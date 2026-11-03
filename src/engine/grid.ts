import type { CoverType, GameMap, Pos, Terrain, Unit } from './types';

export const posKey = (x: number, y: number): string => `${x},${y}`;

const DIRS8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const DIRS4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const LEGEND: Record<string, Terrain> = {
  '.': 'floor',
  '#': 'wall',
  h: 'half',
  F: 'full',
  '~': 'water',
};

/** Build a map from ASCII rows. . floor  # wall  h half cover  F full cover  ~ water */
export function parseMap(rows: string[]): GameMap {
  const width = rows[0]?.length ?? 0;
  const tiles = rows.map((row, y) => {
    if (row.length !== width) throw new Error(`Map row ${y} has width ${row.length}, expected ${width}`);
    return [...row].map((ch) => {
      const t = LEGEND[ch];
      if (!t) throw new Error(`Unknown map character '${ch}' in row ${y}`);
      return t;
    });
  });
  return { width, height: rows.length, tiles };
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function terrainAt(map: GameMap, x: number, y: number): Terrain | null {
  return inBounds(map, x, y) ? map.tiles[y][x] : null;
}

export function dist(a: Pos, b: Pos): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Bresenham line, endpoints included. */
export function line(a: Pos, b: Pos): Pos[] {
  const pts: Pos[] = [];
  let x0 = a.x;
  let y0 = a.y;
  const dx = Math.abs(b.x - x0);
  const dy = Math.abs(b.y - y0);
  const sx = x0 < b.x ? 1 : -1;
  const sy = y0 < b.y ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    pts.push({ x: x0, y: y0 });
    if (x0 === b.x && y0 === b.y) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return pts;
}

/** Only walls block sight; cover objects can be shot over. Permissive: clear from either end counts. */
export function hasLineOfSight(map: GameMap, a: Pos, b: Pos): boolean {
  const clear = (p: Pos, q: Pos): boolean =>
    line(p, q)
      .slice(1, -1)
      .every((t) => terrainAt(map, t.x, t.y) !== 'wall');
  return clear(a, b) || clear(b, a);
}

/**
 * Cover the target enjoys against an attacker at `attacker`.
 * A cover object only counts if it sits on the side of the target facing the attacker.
 */
export function coverAgainst(map: GameMap, attacker: Pos, target: Pos): CoverType {
  const ax = attacker.x - target.x;
  const ay = attacker.y - target.y;
  let best: CoverType = 'none';
  for (const [dx, dy] of DIRS4) {
    const t = terrainAt(map, target.x + dx, target.y + dy);
    if (t !== 'half' && t !== 'full') continue;
    if (ax * dx + ay * dy <= 0) continue;
    if (t === 'full') return 'full';
    best = 'half';
  }
  return best;
}

export function hasAnyCover(map: GameMap, target: Pos): boolean {
  return DIRS4.some(([dx, dy]) => {
    const t = terrainAt(map, target.x + dx, target.y + dy);
    return t === 'half' || t === 'full';
  });
}

/** Flanked = the target is hugging cover, but not on the side the attacker is shooting from. */
export function isFlanked(map: GameMap, attacker: Pos, target: Pos): boolean {
  return hasAnyCover(map, target) && coverAgainst(map, attacker, target) === 'none';
}

export interface PathNode {
  pos: Pos;
  cost: number;
  prev: string | null;
}

/** Every tile `self` can reach within maxCost steps (8-way, no corner cutting, units block). Includes the start tile at cost 0. */
export function reachableTiles(map: GameMap, units: Unit[], self: Unit, maxCost: number): Map<string, PathNode> {
  const occupied = new Set<string>();
  for (const u of units) if (u.alive && u.id !== self.id) occupied.add(posKey(u.pos.x, u.pos.y));

  const out = new Map<string, PathNode>();
  const startKey = posKey(self.pos.x, self.pos.y);
  out.set(startKey, { pos: { ...self.pos }, cost: 0, prev: null });

  let frontier = [startKey];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const k of frontier) {
      const n = out.get(k);
      if (!n || n.cost >= maxCost) continue;
      for (const [dx, dy] of DIRS8) {
        const nx = n.pos.x + dx;
        const ny = n.pos.y + dy;
        const nk = posKey(nx, ny);
        if (out.has(nk) || occupied.has(nk)) continue;
        if (terrainAt(map, nx, ny) !== 'floor') continue;
        if (dx !== 0 && dy !== 0) {
          if (terrainAt(map, n.pos.x + dx, n.pos.y) !== 'floor') continue;
          if (terrainAt(map, n.pos.x, n.pos.y + dy) !== 'floor') continue;
        }
        out.set(nk, { pos: { x: nx, y: ny }, cost: n.cost + 1, prev: k });
        next.push(nk);
      }
    }
    frontier = next;
  }
  return out;
}

/** Steps from the start (exclusive) to the destination (inclusive). */
export function pathTo(nodes: Map<string, PathNode>, destKey: string): Pos[] {
  const path: Pos[] = [];
  let k: string | null = destKey;
  while (k !== null) {
    const n = nodes.get(k);
    if (!n || n.prev === null) break;
    path.push(n.pos);
    k = n.prev;
  }
  return path.reverse();
}
