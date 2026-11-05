import type { BattleEvent, GameMap, GameState, Pos, Team, Unit, Weapon } from './types';
import { pathTo, posKey, reachableTiles, type PathNode } from './grid';
import { computeShot, resolveShot } from './combat';
import { podsToWake, updateExplored } from './vision';
import { coverValueVs, nearestUnit } from './tactics';

export interface UnitSpec {
  id: string;
  name: string;
  team: Team;
  role: string;
  x: number;
  y: number;
  hp: number;
  /** defaults to `hp`; set it lower-than-max `hp` to deploy a wounded unit */
  maxHp?: number;
  mobility: number;
  aim: number;
  defense: number;
  crit: number;
  weapon: Weapon;
  /** enemies sharing a pod id start dormant together and wake together */
  pod?: string;
}

export interface Scenario {
  name: string;
  seed: number;
  map: () => GameMap;
  units: UnitSpec[];
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  events: BattleEvent[];
}

const MAX_AP = 2;

const fail = (error: string): ActionResult => ({ ok: false, error, events: [] });

function spawn(s: UnitSpec): Unit {
  return {
    id: s.id,
    name: s.name,
    team: s.team,
    role: s.role,
    pos: { x: s.x, y: s.y },
    hp: s.hp,
    maxHp: s.maxHp ?? s.hp,
    ap: 0,
    maxAp: MAX_AP,
    mobility: s.mobility,
    aim: s.aim,
    defense: s.defense,
    critChance: s.crit,
    weapon: s.weapon,
    ammo: s.weapon.clip,
    overwatch: false,
    alive: true,
    pod: s.pod ?? null,
    dormant: s.team === 'enemy' && s.pod !== undefined,
    attacked: false,
    idleTurns: 0,
  };
}

export function createBattle(sc: Scenario): GameState {
  const map = sc.map();
  const state: GameState = {
    name: sc.name,
    map,
    units: sc.units.map(spawn),
    active: 'player',
    turn: 1,
    rngState: sc.seed | 0,
    winner: null,
    log: [],
    explored: Array.from({ length: map.height }, () => Array<boolean>(map.width).fill(false)),
    turnsSinceContact: 0,
  };
  startTurn(state, 'player');
  updateExplored(state);
  return state;
}

export const getUnit = (state: GameState, id: string): Unit | undefined => state.units.find((u) => u.id === id);

export const unitAt = (state: GameState, x: number, y: number): Unit | undefined =>
  state.units.find((u) => u.alive && u.pos.x === x && u.pos.y === y);

export const living = (state: GameState, team: Team): Unit[] => state.units.filter((u) => u.alive && u.team === team);

/** Movement AP: up to `mobility` tiles = 1 AP, up to 2x = 2 AP (dash). */
export const moveApCost = (cost: number, mobility: number): number => (cost <= 0 ? 0 : Math.ceil(cost / mobility));

export function reachableFor(state: GameState, u: Unit): Map<string, PathNode> {
  const maxCost = u.mobility * Math.min(u.ap, MAX_AP);
  return reachableTiles(state.map, state.units, u, maxCost);
}

function startTurn(state: GameState, team: Team): void {
  for (const u of state.units) {
    if (u.team === team && u.alive) {
      u.ap = u.dormant ? 0 : u.maxAp; // dormant pods don't act until discovered
      u.overwatch = false;
      u.attacked = false;
    }
  }
  state.log.push({ team: 'sys', text: `--- Turn ${state.turn}: ${team === 'player' ? 'Your squad' : 'Rival faction'} ---` });
}

export function endTurn(state: GameState): BattleEvent[] {
  if (state.winner) return [];
  state.active = state.active === 'player' ? 'enemy' : 'player';
  if (state.active === 'player') {
    state.turn += 1;
    state.turnsSinceContact += 1;
  }
  startTurn(state, state.active);
  return [{ type: 'turn', team: state.active, turn: state.turn }];
}

export const playerTurnOver = (state: GameState): boolean => living(state, 'player').every((u) => u.ap <= 0);

function checkWin(state: GameState, events: BattleEvent[]): void {
  if (state.winner) return;
  let winner: Team | null = null;
  if (living(state, 'enemy').length === 0) winner = 'player';
  else if (living(state, 'player').length === 0) winner = 'enemy';
  if (!winner) return;
  state.winner = winner;
  events.push({ type: 'end', winner });
  state.log.push({ team: 'sys', text: winner === 'player' ? 'Rival faction routed. Victory!' : 'Your squad is down. Defeat.' });
}

function validateActor(state: GameState, id: string, minAp = 1): { unit: Unit } | { error: string } {
  const unit = getUnit(state, id);
  if (!unit || !unit.alive) return { error: 'No such unit' };
  if (state.winner) return { error: 'Battle is over' };
  if (state.active !== unit.team) return { error: 'Not this unit\'s turn' };
  if (unit.ap < minAp) return { error: 'Not enough AP' };
  return { unit };
}

/** Enemy overwatch units that can see the mover each get one reaction shot. */
function triggerOverwatch(state: GameState, mover: Unit): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (const o of state.units) {
    if (!mover.alive) break;
    if (!o.alive || o.team === mover.team || !o.overwatch || o.ammo <= 0) continue;
    const pv = computeShot(state.map, o, o.pos, mover, true);
    if (!pv.canShoot) continue;
    o.overwatch = false;
    o.ammo -= 1;
    events.push(resolveShot(state, o, mover, pv, true));
  }
  return events;
}

interface WalkResult {
  traveled: Pos[];
  reactions: BattleEvent[];
  /** pods discovered mid-walk (only checked when `detect` is set); walking stops at the first discovery */
  woke: string[];
}

/** Step a unit along a path, taking overwatch fire, and (for the player) stopping the moment a pod is discovered. */
function walk(state: GameState, unit: Unit, path: Pos[], detect: boolean): WalkResult {
  const traveled: Pos[] = [];
  const reactions: BattleEvent[] = [];
  let woke: string[] = [];
  for (const step of path) {
    unit.pos = { ...step };
    traveled.push(step);
    reactions.push(...triggerOverwatch(state, unit));
    if (!unit.alive) break;
    if (detect) {
      woke = podsToWake(state);
      if (woke.length > 0) break;
    }
  }
  return { traveled, reactions, woke };
}

/**
 * A discovered pod snaps to the best cover within one move (facing the nearest squad member), taking
 * overwatch fire on the way. Scored on cover, not on incoming fire, so they dive for cover rather
 * than simply backing out of weapon range.
 */
function scamper(state: GameState, members: Unit[]): BattleEvent[] {
  const events: BattleEvent[] = [];
  const players = living(state, 'player');
  for (const m of members) {
    if (!m.alive) continue;
    const reach = reachableTiles(state.map, state.units, m, m.mobility);
    let best: { key: string; score: number } | null = null;
    for (const [key, node] of reach) {
      const threat = nearestUnit(node.pos, players);
      const cover = threat ? coverValueVs(state.map, threat.unit.pos, node.pos) : 0;
      const score = cover - node.cost * 0.3; // a tie goes to the shorter move
      if (!best || score > best.score) best = { key, score };
    }
    if (!best) continue;
    const path = pathTo(reach, best.key);
    if (path.length === 0) continue;
    const from = { ...m.pos };
    state.log.push({ team: 'enemy', text: `${m.name} scrambles for cover.`, at: [from, path[path.length - 1]] });
    const w = walk(state, m, path, false);
    events.push({ type: 'move', unitId: m.id, from, path: w.traveled }, ...w.reactions);
  }
  return events;
}

/** Wake every living member of a pod: contact is made, the clock for the direction hint resets, and they scamper. */
function wakePod(state: GameState, podId: string): BattleEvent[] {
  const members = state.units.filter((u) => u.alive && u.pod === podId && u.dormant);
  if (members.length === 0) return [];
  for (const m of members) m.dormant = false;
  state.turnsSinceContact = 0;
  state.log.push({
    team: 'sys',
    text: `CONTACT! ${members.length} hostile${members.length === 1 ? '' : 's'} spotted.`,
    at: members.map((m) => ({ ...m.pos })),
  });
  return [{ type: 'reveal', podId, unitIds: members.map((m) => m.id) }, ...scamper(state, members)];
}

export function moveUnit(state: GameState, id: string, dest: Pos): ActionResult {
  const v = validateActor(state, id);
  if ('error' in v) return fail(v.error);
  const unit = v.unit;

  const reach = reachableFor(state, unit);
  const key = posKey(dest.x, dest.y);
  const node = reach.get(key);
  if (!node || node.cost === 0) return fail('Cannot reach that tile');
  const plannedCost = moveApCost(node.cost, unit.mobility);
  if (plannedCost > unit.ap) return fail('Not enough AP');

  const from = { ...unit.pos };
  const path = pathTo(reach, key);
  state.log.push({ team: unit.team, text: `${unit.name} ${plannedCost > 1 ? 'dashes' : 'moves'}.`, at: [from, { ...dest }] });

  const w = walk(state, unit, path, unit.team === 'player');
  // Pay only for the distance actually covered (an interrupted dash may cost less than planned).
  unit.ap -= Math.min(unit.ap, Math.max(1, moveApCost(w.traveled.length, unit.mobility)));

  const events: BattleEvent[] = [{ type: 'move', unitId: unit.id, from, path: w.traveled }, ...w.reactions];
  for (const podId of w.woke) events.push(...wakePod(state, podId));
  if (unit.team === 'player' && unit.alive) updateExplored(state);
  checkWin(state, events);
  return { ok: true, events };
}

export function shoot(state: GameState, id: string, targetId: string): ActionResult {
  const v = validateActor(state, id);
  if ('error' in v) return fail(v.error);
  const attacker = v.unit;
  const target = getUnit(state, targetId);
  if (!target || !target.alive) return fail('No such target');
  if (target.team === attacker.team) return fail('Cannot target an ally');
  if (attacker.ammo <= 0) return fail('Out of ammo - reload');

  const pv = computeShot(state.map, attacker, attacker.pos, target);
  if (!pv.canShoot) return fail(pv.reason ?? 'Cannot shoot');

  const wasDormant = target.dormant;
  attacker.ap -= 1;
  attacker.ammo -= 1;
  attacker.attacked = true;
  attacker.idleTurns = 0;
  const events: BattleEvent[] = [resolveShot(state, attacker, target, pv, false)];
  // Being shot at (even at extreme range) wakes the whole pod.
  if (wasDormant && target.pod) events.push(...wakePod(state, target.pod));
  checkWin(state, events);
  return { ok: true, events };
}

/** Spend remaining AP to watch: the first enemy that moves in sight eats a reaction shot. */
export function setOverwatch(state: GameState, id: string): ActionResult {
  const v = validateActor(state, id);
  if ('error' in v) return fail(v.error);
  const unit = v.unit;
  if (unit.ammo <= 0) return fail('Out of ammo - reload');
  unit.ap = 0;
  unit.overwatch = true;
  state.log.push({ team: unit.team, text: `${unit.name} sets overwatch.`, at: [{ ...unit.pos }] });
  return { ok: true, events: [{ type: 'overwatch', unitId: unit.id }] };
}

export function reload(state: GameState, id: string): ActionResult {
  const v = validateActor(state, id);
  if ('error' in v) return fail(v.error);
  const unit = v.unit;
  if (unit.ammo >= unit.weapon.clip) return fail('Already full');
  unit.ap -= 1;
  unit.ammo = unit.weapon.clip;
  state.log.push({ team: unit.team, text: `${unit.name} reloads ${unit.weapon.name}.`, at: [{ ...unit.pos }] });
  return { ok: true, events: [{ type: 'reload', unitId: unit.id }] };
}
