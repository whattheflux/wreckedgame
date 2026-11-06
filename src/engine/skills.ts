import type { Unit, Weapon } from './types';

/** How a skill is aimed. */
export type SkillTarget =
  /** happens at once, no target */
  | 'self'
  /** click an enemy in range and sight */
  | 'enemy'
  /** acts on an adjacent ally (or yourself) who needs it */
  | 'ally'
  /** no targeting: it is a stance of the base game (overwatch, reload, revive) */
  | 'base';

/** Something a unit can do from the action bar besides moving and its basic attack. */
export interface Skill {
  id: string;
  name: string;
  /** hotkey */
  key: string;
  /** AP cost as the tooltip words it */
  cost: string;
  desc: string;
  target: SkillTarget;
  /** AP spent (the base skills do their own accounting) */
  ap?: number;
  /** uses per battle; absent = unlimited */
  perBattle?: number;
  /** a thrown skill resolves like a shot with this weapon (range, falloff and cover all apply) */
  throws?: Weapon;
}

/** What everyone can do. */
export const BASE_SKILLS: Skill[] = [
  {
    id: 'overwatch',
    name: 'Overwatch',
    key: 'o',
    cost: 'All remaining AP (ends turn)',
    desc: 'Watch the ground in front of you. The first enemy to move into sight takes a reaction shot, at a small aim penalty.',
    target: 'base',
  },
  {
    id: 'reload',
    name: 'Reload',
    key: 'r',
    cost: '1 AP',
    desc: 'Refill your weapon to a full clip.',
    target: 'base',
  },
  {
    id: 'revive',
    name: 'Revive',
    key: 'v',
    cost: '1 AP',
    desc: 'Pick up an adjacent knocked-down ally. They return with part of their HP and no AP this turn.',
    target: 'base',
  },
];

/** Things thrown rather than fired: no clip, they never break, and they are lighter than a real weapon. */
export const BALL: Weapon = { name: 'Thrown Ball', damage: [2, 4], range: 7, optimal: 4, aimMod: 0, critMod: 5, clip: 99, hands: 1, heavy: false };
export const BEAKER: Weapon = {
  name: 'Acid Beaker',
  damage: [1, 3],
  range: 5,
  optimal: 5,
  aimMod: 5,
  critMod: 0,
  clip: 99,
  hands: 1,
  heavy: false,
  inflicts: [{ effect: 'burn', chance: 0.8 }],
};

/** The class and clique skills. Add new ones here and in CLIQUE_SKILLS / CLASS_SKILLS. */
export const EXTRA_SKILLS: Record<string, Skill> = {
  throwBall: {
    id: 'throwBall',
    name: 'Throw Ball',
    key: 't',
    cost: '1 AP',
    desc: 'Wing a baseball or football at someone. Range 7, 2-4 damage, never runs out. A light throw: you can still move or throw again.',
    target: 'enemy',
    ap: 1,
    throws: BALL,
  },
  acidBeaker: {
    id: 'acidBeaker',
    name: 'Acid Beaker',
    key: 'a',
    cost: '1 AP, 2 per battle',
    desc: 'Lob a beaker of something nasty from the lab. Range 5, 1-3 damage, and it usually sets in and burns.',
    target: 'enemy',
    ap: 1,
    perBattle: 2,
    throws: BEAKER,
  },
  charm: {
    id: 'charm',
    name: 'Charm',
    key: 'h',
    cost: '1 AP, once per battle',
    desc: 'Flash a smile at someone in sight (range 7). If it works they are starry-eyed and lose their turns until they are hurt. Harder on the tough.',
    target: 'enemy',
    ap: 1,
    perBattle: 1,
  },
  incognito: {
    id: 'incognito',
    name: 'Incognito',
    key: 'k',
    cost: '1 AP, once per battle',
    desc: 'Fade into the scenery for two turns. Rivals cannot see or target you from a distance. Anyone next to you still can, and attacking gives you away.',
    target: 'self',
    ap: 1,
    perBattle: 1,
  },
  patchUp: {
    id: 'patchUp',
    name: 'Patch Up',
    key: 'p',
    cost: '1 AP, uses a bandage',
    desc: 'Use a bandage from your belt or pack on someone next to you (or yourself): restores 4 HP and stops bleeding.',
    target: 'ally',
    ap: 1,
  },
};

/** What each clique and class adds. Keys are the clique / class ids from roster.ts (kept as strings so this file stays import-free). */
export const CLIQUE_SKILLS: Record<string, string[]> = {
  popular: ['charm'],
  nerd: ['acidBeaker'],
  drama: ['incognito'],
};
export const CLASS_SKILLS: Record<string, string[]> = {
  sport: ['throwBall'],
  drama: ['incognito'],
  homeec: ['patchUp'],
};

/** The extra skill ids for a clique + class pair, without duplicates, clique first. */
export function skillIdsFor(clique: string, schoolClass: string): string[] {
  return [...new Set([...(CLIQUE_SKILLS[clique] ?? []), ...(CLASS_SKILLS[schoolClass] ?? [])])];
}

export const skillById = (id: string): Skill | undefined => BASE_SKILLS.find((s) => s.id === id) ?? EXTRA_SKILLS[id];

/** Every skill the unit has, in the order the action bar shows them. */
export function skillsOf(unit?: Pick<Unit, 'skills'>): Skill[] {
  const extra = (unit?.skills ?? []).map((id) => EXTRA_SKILLS[id]).filter((s): s is Skill => !!s);
  return [...BASE_SKILLS, ...extra];
}
