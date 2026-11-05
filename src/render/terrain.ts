/**
 * Ground art for the battle board. Two sources, same call:
 *
 *  1. Bundled art in src/assets/terrain/<biome>/<kind>-<n>.png (see that folder's README), used when it exists;
 *     `common/` is the fallback for a biome with none of its own.
 *  2. Otherwise a pixel-art texture drawn in code, a handful of variants per kind and biome, so the
 *     floor never reads as one flat colour and the board looks the same before any art is made.
 *
 * Which variant a tile gets depends only on its position, so the ground never shimmers between frames.
 */
import type { Biome, Terrain } from '../engine/types';
import { loadedImage, preloadUrls } from './sprites';

export type TerrainKind = Terrain;

/** How many hand-drawn variants of each kind the code makes when there is no art. */
const VARIANTS: Record<TerrainKind, number> = { floor: 6, water: 3, wall: 2, half: 2, full: 2 };

const KIND_SALT: Record<TerrainKind, number> = { floor: 1, water: 2, wall: 3, half: 4, full: 5 };

/** Stable variant for a tile: a hash of its position and kind, in 0..count-1. */
export function variantIndex(x: number, y: number, kind: TerrainKind, count: number): number {
  let h = (x * 374761393 + y * 668265263 + KIND_SALT[kind] * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) % Math.max(1, count);
}

// ---------- bundled art ----------

const FILES = import.meta.glob('../assets/terrain/**/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const ART = new Map<string, string[]>(); // "<biome>/<kind>" -> urls in numeric order
for (const [path, url] of Object.entries(FILES)) {
  const m = /assets\/terrain\/([^/]+)\/(floor|wall|water|half|full)(?:-(\d+))?\.(?:png|webp)$/.exec(path);
  if (!m) continue;
  const key = `${m[1]}/${m[2]}`;
  const list = ART.get(key) ?? [];
  list[m[3] ? Number(m[3]) - 1 : 0] = url;
  ART.set(key, list);
}

function artFor(biome: Biome | undefined, kind: TerrainKind): string[] | null {
  const list = (biome && ART.get(`${biome}/${kind}`)) || ART.get(`common/${kind}`);
  const urls = list?.filter(Boolean);
  return urls && urls.length > 0 ? urls : null;
}

/** Start loading all bundled terrain art; resolves when it is ready (or after `ms`, so a slow net never blocks play). */
export function preloadTerrain(biome: Biome | undefined, ms = 2500): Promise<void> {
  const urls: string[] = [];
  for (const kind of ['floor', 'wall', 'water', 'half', 'full'] as const) urls.push(...(artFor(biome, kind) ?? []));
  return preloadUrls(urls, ms);
}

// ---------- procedural fallback ----------

interface Palette {
  base: string;
  dark: string;
  light: string;
  accent: string;
  water: string;
  waterLight: string;
  wall: string;
  wallLight: string;
  /** what the cover objects look like */
  half: 'crate' | 'rock' | 'bush';
  full: 'crate' | 'rock' | 'bush';
}

const PALETTES: Record<Biome | 'none', Palette> = {
  none: { base: '#6b6246', dark: '#5b533c', light: '#7b7152', accent: '#8a7f5c', water: '#15324a', waterLight: '#24506f', wall: '#4a4f58', wallLight: '#666c77', half: 'crate', full: 'crate' },
  beach: { base: '#8a7f58', dark: '#776d49', light: '#9c9168', accent: '#c9bd90', water: '#1b4a68', waterLight: '#2f6c8f', wall: '#55564f', wallLight: '#716f64', half: 'crate', full: 'crate' },
  forest: { base: '#3f5a36', dark: '#314a2a', light: '#4f6e43', accent: '#6f9150', water: '#1d4258', waterLight: '#2d6079', wall: '#464a46', wallLight: '#626760', half: 'bush', full: 'bush' },
  wastes: { base: '#6e5a46', dark: '#5b4938', light: '#806a53', accent: '#4a3b2e', water: '#2a3d4a', waterLight: '#3d5668', wall: '#50484a', wallLight: '#6b6264', half: 'rock', full: 'crate' },
  marsh: { base: '#46583f', dark: '#384a33', light: '#58704d', accent: '#7a8d55', water: '#1f4a45', waterLight: '#2e6a62', wall: '#434a42', wallLight: '#5d655b', half: 'bush', full: 'bush' },
  mountain: { base: '#5a5d63', dark: '#494c52', light: '#6c7078', accent: '#8a8e98', water: '#1d3c52', waterLight: '#2d5878', wall: '#3d4046', wallLight: '#585c64', half: 'rock', full: 'rock' },
  canyon: { base: '#7a553d', dark: '#664530', light: '#8f6849', accent: '#a98058', water: '#27425a', waterLight: '#3a6082', wall: '#523a2d', wallLight: '#6e5140', half: 'rock', full: 'rock' },
  volcano: { base: '#4a3330', dark: '#3a2624', light: '#5d423e', accent: '#ff7a2a', water: '#8a2f10', waterLight: '#d0601c', wall: '#2f2523', wallLight: '#4b3d3a', half: 'rock', full: 'rock' },
};

const N = 24; // texture pixels per tile edge; drawn scaled up with no smoothing, so the ground reads as pixel art

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BIOME_SEED: Record<string, number> = { none: 1, beach: 2, forest: 3, wastes: 4, marsh: 5, mountain: 6, canyon: 7, volcano: 8 };
const KIND_SEED: Record<TerrainKind, number> = { floor: 11, water: 23, wall: 37, half: 41, full: 53 };

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D, (x: number, y: number, c: string, w?: number, h?: number) => void] {
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  return [c, g, (x, y, col, w = 1, h = 1) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  }];
}

function floorTexture(p: Palette, biome: string, rnd: () => number): HTMLCanvasElement {
  const [c, , px] = canvas();
  px(0, 0, p.base, N, N);
  // fine grain
  for (let i = 0; i < N * N * 0.22; i++) px((rnd() * N) | 0, (rnd() * N) | 0, rnd() < 0.55 ? p.dark : p.light);
  const spot = (n: number, col: string, w = 1, h = 1): void => {
    for (let i = 0; i < n; i++) px((rnd() * (N - w)) | 0, (rnd() * (N - h)) | 0, col, w, h);
  };
  switch (biome) {
    case 'beach':
      spot(5, p.accent); // shell and pebble glints
      spot(2, p.dark, 2, 1);
      break;
    case 'forest':
    case 'marsh':
      for (let i = 0; i < (biome === 'forest' ? 7 : 4); i++) {
        const x = 1 + ((rnd() * (N - 3)) | 0);
        const y = 3 + ((rnd() * (N - 5)) | 0);
        px(x, y, p.accent);
        px(x, y - 1, p.accent);
        px(x + 1, y - 2, p.light);
      }
      if (biome === 'marsh') spot(2, '#33483a', 3, 2); // mud
      break;
    case 'wastes':
      for (let i = 0; i < 3; i++) {
        let x = (rnd() * N) | 0;
        let y = (rnd() * N) | 0;
        for (let k = 0; k < 5; k++) {
          px(x, y, p.accent);
          x = Math.max(0, Math.min(N - 1, x + ((rnd() * 3) | 0) - 1));
          y = Math.max(0, Math.min(N - 1, y + 1));
        }
      }
      spot(3, p.light, 2, 1);
      break;
    case 'mountain':
      spot(6, p.accent);
      spot(3, p.dark, 3, 2);
      break;
    case 'canyon':
      for (let y = 3; y < N; y += 5 + ((rnd() * 3) | 0)) px(0, y, p.dark, N, 1); // strata
      spot(4, p.accent);
      break;
    case 'volcano':
      spot(3, p.accent); // embers
      spot(2, '#8a3a1c');
      spot(2, p.light, 3, 1);
      break;
    default:
      spot(4, p.accent);
  }
  return c;
}

function waterTexture(p: Palette, biome: string, rnd: () => number): HTMLCanvasElement {
  const [c, , px] = canvas();
  px(0, 0, p.water, N, N);
  for (let i = 0; i < 6; i++) {
    const w = 3 + ((rnd() * 4) | 0);
    px((rnd() * (N - w)) | 0, (rnd() * N) | 0, p.waterLight, w, 1);
  }
  for (let i = 0; i < 4; i++) px((rnd() * N) | 0, (rnd() * N) | 0, p.dark, 3, 1);
  if (biome === 'volcano') for (let i = 0; i < 5; i++) px((rnd() * N) | 0, (rnd() * N) | 0, '#ffb347');
  return c;
}

function wallTexture(p: Palette, rnd: () => number): HTMLCanvasElement {
  const [c, , px] = canvas();
  px(0, 0, p.wall, N, N);
  const course = 6;
  for (let row = 0; row * course < N; row++) {
    const y = row * course;
    px(0, y, p.dark, N, 1); // mortar line
    px(0, y + 1, p.wallLight, N, 1); // lit upper edge of the course
    const off = row % 2 ? 6 : 0;
    for (let x = off; x < N; x += 12) px(x, y, p.dark, 1, course);
  }
  for (let i = 0; i < 30; i++) px((rnd() * N) | 0, (rnd() * N) | 0, rnd() < 0.5 ? p.dark : p.wallLight);
  px(0, 0, p.wallLight, N, 1);
  px(0, N - 1, '#1e2126', N, 1);
  return c;
}

/** A filled blob, lit from the top left. */
function blob(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, mid: string, hi: string, lo: string, rnd: () => number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const shade = dx * -0.55 + dy * -0.85 + (rnd() - 0.5) * 0.35;
      g.fillStyle = d > 0.78 ? lo : shade > 0.28 ? hi : shade < -0.34 ? lo : mid;
      g.fillRect(x, y, 1, 1);
    }
  }
}

function objectTexture(p: Palette, style: 'crate' | 'rock' | 'bush', big: boolean, rnd: () => number): HTMLCanvasElement {
  const [c, g, px] = canvas();
  const r = big ? 11 : 8;
  const cx = N / 2;
  const cy = N / 2 + (big ? 0 : 2);
  // soft ground shadow
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath();
  g.ellipse(cx + 1, cy + r * 0.8, r * 1.05, r * 0.45, 0, 0, Math.PI * 2);
  g.fill();
  if (style === 'crate') {
    const w = big ? 21 : 15;
    const h = big ? 19 : 12;
    const x0 = Math.round(cx - w / 2);
    const y0 = Math.round(cy - h / 2);
    px(x0, y0, '#7a5c3e', w, h);
    px(x0, y0, '#9a7a54', w, 2); // lit top edge
    px(x0, y0 + h - 2, '#4e3a26', w, 2);
    for (let k = x0 + 4; k < x0 + w - 1; k += 4) px(k, y0 + 2, '#5e4630', 1, h - 4); // planks
    px(x0, y0, '#4e3a26', 1, h);
    px(x0 + w - 1, y0, '#4e3a26', 1, h);
    if (big) {
      px(x0 + 2, y0 + 2, '#4e3a26', w - 4, 1);
      px(x0 + 2, y0 + h - 3, '#4e3a26', w - 4, 1);
    }
  } else if (style === 'rock') {
    blob(g, cx, cy, r, r * 0.8, p.wallLight, p.accent, p.dark, rnd);
    if (big) blob(g, cx - 4, cy + 3, 5, 4, p.wallLight, p.accent, p.dark, rnd);
  } else {
    const dark = '#2c4526';
    blob(g, cx, cy, r, r * 0.85, '#3f6334', '#5a8a45', dark, rnd);
    for (let i = 0; i < (big ? 6 : 3); i++) px(cx - r + ((rnd() * r * 2) | 0), cy - r * 0.8 + ((rnd() * r * 1.4) | 0), '#7fb05a');
  }
  return c;
}

const CACHE = new Map<string, HTMLCanvasElement>();

function procedural(biome: Biome | undefined, kind: TerrainKind, variant: number): HTMLCanvasElement {
  const key = `${biome ?? 'none'}/${kind}/${variant}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const b = biome ?? 'none';
  const p = PALETTES[b];
  const rnd = mulberry32(BIOME_SEED[b] * 1000 + KIND_SEED[kind] * 31 + variant * 7919);
  const tex =
    kind === 'floor'
      ? floorTexture(p, b, rnd)
      : kind === 'water'
        ? waterTexture(p, b, rnd)
        : kind === 'wall'
          ? wallTexture(p, rnd)
          : objectTexture(p, kind === 'half' ? p.half : p.full, kind === 'full', rnd);
  CACHE.set(key, tex);
  return tex;
}

/** The picture for one tile's ground (opaque) or cover object (transparent). Art if bundled and loaded, else code-drawn. */
export function terrainImage(biome: Biome | undefined, kind: TerrainKind, x: number, y: number): CanvasImageSource {
  const urls = artFor(biome, kind);
  if (urls) {
    const img = loadedImage(urls[variantIndex(x, y, kind, urls.length)]);
    if (img) return img;
  }
  return procedural(biome, kind, variantIndex(x, y, kind, VARIANTS[kind]));
}

/** Whether the biome (or `common`) has bundled art for this kind, so the board knows not to paint over it. */
export const hasTerrainArt = (biome: Biome | undefined, kind: TerrainKind): boolean => artFor(biome, kind) !== null;
