import { describe, expect, it } from 'vitest';
import {
  GRID,
  THRESHOLD_MIN,
  WORLD,
  WALK_SPEED,
  createWorld,
  findPath,
  nearestWalkable,
  pointInPoly,
  regionAt,
  siteById,
  siteNear,
  stepWorld,
  walkTo,
  walkable,
  type Vec,
  type WorldState,
} from './world';

const pathLength = (from: Vec, path: Vec[]): number => {
  let len = 0;
  let cur = from;
  for (const p of path) {
    len += Math.hypot(p.x - cur.x, p.y - cur.y);
    cur = p;
  }
  return len;
};

/** Walk a world state along its click-path to completion, returning events seen. */
function walkAll(w: WorldState, maxSeconds = 120): number {
  let encounters = 0;
  for (let t = 0; t < maxSeconds * 20 && w.path.length > 0; t++) {
    if (stepWorld(w, 0.05, null)) encounters++;
  }
  return encounters;
}

describe('geometry', () => {
  it('point-in-polygon handles inside, outside and concave shapes', () => {
    const sq: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(pointInPoly({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPoly({ x: 15, y: 5 }, sq)).toBe(false);
    const u: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]];
    expect(pointInPoly({ x: 5, y: 8 }, u)).toBe(false); // inside the notch
    expect(pointInPoly({ x: 1, y: 8 }, u)).toBe(true);
  });
});

describe('world data', () => {
  it('the start and every site are on walkable land', () => {
    expect(walkable(WORLD.start)).toBe(true);
    for (const s of WORLD.sites) expect(walkable(s), `${s.id} at ${s.x},${s.y} is in the sea`).toBe(true);
  });

  it('site ids are unique and every garrison has a reward', () => {
    const ids = WORLD.sites.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of WORLD.sites) if (s.difficulty) expect(s.reward, s.id).toBeGreaterThan(0);
  });

  it('every site is reachable on foot from the start', () => {
    for (const s of WORLD.sites) {
      const p = findPath(WORLD.start, s);
      expect(p, `no route to ${s.id}`).not.toBeNull();
      const end = p![p!.length - 1];
      expect(Math.hypot(end.x - s.x, end.y - s.y)).toBeLessThan(8);
    }
  });

  it('camp is a safe zone and the volcano is dangerous', () => {
    expect(regionAt(siteById('camp')!).danger).toBe(0);
    expect(regionAt(siteById('crater')!).danger).toBeGreaterThanOrEqual(3);
    expect(regionAt(siteById('mcaves')!).biome).toBe('mountain');
    expect(regionAt(siteById('sunken')!).biome).toBe('marsh');
    expect(regionAt(siteById('border')!).biome).toBe('wastes');
  });

  it('every region has a known biome and sane danger', () => {
    const biomes = ['beach', 'forest', 'wastes', 'marsh', 'mountain', 'canyon', 'volcano'];
    for (const r of WORLD.regions) {
      expect(biomes).toContain(r.biome);
      expect(r.danger).toBeGreaterThanOrEqual(0);
      expect(r.danger).toBeLessThanOrEqual(4);
    }
  });

  it('siteNear finds the site you are standing in, and nothing in open country', () => {
    const camp = siteById('camp')!;
    expect(siteNear(camp)?.id).toBe('camp');
    expect(siteNear({ x: 600, y: 300 })).toBeNull();
  });
});

describe('pathfinding', () => {
  it('routes around the sea instead of through it', () => {
    // Wrecker's Bay beach -> far north-east marsh: the straight line crosses water at the coast bends.
    const to = siteById('coastal')!;
    const p = findPath(WORLD.start, to)!;
    expect(p).not.toBeNull();
    let cur: Vec = WORLD.start;
    for (const wp of p) {
      const n = Math.max(1, Math.ceil(Math.hypot(wp.x - cur.x, wp.y - cur.y) / 3));
      for (let i = 0; i <= n; i++) {
        const q = { x: cur.x + ((wp.x - cur.x) * i) / n, y: cur.y + ((wp.y - cur.y) * i) / n };
        expect(walkable(q), `route leaves the island at ${q.x.toFixed(0)},${q.y.toFixed(0)}`).toBe(true);
      }
      cur = wp;
    }
  });

  it('is not wildly longer than the straight line over open ground', () => {
    const a = siteById('camp')!;
    const b = siteById('border')!;
    const p = findPath(a, b)!;
    const straight = Math.hypot(a.x - b.x, a.y - b.y);
    expect(pathLength(a, p)).toBeLessThan(straight * 1.15);
  });

  it('snaps a click in the sea to the nearest shore', () => {
    const sea = { x: 20, y: 20 };
    expect(walkable(sea)).toBe(false);
    const snapped = nearestWalkable(sea)!;
    expect(walkable(snapped)).toBe(true);
    const p = findPath(WORLD.start, sea)!;
    expect(walkable(p[p.length - 1])).toBe(true);
  });
});

describe('movement', () => {
  it('walkTo then stepping arrives at the target', () => {
    const w = createWorld(1);
    const target = siteById('camp')!;
    expect(walkTo(w, target)).toBe(true);
    walkAll(w);
    expect(Math.hypot(w.pos.x - target.x, w.pos.y - target.y)).toBeLessThan(1);
    expect(w.walked).toBeGreaterThan(100);
  });

  it('moves at the configured speed', () => {
    const w = createWorld(1);
    w.pos = { x: 600, y: 330 };
    const x0 = w.pos.x;
    for (let i = 0; i < 20; i++) stepWorld(w, 0.05, { dx: 1, dy: 0 });
    expect(w.pos.x - x0).toBeCloseTo(WALK_SPEED * 1, 0);
  });

  it('keyboard movement cancels a click path', () => {
    const w = createWorld(1);
    walkTo(w, siteById('border')!);
    expect(w.path.length).toBeGreaterThan(0);
    stepWorld(w, 0.05, { dx: 0, dy: 1 });
    expect(w.path).toEqual([]);
  });

  it('can never be walked off the island: random-input fuzz', () => {
    const w = createWorld(7);
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 6000; i++) {
      if (i % 30 === 0) w.pos = { ...WORLD.start }; // also fuzz outward from the start often
      stepWorld(w, 0.05, { dx: Math.round(rnd() * 2 - 1), dy: Math.round(rnd() * 2 - 1) });
      expect(walkable(w.pos), `left the island at ${w.pos.x.toFixed(1)},${w.pos.y.toFixed(1)}`).toBe(true);
    }
  });

  it('slides along a wall when pushing diagonally into it', () => {
    // synthetic grid: land for y < 30, sea below, so a diagonal push should keep its x component
    const g = { w: 20, h: 10, cells: new Uint8Array(200) };
    for (let cy = 0; cy < 5; cy++) for (let cx = 0; cx < 20; cx++) g.cells[cy * 20 + cx] = 1;
    const w = createWorld(1);
    w.pos = { x: 30, y: 20 };
    for (let i = 0; i < 40; i++) stepWorld(w, 0.05, { dx: 1, dy: 1 }, g);
    expect(walkable(w.pos, g)).toBe(true);
    expect(w.pos.x).toBeGreaterThan(30 + 50);
    expect(w.pos.y).toBeLessThan(30);
  });

  it('does not tunnel into a dead-end pocket', () => {
    const w = createWorld(1);
    w.pos = { x: 230, y: 420 };
    for (let i = 0; i < 60; i++) stepWorld(w, 0.05, { dx: -1, dy: 1 });
    expect(walkable(w.pos)).toBe(true);
  });
});

describe('random encounters', () => {
  /** Walk back and forth inside a point's vicinity for `seconds`, counting encounters. */
  function encountersWhilePacing(centre: Vec, seconds: number, seed: number, leg = 20): number {
    const w = createWorld(seed);
    w.pos = { ...centre };
    let n = 0;
    for (let i = 0; i < seconds * 20; i++) {
      const dir = Math.floor(i / leg) % 2 === 0 ? 1 : -1;
      if (stepWorld(w, 0.05, { dx: dir, dy: 0 })) n++;
    }
    return n;
  }

  it('never fire in a safe zone', () => {
    const camp = siteById('camp')!;
    expect(encountersWhilePacing({ x: camp.x, y: camp.y }, 120, 3, 8)).toBe(0);
  });

  it('are deterministic for a seed', () => {
    const run = (seed: number): number[] => {
      const w = createWorld(seed);
      w.pos = { x: 600, y: 330 };
      const at: number[] = [];
      for (let i = 0; i < 4000; i++) {
        const dir = Math.floor(i / 20) % 2 === 0 ? 1 : -1;
        if (stepWorld(w, 0.05, { dx: dir, dy: 0 })) at.push(i);
      }
      return at;
    };
    expect(run(99)).toEqual(run(99));
    expect(run(99)).not.toEqual(run(100));
  });

  it('come more often in more dangerous regions', () => {
    // wastes (danger 2) vs peaks (danger 3), pacing 400s each over several seeds
    const wastes = { x: 640, y: 350 };
    const peaks = { x: 500, y: 100 };
    expect(regionAt(wastes).danger).toBe(2);
    expect(regionAt(peaks).danger).toBe(3);
    let low = 0;
    let high = 0;
    for (let seed = 1; seed <= 6; seed++) {
      low += encountersWhilePacing(wastes, 400, seed);
      high += encountersWhilePacing(peaks, 400, seed);
    }
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
  });

  it('spaces encounters by at least the minimum danger-weighted distance', () => {
    const w = createWorld(5);
    w.pos = { x: 500, y: 100 }; // danger 3
    const gaps: number[] = [];
    let last = 0;
    for (let i = 0; i < 6000; i++) {
      const dir = Math.floor(i / 20) % 2 === 0 ? 1 : -1;
      if (stepWorld(w, 0.05, { dx: dir, dy: 0 })) {
        gaps.push(i - last);
        last = i;
      }
    }
    expect(gaps.length).toBeGreaterThan(3);
    const minTicks = THRESHOLD_MIN / 3 / (WALK_SPEED * 0.05);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(Math.floor(minTicks) - 1);
  });

  it('standing still never triggers one', () => {
    const w = createWorld(2);
    w.pos = { x: 500, y: 100 };
    for (let i = 0; i < 2000; i++) expect(stepWorld(w, 0.05, null)).toBeNull();
  });
});

describe('grid sanity', () => {
  it('has a plausible amount of land', () => {
    const land = GRID.cells.reduce((a, c) => a + c, 0);
    const frac = land / GRID.cells.length;
    expect(frac).toBeGreaterThan(0.45);
    expect(frac).toBeLessThan(0.85);
  });
});
