import type { Scenario, UnitSpec } from './battle';
import type { GameState, Unit, Weapon } from './types';
import { WEAPONS } from './scenarios';
import { rand, type RngHolder } from './rng';

/**
 * The persistent squad. Everything here is plain JSON (saveable) and pure logic, like the rest of
 * the engine. A roster member outlives any single battle: it is turned into a battle unit by
 * `deployRoster`, and the battle's outcome is folded back in by `applyBattleResult`.
 *
 * Stats are never stored. They are derived from clique + level + traits + injuries by
 * `effectiveStats`, so they cannot drift out of sync with the things that cause them.
 */

// ---------- data tables ----------

/** Who you are: the social group. Sets the stat line and growth. */
export type Clique = 'popular' | 'jock' | 'nerd' | 'drama' | 'weirdo' | 'stoner';
/** What you studied: the school specialty. Sets the weapon and nudges stats; abilities and tech-tree branches hang off it later. */
export type SchoolClass = 'sport' | 'science' | 'drama' | 'art' | 'homeec' | 'woodwork' | 'metalwork';
export type WeaponId = keyof typeof WEAPONS;

export interface StatBlock {
  hp: number;
  mobility: number;
  aim: number;
  defense: number;
  crit: number;
}

export interface CliqueDef {
  label: string;
  blurb: string;
  /** level-1 stats */
  base: StatBlock;
  /** flat gain per level after the first */
  growth: Omit<StatBlock, 'mobility'>;
  /** +1 mobility every N levels; 0 = never */
  mobilityEvery: number;
}

/** Each clique has a strength and a weakness, so no combination with a class is a trap. */
export const CLIQUES: Record<Clique, CliqueDef> = {
  popular: { label: 'Popular', blurb: 'Everyone knows them. Quick and hard to hit, but fragile.', base: { hp: 10, mobility: 6, aim: 72, defense: 10, crit: 10 }, growth: { hp: 1, aim: 2, defense: 1, crit: 1 }, mobilityEvery: 3 },
  jock: { label: 'Jock', blurb: 'Built to take a hit, but easy to hit back.', base: { hp: 14, mobility: 5, aim: 62, defense: 0, crit: 5 }, growth: { hp: 2, aim: 1, defense: 0, crit: 1 }, mobilityEvery: 0 },
  nerd: { label: 'Nerd', blurb: 'Hits what they aim at, but folds when hit.', base: { hp: 9, mobility: 5, aim: 75, defense: 0, crit: 5 }, growth: { hp: 1, aim: 2, defense: 0, crit: 1 }, mobilityEvery: 0 },
  drama: { label: 'Drama kid', blurb: 'Lives for the big moment. Lucky crits, middling nerve.', base: { hp: 11, mobility: 5, aim: 66, defense: 5, crit: 10 }, growth: { hp: 1, aim: 1, defense: 1, crit: 2 }, mobilityEvery: 0 },
  weirdo: { label: 'Weirdo', blurb: 'Unpredictable. Huge crits, shaky everything else.', base: { hp: 10, mobility: 5, aim: 66, defense: 5, crit: 15 }, growth: { hp: 1, aim: 1, defense: 0, crit: 2 }, mobilityEvery: 0 },
  stoner: { label: 'Stoner', blurb: 'Unbothered. Sturdy and hard to rattle, slow and a poor shot.', base: { hp: 12, mobility: 4, aim: 60, defense: 10, crit: 8 }, growth: { hp: 2, aim: 1, defense: 1, crit: 1 }, mobilityEvery: 0 },
};

export interface ClassDef {
  label: string;
  blurb: string;
  weapon: WeaponId;
  /** added to the clique's level-1 stats */
  base: Partial<StatBlock>;
  /** added to the clique's per-level growth */
  growth: Partial<Omit<StatBlock, 'mobility'>>;
}

export const CLASSES: Record<SchoolClass, ClassDef> = {
  sport: { label: 'Sport', blurb: 'Athletic and quick on their feet. Throws a javelin.', weapon: 'javelin', base: { hp: 2, mobility: 1 }, growth: { hp: 1 } },
  science: { label: 'Science', blurb: 'Careful and precise. Fires flares.', weapon: 'flareGun', base: { aim: 3 }, growth: { aim: 1 } },
  drama: { label: 'Drama', blurb: 'Stagecraft and nerve. Slingshot.', weapon: 'slingshot', base: { defense: 3, crit: 3 }, growth: { crit: 1 } },
  art: { label: 'Art', blurb: 'A good eye for a target. Slingshot.', weapon: 'slingshot', base: { aim: 2, crit: 4 }, growth: { aim: 1 } },
  homeec: { label: 'Home Ec', blurb: 'Patches people up. Slingshot.', weapon: 'slingshot', base: { hp: 1, defense: 2 }, growth: { hp: 1, defense: 1 } },
  woodwork: { label: 'Woodwork', blurb: 'Handy with a sharpened pole.', weapon: 'pole', base: { hp: 1, aim: 2 }, growth: { hp: 1, aim: 1 } },
  metalwork: { label: 'Metalwork', blurb: 'Sturdy and heavy-handed, but slow. Sharpened pole.', weapon: 'pole', base: { hp: 3, defense: 3, mobility: -1 }, growth: { hp: 1, defense: 1 } },
};

export type TraitId = 'sure-footed' | 'eagle-eyed' | 'tough' | 'thick-skinned' | 'jumpy' | 'showboat';

export interface TraitDef {
  name: string;
  blurb: string;
  mods: Partial<StatBlock>;
}

export const TRAITS: Record<TraitId, TraitDef> = {
  'sure-footed': { name: 'Sure-footed', blurb: 'Never trips on roots.', mods: { mobility: 1 } },
  'eagle-eyed': { name: 'Eagle-eyed', blurb: 'Spots the gap in the cover.', mods: { aim: 5 } },
  tough: { name: 'Tough', blurb: 'Shrugs off bruises.', mods: { hp: 2 } },
  'thick-skinned': { name: 'Thick-skinned', blurb: 'Hard to rattle.', mods: { defense: 5 } },
  jumpy: { name: 'Jumpy', blurb: 'Hard to hit, harder to steady.', mods: { defense: 5, aim: -5 } },
  showboat: { name: 'Showboat', blurb: 'Goes for the highlight reel.', mods: { crit: 10, aim: -5 } },
};

/** Levels at which a member picks up a new trait (random, from the ones they don't have). */
export const TRAIT_LEVELS: readonly number[] = [2, 4];

export type InjuryId = 'twisted-ankle' | 'concussion' | 'cracked-ribs' | 'shaken';

export interface InjuryDef {
  name: string;
  mods: Partial<StatBlock>;
  /** completed fights until it heals */
  recovery: number;
}

export const INJURIES: Record<InjuryId, InjuryDef> = {
  'twisted-ankle': { name: 'Twisted ankle', mods: { mobility: -1 }, recovery: 2 },
  concussion: { name: 'Concussion', mods: { aim: -10 }, recovery: 2 },
  'cracked-ribs': { name: 'Cracked ribs', mods: { hp: -3 }, recovery: 3 },
  shaken: { name: 'Shaken up', mods: { aim: -5, crit: -5 }, recovery: 1 },
};

/** A member can carry at most this many injuries; a further one replaces whichever is closest to healing. */
export const MAX_INJURIES = 2;

/** Stat floors so stacked penalties can't make a unit useless. */
export const STAT_FLOOR: StatBlock = { hp: 4, mobility: 3, aim: 30, defense: 0, crit: 0 };

export const MAX_LEVEL = 6;
export const XP_PARTICIPATION = 8;
export const XP_PER_HIT = 2;
export const XP_PER_KILL = 12;
export const XP_VICTORY = 10;
export const xpToNext = (level: number): number => (level >= MAX_LEVEL ? Infinity : 40 * level);

// ---------- model ----------

export interface Injury {
  id: InjuryId;
  /** completed fights left until it heals */
  left: number;
}

export interface RosterMember {
  /** stable; doubles as the battle unit id, which is how results find their way back */
  id: string;
  name: string;
  clique: Clique;
  schoolClass: SchoolClass;
  level: number;
  /** progress toward the next level */
  xp: number;
  traits: TraitId[];
  injuries: Injury[];
  weapon: WeaponId;
  /** current HP, carried between fights; >= 1 while alive */
  hp: number;
  /** fell in battle and is gone for good (see `fateOfDowned`). Kept in the roster so the squad panel can remember them. */
  dead: boolean;
  /** the player character: if they fall, the run is over (see `gameOverReason`) */
  protagonist: boolean;
}

export type Roster = RosterMember[];

/** Most members you can have, and how many take the field in one fight. */
export const MAX_ROSTER = 5;
export const FIELD_SIZE = 4;

export const PLAYER_ID = 'pc';

export interface PlayerChoice {
  name: string;
  clique: Clique;
  schoolClass: SchoolClass;
}

export const DEFAULT_PLAYER: PlayerChoice = { name: 'You', clique: 'popular', schoolClass: 'sport' };

/** The friends who start with you. Clique and class are independent, so these are just their starting picks. */
const COMPANIONS: Array<{ id: string; name: string; clique: Clique; schoolClass: SchoolClass }> = [
  { id: 'p1', name: 'Amy', clique: 'popular', schoolClass: 'homeec' },
  { id: 'p2', name: 'Scott', clique: 'jock', schoolClass: 'sport' },
  { id: 'p3', name: 'Tyson', clique: 'nerd', schoolClass: 'science' },
  { id: 'p4', name: 'Anna', clique: 'drama', schoolClass: 'drama' },
];

export function newMember(id: string, name: string, clique: Clique, schoolClass: SchoolClass, protagonist = false): RosterMember {
  const m: RosterMember = {
    id,
    name,
    clique,
    schoolClass,
    level: 1,
    xp: 0,
    traits: [],
    injuries: [],
    weapon: CLASSES[schoolClass].weapon,
    hp: 1,
    dead: false,
    protagonist,
  };
  m.hp = effectiveStats(m).hp;
  return m;
}

/** The player character plus the four friends: level 1, no traits, full health. */
export function createStarterRoster(player: PlayerChoice = DEFAULT_PLAYER): Roster {
  const name = player.name.trim().slice(0, 16) || DEFAULT_PLAYER.name;
  return [newMember(PLAYER_ID, name, player.clique, player.schoolClass, true), ...COMPANIONS.map((c) => newMember(c.id, c.name, c.clique, c.schoolClass))];
}

export const livingSquad = (roster: Roster): Roster => roster.filter((m) => !m.dead);

/**
 * Who takes the field: the player character always, then the preferred ids in order (living only,
 * duplicates ignored), then anyone else living in roster order, up to FIELD_SIZE.
 */
export function chooseSquad(roster: Roster, preferred: readonly string[] = []): string[] {
  const living = livingSquad(roster);
  const out: string[] = [];
  const add = (id: string): void => {
    if (out.length < FIELD_SIZE && !out.includes(id) && living.some((m) => m.id === id)) out.push(id);
  };
  for (const m of living) if (m.protagonist) add(m.id);
  preferred.forEach(add);
  living.forEach((m) => add(m.id));
  return out;
}

export type GameOver = 'protagonist-fell' | 'squad-lost';

/**
 * The run ends when the player character is dead (a second fall in one fight), or when the whole
 * squad is wiped (a defeat, or nobody left alive).
 */
export function gameOverReason(roster: Roster, outcome?: Outcome): GameOver | null {
  if (roster.some((m) => m.protagonist && m.dead)) return 'protagonist-fell';
  if (outcome === 'defeat' || roster.every((m) => m.dead)) return 'squad-lost';
  return null;
}

// ---------- derived stats ----------

export function baseStats(clique: Clique, schoolClass: SchoolClass, level: number): StatBlock {
  const c = CLIQUES[clique];
  const k = CLASSES[schoolClass];
  const n = level - 1;
  return {
    hp: c.base.hp + (k.base.hp ?? 0) + (c.growth.hp + (k.growth.hp ?? 0)) * n,
    mobility: c.base.mobility + (k.base.mobility ?? 0) + (c.mobilityEvery > 0 ? Math.floor(n / c.mobilityEvery) : 0),
    aim: c.base.aim + (k.base.aim ?? 0) + (c.growth.aim + (k.growth.aim ?? 0)) * n,
    defense: c.base.defense + (k.base.defense ?? 0) + (c.growth.defense + (k.growth.defense ?? 0)) * n,
    crit: c.base.crit + (k.base.crit ?? 0) + (c.growth.crit + (k.growth.crit ?? 0)) * n,
  };
}

/** Clique + class + level, then traits, then injuries, then floors. */
export function effectiveStats(m: RosterMember): StatBlock {
  const s = baseStats(m.clique, m.schoolClass, m.level);
  const add = (mods: Partial<StatBlock>): void => {
    for (const k of Object.keys(mods) as Array<keyof StatBlock>) s[k] += mods[k] ?? 0;
  };
  for (const t of m.traits) add(TRAITS[t].mods);
  for (const i of m.injuries) add(INJURIES[i.id].mods);
  for (const k of Object.keys(s) as Array<keyof StatBlock>) s[k] = Math.max(STAT_FLOOR[k], s[k]);
  return s;
}

export const weaponOf = (m: RosterMember): Weapon => WEAPONS[m.weapon];

// ---------- deployment: roster -> battle ----------

export function memberSpec(m: RosterMember, x: number, y: number): UnitSpec {
  const s = effectiveStats(m);
  return {
    id: m.id,
    name: m.name,
    team: 'player',
    role: `${CLIQUES[m.clique].label} / ${CLASSES[m.schoolClass].label}`,
    x,
    y,
    hp: Math.min(m.hp, s.hp),
    maxHp: s.hp,
    mobility: s.mobility,
    aim: s.aim,
    defense: s.defense,
    crit: s.crit,
    weapon: weaponOf(m),
    ...(m.protagonist ? { protagonist: true } : {}),
  };
}

/**
 * Swap the squad into a scenario's player slots (same positions, same order), leaving the map and
 * the enemies alone. `squad` is the ids you picked; it is run through `chooseSquad`, so the player
 * character is always in, the dead never are, and gaps are filled from the roster.
 */
export function deployRoster(sc: Scenario, roster: Roster, squad?: readonly string[]): Scenario {
  const slots = sc.units.filter((u) => u.team === 'player');
  const rest = sc.units.filter((u) => u.team !== 'player');
  const ids = chooseSquad(roster, squad).slice(0, slots.length);
  const members = ids.map((id) => roster.find((m) => m.id === id) as RosterMember);
  return { ...sc, units: [...members.map((m, i) => memberSpec(m, slots[i].x, slots[i].y)), ...rest] };
}

// ---------- results: battle -> roster ----------

export type Outcome = 'victory' | 'defeat' | 'retreat';

export interface ResultReport {
  outcome: Outcome;
  /** human-readable consequences, in order, for the world log */
  notes: string[];
  /** ids of members lost in this battle */
  fallen: string[];
}

export type Fate = 'dead' | 'injured';

/**
 * What going down costs. Permadeath is the default: a unit that falls is gone. The one exception is
 * the player character's first fall in a battle (a knock-down, `downed`): they survive it, with a
 * serious injury. This is also the seam for anything that softens permadeath later (a skill, an
 * item, a story beat). It runs once per member who fell.
 */
export const fateOfDowned = (_m: RosterMember, u: Unit): Fate => (u.downed ? 'injured' : 'dead');

export interface ResultOptions {
  /** override the fate rule (defaults to `fateOfDowned`) */
  fate?: (m: RosterMember, u: Unit) => Fate;
}

export const outcomeOf = (state: GameState): Outcome => (state.winner === 'player' ? 'victory' : state.winner === 'enemy' ? 'defeat' : 'retreat');

function pick<T>(rng: RngHolder, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rand(rng) * items.length))];
}

function addInjury(m: RosterMember, rng: RngHolder, notes: string[]): void {
  const held = new Set(m.injuries.map((i) => i.id));
  const options = (Object.keys(INJURIES) as InjuryId[]).filter((id) => !held.has(id));
  const id = pick(rng, options);
  if (m.injuries.length >= MAX_INJURIES) {
    let soonest = 0;
    m.injuries.forEach((inj, i) => {
      if (inj.left < m.injuries[soonest].left) soonest = i;
    });
    m.injuries.splice(soonest, 1);
  }
  m.injuries.push({ id, left: INJURIES[id].recovery });
  notes.push(`${m.name} went down hard: ${INJURIES[id].name.toLowerCase()}.`);
}

function tickInjuries(m: RosterMember, notes: string[]): void {
  for (const inj of m.injuries) inj.left -= 1;
  for (const inj of m.injuries.filter((i) => i.left <= 0)) notes.push(`${m.name} has recovered from ${INJURIES[inj.id].name.toLowerCase()}.`);
  m.injuries = m.injuries.filter((i) => i.left > 0);
}

function addXp(m: RosterMember, amount: number, rng: RngHolder, notes: string[]): void {
  if (m.level >= MAX_LEVEL) return;
  m.xp += amount;
  while (m.level < MAX_LEVEL && m.xp >= xpToNext(m.level)) {
    m.xp -= xpToNext(m.level);
    const before = effectiveStats(m).hp;
    m.level += 1;
    const gained: string[] = [`${m.name} reaches level ${m.level}.`];
    if (TRAIT_LEVELS.includes(m.level)) {
      const options = (Object.keys(TRAITS) as TraitId[]).filter((t) => !m.traits.includes(t));
      if (options.length > 0) {
        const t = pick(rng, options);
        m.traits.push(t);
        gained.push(`New trait: ${TRAITS[t].name}.`);
      }
    }
    m.hp += Math.max(0, effectiveStats(m).hp - before); // levelling up heals what it adds
    notes.push(gained.join(' '));
  }
  if (m.level >= MAX_LEVEL) m.xp = 0;
}

/**
 * Fold a finished (or abandoned) battle back into the roster. Mutates the roster; `rng` supplies the
 * injury and trait rolls, so a seeded caller gets a reproducible outcome.
 *
 * - Everyone who deployed keeps the HP they ended with.
 * - A unit that went down meets its `fate`: by default it dies (permanently, even on a retreat: it
 *   fell before you pulled out). The player character's knock-down is 'injured' instead: they come
 *   back at 1 HP with an injury (also if they were revived mid-fight, keeping their revived HP).
 * - Victory and defeat both count as a completed fight: injuries tick down and XP is awarded. A
 *   retreat does neither (otherwise abandoning fights would be a free way to heal and level).
 * - The dead are skipped: no XP, no revival, never deployed again.
 */
export function applyBattleResult(roster: Roster, state: GameState, rng: RngHolder, opts: ResultOptions = {}): ResultReport {
  const outcome = outcomeOf(state);
  const completed = outcome !== 'retreat';
  const fateOf = opts.fate ?? fateOfDowned;
  const notes: string[] = [];
  const fallen: string[] = [];

  for (const m of roster) {
    if (m.dead) continue;
    const u = state.units.find((x) => x.team === 'player' && x.id === m.id);
    if (!u) continue; // stayed at camp

    // Fell at some point: still down at the end, or knocked down and then revived (the leader's one free fall).
    const downed = !u.alive || (u.downs ?? 0) > 0;
    if (!u.alive && fateOf(m, u) === 'dead') {
      m.dead = true;
      m.hp = 0;
      fallen.push(m.id);
      notes.push(`${m.name} didn't make it.`);
      continue;
    }

    if (completed) tickInjuries(m, notes); // before new injuries, so those keep their full duration

    if (downed) {
      m.hp = u.alive ? Math.max(1, u.hp) : 1;
      addInjury(m, rng, notes);
    } else {
      m.hp = Math.max(1, u.hp);
    }

    if (completed) {
      const xp = XP_PARTICIPATION + XP_PER_HIT * (u.hits ?? 0) + XP_PER_KILL * (u.kills ?? 0) + (outcome === 'victory' ? XP_VICTORY : 0);
      addXp(m, xp, rng, notes);
    }

    m.hp = Math.min(m.hp, effectiveStats(m).hp);
  }
  return { outcome, notes, fallen };
}

/** Rest at camp: everyone still alive back to full HP. Injuries are not touched; they heal by completing fights. */
export function restAtCamp(roster: Roster): number {
  let healed = 0;
  for (const m of livingSquad(roster)) {
    const max = effectiveStats(m).hp;
    if (m.hp < max) {
      m.hp = max;
      healed += 1;
    }
  }
  return healed;
}
