import { CLASSES, CLIQUES } from '../engine/roster';
import type { WorldState } from './world';

/**
 * Autosave. The whole game is plain JSON, so a save is just the world (which holds the roster).
 * Storage can be missing or throw (private windows, blocked site data), so every access is guarded
 * and a failed save is simply a no-op.
 */

export const SAVE_KEY = 'wrecked.save';
export const SAVE_VERSION = 3;
/** Versions still worth loading; anything older is repaired by `migrateRoster` on the way in. */
export const LOADABLE_VERSIONS = [2, 3];

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

interface SaveFile {
  v: number;
  world: WorldState;
}

/** Enough structure to trust the save: right version, a roster of five or fewer made of known cliques and classes, one leader. */
export function isValidWorld(w: unknown): w is WorldState {
  const o = w as WorldState | null;
  if (!o || typeof o !== 'object') return false;
  if (!o.pos || typeof o.pos.x !== 'number' || typeof o.pos.y !== 'number') return false;
  if (!Array.isArray(o.path) || !Array.isArray(o.log) || !Array.isArray(o.squad)) return false;
  if (typeof o.rngState !== 'number' || typeof o.scrap !== 'number' || !o.cleared || typeof o.cleared !== 'object') return false;
  if (!Array.isArray(o.roster) || o.roster.length === 0 || o.roster.length > 5) return false;
  if (o.roster.filter((m) => m.protagonist).length !== 1) return false;
  return o.roster.every(
    (m) =>
      typeof m.id === 'string' &&
      typeof m.name === 'string' &&
      m.clique in CLIQUES &&
      m.schoolClass in CLASSES &&
      typeof m.level === 'number' &&
      typeof m.hp === 'number' &&
      Array.isArray(m.traits) &&
      Array.isArray(m.injuries),
  );
}

export function saveGame(world: WorldState, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    const file: SaveFile = { v: SAVE_VERSION, world };
    store.setItem(SAVE_KEY, JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

/** The saved world, or null if there is none or it is unreadable / from an incompatible version. */
export function loadGame(store: KeyValueStore | null = defaultStore()): WorldState | null {
  if (!store) return null;
  try {
    const raw = store.getItem(SAVE_KEY);
    if (!raw) return null;
    const file = JSON.parse(raw) as SaveFile;
    if (!LOADABLE_VERSIONS.includes(file.v) || !isValidWorld(file.world)) return null;
    return file.world;
  } catch {
    return null;
  }
}

export const hasSave = (store: KeyValueStore | null = defaultStore()): boolean => loadGame(store) !== null;

export function clearSave(store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    /* nothing to do */
  }
}
