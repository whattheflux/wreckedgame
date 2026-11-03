import type { BattleEvent, GameState, Pos, Unit } from './types';
import { computeShot } from './combat';
import { dist } from './grid';
import { endTurn, living, moveApCost, moveUnit, reachableFor, reload, setOverwatch, shoot } from './battle';

type Action =
  | { kind: 'shoot'; targetId: string }
  | { kind: 'move'; dest: Pos }
  | { kind: 'reload' }
  | { kind: 'overwatch' }
  | { kind: 'idle' };

const avg = (a: number, b: number): number => (a + b) / 2;

/** Expected damage per round the player squad could put on `u` if it stood at `pos`. */
function threatAt(state: GameState, u: Unit, pos: Pos, players: Unit[]): number {
  let total = 0;
  for (const p of players) {
    const pv = computeShot(state.map, p, p.pos, { defense: u.defense, pos, hp: u.hp });
    if (pv.canShoot) total += (pv.hitChance / 100) * avg(pv.dmgMin, pv.dmgMax);
  }
  return total;
}

function nearestPlayerDist(pos: Pos, players: Unit[]): number {
  let best = Infinity;
  for (const p of players) best = Math.min(best, dist(pos, p.pos));
  return best;
}

function decide(state: GameState, u: Unit): Action {
  if (u.ammo <= 0) return { kind: 'reload' };
  const players = living(state, 'player');
  if (players.length === 0) return { kind: 'idle' };

  const reach = reachableFor(state, u);
  const watchers = players.filter((p) => p.overwatch && p.ammo > 0);

  let bestShot: { score: number; dest: Pos; cost: number; targetId: string } | null = null;

  for (const node of reach.values()) {
    const apCost = moveApCost(node.cost, u.mobility);
    if (u.ap - apCost < 1) continue; // must keep 1 AP to actually shoot

    let value = 0;
    let targetId = '';
    for (const p of players) {
      const pv = computeShot(state.map, u, node.pos, p);
      if (!pv.canShoot) continue;
      const chance = pv.hitChance / 100;
      let v = chance * avg(pv.dmgMin, pv.dmgMax);
      if (pv.dmgMax >= p.hp) v += chance * 4; // go for the kill
      if (pv.flanked) v += 0.5;
      if (v > value) {
        value = v;
        targetId = p.id;
      }
    }
    if (value <= 0) continue;

    let score = value * 1.5 - threatAt(state, u, node.pos, players) * 0.6 - apCost * 0.5;
    // Don't stroll into a watched sightline if we can help it.
    if (node.cost > 0) {
      const watched = watchers.some(
        (o) => computeShot(state.map, o, o.pos, { defense: u.defense, pos: node.pos, hp: u.hp }, true).canShoot,
      );
      if (watched) score -= 4;
    }
    if (!bestShot || score > bestShot.score) bestShot = { score, dest: node.pos, cost: node.cost, targetId };
  }

  if (bestShot) {
    return bestShot.cost === 0 ? { kind: 'shoot', targetId: bestShot.targetId } : { kind: 'move', dest: bestShot.dest };
  }

  // Nothing in reach: close the distance, preferring tiles with less exposure.
  const here = nearestPlayerDist(u.pos, players);
  let bestAdvance: { score: number; dest: Pos } | null = null;
  for (const node of reach.values()) {
    if (node.cost === 0) continue;
    const d = nearestPlayerDist(node.pos, players);
    if (d >= here - 0.5) continue;
    const score = -d - threatAt(state, u, node.pos, players) * 0.4;
    if (!bestAdvance || score > bestAdvance.score) bestAdvance = { score, dest: node.pos };
  }
  if (bestAdvance) return { kind: 'move', dest: bestAdvance.dest };
  return u.ammo > 0 ? { kind: 'overwatch' } : { kind: 'idle' };
}

/**
 * Perform ONE enemy action (so the UI can pace and animate them). Returns the events,
 * or null when every enemy has finished and the turn is handed back to the player.
 * Every branch spends AP, so a turn always terminates.
 */
export function enemyStep(state: GameState): BattleEvent[] | null {
  if (state.winner || state.active !== 'enemy') return null;
  const unit = state.units.find((u) => u.team === 'enemy' && u.alive && u.ap > 0);
  if (!unit) {
    endTurn(state); // every enemy is spent: hand the turn back to the player
    return null;
  }

  const action = decide(state, unit);
  let result;
  switch (action.kind) {
    case 'shoot':
      result = shoot(state, unit.id, action.targetId);
      break;
    case 'move':
      result = moveUnit(state, unit.id, action.dest);
      break;
    case 'reload':
      result = reload(state, unit.id);
      break;
    case 'overwatch':
      result = setOverwatch(state, unit.id);
      break;
    default:
      result = { ok: true, events: [] as BattleEvent[] };
      unit.ap = 0;
  }
  if (!result.ok) unit.ap = 0; // never loop on an invalid decision
  return result.events;
}
