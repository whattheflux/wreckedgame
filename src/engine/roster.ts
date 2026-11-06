import type { Scenario, UnitSpec } from './battle';
import type { GameState, Unit, Weapon } from './types';
import { WEAPONS } from './scenarios';
import { rand, type RngHolder } from './rng';
import { gearMods, startingGear, weaponOfGear, weaponOfItem, type Gear, type ItemId } from './items';
import {
  ATTR_IDS,
  ATTR_MAX,
  COMBAT_SKILLS,
  STAT_FLOOR,
  addMods,
  attributeStats,
  canRaise,
  canTrain,
  combatStats,
  MAX_MOBILITY,
  luckFactor,
  xpMultiplier,
  zeroAttributes,
  zeroCombat,
  type AttrId,
  type Attributes,
  type CombatSkillId,
  type CombatSkills,
  type StatBlock,
  type StatMods,
} from './attributes';
import { CLASS_POOL, CLASS_STARTER, CLIQUE_POOL, CLIQUE_STARTER, PERKS, grantedSkills, offerPerks, perkFlags, perkMods, type PerkFlag } from './perks';

/**
 * The persistent squad. Everything here is plain JSON (saveable) and pure logic, like the rest of
 * the engine. A roster member outlives any single battle: it is turned into a battle unit by
 * `deployRoster`, and the battle's outcome is folded back in by `applyBattleResult`.
 *
 * Stats are never stored. They are derived from attributes + combat skills + traits + injuries +
 * perks + gear by `effectiveStats`, so they cannot drift out of sync with the things that cause them.
 *
 * Levelling hands out *pending picks* rather than numbers: the player spends them (see `spendAttribute`,
 * `spendCombat`, `takePerk`). What a perk pick offers is drawn when the level happens and stored, so
 * closing the screen cannot reroll it.
 */

export type { AttrId, Attributes, CombatSkillId, CombatSkills, StatBlock, StatMods };

// ---------- data tables ----------

/** Who you are: the social group. Sets the starting attribute spread and the clique perk pool. */
export type Clique = 'popular' | 'jock' | 'nerd' | 'drama' | 'weirdo' | 'stoner';
/** What you studied: the school specialty. Sets the starting weapon, nudges attributes, and picks the class perk pool. */
export type SchoolClass = 'sport' | 'science' | 'drama' | 'art' | 'homeec' | 'woodwork' | 'metalwork';
export type WeaponId = keyof typeof WEAPONS;

export interface CliqueDef {
  label: string;
  blurb: string;
  /** level-1 attributes; every clique spends the same total, laid out differently */
  attrs: Attributes;
}

const attrs = (strength: number, charm: number, hustle: number, observation: number, luck: number, aptitude: number, resilience: number): Attributes => ({
  strength,
  charm,
  hustle,
  observation,
  luck,
  aptitude,
  resilience,
});

/** Every clique starts with the same number of attribute points, spent differently. */
export const CLIQUE_ATTR_TOTAL = 24;

export const CLIQUES: Record<Clique, CliqueDef> = {
  popular: { label: 'Popular', blurb: 'Everyone knows them. Quick and persuasive, not built to take a hit.', attrs: attrs(3, 7, 4, 3, 3, 2, 2) },
  jock: { label: 'Jock', blurb: 'Strong, fast and hard to put down. Not the sharpest eye on the island.', attrs: attrs(7, 2, 4, 2, 2, 2, 5) },
  nerd: { label: 'Nerd', blurb: 'Sees everything first and learns fastest. Folds when hit.', attrs: attrs(2, 2, 3, 6, 2, 7, 2) },
  drama: { label: 'Drama kid', blurb: 'No weak spot and no strong one, with a gift for talking people round.', attrs: attrs(3, 5, 4, 3, 3, 3, 3) },
  weirdo: { label: 'Weirdo', blurb: 'Impossible to read, improbably lucky, hits harder than they have any right to.', attrs: attrs(3, 2, 4, 3, 7, 3, 2) },
  stoner: { label: 'Stoner', blurb: 'Unbothered and very hard to finish off. In no particular hurry.', attrs: attrs(4, 3, 2, 2, 4, 3, 6) },
};

export interface ClassDef {
  label: string;
  blurb: string;
  weapon: WeaponId;
  /** added to the clique's level-1 attributes */
  attrs: Partial<Attributes>;
}

/** Every class adds the same number of attribute points on top of the clique's spread. */
export const CLASS_ATTR_BONUS = 3;

export const CLASSES: Record<SchoolClass, ClassDef> = {
  sport: { label: 'Sport', blurb: 'Athletic and quick on their feet. Throws a javelin, and anything else to hand.', weapon: 'javelin', attrs: { strength: 1, hustle: 2 } },
  science: { label: 'Science', blurb: 'Careful, precise, and holding the chemistry store key. Fires flares.', weapon: 'flareGun', attrs: { observation: 2, aptitude: 1 } },
  drama: { label: 'Drama', blurb: 'Stagecraft and nerve, and a slingshot.', weapon: 'slingshot', attrs: { charm: 2, luck: 1 } },
  art: { label: 'Art', blurb: 'A good eye for a target and a jar of paint. Slingshot.', weapon: 'slingshot', attrs: { observation: 2, luck: 1 } },
  homeec: { label: 'Home Ec', blurb: 'Patches people up and keeps them fed. Slingshot.', weapon: 'slingshot', attrs: { charm: 1, aptitude: 1, resilience: 1 } },
  woodwork: { label: 'Woodwork', blurb: 'Handy with a sharpened pole and steady on their feet.', weapon: 'pole', attrs: { strength: 1, observation: 1, resilience: 1 } },
  metalwork: { label: 'Metalwork', blurb: 'Sturdy and heavy-handed. Sharpened pole, and plans for something better.', weapon: 'pole', attrs: { strength: 2, resilience: 1 } },
};

export type TraitId = 'sure-footed' | 'eagle-eyed' | 'tough' | 'thick-skinned' | 'jumpy' | 'showboat';

export interface TraitDef {
  name: string;
  blurb: string;
  mods: StatMods;
}

/** Quirks. One is settled on each character when they are made; they are never handed out later. */
export const TRAITS: Record<TraitId, TraitDef> = {
  'sure-footed': { name: 'Sure-footed', blurb: 'Never trips on roots.', mods: { mobility: 1 } },
  'eagle-eyed': { name: 'Eagle-eyed', blurb: 'Spots the gap in the cover.', mods: { aim: 5 } },
  tough: { name: 'Tough', blurb: 'Shrugs off bruises.', mods: { hp: 2 } },
  'thick-skinned': { name: 'Thick-skinned', blurb: 'Hard to rattle.', mods: { defense: 5 } },
  jumpy: { name: 'Jumpy', blurb: 'Hard to hit, harder to steady.', mods: { defense: 5, aim: -5 } },
  showboat: { name: 'Showboat', blurb: 'Goes for the highlight reel.', mods: { crit: 10, aim: -5 } },
};

export const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];

export type InjuryId =
  | 'twisted-ankle'
  | 'concussion'
  | 'cracked-ribs'
  | 'shaken'
  | 'broken-nose'
  | 'torn-tendon'
  | 'deep-gash'
  | 'lost-hand'
  | 'lost-leg'
  | 'blind-eye';

export type BodyPart = 'head' | 'chest' | 'arm' | 'leg' | 'mind';

export interface InjuryDef {
  name: string;
  part: BodyPart;
  mods: StatMods;
  /** days of rest (or completed fights) until it heals; 0 for a permanent one */
  recovery: number;
  /** never heals: a scar the character lives with */
  permanent?: boolean;
  blurb: string;
}

export const INJURIES: Record<InjuryId, InjuryDef> = {
  'twisted-ankle': { name: 'Twisted ankle', part: 'leg', mods: { mobility: -1 }, recovery: 2, blurb: 'Slows you down.' },
  concussion: { name: 'Concussion', part: 'head', mods: { aim: -10, sight: -2 }, recovery: 2, blurb: 'Vision swims.' },
  'cracked-ribs': { name: 'Cracked ribs', part: 'chest', mods: { hp: -3 }, recovery: 3, blurb: 'Every breath hurts.' },
  shaken: { name: 'Shaken up', part: 'mind', mods: { aim: -5, crit: -5 }, recovery: 1, blurb: 'Hands will not stay still.' },
  'broken-nose': { name: 'Broken nose', part: 'head', mods: { aim: -3, crit: -3 }, recovery: 3, blurb: 'Eyes streaming.' },
  'torn-tendon': { name: 'Torn tendon', part: 'arm', mods: { aim: -8 }, recovery: 6, blurb: 'The arm will not hold steady. Slow to mend.' },
  'deep-gash': { name: 'Deep gash', part: 'chest', mods: { hp: -2 }, recovery: 3, blurb: 'Keeps reopening.' },
  'lost-hand': { name: 'Lost a hand', part: 'arm', mods: { meleeAim: -10, rangedAim: -6 }, recovery: 0, permanent: true, blurb: 'One hand only: no two-handed weapons.' },
  'lost-leg': { name: 'Lost a leg', part: 'leg', mods: { mobility: -2 }, recovery: 0, permanent: true, blurb: 'Hobbles on a crutch.' },
  'blind-eye': { name: 'Blind in one eye', part: 'head', mods: { rangedAim: -10, crit: -3, sight: -3 }, recovery: 0, permanent: true, blurb: 'Judging distance is harder.' },
};

export const INJURY_IDS = Object.keys(INJURIES) as InjuryId[];
export const TEMPORARY_INJURIES = INJURY_IDS.filter((id) => !INJURIES[id].permanent);
export const PERMANENT_INJURIES = INJURY_IDS.filter((id) => INJURIES[id].permanent);

export type Severity = 'light' | 'serious' | 'permanent';
export const severityOf = (id: InjuryId): Severity => (INJURIES[id].permanent ? 'permanent' : INJURIES[id].recovery >= 4 ? 'serious' : 'light');

/** A member can carry at most this many healing injuries; a further one replaces whichever is closest to healing. Permanent ones are extra. */
export const MAX_INJURIES = 2;

/** A real fall (the leader going down) is a permanent scar this often; battered survivors only get ones that heal. Luck shortens both. */
export const PERMANENT_ON_FALL = 0.15;
export const BATTERED_BELOW = 0.35;
export const BATTERED_CHANCE = 0.4;

// ---------- levelling ----------

export const MAX_LEVEL = 12;
export const XP_PARTICIPATION = 8;
export const XP_PER_HIT = 2;
export const XP_PER_KILL = 12;
export const XP_VICTORY = 10;
/** Away from the battlefield: clearing a site for good, finding somewhere new, a job done at camp. */
export const XP_SITE_BASE = 12;
export const XP_SITE_PER_DIFFICULTY = 6;
export const XP_DISCOVERY = 6;
export const XP_CAMP_TASK = 5;

/** Hand the same experience to everyone still standing (a shared world event). Returns the log lines. */
export function grantXp(roster: Roster, amount: number, rng: RngHolder): string[] {
  const notes: string[] = [];
  for (const m of livingSquad(roster)) addXp(m, amount, rng, notes);
  return notes;
}

/** Experience for the next level. Flat-ish early, steeper later; `MAX_LEVEL` needs none. */
export const xpToNext = (level: number): number => (level >= MAX_LEVEL ? Infinity : 40 + 25 * (level - 1));

/** A class perk every this many levels, a clique perk every this many, this many options each time. */
export const CLASS_PERK_EVERY = 3;
export const CLIQUE_PERK_EVERY = 6;
export const PERK_OPTIONS = 2;

export type PickKind = 'attribute' | 'combat' | 'classPerk' | 'cliquePerk';

export const PICK_LABEL: Record<PickKind, string> = {
  attribute: 'Attribute point',
  combat: 'Combat training',
  classPerk: 'Class perk',
  cliquePerk: 'Clique perk',
};

/** Something the player still has to choose. Perk picks carry the options they were offered. */
export interface PendingPick {
  kind: PickKind;
  /** the level that handed it out */
  level: number;
  /** perk ids on offer, fixed when the level happened */
  options?: string[];
}

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
  /** the seven SCHOLAR attributes */
  attributes: Attributes;
  /** points put into each combat skill */
  combat: CombatSkills;
  /** perk ids owned, in the order they were taken */
  perks: string[];
  /** choices the player still owes */
  pending: PendingPick[];
  traits: TraitId[];
  injuries: Injury[];
  weapon: WeaponId;
  /** what they wear and carry (slot -> item id). Absent on older saves: `gearOf` fills in the class starting kit. */
  gear?: Gear;
  /** current HP, carried between fights; >= 1 while alive */
  hp: number;
  /** fell in battle and is gone for good (see `fateOfDowned`). Kept in the roster so the squad panel can remember them. */
  dead: boolean;
  /** the player character: if they fall, the run is over (see `gameOverReason`) */
  protagonist: boolean;
  /** the player character's body, which picks their art (absent on companions and on older saves) */
  look?: Look;
  /** has had their makeover (see MAKEOVERS): swaps to the `<name>-makeover` art when there is some */
  makeover?: boolean;
}

/** A member's gear, creating the class starting kit the first time it is needed (so old saves just work). */
export function gearOf(m: RosterMember): Gear {
  return (m.gear ??= startingGear(m.weapon, m.protagonist));
}

/** The art key for a roster member: companions by name, the player character by body. */
export const spriteKey = (m: RosterMember): string => (m.protagonist ? `pc-${m.look ?? 'male'}` : `${m.name.toLowerCase()}${m.makeover ? '-makeover' : ''}`);

/** Companions who change their look partway through: roster id -> the level they do it at (and the line shown). */
export const MAKEOVERS: Record<string, { level: number; note: string }> = {
  p4: { level: 3, note: 'Anna has had enough of the costume trunk and gives herself a makeover.' },
};

export type Roster = RosterMember[];

/** Most members you can have, and how many take the field in one fight. */
export const MAX_ROSTER = 5;
export const FIELD_SIZE = 4;

export const PLAYER_ID = 'pc';

/** Which body (and art) the player character uses. */
export type Look = 'male' | 'female';

export interface PlayerChoice {
  name: string;
  clique: Clique;
  schoolClass: SchoolClass;
  look?: Look;
}

export const DEFAULT_PLAYER: PlayerChoice = { name: 'You', clique: 'popular', schoolClass: 'sport', look: 'male' };

/** The friends who start with you. Clique and class are independent, so these are just their starting picks. */
const COMPANIONS: Array<{ id: string; name: string; clique: Clique; schoolClass: SchoolClass }> = [
  { id: 'p1', name: 'Amy', clique: 'popular', schoolClass: 'homeec' },
  { id: 'p2', name: 'Scott', clique: 'jock', schoolClass: 'sport' },
  { id: 'p3', name: 'Tyson', clique: 'nerd', schoolClass: 'science' },
  { id: 'p4', name: 'Anna', clique: 'drama', schoolClass: 'drama' },
];

// ---------- making one ----------

/** Level-1 attributes: the clique's spread plus what the class adds. */
export function startingAttributes(clique: Clique, schoolClass: SchoolClass): Attributes {
  const a = { ...CLIQUES[clique].attrs };
  for (const [k, v] of Object.entries(CLASSES[schoolClass].attrs)) a[k as AttrId] += v ?? 0;
  return a;
}

/** The perks a character is simply born with: their clique's and their class's signature. */
export function startingPerks(clique: Clique, schoolClass: SchoolClass): string[] {
  return [...new Set([CLIQUE_STARTER[clique], CLASS_STARTER[schoolClass]].filter(Boolean))];
}

/**
 * The one quirk a character has. Settled from who they are rather than rolled, so it is stable
 * across saves and the same character is always the same person.
 */
export function startingTrait(name: string, clique: Clique, schoolClass: SchoolClass): TraitId {
  const key = `${name}|${clique}|${schoolClass}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // final avalanche, or short keys that differ late all land in the same bucket
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return TRAIT_IDS[(h >>> 0) % TRAIT_IDS.length];
}

export function newMember(id: string, name: string, clique: Clique, schoolClass: SchoolClass, protagonist = false, look?: Look): RosterMember {
  const m: RosterMember = {
    id,
    name,
    clique,
    schoolClass,
    level: 1,
    xp: 0,
    attributes: startingAttributes(clique, schoolClass),
    combat: zeroCombat(),
    perks: startingPerks(clique, schoolClass),
    pending: [],
    traits: [startingTrait(name, clique, schoolClass)],
    injuries: [],
    weapon: CLASSES[schoolClass].weapon,
    gear: startingGear(CLASSES[schoolClass].weapon, protagonist),
    hp: 1,
    dead: false,
    protagonist,
    ...(protagonist ? { look: look ?? 'male' } : {}),
  };
  m.hp = effectiveStats(m).hp;
  return m;
}

/** The player character plus the four friends: level 1, nothing spent, full health. */
export function createStarterRoster(player: PlayerChoice = DEFAULT_PLAYER): Roster {
  const name = player.name.trim().slice(0, 16) || DEFAULT_PLAYER.name;
  return [newMember(PLAYER_ID, name, player.clique, player.schoolClass, true, player.look), ...COMPANIONS.map((c) => newMember(c.id, c.name, c.clique, c.schoolClass))];
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

/** The active skills this member knows, from their perks. */
export const skillsFor = (m: RosterMember): string[] => grantedSkills(m.perks ?? []);

/** The rule flags this member's perks turn on. */
export const flagsFor = (m: RosterMember): PerkFlag[] => perkFlags(m.perks ?? []);

/** Attributes, then trained combat skills, then quirks, injuries, perks and what they are wearing, then floors. */
export function effectiveStats(m: RosterMember): StatBlock {
  const s = attributeStats(m.attributes ?? zeroAttributes());
  addMods(s, combatStats(m.combat ?? zeroCombat()));
  for (const t of m.traits ?? []) addMods(s, TRAITS[t]?.mods);
  for (const i of m.injuries ?? []) addMods(s, INJURIES[i.id]?.mods);
  for (const mod of perkMods(m.perks ?? [])) addMods(s, mod);
  addMods(s, gearMods(gearOf(m)));
  for (const k of Object.keys(s) as Array<keyof StatBlock>) s[k] = Math.max(STAT_FLOOR[k], s[k]);
  s.mobility = Math.min(MAX_MOBILITY, s.mobility);
  return s;
}

/** What they hit with: whatever is in their hands. */
export const weaponOf = (m: RosterMember): Weapon => weaponOfGear(gearOf(m));

// ---------- spending what a level handed out ----------

/** What this level hands out: a point of attributes and a point of training every time, perks on their own schedule. */
export function picksForLevel(m: RosterMember, level: number, rng: RngHolder): PendingPick[] {
  const out: PendingPick[] = [{ kind: 'attribute', level }, { kind: 'combat', level }];
  // Anything already on the table counts as spoken for: levelling several times at once (or a save
  // being brought up to date) must not put the same perk in front of the player twice.
  const owned = [...m.perks, ...(m.pending ?? []).flatMap((p) => p.options ?? [])];
  if (level % CLASS_PERK_EVERY === 0) {
    const options = offerPerks(CLASS_POOL[m.schoolClass] ?? [], owned, rng, PERK_OPTIONS);
    if (options.length > 0) {
      out.push({ kind: 'classPerk', level, options });
      owned.push(...options); // so a clique pick in the same level cannot offer the same perk twice
    }
  }
  if (level % CLIQUE_PERK_EVERY === 0) {
    const options = offerPerks(CLIQUE_POOL[m.clique] ?? [], owned, rng, PERK_OPTIONS);
    if (options.length > 0) out.push({ kind: 'cliquePerk', level, options });
  }
  return out;
}

export const pendingOf = (m: RosterMember, kind: PickKind): PendingPick | undefined => (m.pending ?? []).find((p) => p.kind === kind);
export const hasPending = (m: RosterMember): boolean => (m.pending ?? []).length > 0;
export const pendingCount = (roster: Roster): number => roster.filter((m) => !m.dead).reduce((n, m) => n + (m.pending?.length ?? 0), 0);

export interface PickResult {
  ok: boolean;
  error?: string;
  /** a line for the log */
  note?: string;
}

const noPick = (error: string): PickResult => ({ ok: false, error });

function consume(m: RosterMember, kind: PickKind): boolean {
  const i = (m.pending ?? []).findIndex((p) => p.kind === kind);
  if (i < 0) return false;
  m.pending.splice(i, 1);
  return true;
}

/** Heal by however much a choice raised the ceiling, so a level-up is never a net loss of health. */
function keepHealthy(m: RosterMember, beforeMax: number): void {
  const after = effectiveStats(m).hp;
  if (after > beforeMax) m.hp += after - beforeMax;
  m.hp = Math.max(1, Math.min(m.hp, after));
}

/** Put the pending attribute point into one of the seven. */
export function spendAttribute(m: RosterMember, id: AttrId): PickResult {
  if (!pendingOf(m, 'attribute')) return noPick('No attribute point to spend.');
  if (!canRaise(m.attributes, id)) return noPick(`${id} is already at ${ATTR_MAX}.`);
  const before = effectiveStats(m).hp;
  consume(m, 'attribute');
  m.attributes[id] += 1;
  keepHealthy(m, before);
  return { ok: true, note: `${m.name}: ${id} ${m.attributes[id]}.` };
}

/** Put the pending training point into one of the five combat skills. */
export function spendCombat(m: RosterMember, id: CombatSkillId): PickResult {
  if (!pendingOf(m, 'combat')) return noPick('No training point to spend.');
  if (!canTrain(m.combat, id)) return noPick(`${COMBAT_SKILLS[id].label} is fully trained.`);
  const before = effectiveStats(m).hp;
  consume(m, 'combat');
  m.combat[id] += 1;
  keepHealthy(m, before);
  return { ok: true, note: `${m.name}: ${COMBAT_SKILLS[id].label} ${m.combat[id]}/${COMBAT_SKILLS[id].maxPoints}.` };
}

/** Take one of the perks on offer. Only the ones actually offered are allowed. */
export function takePerk(m: RosterMember, perkId: string): PickResult {
  const pick = (m.pending ?? []).find((p) => (p.kind === 'classPerk' || p.kind === 'cliquePerk') && p.options?.includes(perkId));
  if (!pick) return noPick('That perk is not on offer.');
  if (m.perks.includes(perkId)) return noPick('Already learned.');
  if (PERKS[perkId]?.requires && !m.perks.includes(PERKS[perkId].requires as string)) return noPick('Something else has to come first.');
  const before = effectiveStats(m).hp;
  m.pending.splice(m.pending.indexOf(pick), 1);
  m.perks.push(perkId);
  keepHealthy(m, before);
  return { ok: true, note: `${m.name} learns ${perkId}.` };
}

/**
 * Spend everything still owing without asking: attribute points go to whatever is lowest among the
 * clique's best three, training follows the weapon in hand, and perks take the first on offer. Used
 * for companions when the player cannot be bothered, and whenever a level happens off-screen.
 */
export function autoSpend(m: RosterMember): string[] {
  const notes: string[] = [];
  let guard = 100;
  while (hasPending(m) && guard-- > 0) {
    const pick = m.pending[0];
    if (pick.kind === 'attribute') {
      // lean into what they are already good at, but spread across their best three rather than
      // piling everything into one number
      const strongest = [...ATTR_IDS].sort((a, b) => m.attributes[b] - m.attributes[a]).slice(0, 3);
      const open = [...strongest, ...ATTR_IDS].filter((id) => canRaise(m.attributes, id));
      const best = open.slice(0, 3).sort((a, b) => m.attributes[a] - m.attributes[b]);
      const r = spendAttribute(m, best[0] ?? 'resilience');
      if (!r.ok) consume(m, 'attribute');
      else if (r.note) notes.push(r.note);
    } else if (pick.kind === 'combat') {
      const melee = !!weaponOf(m).melee;
      const order: CombatSkillId[] = melee ? ['meleeAttack', 'meleeDefense', 'speed', 'rangedDefense', 'rangedAttack'] : ['rangedAttack', 'rangedDefense', 'speed', 'meleeDefense', 'meleeAttack'];
      // same idea: the top three for this weapon, evened out
      const open = order.filter((x) => canTrain(m.combat, x));
      const id = open.slice(0, 3).sort((a, b) => m.combat[a] - m.combat[b])[0];
      const r = id ? spendCombat(m, id) : noPick('');
      if (!r.ok) consume(m, 'combat');
      else if (r.note) notes.push(r.note);
    } else {
      const choice = pick.options?.[0];
      const r = choice ? takePerk(m, choice) : noPick('');
      if (!r.ok) m.pending.splice(0, 1);
      else if (r.note) notes.push(r.note);
    }
  }
  return notes;
}

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
    aim: s.rangedAim,
    meleeAim: s.meleeAim,
    defense: s.rangedDefense,
    meleeDefense: s.meleeDefense,
    sight: s.sight,
    crit: s.crit,
    charm: m.attributes.charm,
    weapon: weaponOf(m),
    gear: { ...gearOf(m) },
    sprite: spriteKey(m),
    skills: skillsFor(m),
    flags: flagsFor(m),
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
  /** gear that had to come off (a two-hander after losing a hand): the caller puts it in the stash */
  dropped: ItemId[];
  /** ids of members who now owe the player a choice */
  levelled: string[];
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
  /** spend every pick straight away instead of leaving them for the player (companions, headless runs) */
  auto?: boolean;
}

export const outcomeOf = (state: GameState): Outcome => (state.winner === 'player' ? 'victory' : state.winner === 'enemy' ? 'defeat' : 'retreat');

function pick<T>(rng: RngHolder, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rand(rng) * items.length))];
}

export const hasInjury = (m: RosterMember, id: InjuryId): boolean => m.injuries.some((i) => i.id === id);

/** Hands a member can use: a lost hand leaves one. */
export const handsOf = (m: RosterMember): 1 | 2 => (hasInjury(m, 'lost-hand') ? 1 : 2);

/** The reason this member cannot hold this gear (a two-handed weapon with one hand), or null. */
export function wieldProblem(m: RosterMember, gear: Gear): string | null {
  if (handsOf(m) === 1 && [gear.rightHand, gear.leftHand].some((id) => id && (weaponOfItem(id)?.hands ?? 1) === 2)) {
    return `${m.name} only has one hand: no two-handed weapons.`;
  }
  return null;
}

/** Take away anything they can no longer hold (a two-hander after losing a hand) and return it, for the stash. */
export function dropIllegalGear(m: RosterMember): ItemId[] {
  const g = gearOf(m);
  const out: ItemId[] = [];
  if (wieldProblem(m, g)) {
    for (const slot of ['rightHand', 'leftHand'] as const) {
      const id = g[slot];
      if (id && (weaponOfItem(id)?.hands ?? 1) === 2) {
        out.push(id);
        delete g[slot];
      }
    }
  }
  return out;
}

export interface InjuryOptions {
  /** chance (0-1) that this one is a permanent scar rather than something that heals */
  permanentChance?: number;
  /** only these (e.g. never permanent for a light knock) */
  from?: readonly InjuryId[];
}

/**
 * Give a member a random injury they do not already have. Healing injuries are capped (a further one
 * replaces whichever is closest to mending); permanent ones always stay. Returns the injury given, or
 * null if they already carry everything on offer.
 */
export function giveInjury(m: { injuries: Injury[] }, rng: RngHolder, opts: InjuryOptions = {}): InjuryId | null {
  const held = new Set(m.injuries.map((i) => i.id));
  const wantPermanent = !opts.from && rand(rng) < (opts.permanentChance ?? 0);
  const pool = (opts.from ?? (wantPermanent ? PERMANENT_INJURIES : TEMPORARY_INJURIES)).filter((id) => !held.has(id));
  if (pool.length === 0) return null;
  const id = pick(rng, pool);
  if (!INJURIES[id].permanent) {
    const healing = m.injuries.filter((i) => !INJURIES[i.id].permanent);
    if (healing.length >= MAX_INJURIES) {
      const soonest = healing.reduce((b, i) => (i.left < b.left ? i : b));
      m.injuries.splice(m.injuries.indexOf(soonest), 1);
    }
  }
  m.injuries.push({ id, left: INJURIES[id].recovery });
  return id;
}

/** Heal one day (or one fight) off every healing injury; returns the ones that finished. Permanent injuries never move. */
export function tickInjuries(m: { name: string; injuries: Injury[] }, notes: string[], days = 1): InjuryId[] {
  const healed: InjuryId[] = [];
  for (const inj of m.injuries) if (!INJURIES[inj.id].permanent) inj.left -= days;
  for (const inj of m.injuries.filter((i) => !INJURIES[i.id].permanent && i.left <= 0)) {
    notes.push(`${m.name} has recovered from ${INJURIES[inj.id].name.toLowerCase()}.`);
    healed.push(inj.id);
  }
  m.injuries = m.injuries.filter((i) => INJURIES[i.id].permanent || i.left > 0);
  return healed;
}

/**
 * Hand a member experience. Aptitude makes it go further. Every level reached queues the choices
 * that come with it rather than deciding anything, so the player picks them later.
 */
export function addXp(m: RosterMember, amount: number, rng: RngHolder, notes: string[]): void {
  if (m.level >= MAX_LEVEL || amount <= 0) return;
  m.pending ??= [];
  m.xp += Math.max(1, Math.round(amount * xpMultiplier(m.attributes)));
  while (m.level < MAX_LEVEL && m.xp >= xpToNext(m.level)) {
    m.xp -= xpToNext(m.level);
    const before = effectiveStats(m).hp;
    m.level += 1;
    const gained: string[] = [`${m.name} reaches level ${m.level}.`];
    m.pending.push(...picksForLevel(m, m.level, rng));
    const mk = MAKEOVERS[m.id];
    if (mk && !m.makeover && !m.protagonist && m.level >= mk.level) {
      m.makeover = true;
      gained.push(mk.note);
    }
    keepHealthy(m, before);
    notes.push(gained.join(' '));
  }
  if (m.level >= MAX_LEVEL) m.xp = 0;
}

/**
 * Fold a finished (or abandoned) battle back into the roster. Mutates the roster; `rng` supplies the
 * injury and perk-offer rolls, so a seeded caller gets a reproducible outcome.
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
  const dropped: ItemId[] = [];
  const levelled: string[] = [];

  for (const m of roster) {
    if (m.dead) continue;
    const u = state.units.find((x) => x.team === 'player' && x.id === m.id);
    if (!u) continue; // stayed at camp

    // Fell at some point: still down at the end, or knocked down and then revived (the leader's one free fall).
    const downed = !u.alive || (u.downs ?? 0) > 0;
    if (!u.alive && fateOf(m, u) === 'dead') {
      m.dead = true;
      m.hp = 0;
      m.gear = {}; // what they carried was left where they fell
      fallen.push(m.id);
      notes.push(`${m.name} didn't make it.`);
      continue;
    }

    m.gear = { ...(u.gear ?? gearOf(m)) }; // whatever they ended up wearing and carrying comes home with them
    if (completed) tickInjuries(m, notes); // before new injuries, so those keep their full duration

    const luck = luckFactor(m.attributes);
    if (downed) {
      m.hp = u.alive ? Math.max(1, u.hp) : 1;
      const id = giveInjury(m, rng, { permanentChance: PERMANENT_ON_FALL * luck });
      if (id) {
        notes.push(`${m.name} went down hard: ${INJURIES[id].name.toLowerCase()}.`);
        if (id === 'lost-hand') dropped.push(...dropIllegalGear(m));
      }
    } else {
      m.hp = Math.max(1, u.hp);
      // Ended the fight on their last legs: a chance of a knock that heals (never a scar; that takes a real fall).
      if (u.alive && u.hp <= u.maxHp * BATTERED_BELOW && rand(rng) < BATTERED_CHANCE * luck) {
        const id = giveInjury(m, rng);
        if (id) notes.push(`${m.name} is battered: ${INJURIES[id].name.toLowerCase()}.`);
      }
    }

    if (completed) {
      const xp = XP_PARTICIPATION + XP_PER_HIT * (u.hits ?? 0) + XP_PER_KILL * (u.kills ?? 0) + (outcome === 'victory' ? XP_VICTORY : 0);
      const was = m.level;
      addXp(m, xp, rng, notes);
      if (m.level > was) levelled.push(m.id);
    }
    if (opts.auto) notes.push(...autoSpend(m));

    m.hp = Math.min(m.hp, effectiveStats(m).hp);
  }
  return { outcome, notes, fallen, dropped, levelled };
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

// ---------- older saves ----------

/**
 * Bring a member written before attributes and perks existed up to date: rebuild their level-1 self
 * and hand back every pick their level has earned, so nothing is quietly lost. Safe to run on a
 * member that is already current, which is what makes it usable as a load-time repair pass.
 */
export function migrateMember(m: RosterMember, rng: RngHolder): boolean {
  let changed = false;
  if (!m.attributes) {
    m.attributes = startingAttributes(m.clique, m.schoolClass);
    changed = true;
  }
  if (!m.combat) {
    m.combat = zeroCombat();
    changed = true;
  }
  if (!m.perks) {
    m.perks = startingPerks(m.clique, m.schoolClass);
    changed = true;
  }
  if (!Array.isArray(m.traits) || m.traits.length === 0) {
    m.traits = [startingTrait(m.name, m.clique, m.schoolClass)];
    changed = true;
  }
  if (!m.pending) {
    m.pending = [];
    for (let lv = 2; lv <= Math.min(m.level, MAX_LEVEL); lv++) m.pending.push(...picksForLevel(m, lv, rng));
    changed = true;
  }
  if (changed) m.hp = Math.max(1, Math.min(m.hp, effectiveStats(m).hp));
  return changed;
}

export const migrateRoster = (roster: Roster, rng: RngHolder): boolean => roster.map((m) => migrateMember(m, rng)).some(Boolean);
