import { parseMap, type GameState, type Unit } from './index';

/** A plain unit with sensible defaults; override whatever the test cares about. */
export function unit(over: Partial<Unit> & Pick<Unit, 'id' | 'team'>): Unit {
  return {
    name: over.id,
    role: 'test',
    pos: { x: 0, y: 0 },
    hp: 10,
    maxHp: 10,
    ap: 2,
    maxAp: 2,
    mobility: 5,
    aim: 70,
    defense: 0,
    critChance: 0,
    weapon: { name: 'Test', damage: [3, 3], range: 12, optimal: 12, aimMod: 0, critMod: 0, clip: 6, hands: 1, heavy: false },
    ammo: 6,
    overwatch: false,
    alive: true,
    pod: null,
    dormant: false,
    attacked: false,
    idleTurns: 0,
    ...over,
  };
}

/** A hand-built battle on an ASCII map. . floor  # wall  h half  F full  ~ water */
export function arena(rows: string[], units: Unit[], seed = 1): GameState {
  const map = parseMap(rows);
  return {
    name: 'test',
    map,
    units,
    active: 'player',
    turn: 1,
    rngState: seed,
    winner: null,
    log: [],
    explored: Array.from({ length: map.height }, () => Array<boolean>(map.width).fill(false)),
    turnsSinceContact: 0,
  };
}

export const open = (w: number, h: number): string[] => Array.from({ length: h }, () => '.'.repeat(w));
