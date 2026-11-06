import type { BattleEvent, GameState, Pos, Unit } from './types';
import { computeShot } from './combat';
import { canUseSkills } from './status';
import { avg, coverValueVs, nearestUnit, threatAt } from './tactics';
import { endTurn, living, moveApCost, moveUnit, reachableFor, reload, setOverwatch, shoot } from './battle';

type Action =
  | { kind: 'shoot'; targetId: string }
  | { kind: 'move'; dest: Pos }
  | { kind: 'reload' }
  | { kind: 'overwatch' }
  | { kind: 'idle' };

/** Score penalty for ending a move inside a sightline a player unit is watching. */
const WATCHED_PENALTY = 4;
/** Hold an overwatch ambush for at most this many consecutive turns before getting impatient. */
const MAX_AMBUSH_TURNS = 2;

/**
 * Decision order for one awake enemy unit:
 *  1. Having already fired this turn and standing somewhere dangerous: duck into cover (but stay in the fight).
 *  2. Take the best shot available (possibly after repositioning), weighing exposure at the firing tile.
 *  3. Sitting in good cover with the squad close: hold overwatch and let them walk into it.
 *  4. Otherwise advance cover-to-cover, staying with the group, more boldly the longer it has waited.
 */
function decide(state: GameState, u: Unit): Action {
  const melee = !!u.weapon.melee;
  if (!melee && u.ammo <= 0) return { kind: 'reload' };
  const players = living(state, 'player');
  if (players.length === 0) return { kind: 'idle' };

  const reach = reachableFor(state, u);
  const watchers = players.filter((p) => p.overwatch && p.ammo > 0);
  const isWatched = (pos: Pos): boolean =>
    watchers.some((o) => computeShot(state.map, o, o.pos, { defense: u.defense, pos, hp: u.hp }, true).canShoot);
  const allies = living(state, 'enemy').filter((a) => a.id !== u.id && !a.dormant);

  // 1. Already fired this turn and out in the open: shoot-and-scoot into cover, staying within weapon range.
  const threatHere = threatAt(state, u, u.pos, players);
  if (!melee && u.attacked && u.ap >= 1 && threatHere > 0.8) {
    let best: { pos: Pos; threat: number; score: number } | null = null;
    for (const node of reach.values()) {
      if (node.cost === 0) continue;
      const near = nearestUnit(node.pos, players);
      if (!near || near.d > u.weapon.range) continue; // don't just flee the fight
      const threat = threatAt(state, u, node.pos, players);
      const score = -threat - node.cost * 0.05 - (isWatched(node.pos) ? WATCHED_PENALTY : 0);
      if (!best || score > best.score) best = { pos: node.pos, threat, score };
    }
    if (best && threatHere - best.threat >= 0.8) return { kind: 'move', dest: best.pos };
  }

  // 2. Best shot, from here or after one move.
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
      let v = chance * avg(pv.dmgMin, pv.dmgMax) * (1 + 0.5 * (pv.critChance / 100)); // a crit is +50% damage
      if (pv.dmgMax >= p.hp) v += chance * 4; // go for the kill
      if (v > value) {
        value = v;
        targetId = p.id;
      }
    }
    if (value <= 0) continue;

    let score = value * 1.5 - threatAt(state, u, node.pos, players) * 0.6 - apCost * 0.5;
    if (node.cost > 0 && isWatched(node.pos)) score -= WATCHED_PENALTY;
    if (!bestShot || score > bestShot.score) bestShot = { score, dest: node.pos, cost: node.cost, targetId };
  }
  if (bestShot) {
    return bestShot.cost === 0 ? { kind: 'shoot', targetId: bestShot.targetId } : { kind: 'move', dest: bestShot.dest };
  }

  // 3. Dug in with the squad nearby: set an ambush.
  const nearest = nearestUnit(u.pos, players);
  if (
    !melee &&
    canUseSkills(u) &&
    nearest &&
    u.ap >= 1 &&
    u.idleTurns < MAX_AMBUSH_TURNS &&
    coverValueVs(state.map, nearest.unit.pos, u.pos) >= 2 &&
    nearest.d <= u.mobility + u.weapon.range
  ) {
    return { kind: 'overwatch' };
  }

  // 4. Advance toward the squad, hopping between cover and keeping the group together.
  const eagerness = 0.6 + 0.4 * u.idleTurns;
  const score = (pos: Pos): number => {
    const n = nearestUnit(pos, players);
    if (!n) return 0;
    let s = -eagerness * n.d + coverValueVs(state.map, n.unit.pos, pos) - 0.5 * threatAt(state, u, pos, players);
    const ally = nearestUnit(pos, allies);
    if (ally && ally.d > 5) s -= 0.4 * (ally.d - 5);
    return s;
  };
  const hereScore = score(u.pos);
  let bestAdvance: { score: number; dest: Pos } | null = null;
  for (const node of reach.values()) {
    if (node.cost === 0) continue;
    const s = score(node.pos) - (isWatched(node.pos) ? WATCHED_PENALTY : 0);
    if (!bestAdvance || s > bestAdvance.score) bestAdvance = { score: s, dest: node.pos };
  }
  if (bestAdvance && bestAdvance.score > hereScore + 0.5) return { kind: 'move', dest: bestAdvance.dest };

  return !melee && canUseSkills(u) && u.ammo > 0 && u.ap >= 1 ? { kind: 'overwatch' } : { kind: 'idle' };
}

/**
 * Perform ONE enemy action (so the UI can pace and animate them). Returns the events,
 * or null when every enemy has finished and the turn is handed back to the player.
 * Dormant pods have 0 AP and are skipped. Every branch spends AP, so a turn always terminates.
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
      if (result.ok) unit.idleTurns = 0;
      break;
    case 'reload':
      result = reload(state, unit.id);
      break;
    case 'overwatch':
      result = setOverwatch(state, unit.id);
      if (result.ok) unit.idleTurns += 1;
      break;
    default:
      result = { ok: true, events: [] as BattleEvent[] };
      unit.ap = 0;
      unit.idleTurns += 1;
  }
  if (!result.ok) unit.ap = 0; // never loop on an invalid decision
  return result.events;
}
