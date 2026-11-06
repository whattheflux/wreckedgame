import raw from './worlddata.json';
import type { Biome } from '../engine/types';
import { rand } from '../engine/rng';
import type { ItemId } from '../engine/items';
import type { Captive, Mercy } from './spoils';
import { createStarterRoster, type PlayerChoice, type Roster } from '../engine/roster';

// ---------- data (see worlddata.json; coordinates are pixels in the reference map) ----------

export interface Vec {
  x: number;
  y: number;
}

export type RegionShape =
  | { type: 'circle'; x: number; y: number; r: number }
  | { type: 'poly'; points: Array<[number, number]> };

export interface Region {
  id: string;
  name: string;
  biome: Biome;
  /** 0 = safe. Encounters build up with distance walked, scaled by this. */
  danger: number;
  shape: RegionShape;
}

export type SiteKind = 'home' | 'landmark' | 'wreck' | 'ruin' | 'outpost' | 'cave';

export interface Site {
  id: string;
  name: string;
  kind: SiteKind;
  x: number;
  y: number;
  radius: number;
  /** present = a hostile garrison to clear (1 easy .. 4 hard) */
  difficulty?: number;
  /** scrap awarded the first time it is cleared */
  reward?: number;
  blurb: string;
}

export const WORLD = {
  size: raw.size as [number, number],
  start: { x: raw.start[0], y: raw.start[1] } as Vec,
  coast: raw.coast as Array<[number, number]>,
  regions: raw.regions as Region[],
  sites: raw.sites as Site[],
};

export const siteById = (id: string): Site | undefined => WORLD.sites.find((s) => s.id === id);

// ---------- geometry ----------

export function pointInPoly(p: Vec, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const distance = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

function inShape(p: Vec, s: RegionShape): boolean {
  return s.type === 'circle' ? Math.hypot(p.x - s.x, p.y - s.y) <= s.r : pointInPoly(p, s.points);
}

/** First region (in file order) containing the point; the last region is a catch-all. */
export function regionAt(p: Vec): Region {
  return WORLD.regions.find((r) => inShape(p, r.shape)) ?? WORLD.regions[WORLD.regions.length - 1];
}

/** Nearest site whose entry radius contains the point. */
export function siteNear(p: Vec): Site | null {
  let best: Site | null = null;
  let bestD = Infinity;
  for (const s of WORLD.sites) {
    const d = distance(p, s);
    if (d <= s.radius && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

// ---------- walkability grid + pathfinding ----------

export const CELL = 6;

export interface WalkGrid {
  w: number;
  h: number;
  cells: Uint8Array;
}

export function buildWalkGrid(): WalkGrid {
  const w = Math.ceil(WORLD.size[0] / CELL);
  const h = Math.ceil(WORLD.size[1] / CELL);
  const cells = new Uint8Array(w * h);
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      cells[cy * w + cx] = pointInPoly({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 }, WORLD.coast) ? 1 : 0;
    }
  }
  return { w, h, cells };
}

export const GRID: WalkGrid = buildWalkGrid();

export function walkable(p: Vec, g: WalkGrid = GRID): boolean {
  const cx = Math.floor(p.x / CELL);
  const cy = Math.floor(p.y / CELL);
  if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return false;
  return g.cells[cy * g.w + cx] === 1;
}

const cellCenter = (cx: number, cy: number): Vec => ({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });

/** Nearest walkable cell to a point (spiral outward), or null if the grid has none within range. */
export function nearestWalkable(p: Vec, g: WalkGrid = GRID): Vec | null {
  if (walkable(p, g)) return p;
  const cx0 = Math.floor(p.x / CELL);
  const cy0 = Math.floor(p.y / CELL);
  let best: Vec | null = null;
  let bestD = Infinity;
  for (let r = 1; r < 60; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = cx0 + dx;
        const cy = cy0 + dy;
        if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h || g.cells[cy * g.w + cx] !== 1) continue;
        const c = cellCenter(cx, cy);
        const d = distance(p, c);
        if (d < bestD) {
          best = c;
          bestD = d;
        }
      }
    }
    if (best) return best; // first ring with a hit is the nearest to within one cell
  }
  return null;
}

function lineClear(a: Vec, b: Vec, g: WalkGrid): boolean {
  const d = distance(a, b);
  const steps = Math.max(1, Math.ceil(d / 3));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (!walkable({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, g)) return false;
  }
  return true;
}

/** Binary min-heap keyed on f-score. */
class Heap {
  private a: Array<{ k: number; v: number }> = [];
  get size(): number {
    return this.a.length;
  }
  push(v: number, k: number): void {
    const a = this.a;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0].v;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * A* over the walk grid (8-way, no corner cutting), then string-pulled so the party walks straight
 * where it can. A destination in the sea snaps to the nearest shore. Returns waypoints, or null.
 */
export function findPath(from: Vec, to: Vec, g: WalkGrid = GRID): Vec[] | null {
  const goal = nearestWalkable(to, g);
  const start = nearestWalkable(from, g);
  if (!goal || !start) return null;
  const sx = Math.floor(start.x / CELL);
  const sy = Math.floor(start.y / CELL);
  const gx = Math.floor(goal.x / CELL);
  const gy = Math.floor(goal.y / CELL);
  const idx = (x: number, y: number): number => y * g.w + x;
  const ok = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < g.w && y < g.h && g.cells[idx(x, y)] === 1;

  const cost = new Float32Array(g.w * g.h).fill(Infinity);
  const prev = new Int32Array(g.w * g.h).fill(-1);
  const open = new Heap();
  const h = (x: number, y: number): number => Math.hypot(x - gx, y - gy);
  cost[idx(sx, sy)] = 0;
  open.push(idx(sx, sy), h(sx, sy));

  const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let found = false;
  while (open.size > 0) {
    const cur = open.pop();
    const cx = cur % g.w;
    const cy = (cur / g.w) | 0;
    if (cx === gx && cy === gy) {
      found = true;
      break;
    }
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!ok(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!ok(cx + dx, cy) || !ok(cx, cy + dy))) continue;
      const nc = cost[cur] + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
      const ni = idx(nx, ny);
      if (nc < cost[ni]) {
        cost[ni] = nc;
        prev[ni] = cur;
        open.push(ni, nc + h(nx, ny));
      }
    }
  }
  if (!found) return null;

  const cells: Vec[] = [];
  for (let i = idx(gx, gy); i !== -1; i = prev[i]) cells.push(cellCenter(i % g.w, (i / g.w) | 0));
  cells.reverse();
  cells[0] = { ...from };
  const last = walkable(to, g) ? { ...to } : goal;
  cells[cells.length - 1] = last;

  // String-pull: from each anchor, jump to the furthest waypoint still in clear sight.
  const out: Vec[] = [];
  let a = 0;
  while (a < cells.length - 1) {
    let b = cells.length - 1;
    while (b > a + 1 && !lineClear(cells[a], cells[b], g)) b--;
    out.push(cells[b]);
    a = b;
  }
  return out;
}

// ---------- world state ----------

export const WALK_SPEED = 100; // reference-map pixels per second
/** danger-weighted distance between random encounters is THRESHOLD_MIN + rand * THRESHOLD_SPAN */
export const THRESHOLD_MIN = 900;
export const THRESHOLD_SPAN = 900;

export interface WorldState {
  pos: Vec;
  /** waypoints still to walk (click-to-move) */
  path: Vec[];
  rngState: number;
  /** danger-weighted distance walked since the last encounter */
  sinceEncounter: number;
  nextEncounter: number;
  cleared: Record<string, boolean>;
  scrap: number;
  /** the persistent squad: HP, injuries, XP and traits carry between fights */
  roster: Roster;
  /** ids picked for the next fight (the player character is always taken as well); see `chooseSquad` */
  squad: string[];
  /** total distance walked (stat) */
  walked: number;
  log: string[];
  /** the party's shared pack: everything taken in fights that nobody is wearing. Absent on older saves; see `ensureStores`. */
  stash?: ItemId[];
  /** rivals kept prisoner */
  captives?: Captive[];
  /** how the player has treated people */
  mercy?: Mercy;
  /** camp days passed (starts at 1). Absent on older saves. */
  day?: number;
  /** regions and sites already found, so a discovery only pays once. Absent on older saves. */
  seen?: Record<string, boolean>;
}

export function createWorld(seed: number, player?: PlayerChoice): WorldState {
  const w: WorldState = {
    pos: { ...WORLD.start },
    path: [],
    rngState: seed | 0,
    sinceEncounter: 0,
    nextEncounter: 0,
    cleared: {},
    scrap: 0,
    roster: createStarterRoster(player),
    squad: [],
    walked: 0,
    log: ['You wash ashore. Somewhere on this island are your friends, and some people who are not.'],
  };
  w.nextEncounter = THRESHOLD_MIN + rand(w) * THRESHOLD_SPAN;
  return w;
}

export type WorldEvent = { type: 'encounter'; region: Region };

export interface MoveInput {
  dx: number;
  dy: number;
}

/**
 * Advance the party by `dt` seconds. Keyboard input overrides and cancels any click-path. Movement
 * slides along the coast rather than stopping dead. Returns an encounter event when one triggers.
 */
export function stepWorld(w: WorldState, dt: number, input: MoveInput | null, g: WalkGrid = GRID): WorldEvent | null {
  const dist = WALK_SPEED * Math.min(dt, 0.05);
  let moved = 0;

  if (input && (input.dx !== 0 || input.dy !== 0)) {
    w.path = [];
    const len = Math.hypot(input.dx, input.dy);
    moved = slide(w, (input.dx / len) * dist, (input.dy / len) * dist, g);
  } else if (w.path.length > 0) {
    let budget = dist;
    while (budget > 0 && w.path.length > 0) {
      const t = w.path[0];
      const d = distance(w.pos, t);
      if (d <= budget) {
        w.pos = { ...t };
        w.path.shift();
        budget -= d;
        moved += d;
      } else {
        w.pos = { x: w.pos.x + ((t.x - w.pos.x) / d) * budget, y: w.pos.y + ((t.y - w.pos.y) / d) * budget };
        moved += budget;
        budget = 0;
      }
    }
  }

  if (moved <= 0) return null;
  w.walked += moved;

  const region = regionAt(w.pos);
  if (region.danger <= 0) return null;
  w.sinceEncounter += moved * region.danger;
  if (w.sinceEncounter < w.nextEncounter) return null;

  w.sinceEncounter = 0;
  w.nextEncounter = THRESHOLD_MIN + rand(w) * THRESHOLD_SPAN;
  w.path = [];
  return { type: 'encounter', region };
}

/** Move by (dx,dy), sliding along obstacles axis-by-axis. Returns the distance actually moved. */
function slide(w: WorldState, dx: number, dy: number, g: WalkGrid): number {
  const from = w.pos;
  const full = { x: from.x + dx, y: from.y + dy };
  if (walkable(full, g)) {
    w.pos = full;
  } else {
    const ax = { x: from.x + dx, y: from.y };
    const ay = { x: from.x, y: from.y + dy };
    if (walkable(ax, g) && Math.abs(dx) >= Math.abs(dy) * 0.25) w.pos = ax;
    else if (walkable(ay, g) && Math.abs(dy) >= Math.abs(dx) * 0.25) w.pos = ay;
  }
  return distance(from, w.pos);
}

/** Click-to-move. Returns false if no route exists. */
export function walkTo(w: WorldState, target: Vec, g: WalkGrid = GRID): boolean {
  const p = findPath(w.pos, target, g);
  if (!p) return false;
  w.path = p;
  return true;
}
