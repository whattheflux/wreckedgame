import type { Scenario, UnitSpec } from './battle';
import type { GameState, Weapon } from './types';
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

export type Clique = 'scout' | 'jock' | 'nerd' | 'drama';
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
  /** level-1 stats */
  base: StatBlock;
  weapon: WeaponId;
  /** flat gain per level after the first */
  growth: Omit<StatBlock, 'mobility'>;
  /** +1 mobility every N levels; 0 = never */
  mobilityEvery: number;
}

export const CLIQUES: Record<Clique, CliqueDef> = {
  scout: { label: 'Scout', base: { hp: 10, mobility: 6, aim: 72, defense: 10, crit: 10 }, weapon: 'slingshot', growth: { hp: 1, aim: 2, defense: 1, crit: 1 }, mobilityEvery: 3 },
  jock: { label: 'Jock', base: { hp: 14, mobility: 5, aim: 62, defense: 0, crit: 5 }, weapon: 'javelin', growth: { hp: 2, aim: 1, defense: 0, crit: 1 }, mobilityEvery: 0 },
  nerd: { label: 'Nerd', base: { hp: 9, mobility: 5, aim: 75, defense: 0, crit: 5 }, weapon: 'flareGun', growth: { hp: 1, aim: 2, defense: 0, crit: 1 }, mobilityEvery: 0 },
  drama: { label: 'Drama kid', base: { hp: 11, mobility: 5, aim: 66, defense: 5, crit: 10 }, weapon: 'slingshot', growth: { hp: 1, aim: 1, defense: 1, crit: 2 }, mobilityEvery: 0 },
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
  level: number;
  /** progress toward the next level */
  xp: number;
  traits: TraitId[];
  injuries: Injury[];
  weapon: WeaponId;
  /** current HP, carried between fights; always >= 1 */
  hp: number;
}

export type Roster = RosterMember[];

const STARTERS: Array<{ id: string; name: string; clique: Clique }> = [
  { id: 'p1', name: 'Mia', clique: 'scout' },
  { id: 'p2', name: 'Jonah', clique: 'jock' },
  { id: 'p3', name: 'Priya', clique: 'nerd' },
  { id: 'p4', name: 'Sam', clique: 'drama' },
];

export function newMember(id: string, name: string, clique: Clique): RosterMember {
  const m: RosterMember = { id, name, clique, level: 1, xp: 0, traits: [], injuries: [], weapon: CLIQUES[clique].weapon, hp: 1 };
  m.hp = effectiveStats(m).hp;
  return m;
}

/** The four friends you start with: level 1, no traits, full health. */
export function createStarterRoster(): Roster {
  return STARTERS.map((s) => newMember(s.id, s.name, s.clique));
}

// ---------- derived stats ----------

export function baseStats(clique: Clique, level: number): StatBlock {
  const c = CLIQUES[clique];
  const n = level - 1;
  return {
    hp: c.base.hp + c.growth.hp * n,
    mobility: c.base.mobility + (c.mobilityEvery > 0 ? Math.floor(n / c.mobilityEvery) : 0),
    aim: c.base.aim + c.growth.aim * n,
    defense: c.base.defense + c.growth.defense * n,
    crit: c.base.crit + c.growth.crit * n,
  };
}

/** Clique + level, then traits, then injuries, then floors. */
export function effectiveStats(m: RosterMember): StatBlock {
  const s = baseStats(m.clique, m.level);
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
    role: CLIQUES[m.clique].label,
    x,
    y,
    hp: Math.min(m.hp, s.hp),
    maxHp: s.hp,
    mobility: s.mobility,
    aim: s.aim,
    defense: s.defense,
    crit: s.crit,
    weapon: weaponOf(m),
  };
}

/**
 * Swap the roster into a scenario's player slots (same positions, same order), leaving the map and
 * the enemies alone. If the scenario has fewer slots than the roster, the first members deploy.
 */
export function deployRoster(sc: Scenario, roster: Roster): Scenario {
  const slots = sc.units.filter((u) => u.team === 'player');
  const rest = sc.units.filter((u) => u.team !== 'player');
  const squad = roster.slice(0, slots.length).map((m, i) => memberSpec(m, slots[i].x, slots[i].y));
  return { ...sc, units: [...squad, ...rest] };
}

// ---------- results: battle -> roster ----------

export type Outcome = 'victory' | 'defeat' | 'retreat';

export interface ResultReport {
  outcome: Outcome;
  /** human-readable consequences, in order, for the world log */
  notes: string[];
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
 * - Everyone who deployed keeps the HP they ended with. A unit that went down is not lost: it comes
 *   back at 1 HP with an injury.
 * - Victory and defeat both count as a completed fight: injuries tick down and XP is awarded. A
 *   retreat does neither (otherwise abandoning fights would be a free way to heal and level).
 */
export function applyBattleResult(roster: Roster, state: GameState, rng: RngHolder): ResultReport {
  const outcome = outcomeOf(state);
  const completed = outcome !== 'retreat';
  const notes: string[] = [];

  for (const m of roster) {
    const u = state.units.find((x) => x.team === 'player' && x.id === m.id);
    if (!u) continue; // stayed at camp

    if (completed) tickInjuries(m, notes); // before new injuries, so those keep their full duration

    if (u.alive) {
      m.hp = Math.max(1, u.hp);
    } else {
      m.hp = 1;
      addInjury(m, rng, notes);
    }

    if (completed) {
      const xp = XP_PARTICIPATION + XP_PER_HIT * (u.hits ?? 0) + XP_PER_KILL * (u.kills ?? 0) + (outcome === 'victory' ? XP_VICTORY : 0);
      addXp(m, xp, rng, notes);
    }

    m.hp = Math.min(m.hp, effectiveStats(m).hp);
  }
  return { outcome, notes };
}

/** Rest at camp: everyone back to full HP. Injuries are not touched; they heal by completing fights. */
export function restAtCamp(roster: Roster): number {
  let healed = 0;
  for (const m of roster) {
    const max = effectiveStats(m).hp;
    if (m.hp < max) {
      m.hp = max;
      healed += 1;
    }
  }
  return healed;
}
