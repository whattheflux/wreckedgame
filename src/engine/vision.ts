import type { GameState, Pos, Team, Unit } from './types';
import { dist, hasLineOfSight } from './grid';

/** How far a unit sees (tiles) when nothing says otherwise. Observation buys more; `Unit.sight` holds it. */
export const SIGHT_RANGE = 12;

/** This unit's own sight range. */
export const sightOf = (u: Pick<Unit, 'sight'>): number => u.sight ?? SIGHT_RANGE;

export function canSeePos(state: GameState, from: Pos, to: Pos, range = SIGHT_RANGE): boolean {
  return dist(from, to) <= range && hasLineOfSight(state.map, from, to);
}

/** Every tile currently visible to any living unit of `team`: visible[y][x]. */
export function visibleTiles(state: GameState, team: Team = 'player'): boolean[][] {
  const { width, height } = state.map;
  const vis = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
  for (const u of state.units) {
    if (!u.alive || u.team !== team) continue;
    const r = Math.ceil(sightOf(u));
    for (let y = Math.max(0, u.pos.y - r); y <= Math.min(height - 1, u.pos.y + r); y++) {
      for (let x = Math.max(0, u.pos.x - r); x <= Math.min(width - 1, u.pos.x + r); x++) {
        if (!vis[y][x] && canSeePos(state, u.pos, { x, y }, sightOf(u))) vis[y][x] = true;
      }
    }
  }
  return vis;
}

/** Marks everything currently visible as explored and returns the visibility grid. */
export function updateExplored(state: GameState): boolean[][] {
  const vis = visibleTiles(state);
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if (vis[y][x]) state.explored[y][x] = true;
    }
  }
  return vis;
}

/** Dormant enemy pods that a player unit can currently see. A whole pod wakes when any member is spotted. */
export function podsToWake(state: GameState): string[] {
  const players = state.units.filter((u) => u.alive && u.team === 'player');
  const ids = new Set<string>();
  for (const e of state.units) {
    if (!e.alive || e.team !== 'enemy' || !e.dormant || !e.pod || ids.has(e.pod)) continue;
    if (players.some((p) => canSeePos(state, p.pos, e.pos, sightOf(p)))) ids.add(e.pod);
  }
  return [...ids];
}
