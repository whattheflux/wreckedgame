import type { Biome, GameMap, Pos, Terrain, Weapon } from './types';
import type { Scenario, UnitSpec } from './battle';
import { buildMap, foe, squadAt, WEAPONS } from './scenarios';
import { SIGHT_RANGE } from './vision';
import { randInt, type RngHolder } from './rng';
import { rivalCrew } from './rivals';
import { gearMods, rivalGear, weaponOfGear } from './items';

export const ENCOUNTER_W = 30;
export const ENCOUNTER_H = 18;

export interface EncounterOptions {
  seed: number;
  biome: Biome;
  /** how many dormant pods */
  pods: number;
  /** enemies per pod */
  podSize: number;
  /** 1 (easy) .. 4 (hard): scales enemy stats and weaponry */
  difficulty: number;
  /** the enemy is already on top of you (a night attack): pods start close to the squad instead of out of sight */
  ambush?: boolean;
  /**
   * The squad's average level. Rival schools have been surviving the island too, so they toughen up
   * alongside you: a run that levels the squad to the cap does not end up swatting children.
   */
  level?: number;
}

/**
 * What one level of the squad's experience is worth to the people they meet. Deliberately less than
 * the squad gains per level: the squad also picks up perks and better gear, and a run where growing
 * stronger left you worse off would be a pointless run. `balance.test.ts` is what keeps this honest.
 */
export const VET_AIM = 1;
/** A rival gains a point of health, and a point of defense, every this many levels. */
export const VET_HP_EVERY = 2;
export const VET_DEFENSE_EVERY = 2;
/** However long a run goes on, rivals stop improving here (the squad still has perks and gear). */
export const VET_CAP = 6;
/** Rivals pick up one step of this for every this many levels the squad gains. */
export const VET_PER_LEVELS = 2;

/** How much tougher rivals are for a squad of this average level. */
export const veterancy = (level = 1): number => Math.max(0, Math.min(VET_CAP, Math.floor((Math.round(level) - 1) / VET_PER_LEVELS)));

/** How cluttered each ground type is. Counts are attempts; sizes are max edge length in tiles. */
interface Profile {
  walls: [count: number, maxSize: number];
  half: number;
  full: number;
  water: [count: number, maxSize: number];
  /** extra structure applied after scatter */
  rim?: 'sea-top' | 'canyon' | 'none';
}

export const PROFILES: Record<Biome, Profile> = {
  beach: { walls: [3, 2], half: 22, full: 10, water: [0, 0], rim: 'sea-top' },
  forest: { walls: [16, 3], half: 30, full: 14, water: [0, 0] },
  wastes: { walls: [4, 2], half: 36, full: 8, water: [0, 0] },
  marsh: { walls: [3, 2], half: 26, full: 6, water: [8, 4] },
  mountain: { walls: [20, 4], half: 16, full: 16, water: [0, 0] },
  canyon: { walls: [4, 3], half: 18, full: 10, water: [0, 0], rim: 'canyon' },
  volcano: { walls: [10, 3], half: 14, full: 12, water: [6, 3] },
};

/** Pod members sit in a tight cluster around the pod centre. */
const CLUSTER: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, 1], [2, 0]];

const MIN_POD_GAP = 6;

function weaponFor(difficulty: number, i: number): Weapon {
  const W = WEAPONS;
  const pool: Weapon[] =
    difficulty >= 4
      ? [W.javelin, W.crudeSword, W.flareGun, W.nailBat, W.machete, W.slingshot, W.poisonDagger, W.fireAxe]
      : difficulty === 3
        ? [W.javelin, W.flareGun, W.crudeSword, W.slingshot, W.weightedClub, W.pole, W.machete, W.torch]
        : difficulty === 2
          ? [W.slingshot, W.javelin, W.knife, W.pole, W.sharpStick, W.torch, W.weightedClub, W.sandSock]
          : [W.slingshot, W.stick, W.fryingPan, W.slingshot, W.rollingPin, W.pipe, W.humanBone, W.javelin, W.knife];
  return pool[i % pool.length];
}

const dist = (a: Pos, b: Pos): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 8-way flood over passable tiles, same movement rule as the battle engine (no corner cutting). */
function floodFrom(map: GameMap, from: Pos): boolean[][] {
  const seen = Array.from({ length: map.height }, () => Array<boolean>(map.width).fill(false));
  const open = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < map.width && y < map.height && map.tiles[y][x] === 'floor';
  if (!open(from.x, from.y)) return seen;
  const q: Pos[] = [from];
  seen[from.y][from.x] = true;
  while (q.length > 0) {
    const p = q.pop()!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = p.x + dx;
        const ny = p.y + dy;
        if (!open(nx, ny) || seen[ny][nx]) continue;
        if (dx !== 0 && dy !== 0 && (!open(p.x + dx, p.y) || !open(p.x, p.y + dy))) continue;
        seen[ny][nx] = true;
        q.push({ x: nx, y: ny });
      }
    }
  }
  return seen;
}

/** Carve an orthogonal L-shaped corridor of floor between two tiles (orthogonal steps only, so always walkable). */
function carve(tiles: Terrain[][], a: Pos, b: Pos): void {
  const set = (x: number, y: number): void => {
    if (y >= 0 && y < tiles.length && x >= 0 && x < tiles[0].length) tiles[y][x] = 'floor';
  };
  const sx = Math.sign(b.x - a.x) || 1;
  for (let x = a.x; x !== b.x; x += sx) set(x, a.y);
  const sy = Math.sign(b.y - a.y) || 1;
  for (let y = a.y; y !== b.y + sy && a.y !== b.y; y += sy) set(b.x, y);
  set(b.x, b.y);
}

/**
 * Build a skirmish for one world-map encounter or site assault. Deterministic per options.
 * Guarantees: the squad starts on the left, no pod is within sight range of the squad (so every
 * fight begins with a search), and every unit can walk to every other.
 */
export function encounterScenario(opts: EncounterOptions): Scenario {
  const W = ENCOUNTER_W;
  const H = ENCOUNTER_H;
  const rng: RngHolder = { rngState: opts.seed | 0 };
  const ri = (a: number, b: number): number => randInt(rng, a, b);
  const profile = PROFILES[opts.biome];
  const pods = Math.max(1, Math.min(opts.pods, 5));
  const podSize = Math.max(1, Math.min(opts.podSize, CLUSTER.length));
  const diff = Math.max(1, Math.min(opts.difficulty, 4));

  // --- spawn layout first, terrain second, so we can keep spawns clear ---
  const cy = ri(5, H - 6);
  const squadPos: Array<[number, number]> = [[2, cy], [3, cy + 1], [3, cy - 1], [2, cy + 2]];
  const squadCentre: Pos = { x: 3, y: cy };

  const podCentres: Pos[] = [];
  const minX = opts.ambush ? squadCentre.x + 5 : Math.ceil(squadCentre.x + SIGHT_RANGE + 3); // comfortably outside the usual sight range, unless they are jumping you
  for (let tries = 0; podCentres.length < pods && tries < 400; tries++) {
    const p = { x: ri(minX, opts.ambush ? Math.min(W - 5, minX + 5) : W - 5), y: ri(3, H - 4) };
    if (podCentres.some((q) => dist(p, q) < MIN_POD_GAP)) continue;
    podCentres.push(p);
  }
  // Tight maps can run out of room; fall back to the free columns rather than dropping pods silently.
  while (podCentres.length < pods) podCentres.push({ x: W - 5, y: 3 + podCentres.length * 3 });

  const spawnTiles: Pos[] = [...squadPos.map(([x, y]) => ({ x, y }))];
  const units: UnitSpec[] = [];
  const crew = rivalCrew(opts.seed, pods * podSize, diff);

  let n = 0;
  podCentres.forEach((c, pi) => {
    const podId = String.fromCharCode(65 + pi);
    for (let m = 0; m < podSize; m++) {
      const [ox, oy] = CLUSTER[m];
      const pos = { x: Math.min(W - 3, Math.max(1, c.x + ox)), y: Math.min(H - 3, Math.max(1, c.y + oy)) };
      spawnTiles.push(pos);
      n++;
      const weapon = weaponFor(diff, m + pi);
      const kid = crew.members[n - 1];
      const vet = veterancy(opts.level);
      const spec = foe(
        `e${n}`,
        kid.name,
        pos.x,
        pos.y,
        podId,
        weapon,
        7 + diff + (weapon === WEAPONS.pole || weapon.melee ? 2 : 0) + Math.floor(vet / VET_HP_EVERY),
        52 + diff * 4 + vet * VET_AIM,
      );
      // What they carry rolls from its own stream so it never disturbs the map. Worn pieces make them harder to hurt.
      const weaponKey = (Object.keys(WEAPONS) as Array<keyof typeof WEAPONS>).find((k) => WEAPONS[k] === weapon) ?? 'slingshot';
      const gear = rivalGear(weaponKey, diff, { rngState: Math.imul(opts.seed | 0, 7919) + n });
      const mods = gearMods(gear);
      units.push({
        ...spec,
        role: kid.role,
        sprite: kid.sprite,
        ...(kid.skills.length ? { skills: kid.skills } : {}),
        gear,
        weapon: weaponOfGear(gear),
        hp: spec.hp + mods.hp,
        defense: spec.defense + mods.rangedDefense + Math.floor(vet / VET_DEFENSE_EVERY),
        meleeDefense: spec.defense + mods.meleeDefense + Math.floor(vet / VET_DEFENSE_EVERY),
        mobility: spec.mobility + mods.mobility,
        aim: spec.aim + mods.rangedAim,
        meleeAim: spec.aim + mods.meleeAim,
        crit: spec.crit + mods.crit,
      });
    }
  });

  // --- terrain ---
  const rectInto = (set: (x: number, y: number, t: Terrain) => void, x0: number, y0: number, x1: number, y1: number, t: Terrain): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t);
  };
  const map = buildMap(
    W,
    H,
    (set) => {
      const bx = (): number => ri(1, W - 2);
      const by = (): number => ri(1, H - 2);
      if (profile.rim === 'sea-top') rectInto(set, 0, 0, W - 1, 1, 'water');
      if (profile.rim === 'canyon') {
        // two cliff bands running east-west with ragged gaps
        for (let x = 0; x < W; x++) {
          if (x % 7 !== 3) rectInto(set, x, 2, x, 3, 'wall');
          if (x % 8 !== 5) rectInto(set, x, H - 4, x, H - 3, 'wall');
        }
      }
      for (let i = 0; i < profile.walls[0]; i++) {
        const x = bx();
        const y = by();
        rectInto(set, x, y, x + ri(1, profile.walls[1]) - 1, y + ri(1, profile.walls[1]) - 1, 'wall');
      }
      for (let i = 0; i < profile.water[0]; i++) {
        const x = bx();
        const y = by();
        rectInto(set, x, y, x + ri(1, profile.water[1]) - 1, y + ri(1, profile.water[1]) - 1, 'water');
      }
      for (let i = 0; i < profile.half; i++) set(bx(), by(), 'half');
      for (let i = 0; i < profile.full; i++) set(bx(), by(), 'full');
      // keep a clearing around each spawn so nobody starts inside a rock
      for (const t of spawnTiles) rectInto(set, t.x - 1, t.y - 1, t.x + 1, t.y + 1, 'floor');
    },
    opts.biome,
  );

  // --- connectivity: carve to anything the squad can't walk to ---
  const start = { x: squadPos[0][0], y: squadPos[0][1] };
  const reach = floodFrom(map, start);
  for (const t of spawnTiles) {
    if (reach[t.y][t.x]) continue;
    // carve toward the nearest already-reachable tile, then re-flood so later spawns can reuse the corridor
    let best: Pos = start;
    let bestD = Infinity;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!reach[y][x]) continue;
        const d = Math.abs(x - t.x) + Math.abs(y - t.y);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    carve(map.tiles, best, t);
    const again = floodFrom(map, start);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) reach[y][x] = again[y][x];
  }

  const name = `${crew.school}: ${opts.biome} skirmish`;
  return {
    name,
    seed: (opts.seed ^ 0x5bd1e995) | 0,
    map: () => structuredClone(map),
    units: [...squadAt(squadPos), ...units],
  };
}
