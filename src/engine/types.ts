export type Team = 'player' | 'enemy';
/** floor: walkable. wall: blocks movement + sight. half/full: cover objects (block movement, not sight). water: impassable. */
export type Terrain = 'floor' | 'wall' | 'half' | 'full' | 'water';
export type CoverType = 'none' | 'half' | 'full';

export interface Pos {
  x: number;
  y: number;
}

export interface GameMap {
  width: number;
  height: number;
  /** tiles[y][x] */
  tiles: Terrain[][];
}

export interface Weapon {
  name: string;
  damage: [number, number];
  /** max range in tiles */
  range: number;
  /** range beyond which accuracy falls off */
  optimal: number;
  aimMod: number;
  critMod: number;
  clip: number;
}

export interface Unit {
  id: string;
  name: string;
  team: Team;
  role: string;
  pos: Pos;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  /** tiles covered per movement AP */
  mobility: number;
  aim: number;
  defense: number;
  critChance: number;
  weapon: Weapon;
  ammo: number;
  overwatch: boolean;
  alive: boolean;
}

export type BattleEvent =
  | { type: 'move'; unitId: string; from: Pos; path: Pos[] }
  | {
      type: 'shoot';
      attackerId: string;
      targetId: string;
      hit: boolean;
      crit: boolean;
      damage: number;
      killed: boolean;
      overwatch: boolean;
      hitChance: number;
    }
  | { type: 'overwatch'; unitId: string }
  | { type: 'reload'; unitId: string }
  | { type: 'turn'; team: Team; turn: number }
  | { type: 'end'; winner: Team };

export interface LogEntry {
  team: Team | 'sys';
  text: string;
}

/** Plain-JSON game state: serialisable for saves, and shared by every layer of the game. */
export interface GameState {
  name: string;
  map: GameMap;
  units: Unit[];
  active: Team;
  turn: number;
  rngState: number;
  winner: Team | null;
  log: LogEntry[];
}
