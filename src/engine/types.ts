import type { Gear, ItemId } from './items';

export type Team = 'player' | 'enemy';
/** floor: walkable. wall: blocks movement + sight. half/full: cover objects (block movement, not sight). water: impassable. */
export type Terrain = 'floor' | 'wall' | 'half' | 'full' | 'water';
export type CoverType = 'none' | 'half' | 'full';

export interface Pos {
  x: number;
  y: number;
}

/** Ground type of a battle map; drives generation and floor colour. Matches the world-map regions. */
export type Biome = 'beach' | 'forest' | 'wastes' | 'marsh' | 'mountain' | 'canyon' | 'volcano';

export interface GameMap {
  width: number;
  height: number;
  /** tiles[y][x] */
  tiles: Terrain[][];
  biome?: Biome;
}

/** Conditions a hit can leave on someone. Defined in status.ts. */
export type StatusId =
  | 'stun'
  | 'bleed'
  | 'poison'
  | 'burn'
  | 'shaken'
  | 'scared'
  | 'blind'
  | 'silenced'
  | 'charmed'
  | 'marked'
  | 'hidden'
  | 'braced';

export interface Status {
  id: StatusId;
  /** own turns left; it ticks at the start of its owner's turn */
  turns: number;
}

/** A chance for a hit to leave a status behind. */
export interface Inflict {
  effect: StatusId;
  /** 0-1, rolled on every hit that leaves the target standing */
  chance: number;
  /** how long it lasts; defaults to the status's own length */
  turns?: number;
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
  /** hands needed to hold it; a two-hander fills both hand slots on the action bar */
  hands: 1 | 2;
  /** attacking with it ends the unit's turn (its remaining AP is spent); a light weapon costs just its 1 AP */
  heavy: boolean;
  /** adjacent targets only: cover does not help against it, there is no range falloff, and it never runs out of ammo */
  melee?: boolean;
  /** 0 = scraps and sticks, 1 = proper hand-made weapons, 2 = crude but deadly; shown on the item */
  tier?: number;
  /** chance (0-1) the weapon breaks on every attack. Cheap weapons are fragile. */
  breakChance?: number;
  /** what a hit can do besides damage */
  inflicts?: Inflict[];
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
  /** hit chance with anything thrown or fired */
  aim: number;
  /** hit chance swinging at someone in reach; falls back to `aim` when a unit has no separate training */
  meleeAim?: number;
  /** how hard this unit is to hit at a distance */
  defense: number;
  /** how hard this unit is to hit from arm's reach; falls back to `defense` */
  meleeDefense?: number;
  /** how far this unit can see (tiles); falls back to SIGHT_RANGE */
  sight?: number;
  /** rule flags from this unit's perks (see PerkFlag) */
  flags?: string[];
  /** the Charm attribute, which a few skills read; absent on hand-built units */
  charm?: number;
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
  /** shots landed / enemies downed this battle (feeds XP; absent until the first one) */
  hits?: number;
  kills?: number;
  /** the player character: their first fall in a battle is a knock-down, not a death (see resolveShot) */
  protagonist?: boolean;
  /** knocked down but not dead: out of the fight (alive is false) until an adjacent ally revives them */
  downed?: boolean;
  /** how many times this unit has gone down this battle */
  downs?: number;
  /** key of this unit's art (a file or folder in src/assets/sprites); defaults to the lowercase name */
  sprite?: string;
  /** what the unit wears and carries (slot -> item id); the hand slots decide `weapon`, the worn slots its stats */
  gear?: Gear;
  /** conditions on this unit (absent when it has none) */
  status?: Status[];
  /** extra skill ids this unit has on its action bar (from its clique and class); see skills.ts */
  skills?: string[];
  /** how many times each skill (and each once-a-battle perk) has fired this battle */
  uses?: Record<string, number>;
  /** how a non-leader fell: killed outright, or knocked out cold (still there at the end of a won fight, to be dealt with) */
  fate?: 'dead' | 'unconscious';
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
      /** the target was knocked down rather than killed (so `killed` is true but they can be revived) */
      downed?: boolean;
      /** the blow would have put them down, but Iron Will kept them up on 1 HP */
      held?: boolean;
      /** a free hit as the target walked out of reach */
      opportunity?: boolean;
      /** the attacker's weapon broke on this attack */
      broke?: boolean;
      weaponName?: string;
      /** conditions this hit left on the target */
      inflicted?: StatusId[];
      /** a rival went down: killed or knocked out */
      fate?: 'dead' | 'unconscious';
      overwatch: boolean;
      hitChance: number;
    }
  | { type: 'revive'; unitId: string; targetId: string }
  /** a class or clique skill that is not a shot (charm, incognito, patch up); `ok` is false when it failed (a charm that did not take) */
  | { type: 'skill'; unitId: string; skillId: string; targetId?: string; ok: boolean }
  | { type: 'overwatch'; unitId: string }
  | { type: 'reload'; unitId: string }
  | { type: 'gear'; unitId: string }
  | { type: 'tick'; unitId: string; effect: StatusId; damage: number; fell?: boolean }
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
  /** items lying on tiles ("x,y" -> item ids): what fallen units left behind. Absent until something drops. */
  ground?: Record<string, ItemId[]>;
}
