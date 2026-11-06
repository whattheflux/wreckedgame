import { rand, type RngHolder } from './rng';

/**
 * Rival crews for world-site fights. Every encounter is a rival school turning up with a mix of
 * different kinds of kid (none of them the kinds already in the player's party). Presentation only:
 * the crew decides names, roles and art, never stats, so difficulty stays in encounter.ts.
 *
 * To add a kind of kid once its art is bundled (src/assets/sprites/<key>/), add a row to RIVAL_KINDS.
 */
export interface RivalKind {
  label: string;
  /** art key per look; a kind with one look (e.g. only male art so far) lists just that one */
  art: { male?: string; female?: string };
  /**
   * What this kind of kid has worked out how to do, best trick first. They are handed out by
   * difficulty (see `rivalSkills`), so the first fights stay simple. Deliberately none of the ones
   * that would take a turn away from the player: rivals shout, charge, brace and throw.
   */
  skills?: string[];
}

export const RIVAL_KINDS: RivalKind[] = [
  { label: 'Goth', art: { male: 'goth-male', female: 'goth-female' }, skills: ['unsettle', 'analyse'] },
  { label: 'Stoner', art: { male: 'stoner-male', female: 'stoner-female' }, skills: ['mellow', 'brace'] },
  { label: 'Shop Kid', art: { male: 'shop-male', female: 'shop-female' }, skills: ['brace', 'tackle'] },
  { label: 'Cheerleader', art: { male: 'cheer-male', female: 'cheer-female' }, skills: ['warCry', 'rally'] },
  { label: 'Rebel', art: { male: 'rebel-male', female: 'rebel-female' }, skills: ['paintBomb', 'unsettle'] },
  { label: 'New Kid', art: { male: 'newkid-male', female: 'newkid-female' }, skills: ['brace'] },
  { label: 'Big Kid', art: { male: 'bigkid-male', female: 'bigkid-female' }, skills: ['tackle', 'warCry'] },
  { label: 'Drama Kid', art: { male: 'drama-guy' }, skills: ['unsettle', 'rally'] },
];

/** Skills a kind brings to a fight of this difficulty: none in the easiest, one, then everything. */
export function rivalSkills(kind: RivalKind, difficulty: number): string[] {
  if (difficulty <= 1) return [];
  return (kind.skills ?? []).slice(0, difficulty >= 3 ? 2 : 1);
}

export const RIVAL_SCHOOLS = [
  'Westbrook High', 'Ridgemont Prep', "St. Aldric's", 'Cutter Bay Academy', 'Hollow Pines High',
  'Marlow Heights', 'Bellwether College', 'Port Kessing High', 'Lakemont Secondary', 'Ashgrove Prep',
];

const MALE_NAMES = [
  'Brock', 'Tyler', 'Dane', 'Cole', 'Reid', 'Chad', 'Troy', 'Wade', 'Kyle', 'Jace', 'Nate', 'Rhett',
  'Colt', 'Grant', 'Hunter', 'Blake', 'Axel', 'Dex', 'Boone', 'Flint', 'Garrett', 'Heath', 'Jett', 'Knox',
];
const FEMALE_NAMES = [
  'Brooke', 'Tess', 'Dani', 'Kayla', 'Reese', 'Chloe', 'Tori', 'Wren', 'Kira', 'Jade', 'Nova', 'Raven',
  'Cass', 'Greta', 'Harper', 'Blair', 'Ash', 'Dede', 'Bree', 'Fern', 'Gwen', 'Hailey', 'Jules', 'Kit',
];

export interface RivalMember {
  name: string;
  /** art key, same as Unit.sprite */
  sprite: string;
  role: string;
  /** what this one can do besides shoot (see `rivalSkills`) */
  skills: string[];
}

export interface RivalCrew {
  school: string;
  members: RivalMember[];
}

function shuffle<T>(rng: RngHolder, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(rng) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Every (kind, look) with art, i.e. what a rival can look like. */
export function rivalLooks(): Array<{ kind: RivalKind; look: 'male' | 'female'; sprite: string }> {
  const out: Array<{ kind: RivalKind; look: 'male' | 'female'; sprite: string }> = [];
  for (const kind of RIVAL_KINDS) {
    for (const look of ['male', 'female'] as const) {
      const sprite = kind.art[look];
      if (sprite) out.push({ kind, look, sprite });
    }
  }
  return out;
}

/**
 * A rival school and `count` members, deterministic per seed. Looks are dealt from a shuffled deck
 * of every (kind, look) so a crew is as mixed as it can be before anything repeats; names are unique.
 * Uses its own random stream so it never disturbs map generation.
 */
export function rivalCrew(seed: number, count: number, difficulty = 1): RivalCrew {
  const rng: RngHolder = { rngState: (seed ^ 0x2c1b3c6d) | 0 };
  const school = RIVAL_SCHOOLS[Math.floor(rand(rng) * RIVAL_SCHOOLS.length)];
  const looks = rivalLooks();
  let deck: typeof looks = [];
  const male = shuffle(rng, MALE_NAMES);
  const female = shuffle(rng, FEMALE_NAMES);
  const members: RivalMember[] = [];
  for (let i = 0; i < count; i++) {
    if (deck.length === 0) deck = shuffle(rng, looks);
    const pick = deck.pop()!;
    const name = (pick.look === 'male' ? male : female).pop() ?? `${pick.kind.label} ${i + 1}`;
    members.push({ name, sprite: pick.sprite, role: `${pick.kind.label} (${school})`, skills: rivalSkills(pick.kind, difficulty) });
  }
  return { school, members };
}
