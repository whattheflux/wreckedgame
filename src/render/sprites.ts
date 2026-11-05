/**
 * Character art. Facing-aware, optional, and bundled at build time (so nothing is requested for art
 * that does not exist). Two layouts live side by side in src/assets/sprites/:
 *
 *   amy.png                     one image, used whichever way the unit faces
 *   pc-male/down-left.png ...   a folder per character with up to 8 facings
 *   pc-male/ko.png              (optional) the knocked-out pose, drawn while the unit is downed
 *
 * The folder name (or file name) is the unit's art key: its `sprite` field, else its lowercase name.
 */

export type Dir = 'right' | 'down-right' | 'down' | 'down-left' | 'left' | 'up-left' | 'up' | 'up-right';

/** Screen angle of each facing in degrees, y pointing down (so 'down' is 90). */
export const DIR_ANGLE: Record<Dir, number> = {
  right: 0,
  'down-right': 45,
  down: 90,
  'down-left': 135,
  left: 180,
  'up-left': 225,
  up: 270,
  'up-right': 315,
};
export const DIRS = Object.keys(DIR_ANGLE) as Dir[];

const isDir = (s: string): s is Dir => s in DIR_ANGLE;

/** The facing for a step of (dx, dy) tiles; null when there is no movement. */
export function dirFromDelta(dx: number, dy: number): Dir | null {
  if (dx === 0 && dy === 0) return null;
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  const slot = Math.round(deg / 45) % 8;
  return DIRS.find((d) => DIR_ANGLE[d] === slot * 45) as Dir;
}

const angularGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** `want` if drawn, else the closest drawn facing (ties go to the first listed); null if none. */
export function nearestDir(want: Dir, available: readonly Dir[]): Dir | null {
  let best: Dir | null = null;
  for (const d of available) {
    if (d === want) return d;
    if (best === null || angularGap(DIR_ANGLE[d], DIR_ANGLE[want]) < angularGap(DIR_ANGLE[best], DIR_ANGLE[want])) best = d;
  }
  return best;
}

interface SpriteSet {
  single?: string;
  ko?: string;
  dirs: Partial<Record<Dir, string>>;
}

const FILES = import.meta.glob('../assets/sprites/**/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const SETS = new Map<string, SpriteSet>();
for (const [path, url] of Object.entries(FILES)) {
  const parts = path
    .replace(/^.*\/assets\/sprites\//, '')
    .replace(/\.(png|webp)$/, '')
    .split('/');
  const id = parts[0];
  const set = SETS.get(id) ?? { dirs: {} };
  if (parts.length === 1) set.single = url;
  else if (parts.length === 2 && isDir(parts[1])) set.dirs[parts[1]] = url;
  else if (parts.length === 2 && parts[1] === 'ko') set.ko = url;
  SETS.set(id, set);
}

/** URL of the art for `id` facing `want`, or null if there is none. */
export function spriteUrl(id: string, want: Dir): string | null {
  const set = SETS.get(id);
  if (!set) return null;
  const d = nearestDir(want, Object.keys(set.dirs).filter(isDir));
  return d ? (set.dirs[d] as string) : (set.single ?? null);
}

/** URL of the knocked-out pose for `id`, or null if it has none. */
export const koUrl = (id: string): string | null => SETS.get(id)?.ko ?? null;

/** A picture to show in menus (front-facing if there is one). */
export const previewUrl = (id: string): string | null => spriteUrl(id, 'down');

const images = new Map<string, HTMLImageElement>();

/** The loaded image for a url (starting the load on first use), or null while it is still loading. */
export function loadedImage(url: string): HTMLImageElement | null {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}
