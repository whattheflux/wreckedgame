import type { Biome, GameMap, Terrain, Weapon } from './types';
import type { Scenario, UnitSpec } from './battle';
import { randInt } from './rng';

export const WEAPONS = {
  slingshot: { name: 'Slingshot', damage: [2, 4], range: 9, optimal: 6, aimMod: 0, critMod: 5, clip: 6 },
  javelin: { name: 'Javelin', damage: [4, 6], range: 5, optimal: 3, aimMod: 5, critMod: 10, clip: 2 },
  flareGun: { name: 'Flare Gun', damage: [5, 8], range: 8, optimal: 5, aimMod: -5, critMod: 0, clip: 2 },
  pole: { name: 'Sharpened Pole', damage: [3, 5], range: 2.5, optimal: 1.5, aimMod: 10, critMod: 10, clip: 4 },
} satisfies Record<string, Weapon>;

type Edit = (
  set: (x: number, y: number, t: Terrain) => void,
  rect: (x0: number, y0: number, x1: number, y1: number, t: Terrain) => void,
) => void;

export function buildMap(width: number, height: number, edit: Edit, biome?: Biome): GameMap {
  const tiles: Terrain[][] = Array.from({ length: height }, () => Array<Terrain>(width).fill('floor'));
  const set = (x: number, y: number, t: Terrain): void => {
    if (x >= 0 && y >= 0 && x < width && y < height) tiles[y][x] = t;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, t: Terrain): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t);
  };
  edit(set, rect);
  return { width, height, tiles, biome };
}

// ---------- squad / rivals ----------

export const SQUAD_TEMPLATE = [
  { id: 'p1', name: 'Mia', role: 'Scout', hp: 10, mobility: 6, aim: 72, defense: 10, crit: 10, weapon: WEAPONS.slingshot },
  { id: 'p2', name: 'Jonah', role: 'Jock', hp: 14, mobility: 5, aim: 62, defense: 0, crit: 5, weapon: WEAPONS.javelin },
  { id: 'p3', name: 'Priya', role: 'Nerd', hp: 9, mobility: 5, aim: 75, defense: 0, crit: 5, weapon: WEAPONS.flareGun },
  { id: 'p4', name: 'Sam', role: 'Drama kid', hp: 11, mobility: 5, aim: 66, defense: 5, crit: 10, weapon: WEAPONS.slingshot },
];

export function squadAt(positions: Array<[number, number]>): UnitSpec[] {
  return SQUAD_TEMPLATE.map((t, i) => ({ ...t, team: 'player' as const, x: positions[i][0], y: positions[i][1] }));
}

export function foe(id: string, name: string, x: number, y: number, pod: string, weapon: Weapon, hp = 10, aim = 60): UnitSpec {
  return { id, name, team: 'enemy', role: 'Varsity', x, y, hp, mobility: 5, aim, defense: 0, crit: 5, weapon, pod };
}

// ---------- Beach Landing (24x16) ----------

function beachMap(): GameMap {
  return buildMap(24, 16, (set, rect) => {
    // Sea along the top and the right edge
    rect(0, 0, 23, 1, 'water');
    rect(22, 0, 23, 15, 'water');
    rect(0, 15, 23, 15, 'water');

    // Broken section of hull in the middle of the beach
    rect(10, 5, 13, 5, 'wall');
    rect(10, 6, 10, 7, 'wall');
    rect(13, 8, 13, 9, 'wall');
    rect(10, 10, 13, 10, 'wall');

    // Crates, rocks and deck chairs
    for (const [x, y] of [[5, 7], [5, 8], [6, 12], [7, 4], [8, 9], [15, 4], [16, 9], [18, 12], [17, 3], [12, 12]] as const) set(x, y, 'half');
    for (const [x, y] of [[7, 7], [8, 12], [14, 7], [15, 11], [18, 6], [19, 9], [9, 3], [12, 13]] as const) set(x, y, 'full');
  }, 'beach');
}

export const beachLanding: Scenario = {
  name: 'Beach Landing',
  seed: 20261103,
  map: beachMap,
  units: [
    ...squadAt([[2, 11], [3, 13], [3, 9], [2, 7]]),
    // Pod A: three Varsity guarding the north end of the beach
    foe('e1', 'Brock', 19, 4, 'A', WEAPONS.javelin),
    foe('e2', 'Tyler', 20, 5, 'A', WEAPONS.slingshot, 9, 62),
    foe('e3', 'Dane', 19, 6, 'A', WEAPONS.pole),
    // Pod B: two more camped by the south rocks
    foe('e4', 'Cole', 20, 11, 'B', WEAPONS.slingshot, 9, 62),
    foe('e5', 'Reid', 19, 12, 'B', WEAPONS.javelin),
  ],
};

// ---------- Jungle Interior (40x28): big on purpose, to exercise fog of war and the contact hint ----------

/** Open ground kept clear around every spawn so nobody starts inside a rock. [x, y, radius] */
const JUNGLE_CLEAR: Array<[number, number, number]> = [
  [3, 22, 3],
  [32, 6, 2],
  [34, 18, 2],
  [21, 12, 2],
  [11, 6, 2],
];

function jungleMap(): GameMap {
  const W = 40;
  const H = 28;
  return buildMap(W, H, (set, rect) => {
    rect(0, 0, W - 1, 1, 'water');
    rect(0, H - 2, W - 1, H - 1, 'water');
    rect(W - 2, 0, W - 1, H - 1, 'water');

    const rng = { rngState: 1337 };
    const ri = (a: number, b: number): number => randInt(rng, a, b);
    // Dense growth and rock outcrops that block sight
    for (let i = 0; i < 34; i++) {
      const cx = ri(4, W - 5);
      const cy = ri(3, H - 4);
      rect(cx, cy, cx + ri(1, 3) - 1, cy + ri(1, 3) - 1, 'wall');
    }
    for (let i = 0; i < 46; i++) set(ri(2, W - 3), ri(2, H - 3), 'half');
    for (let i = 0; i < 30; i++) set(ri(2, W - 3), ri(2, H - 3), 'full');

    for (const [x, y, r] of JUNGLE_CLEAR) rect(x - r, y - r, x + r, y + r, 'floor');
  }, 'forest');
}

export const jungleInterior: Scenario = {
  name: 'Jungle Interior',
  seed: 4242,
  map: jungleMap,
  units: [
    ...squadAt([[2, 21], [3, 22], [4, 21], [3, 20]]),
    foe('e1', 'Brock', 31, 6, 'A', WEAPONS.javelin),
    foe('e2', 'Tyler', 33, 6, 'A', WEAPONS.slingshot, 9, 62),
    foe('e3', 'Dane', 32, 7, 'A', WEAPONS.pole),
    foe('e4', 'Cole', 34, 18, 'B', WEAPONS.slingshot, 9, 62),
    foe('e5', 'Reid', 35, 19, 'B', WEAPONS.javelin),
    foe('e6', 'Chad', 33, 19, 'B', WEAPONS.pole),
    foe('e7', 'Troy', 21, 12, 'C', WEAPONS.slingshot, 9, 62),
    foe('e8', 'Wade', 22, 12, 'C', WEAPONS.javelin),
    foe('e9', 'Kyle', 11, 6, 'D', WEAPONS.slingshot, 9, 62),
    foe('e10', 'Jace', 12, 6, 'D', WEAPONS.javelin),
    foe('e11', 'Nate', 11, 7, 'D', WEAPONS.pole),
  ],
};

export const SCENARIOS: Scenario[] = [beachLanding, jungleInterior];
