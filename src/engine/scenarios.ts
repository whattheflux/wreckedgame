import type { GameMap, Terrain, Weapon } from './types';
import type { Scenario, UnitSpec } from './battle';

export const WEAPONS = {
  slingshot: { name: 'Slingshot', damage: [2, 4], range: 9, optimal: 6, aimMod: 0, critMod: 5, clip: 6 },
  javelin: { name: 'Javelin', damage: [4, 6], range: 5, optimal: 3, aimMod: 5, critMod: 10, clip: 2 },
  flareGun: { name: 'Flare Gun', damage: [5, 8], range: 8, optimal: 5, aimMod: -5, critMod: 0, clip: 2 },
  pole: { name: 'Sharpened Pole', damage: [3, 5], range: 2.5, optimal: 1.5, aimMod: 10, critMod: 10, clip: 4 },
} satisfies Record<string, Weapon>;

function buildMap(
  width: number,
  height: number,
  edit: (set: (x: number, y: number, t: Terrain) => void, rect: (x0: number, y0: number, x1: number, y1: number, t: Terrain) => void) => void,
): GameMap {
  const tiles: Terrain[][] = Array.from({ length: height }, () => Array<Terrain>(width).fill('floor'));
  const set = (x: number, y: number, t: Terrain): void => {
    if (x >= 0 && y >= 0 && x < width && y < height) tiles[y][x] = t;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, t: Terrain): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t);
  };
  edit(set, rect);
  return { width, height, tiles };
}

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
  });
}

const squad: UnitSpec[] = [
  { id: 'p1', name: 'Mia', team: 'player', role: 'Scout', x: 2, y: 11, hp: 10, mobility: 6, aim: 72, defense: 10, crit: 10, weapon: WEAPONS.slingshot },
  { id: 'p2', name: 'Jonah', team: 'player', role: 'Jock', x: 3, y: 13, hp: 14, mobility: 5, aim: 62, defense: 0, crit: 5, weapon: WEAPONS.javelin },
  { id: 'p3', name: 'Priya', team: 'player', role: 'Nerd', x: 3, y: 9, hp: 9, mobility: 5, aim: 75, defense: 0, crit: 5, weapon: WEAPONS.flareGun },
  { id: 'p4', name: 'Sam', team: 'player', role: 'Drama kid', x: 2, y: 7, hp: 11, mobility: 5, aim: 66, defense: 5, crit: 10, weapon: WEAPONS.slingshot },
];

const rivals: UnitSpec[] = [
  { id: 'e1', name: 'Brock', team: 'enemy', role: 'Varsity', x: 19, y: 4, hp: 10, mobility: 5, aim: 60, defense: 0, crit: 5, weapon: WEAPONS.javelin },
  { id: 'e2', name: 'Tyler', team: 'enemy', role: 'Varsity', x: 20, y: 7, hp: 9, mobility: 5, aim: 62, defense: 0, crit: 5, weapon: WEAPONS.slingshot },
  { id: 'e3', name: 'Dane', team: 'enemy', role: 'Varsity', x: 17, y: 8, hp: 10, mobility: 5, aim: 58, defense: 0, crit: 5, weapon: WEAPONS.pole },
  { id: 'e4', name: 'Cole', team: 'enemy', role: 'Varsity', x: 20, y: 11, hp: 9, mobility: 5, aim: 62, defense: 0, crit: 5, weapon: WEAPONS.slingshot },
  { id: 'e5', name: 'Reid', team: 'enemy', role: 'Varsity', x: 17, y: 13, hp: 10, mobility: 5, aim: 60, defense: 0, crit: 5, weapon: WEAPONS.javelin },
];

export const beachLanding: Scenario = {
  name: 'Beach Landing',
  seed: 20261103,
  map: beachMap,
  units: [...squad, ...rivals],
};

export const SCENARIOS: Scenario[] = [beachLanding];
