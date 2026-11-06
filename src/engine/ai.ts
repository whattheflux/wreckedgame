import type { BattleEvent, GameState, Pos, Unit } from './types';
import { computeShot } from './combat';
import { canUseSkills, hasStatus, isHiddenFrom } from './status';
import { avg, coverValueVs, nearestUnit, threatAt } from './tactics';
import { endTurn, living, moveApCost, moveUnit, reachableFor, reload, setOverwatch, shoot } from './battle';
import { TACKLE_HIT, TACKLE_STUN, skillBlock, thrownWeapon, useSkill } from './abilities';
import { EXTRA_SKILLS, type Skill } from './skills';
import { dist } from './grid';

type Action =
  | { kind: 'shoot'; targetId: string }
  | { kind: 'move'; dest: Pos }
  | { kind: 'reload' }
  | { kind: 'overwatch' }
  | { kind: 'skill'; skillId: string; targetId?: string }
  | { kind: 'idle' };

/** Hurt this badly and a rival who can shake it off will stop and do that. */
const PATCH_UP_BELOW = 0.4;
/** A shout is only worth a turn if it lands on at least this many of the squad. */
const SHOUT_WORTH_IT = 2;
/** How much better a thrown skill has to look than the plain attack before the AI reaches for it. */
const SKILL_MARGIN = 1.15;

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
/** The expected damage a shot preview is worth, with a nudge for finishing someone off. */
function shotValue(pv: ReturnType<typeof computeShot>, target: Unit): number {
  if (!pv.canShoot) return 0;
  const chance = pv.hitChance / 100;
  let v = chance * avg(pv.dmgMin, pv.dmgMax) * (1 + 0.5 * (pv.critChance / 100)); // a crit is +50% damage
  if (pv.dmgMax >= target.hp) v += chance * 4; // go for the kill
  return v;
}

/** The skills this unit could use right now, in the order its kind prefers them. */
const readySkills = (state: GameState, u: Unit): Skill[] =>
  (u.skills ?? []).map((id) => EXTRA_SKILLS[id]).filter((k): k is Skill => !!k && skillBlock(state, u, k) === null);

function decide(state: GameState, u: Unit): Action {
  const melee = !!u.weapon.melee;
  if (!melee && u.ammo <= 0) return { kind: 'reload' };
  // hidden (incognito) units can't be seen from a distance, so they aren't targets or threats
  const players = living(state, 'player').filter((p) => !isHiddenFrom(p, u));
  if (players.length === 0) return { kind: 'idle' };
  const ready = readySkills(state, u);
  const has = (id: string): Skill | undefined => ready.find((k) => k.id === id);

  // 0. Burning, bleeding or nearly finished, and able to do something about it: do that first.
  const mellow = has('mellow');
  if (mellow && (u.hp <= u.maxHp * PATCH_UP_BELOW || hasStatus(u, 'burn') || hasStatus(u, 'bleed'))) {
    return { kind: 'skill', skillId: mellow.id };
  }

  const reach = reachableFor(state, u);
  const watchers = players.filter((p) => p.overwatch && p.ammo > 0);
  const isWatched = (pos: Pos): boolean =>
    watchers.some((o) => computeShot(state.map, o, o.pos, { defense: u.defense, meleeDefense: u.meleeDefense, pos, hp: u.hp }, true).canShoot);
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

  // 1b. A shout that catches a crowd is worth an action point, provided there is one left to use after.
  for (const shout of [has('warCry'), has('unsettle')]) {
    if (!shout || u.ap < 2) continue;
    const reach = shout.range ?? 4;
    const caught = players.filter((p) => dist(u.pos, p.pos) <= reach && !hasStatus(p, shout.id === 'warCry' ? 'shaken' : 'scared'));
    if (caught.length >= SHOUT_WORTH_IT) return { kind: 'skill', skillId: shout.id };
  }

  // 1c. Call out the gap in someone, then shoot them with the rest of the turn.
  const analyse = has('analyse');
  if (analyse && u.ap >= 2) {
    const mark = players.find((p) => !hasStatus(p, 'marked') && computeShot(state.map, u, u.pos, p).canShoot && dist(u.pos, p.pos) <= (analyse.range ?? 9));
    if (mark) return { kind: 'skill', skillId: analyse.id, targetId: mark.id };
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
  // 2b. Anything thrown is weighed against that shot: a beaker or a jar of paint from where they stand.
  let bestThrow: { score: number; skillId: string; targetId: string } | null = null;
  for (const k of ready) {
    const w = thrownWeapon(u, k);
    if (!w) continue;
    for (const p of players) {
      const pv = computeShot(state.map, { aim: u.aim, meleeAim: u.meleeAim, critChance: u.critChance, weapon: w, status: u.status, flags: u.flags }, u.pos, p);
      // what it leaves behind is worth something beyond the damage
      const value = shotValue(pv, p) + (pv.canShoot ? (w.inflicts ?? []).reduce((n, i) => n + i.chance * 2, 0) : 0);
      if (value > 0 && (!bestThrow || value > bestThrow.score)) bestThrow = { score: value, skillId: k.id, targetId: p.id };
    }
  }
  const standingShot = bestShot && bestShot.cost === 0 ? bestShot.score : 0;
  if (bestThrow && bestThrow.score * SKILL_MARGIN > standingShot) {
    return { kind: 'skill', skillId: bestThrow.skillId, targetId: bestThrow.targetId };
  }

  // 2c. A shoulder charge covers the same ground in one action, and usually stuns. Worth it when the
  // weapon they would have closed with is not up to much; not worth it when it is.
  const tackle = has('tackle');
  if (tackle) {
    let best: { score: number; targetId: string } | null = null;
    for (const p of players) {
      if (dist(u.pos, p.pos) > u.mobility + 1.5) continue;
      const pv = computeShot(state.map, { aim: u.aim, meleeAim: u.meleeAim, critChance: u.critChance, weapon: TACKLE_HIT, status: u.status, flags: u.flags }, p.pos, p);
      const score = shotValue({ ...pv, canShoot: true }, p) + TACKLE_STUN * 4;
      if (!best || score > best.score) best = { score, targetId: p.id };
    }
    // the plain plan is whatever branch 2 found; a charge has to beat it outright
    if (best && best.score > (bestShot?.score ?? 0)) return { kind: 'skill', skillId: tackle.id, targetId: best.targetId };
  }

  if (bestShot) {
    return bestShot.cost === 0 ? { kind: 'shoot', targetId: bestShot.targetId } : { kind: 'move', dest: bestShot.dest };
  }

  // 3. Dug in with the squad nearby: set an ambush, or plant your feet if that is all you can do.
  const nearest = nearestUnit(u.pos, players);
  const brace = has('brace');
  if (brace && nearest && nearest.d <= u.mobility + 2 && (melee || u.ammo <= 0) && coverValueVs(state.map, nearest.unit.pos, u.pos) < 2) {
    return { kind: 'skill', skillId: brace.id };
  }
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

  if (!melee && canUseSkills(u) && u.ammo > 0 && u.ap >= 1) return { kind: 'overwatch' };
  // Nothing better to do: get a friend back on their feet, or brace.
  const rally = has('rally');
  if (rally) return { kind: 'skill', skillId: rally.id };
  if (brace) return { kind: 'skill', skillId: brace.id };
  return { kind: 'idle' };
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
    case 'skill':
      result = useSkill(state, unit.id, action.skillId, action.targetId);
      if (result.ok) unit.idleTurns = 0;
      break;
    default:
      result = { ok: true, events: [] as BattleEvent[] };
      unit.ap = 0;
      unit.idleTurns += 1;
  }
  if (!result.ok) unit.ap = 0; // never loop on an invalid decision
  return result.events;
}
