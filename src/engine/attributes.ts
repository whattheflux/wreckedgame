/**
 * Attributes and combat skills: the two things you spend a point on at every level.
 *
 * Attributes are the broad "who you are" numbers (a school-flavoured take on the Fallout SPECIAL
 * idea), spelling SCHOLAR. Combat skills are the narrow Battle Brothers-style numbers that feed
 * straight into the shot maths. Everything here is pure data and arithmetic: no state, no DOM.
 *
 * Nothing stores a derived stat. `effectiveStats` in roster.ts rebuilds the whole block from
 * attributes + combat skills + traits + injuries + perks + gear, so numbers cannot drift.
 */

// ---------- SCHOLAR ----------

export type AttrId = 'strength' | 'charm' | 'hustle' | 'observation' | 'luck' | 'aptitude' | 'resilience';

/** Display order, which spells SCHOLAR. */
export const ATTR_IDS: readonly AttrId[] = ['strength', 'charm', 'hustle', 'observation', 'luck', 'aptitude', 'resilience'];

export interface AttrDef {
  letter: string;
  label: string;
  blurb: string;
  /** what each point buys, for the level-up screen */
  effects: string[];
}

export const ATTRS: Record<AttrId, AttrDef> = {
  strength: {
    letter: 'S',
    label: 'Strength',
    blurb: 'How hard you swing and how hard you are to shove off a spot.',
    effects: ['+3 melee attack', '+1 melee defense'],
  },
  charm: {
    letter: 'C',
    label: 'Charm',
    blurb: 'Whether people listen to you — in a fight and back at camp.',
    effects: ['+4 to charm attempts', 'better odds talking prisoners round'],
  },
  hustle: {
    letter: 'H',
    label: 'Hustle',
    blurb: 'Moving, dodging, getting out of the way.',
    effects: ['+1 tile of movement every 2 points', '+1 ranged defense', 'some melee defense'],
  },
  observation: {
    letter: 'O',
    label: 'Observation',
    blurb: 'Spotting the gap, and spotting them first.',
    effects: ['+3 ranged attack', '+1 tile of sight'],
  },
  luck: {
    letter: 'L',
    label: 'Luck',
    blurb: 'The difference between a scar and a story.',
    effects: ['+2 crit chance', 'fewer permanent injuries'],
  },
  aptitude: {
    letter: 'A',
    label: 'Aptitude',
    blurb: 'How fast you pick things up.',
    effects: ['+4% experience', 'faster work at camp'],
  },
  resilience: {
    letter: 'R',
    label: 'Resilience',
    blurb: 'How much you can take before you go down.',
    effects: ['+2 HP', 'shrugs off lasting damage'],
  },
};

export type Attributes = Record<AttrId, number>;

export const ATTR_MIN = 1;
export const ATTR_MAX = 10;

export const zeroAttributes = (): Attributes => ({ strength: 0, charm: 0, hustle: 0, observation: 0, luck: 0, aptitude: 0, resilience: 0 });

export const attrTotal = (a: Attributes): number => ATTR_IDS.reduce((n, id) => n + a[id], 0);

/** Can another point go into this attribute? */
export const canRaise = (a: Attributes, id: AttrId): boolean => a[id] < ATTR_MAX;

// ---------- combat skills ----------

export type CombatSkillId = 'meleeAttack' | 'rangedAttack' | 'meleeDefense' | 'rangedDefense' | 'speed';

export const COMBAT_SKILL_IDS: readonly CombatSkillId[] = ['meleeAttack', 'rangedAttack', 'meleeDefense', 'rangedDefense', 'speed'];

export interface CombatSkillDef {
  label: string;
  /** what one point is worth */
  per: number;
  /** most points that can go in */
  maxPoints: number;
  blurb: string;
  /** how a point reads on the button */
  unit: string;
}

export const COMBAT_SKILLS: Record<CombatSkillId, CombatSkillDef> = {
  meleeAttack: { label: 'Melee Attack', per: 4, maxPoints: 8, unit: 'hit chance', blurb: 'Landing a blow on someone within reach.' },
  rangedAttack: { label: 'Ranged Attack', per: 4, maxPoints: 8, unit: 'hit chance', blurb: 'Landing anything thrown or fired.' },
  meleeDefense: { label: 'Melee Defense', per: 2, maxPoints: 8, unit: 'harder to hit', blurb: 'Keeping out of the way of a swing.' },
  rangedDefense: { label: 'Ranged Defense', per: 2, maxPoints: 8, unit: 'harder to hit', blurb: 'Being a poor target at a distance.' },
  speed: { label: 'Speed', per: 1, maxPoints: 6, unit: 'speed', blurb: 'Ground covered in a move: every 2 points is another tile.' },
};

/** Points put into each skill (not the value it is worth: that is points x `per`). */
export type CombatSkills = Record<CombatSkillId, number>;

export const zeroCombat = (): CombatSkills => ({ meleeAttack: 0, rangedAttack: 0, meleeDefense: 0, rangedDefense: 0, speed: 0 });

/** What the points in a skill are worth. */
export const combatValue = (c: CombatSkills, id: CombatSkillId): number => c[id] * COMBAT_SKILLS[id].per;

export const combatSpent = (c: CombatSkills): number => COMBAT_SKILL_IDS.reduce((n, id) => n + c[id], 0);

export const canTrain = (c: CombatSkills, id: CombatSkillId): boolean => c[id] < COMBAT_SKILLS[id].maxPoints;

// ---------- the stat block everything derives into ----------

/**
 * A character's final numbers. Melee and ranged are separate lines (that is the whole point of the
 * combat skills), and `sight` is here because Observation buys it.
 */
export interface StatBlock {
  hp: number;
  mobility: number;
  crit: number;
  rangedAim: number;
  meleeAim: number;
  rangedDefense: number;
  meleeDefense: number;
  sight: number;
}

/**
 * A change to a stat block. `aim` and `defense` are shorthand for "both kinds": a bike helmet or a
 * concussion does not care whether the blow was thrown or swung. Use the split keys for anything
 * that should only touch one.
 */
export interface StatMods extends Partial<StatBlock> {
  aim?: number;
  defense?: number;
}

export const zeroStats = (): StatBlock => ({ hp: 0, mobility: 0, crit: 0, rangedAim: 0, meleeAim: 0, rangedDefense: 0, meleeDefense: 0, sight: 0 });

/** Add a change into a block, in place. */
export function addMods(into: StatBlock, m: StatMods | undefined): StatBlock {
  if (!m) return into;
  into.hp += m.hp ?? 0;
  into.mobility += m.mobility ?? 0;
  into.crit += m.crit ?? 0;
  into.sight += m.sight ?? 0;
  into.rangedAim += (m.rangedAim ?? 0) + (m.aim ?? 0);
  into.meleeAim += (m.meleeAim ?? 0) + (m.aim ?? 0);
  into.rangedDefense += (m.rangedDefense ?? 0) + (m.defense ?? 0);
  into.meleeDefense += (m.meleeDefense ?? 0) + (m.defense ?? 0);
  return into;
}

/** Sum a list of changes into one block. */
export const sumMods = (list: ReadonlyArray<StatMods | undefined>): StatBlock => list.reduce<StatBlock>((acc, m) => addMods(acc, m), zeroStats());

/** How a change reads in a tooltip ("+2 HP, -1 Move"), empty when it changes nothing. */
export const MOD_LABEL: Record<string, string> = {
  hp: 'HP',
  mobility: 'Move',
  crit: 'Crit',
  aim: 'Attack',
  defense: 'Defense',
  rangedAim: 'Ranged Attack',
  meleeAim: 'Melee Attack',
  rangedDefense: 'Ranged Defense',
  meleeDefense: 'Melee Defense',
  sight: 'Sight',
};

export function modsText(m: StatMods | undefined): string {
  if (!m) return '';
  return Object.entries(m)
    .filter(([, v]) => typeof v === 'number' && v !== 0)
    .map(([k, v]) => `${(v as number) > 0 ? '+' : ''}${v} ${MOD_LABEL[k] ?? k}`)
    .join(', ');
}

// ---------- attributes -> stats ----------

/** The floor every stat is held at, so stacked penalties can never make someone useless. */
export const STAT_FLOOR: StatBlock = { hp: 4, mobility: 3, crit: 0, rangedAim: 25, meleeAim: 25, rangedDefense: 0, meleeDefense: 0, sight: 5 };

export const BASE_AIM = 52;
export const BASE_MOBILITY = 3;
export const BASE_HP = 5;
export const BASE_SIGHT = 8;
/** Attribute points that buy no defense at all, so a level-1 squad is not already slippery. */
export const DEFENSE_OFFSET = 2;
/** However fast you are, a move is never longer than this: maps have to stay readable. */
export const MAX_MOBILITY = 8;

/** What the seven attributes alone are worth. */
export function attributeStats(a: Attributes): StatBlock {
  return {
    hp: BASE_HP + a.resilience * 2,
    mobility: Math.min(MAX_MOBILITY, BASE_MOBILITY + Math.ceil(a.hustle / 2)),
    crit: 2 + a.luck * 2,
    rangedAim: BASE_AIM + a.observation * 3,
    meleeAim: BASE_AIM + a.strength * 3 + a.hustle,
    // nobody is hard to hit standing still: defense is what you buy past the first few points
    rangedDefense: Math.max(0, a.hustle - DEFENSE_OFFSET),
    meleeDefense: Math.max(0, Math.floor((a.hustle + a.strength) / 2) - DEFENSE_OFFSET),
    sight: BASE_SIGHT + a.observation,
  };
}

/** What the trained combat skills are worth on top. Movement is capped in `effectiveStats`, not here. */
export function combatStats(c: CombatSkills): StatBlock {
  const s = zeroStats();
  s.meleeAim = combatValue(c, 'meleeAttack');
  s.rangedAim = combatValue(c, 'rangedAttack');
  s.meleeDefense = combatValue(c, 'meleeDefense');
  s.rangedDefense = combatValue(c, 'rangedDefense');
  s.mobility = Math.floor(combatValue(c, 'speed') / 2);
  return s;
}

/** Experience is earned faster by a quick study: +4% a point of Aptitude. */
export const xpMultiplier = (a: Attributes): number => 1 + a.aptitude * 0.04;

/** Luck shortens the odds of a knock becoming something permanent. */
export const luckFactor = (a: Attributes): number => Math.max(0.2, 1 - a.luck * 0.07);
