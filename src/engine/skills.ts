import type { Unit, Weapon } from './types';

/** How a skill is aimed. */
export type SkillTarget =
  /** happens at once, with no target to pick (a stance, a shout, something you do to yourself) */
  | 'self'
  /** click an enemy in range and sight */
  | 'enemy'
  /** acts on an adjacent ally (or yourself) who needs it */
  | 'ally'
  /** no targeting: one of the things everybody can do (overwatch, reload, revive) */
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
  /** using it spends the rest of the turn, like a heavy weapon */
  endsTurn?: boolean;
  /** uses per battle; absent = unlimited */
  perBattle?: number;
  /** a thrown skill resolves like a shot with this weapon (range, falloff and cover all apply) */
  throws?: Weapon;
  /** consumes this item from the belt or pack */
  needsItem?: string;
  /** how far it reaches when it is not a throw (tiles); absent = adjacent */
  range?: number;
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

// ---------- things that get thrown ----------

/** Thrown, not fired: no clip to run dry, and they never break the weapon in your hands. */
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
export const PAINT: Weapon = {
  name: 'Paint Bomb',
  damage: [1, 2],
  range: 6,
  optimal: 5,
  aimMod: 10,
  critMod: 0,
  clip: 99,
  hands: 1,
  heavy: false,
  inflicts: [{ effect: 'blind', chance: 0.7 }],
};

// ---------- the skills perks grant ----------

/**
 * Everything a perk can give you. Keyed by id; `perks.ts` decides who can learn what and when.
 * Hotkeys are unique across this table and never clash with the fixed battle keys.
 */
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
  paintBomb: {
    id: 'paintBomb',
    name: 'Paint Bomb',
    key: 'b',
    cost: '1 AP, 2 per battle',
    desc: 'A jar of poster paint in the face. Range 6, little damage, but they usually cannot see a thing afterwards.',
    target: 'enemy',
    ap: 1,
    perBattle: 2,
    throws: PAINT,
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
    range: 7,
  },
  analyse: {
    id: 'analyse',
    name: 'Analyse',
    key: 'q',
    cost: '1 AP, 2 per battle',
    desc: 'Read how someone fights and call it out. Range 9: they are marked for two turns and everyone finds them easier to hit.',
    target: 'enemy',
    ap: 1,
    perBattle: 2,
    range: 9,
  },
  tackle: {
    id: 'tackle',
    name: 'Tackle',
    key: 'c',
    cost: '1 AP (ends turn)',
    desc: 'Charge someone you can reach, shoulder first. You end up next to them, they take a hit and are often stunned.',
    target: 'enemy',
    ap: 1,
    endsTurn: true,
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
  brace: {
    id: 'brace',
    name: 'Brace',
    key: 'd',
    cost: '1 AP (ends turn)',
    desc: 'Plant your feet and watch the ground around you: much harder to hit until your next turn.',
    target: 'self',
    ap: 1,
    endsTurn: true,
  },
  warCry: {
    id: 'warCry',
    name: 'War Cry',
    key: 's',
    cost: '1 AP, once per battle',
    desc: 'Roar at everyone nearby. Rivals within 5 tiles are shaken: their aim and nerve go.',
    target: 'self',
    ap: 1,
    perBattle: 1,
    range: 5,
  },
  unsettle: {
    id: 'unsettle',
    name: 'Unsettle',
    key: 'u',
    cost: '1 AP, once per battle',
    desc: 'Do whatever it is you do. Rivals within 4 tiles are scared and shoot badly for a while.',
    target: 'self',
    ap: 1,
    perBattle: 1,
    range: 4,
  },
  mellow: {
    id: 'mellow',
    name: 'Mellow Out',
    key: 'j',
    cost: '1 AP, once per battle',
    desc: 'Breathe. Everything on you (burning, bleeding, scared, the lot) comes off, and you get 3 HP back.',
    target: 'self',
    ap: 1,
    perBattle: 1,
  },
  rally: {
    id: 'rally',
    name: 'Rally',
    key: 'y',
    cost: '1 AP, once per battle',
    desc: 'Get an adjacent friend moving again: they gain an action point and shake off being shaken or scared.',
    target: 'ally',
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
    needsItem: 'bandage',
  },
  rations: {
    id: 'rations',
    name: 'Rations',
    key: 'g',
    cost: '1 AP, uses an energy bar',
    desc: 'Push an energy bar into someone next to you (or yourself): 3 HP back, and it settles their nerves.',
    target: 'ally',
    ap: 1,
    needsItem: 'energybar',
  },
};

export const skillById = (id: string): Skill | undefined => BASE_SKILLS.find((s) => s.id === id) ?? EXTRA_SKILLS[id];

/** Every skill the unit has, in the order the action bar shows them. */
export function skillsOf(unit?: Pick<Unit, 'skills'>): Skill[] {
  const extra = (unit?.skills ?? []).map((id) => EXTRA_SKILLS[id]).filter((s): s is Skill => !!s);
  return [...BASE_SKILLS, ...extra];
}
