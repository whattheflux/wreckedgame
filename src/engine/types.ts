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
  /** pod (cluster) this unit belongs to, or null for a lone unit */
  pod: string | null;
  /** dormant units stand their ground until their pod is discovered */
  dormant: boolean;
  /** has fired this turn (AI uses it to decide whether to fall back to cover) */
  attacked: boolean;
  /** consecutive turns the AI has held position (drives impatience) */
  idleTurns: number;
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
  | { type: 'reveal'; podId: string; unitIds: string[] }
  | { type: 'turn'; team: Team; turn: number }
  | { type: 'end'; winner: Team };

export interface LogEntry {
  team: Team | 'sys';
  text: string;
  /** where it happened; enemy entries are only shown to the player if one of these tiles is visible */
  at?: Pos[];
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
  /** tiles the player has ever seen: explored[y][x] */
  explored: boolean[][];
  /** player turns since a hostile pod was last discovered; drives the direction hint */
  turnsSinceContact: number;
}
