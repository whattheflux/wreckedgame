import { rand, type RngHolder } from './rng';
import { EXTRA_SKILLS } from './skills';
import type { StatMods } from './attributes';

/**
 * Perks: what you choose at a level-up. A perk either teaches an active skill, changes a stat, or
 * flips a rule flag the engine checks somewhere. Pools are keyed by plain strings so this module
 * stays free of roster.ts (which imports it).
 *
 * To add one: write the entry in PERKS, list its id in a pool, and — if it has a flag — handle that
 * flag in the one place it belongs. Every flag below is checked somewhere; `perks.test.ts` guards it.
 */

/** A rule a perk turns on. Each is read in exactly one part of the engine. */
export type PerkFlag =
  /** half cover does not help the target against you */
  | 'coverBreaker'
  /** range falloff beyond your optimal range is halved */
  | 'deadeye'
  /** +15 ranged attack within 3 tiles */
  | 'pointBlank'
  /** +12 crit when you swing at someone */
  | 'brawler'
  /** overwatch shots lose nothing to the reaction penalty */
  | 'steadyAim'
  /** every hit you take is 1 point lighter */
  | 'toughHide'
  /** the first blow that would put you down in a battle leaves you on 1 HP instead */
  | 'ironWill'
  /** walking away from someone never gives them a free swing */
  | 'nimble'
  /** your own parting blows land far more often */
  | 'duelist'
  /** gear on the people you down is likelier to survive them */
  | 'scrounger'
  /** changing what is in your hands mid-fight is free */
  | 'fastHands'
  /** reloading is free */
  | 'quickDraw'
  /** a heavy weapon no longer eats the rest of your turn */
  | 'runAndGun'
  /** putting someone down patches you up a little */
  | 'secondWind'
  /** Patch Up heals more and costs nothing */
  | 'fieldMedic'
  /** an extra beaker, and they hit harder */
  | 'chemist'
  /** charm attempts are far likelier to land */
  | 'showstopper'
  /** Incognito lasts an extra turn */
  | 'understudy'
  /** Throw Ball reaches further and hurts more */
  | 'cannonArm'
  /** shaken and scared slide right off you */
  | 'unflappable';

export interface Perk {
  id: string;
  name: string;
  blurb: string;
  /** teaches this active skill (a key of EXTRA_SKILLS) */
  grants?: string;
  /** permanent stat change */
  mods?: StatMods;
  /** rule this perk turns on */
  flag?: PerkFlag;
  /** perk id you need first */
  requires?: string;
}

const p = (perk: Perk): [string, Perk] => [perk.id, perk];

export const PERKS: Record<string, Perk> = Object.fromEntries([
  // ---- signature perks, handed out free at level 1 by a clique or a class ----
  p({ id: 'throwArm', name: 'Throwing Arm', blurb: 'Years of sport. You can put a ball through a window at thirty paces.', grants: 'throwBall' }),
  p({ id: 'labKit', name: 'Lab Kit', blurb: 'You kept the chemistry store key. Nobody has asked for it back.', grants: 'acidBeaker' }),
  p({ id: 'stagecraft', name: 'Stagecraft', blurb: 'Blocking, lighting, and knowing exactly where the audience is not looking.', grants: 'incognito' }),
  p({ id: 'paintPot', name: 'Paint Pot', blurb: 'A jar of poster paint and a good overarm.', grants: 'paintBomb' }),
  p({ id: 'firstAid', name: 'First Aid', blurb: 'You actually paid attention during the first-aid unit.', grants: 'patchUp' }),
  p({ id: 'bracing', name: 'Bracing', blurb: 'Shop-room stance: feet planted, weight low, ready for whatever comes.', grants: 'brace' }),
  p({ id: 'charmer', name: 'Charmer', blurb: 'People want you to like them. It is genuinely unfair.', grants: 'charm' }),
  p({ id: 'holler', name: 'Holler', blurb: 'A voice that carries across a field, and the lungs to use it.', grants: 'warCry' }),
  p({ id: 'unnerving', name: 'Unnerving', blurb: 'Nobody can say what it is about you. They would rather not find out.', grants: 'unsettle' }),
  p({ id: 'chill', name: 'Chill', blurb: 'Whatever is happening, it can wait until you have had a moment.', grants: 'mellow' }),

  // ---- taught skills ----
  p({ id: 'tackle', name: 'Tackle', blurb: 'Drop the shoulder and go through them.', grants: 'tackle' }),
  p({ id: 'shoulderCharge', name: 'Shoulder Charge', blurb: 'The same idea, learned on a field instead of in a gym.', grants: 'tackle' }),
  p({ id: 'analyse', name: 'Analyse', blurb: 'Watch how someone fights for ten seconds and tell everyone where the gap is.', grants: 'analyse' }),
  p({ id: 'scenePartner', name: 'Scene Partner', blurb: 'You know how to give somebody their cue.', grants: 'rally' }),
  p({ id: 'socialite', name: 'Socialite', blurb: 'A word in the right ear and they are back on their feet.', grants: 'rally' }),
  p({ id: 'monologue', name: 'Monologue', blurb: 'It is not showing off if it works.', grants: 'rally' }),
  p({ id: 'mealPrep', name: 'Meal Prep', blurb: 'You have been rationing the good snacks since day one.', grants: 'rations' }),

  // ---- rule perks ----
  p({ id: 'cannonArm', name: 'Cannon Arm', blurb: 'Further and harder than anyone expects.', flag: 'cannonArm', requires: 'throwArm' }),
  p({ id: 'chemist', name: 'Chemist', blurb: 'A stronger mix, and you packed a spare.', flag: 'chemist', requires: 'labKit' }),
  p({ id: 'understudy', name: 'Understudy', blurb: 'You can hold a pose for a very long time.', flag: 'understudy', requires: 'stagecraft' }),
  p({ id: 'showstopper', name: 'Showstopper', blurb: 'They forget what they were doing entirely.', flag: 'showstopper', requires: 'charmer' }),
  p({ id: 'fieldMedic', name: 'Field Medic', blurb: 'Faster hands and a better bandage.', flag: 'fieldMedic', requires: 'firstAid' }),
  p({ id: 'coverBreaker', name: 'Cover Breaker', blurb: 'You shoot at the bit of them that is sticking out.', flag: 'coverBreaker' }),
  p({ id: 'muralist', name: 'Muralist', blurb: 'You see the whole shape of a thing, including the half behind the crate.', flag: 'coverBreaker' }),
  p({ id: 'deadeye', name: 'Deadeye', blurb: 'Distance bothers you about half as much as it should.', flag: 'deadeye' }),
  p({ id: 'calculated', name: 'Calculated', blurb: 'You worked out the drop once and never forgot it.', flag: 'deadeye' }),
  p({ id: 'steadyHand', name: 'Steady Hand', blurb: 'A snap shot is just a slow shot taken quickly.', flag: 'steadyAim' }),
  p({ id: 'closeQuarters', name: 'Close Quarters', blurb: 'You do your best work from a few paces away.', flag: 'pointBlank' }),
  p({ id: 'brawler', name: 'Brawler', blurb: 'You know where it hurts.', flag: 'brawler' }),
  p({ id: 'toughHide', name: 'Tough Hide', blurb: 'You have been hit before. It was fine.', flag: 'toughHide' }),
  p({ id: 'ironWill', name: 'Iron Will', blurb: 'The first time it should finish you, it does not.', flag: 'ironWill' }),
  p({ id: 'nimbleFeet', name: 'Nimble Feet', blurb: 'Nobody gets a free swing at you as you go past.', flag: 'nimble' }),
  p({ id: 'splinters', name: 'Splinters', blurb: 'Try walking away from you and find out.', flag: 'duelist' }),
  p({ id: 'scrounger', name: 'Scrounger', blurb: 'You know what is worth picking up off a body.', flag: 'scrounger' }),
  p({ id: 'fastHands', name: 'Fast Hands', blurb: 'Swap what you are holding without breaking stride.', flag: 'fastHands' }),
  p({ id: 'improv', name: 'Improv', blurb: 'Whatever is in reach becomes the prop you needed.', flag: 'fastHands' }),
  p({ id: 'thrifty', name: 'Thrifty', blurb: 'Reloading is muscle memory by now.', flag: 'quickDraw' }),
  p({ id: 'quickDraw', name: 'Quick Draw', blurb: 'Loaded before anyone noticed you were empty.', flag: 'quickDraw' }),
  p({ id: 'heavyHitter', name: 'Heavy Hitter', blurb: 'You can swing the big stuff and still have something left.', flag: 'runAndGun' }),
  p({ id: 'secondWind', name: 'Second Wind', blurb: 'Putting someone down puts you right.', flag: 'secondWind' }),
  p({ id: 'facade', name: 'Facade', blurb: 'Nothing gets to you where anyone can see it.', flag: 'unflappable' }),
  p({ id: 'unflappable', name: 'Unflappable', blurb: 'Fear is a choice and you have declined.', flag: 'unflappable' }),

  // ---- plain stat perks ----
  p({ id: 'sprinter', name: 'Sprinter', blurb: 'One more stride in every dash.', mods: { mobility: 1 } }),
  p({ id: 'linebacker', name: 'Linebacker', blurb: 'Close the distance and finish it.', mods: { meleeAim: 8 } }),
  p({ id: 'keenEye', name: 'Keen Eye', blurb: 'You pick the shot before you raise your arm.', mods: { rangedAim: 6 } }),
  p({ id: 'fieldGlasses', name: 'Field Glasses', blurb: 'Salvaged binoculars, and the patience to use them.', mods: { sight: 3 } }),
  p({ id: 'swot', name: 'Swot', blurb: 'You read the ground the way you read a textbook.', mods: { sight: 2, rangedAim: 3 } }),
  p({ id: 'poise', name: 'Poise', blurb: 'Stage presence, applied to not being hit.', mods: { defense: 5 } }),
  p({ id: 'limelight', name: 'Limelight', blurb: 'If you are going to do it, do it where it counts.', mods: { crit: 8 } }),
  p({ id: 'composition', name: 'Composition', blurb: 'You can see the one line that matters.', mods: { crit: 8 } }),
  p({ id: 'lifeDrawing', name: 'Life Drawing', blurb: 'Hours of looking properly at people.', mods: { rangedAim: 6, sight: 1 } }),
  p({ id: 'homely', name: 'Homely', blurb: 'Warm food, dry socks, and the sense to use both.', mods: { hp: 4 } }),
  p({ id: 'whittler', name: 'Whittler', blurb: 'You have handled a blade every week since you were nine.', mods: { meleeAim: 8 } }),
  p({ id: 'sturdy', name: 'Sturdy', blurb: 'Built like the benches in the shop room.', mods: { hp: 3, meleeDefense: 3 } }),
  p({ id: 'carpenter', name: 'Carpenter', blurb: 'You know what stops a blow and you stand behind it.', mods: { defense: 4 } }),
  p({ id: 'armourer', name: 'Armourer', blurb: 'Plate, strap and rivet, cut down to fit a teenager.', mods: { defense: 5 } }),
  p({ id: 'forgedEdge', name: 'Forged Edge', blurb: 'Your edge is better than theirs, because you made it.', mods: { meleeAim: 6, crit: 4 } }),
  p({ id: 'entourage', name: 'Entourage', blurb: 'Somebody is always watching your back, mostly.', mods: { hp: 2, crit: 4 } }),
  p({ id: 'conditioning', name: 'Conditioning', blurb: 'Pre-season, every season.', mods: { hp: 5 } }),
  p({ id: 'bigSwing', name: 'Big Swing', blurb: 'All of it, all at once.', mods: { meleeAim: 6, crit: 4 } }),
  p({ id: 'erratic', name: 'Erratic', blurb: 'Nobody can read you, least of all you.', mods: { crit: 10, rangedDefense: 3 } }),
  p({ id: 'luckyBreak', name: 'Lucky Break', blurb: 'Things keep going your way and nobody can explain it.', mods: { crit: 6, hp: 2 } }),
  p({ id: 'slowBurn', name: 'Slow Burn', blurb: 'You keep going long after it stops making sense.', mods: { hp: 5 } }),
  p({ id: 'zenGarden', name: 'Zen Garden', blurb: 'Very hard to hit something that was never quite where you thought.', mods: { defense: 5 } }),
]);

export const perkById = (id: string): Perk | undefined => PERKS[id];

/** Does this unit's perks turn on the given rule? */
export const hasFlag = (u: { flags?: string[] } | undefined, f: PerkFlag): boolean => !!u?.flags?.includes(f);

// ---------- who can learn what ----------

/** The perk every member of a class starts with, free, at level 1. */
export const CLASS_STARTER: Record<string, string> = {
  sport: 'throwArm',
  science: 'labKit',
  drama: 'stagecraft',
  art: 'paintPot',
  homeec: 'firstAid',
  woodwork: 'bracing',
  metalwork: 'bracing',
};

/** The perk every member of a clique starts with, free, at level 1. */
export const CLIQUE_STARTER: Record<string, string> = {
  popular: 'charmer',
  jock: 'holler',
  nerd: 'labKit',
  drama: 'stagecraft',
  weirdo: 'unnerving',
  stoner: 'chill',
};

/** What a class can teach at its level-up picks. */
export const CLASS_POOL: Record<string, string[]> = {
  sport: ['cannonArm', 'tackle', 'sprinter', 'nimbleFeet', 'linebacker', 'closeQuarters'],
  science: ['chemist', 'analyse', 'keenEye', 'fieldGlasses', 'coverBreaker'],
  drama: ['understudy', 'scenePartner', 'poise', 'limelight', 'improv'],
  art: ['deadeye', 'composition', 'steadyHand', 'lifeDrawing', 'muralist'],
  homeec: ['fieldMedic', 'mealPrep', 'scrounger', 'homely', 'thrifty'],
  woodwork: ['whittler', 'sturdy', 'fastHands', 'splinters', 'carpenter'],
  metalwork: ['heavyHitter', 'brawler', 'ironWill', 'armourer', 'forgedEdge'],
};

/** What a clique can teach at its level-up picks. */
export const CLIQUE_POOL: Record<string, string[]> = {
  popular: ['showstopper', 'socialite', 'entourage', 'facade'],
  jock: ['conditioning', 'shoulderCharge', 'toughHide', 'bigSwing', 'closeQuarters'],
  nerd: ['analyse', 'coverBreaker', 'swot', 'calculated'],
  drama: ['understudy', 'monologue', 'limelight', 'poise'],
  weirdo: ['erratic', 'brawler', 'secondWind', 'luckyBreak'],
  stoner: ['unflappable', 'slowBurn', 'quickDraw', 'zenGarden'],
};

// ---------- reading a set of perks ----------

/** The active skills this set of perks teaches, in perk order, without repeats. */
export function grantedSkills(perks: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of perks) {
    const g = PERKS[id]?.grants;
    if (g && EXTRA_SKILLS[g] && !out.includes(g)) out.push(g);
  }
  return out;
}

/** Every rule flag this set turns on. */
export function perkFlags(perks: readonly string[]): PerkFlag[] {
  const out = new Set<PerkFlag>();
  for (const id of perks) {
    const f = PERKS[id]?.flag;
    if (f) out.add(f);
  }
  return [...out];
}

/** Every stat change this set makes, for `effectiveStats` to fold in. */
export const perkMods = (perks: readonly string[]): StatMods[] => perks.map((id) => PERKS[id]?.mods).filter((m): m is StatMods => !!m);

/**
 * A perk is worth offering when you do not have it, you have what it needs first, and it would not
 * just teach you a skill you already know by another name.
 */
export function eligible(pool: readonly string[], owned: readonly string[]): string[] {
  const known = new Set(grantedSkills(owned));
  return pool.filter((id) => {
    const perk = PERKS[id];
    if (!perk || owned.includes(id)) return false;
    if (perk.requires && !owned.includes(perk.requires)) return false;
    if (perk.grants && known.has(perk.grants)) return false;
    return true;
  });
}

/**
 * The perks to put in front of the player for one pick. Drawn with the given random stream, so a
 * level-up's offer is fixed the moment it happens and cannot be rerolled by closing the screen.
 */
export function offerPerks(pool: readonly string[], owned: readonly string[], rng: RngHolder, count = 2): string[] {
  const options = eligible(pool, owned);
  const out: string[] = [];
  while (out.length < count && options.length > 0) {
    out.push(options.splice(Math.floor(rand(rng) * options.length), 1)[0]);
  }
  return out;
}
