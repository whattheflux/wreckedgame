import type { GameState } from './types';
import { dist } from './grid';

/** Player turns without discovering a hostile pod before the game points you toward the nearest one. */
export const HINT_AFTER_TURNS = 3;

export interface Hint {
  /** compass direction from the squad to the nearest undiscovered pod */
  direction: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
  /** the direction as a screen-space angle in radians (0 = east, +pi/2 = south), snapped to 45 degrees */
  angle: number;
  /** approximate distance in tiles, rounded to the nearest 5 so it stays vague */
  distance: number;
  band: 'close' | 'mid' | 'far';
}

// Index = angle / 45deg, with screen coordinates (y grows downward).
const COMPASS: Hint['direction'][] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

/**
 * If the squad has gone HINT_AFTER_TURNS without finding anyone, say roughly where the nearest
 * dormant pod is. Deliberately vague: a direction and a rounded range, never a position.
 */
export function getHint(state: GameState): Hint | null {
  if (state.winner || state.turnsSinceContact < HINT_AFTER_TURNS) return null;

  const players = state.units.filter((u) => u.alive && u.team === 'player');
  if (players.length === 0) return null;
  const cx = players.reduce((s, u) => s + u.pos.x, 0) / players.length;
  const cy = players.reduce((s, u) => s + u.pos.y, 0) / players.length;

  const pods = new Map<string, { sx: number; sy: number; n: number }>();
  for (const u of state.units) {
    if (!u.alive || u.team !== 'enemy' || !u.dormant || !u.pod) continue;
    const p = pods.get(u.pod) ?? { sx: 0, sy: 0, n: 0 };
    p.sx += u.pos.x;
    p.sy += u.pos.y;
    p.n += 1;
    pods.set(u.pod, p);
  }
  if (pods.size === 0) return null;

  let best: { dx: number; dy: number; d: number } | null = null;
  for (const p of pods.values()) {
    const dx = p.sx / p.n - cx;
    const dy = p.sy / p.n - cy;
    const d = dist({ x: 0, y: 0 }, { x: dx, y: dy });
    if (!best || d < best.d) best = { dx, dy, d };
  }
  if (!best) return null;

  const idx = ((Math.round(Math.atan2(best.dy, best.dx) / (Math.PI / 4)) % 8) + 8) % 8;
  const distance = Math.max(5, Math.round(best.d / 5) * 5);
  return {
    direction: COMPASS[idx],
    angle: idx * (Math.PI / 4),
    distance,
    band: best.d < 15 ? 'close' : best.d < 30 ? 'mid' : 'far',
  };
}
