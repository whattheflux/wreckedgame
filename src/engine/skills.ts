import type { Unit } from './types';

/** Something a unit can do from the action bar besides moving and its basic attack. */
export interface Skill {
  id: string;
  name: string;
  /** hotkey */
  key: string;
  /** AP cost as the tooltip words it */
  cost: string;
  desc: string;
}

/** What everyone can do. Class and clique skills (charm, invisibility, thrown beakers...) get added beside these. */
export const BASE_SKILLS: Skill[] = [
  {
    id: 'overwatch',
    name: 'Overwatch',
    key: 'o',
    cost: 'All remaining AP (ends turn)',
    desc: 'Watch the ground in front of you. The first enemy to move into sight takes a reaction shot, at a small aim penalty.',
  },
  {
    id: 'reload',
    name: 'Reload',
    key: 'r',
    cost: '1 AP',
    desc: 'Refill your weapon to a full clip.',
  },
  {
    id: 'revive',
    name: 'Revive',
    key: 'v',
    cost: '1 AP',
    desc: 'Pick up an adjacent knocked-down ally. They return with part of their HP and no AP this turn.',
  },
];

/** Every skill the unit has, in the order the action bar shows them. */
export function skillsOf(_unit?: Unit): Skill[] {
  return BASE_SKILLS;
}
