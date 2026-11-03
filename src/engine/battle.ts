import type { BattleEvent, GameMap, GameState, Pos, Team, Unit, Weapon } from './types';
import { pathTo, posKey, reachableTiles, type PathNode } from './grid';
import { computeShot, resolveShot } from './combat';

export interface UnitSpec {
  id: string;
  name: string;
  team: Team;
  role: string;
  x: number;
  y: number;
  hp: number;
  mobility: number;
  aim: number;
  defense: number;
  crit: number;
  weapon: Weapon;
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
    maxHp: s.hp,
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
  };
}

export function createBattle(sc: Scenario): GameState {
  const state: GameState = {
    name: sc.name,
    map: sc.map(),
    units: sc.units.map(spawn),
    active: 'player',
    turn: 1,
    rngState: sc.seed | 0,
    winner: null,
    log: [],
  };
  startTurn(state, 'player');
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
      u.ap = u.maxAp;
      u.overwatch = false;
    }
  }
  state.log.push({ team: 'sys', text: `--- Turn ${state.turn}: ${team === 'player' ? 'Your squad' : 'Rival faction'} ---` });
}

export function endTurn(state: GameState): BattleEvent[] {
  if (state.winner) return [];
  state.active = state.active === 'player' ? 'enemy' : 'player';
  if (state.active === 'player') state.turn += 1;
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

export function moveUnit(state: GameState, id: string, dest: Pos): ActionResult {
  const v = validateActor(state, id);
  if ('error' in v) return fail(v.error);
  const unit = v.unit;

  const reach = reachableFor(state, unit);
  const key = posKey(dest.x, dest.y);
  const node = reach.get(key);
  if (!node || node.cost === 0) return fail('Cannot reach that tile');
  const apCost = moveApCost(node.cost, unit.mobility);
  if (apCost > unit.ap) return fail('Not enough AP');

  const from = { ...unit.pos };
  const path = pathTo(reach, key);
  const traveled: Pos[] = [];
  const reactions: BattleEvent[] = [];

  state.log.push({ team: unit.team, text: `${unit.name} ${apCost > 1 ? 'dashes' : 'moves'}.` });
  for (const step of path) {
    unit.pos = { ...step };
    traveled.push(step);
    reactions.push(...triggerOverwatch(state, unit));
    if (!unit.alive) break;
  }
  unit.ap -= apCost;

  const events: BattleEvent[] = [{ type: 'move', unitId: unit.id, from, path: traveled }, ...reactions];
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

  attacker.ap -= 1;
  attacker.ammo -= 1;
  const events: BattleEvent[] = [resolveShot(state, attacker, target, pv, false)];
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
  state.log.push({ team: unit.team, text: `${unit.name} sets overwatch.` });
  return { ok: true, events: [{ type: 'overwatch', unitId: unit.id }] };
}

export function reload(state: GameState, id: string): ActionResult {
  const v = validateActor(state, id);
  if ('error' in v) return fail(v.error);
  const unit = v.unit;
  if (unit.ammo >= unit.weapon.clip) return fail('Already full');
  unit.ap -= 1;
  unit.ammo = unit.weapon.clip;
  state.log.push({ team: unit.team, text: `${unit.name} reloads ${unit.weapon.name}.` });
  return { ok: true, events: [{ type: 'reload', unitId: unit.id }] };
}
