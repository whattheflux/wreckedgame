import type { GameMap, GameState, Pos, Unit } from './types';
import { computeShot } from './combat';
import { coverAgainst, dist } from './grid';

export const avg = (a: number, b: number): number => (a + b) / 2;

/** Expected damage per round the given shooters could put on a unit standing at `pos`. */
export function threatAt(
  state: GameState,
  target: Pick<Unit, 'defense' | 'hp'>,
  pos: Pos,
  shooters: Unit[],
): number {
  let total = 0;
  for (const s of shooters) {
    const pv = computeShot(state.map, s, s.pos, { defense: target.defense, pos, hp: target.hp });
    if (pv.canShoot) total += (pv.hitChance / 100) * avg(pv.dmgMin, pv.dmgMax);
  }
  return total;
}

export function nearestUnit(pos: Pos, units: Unit[]): { unit: Unit; d: number } | null {
  let best: { unit: Unit; d: number } | null = null;
  for (const u of units) {
    const d = dist(pos, u.pos);
    if (!best || d < best.d) best = { unit: u, d };
  }
  return best;
}

/** How much protection `pos` gives against fire from `from`: 0 none, 2 half, 4 full. */
export function coverValueVs(map: GameMap, from: Pos, pos: Pos): number {
  const c = coverAgainst(map, from, pos);
  return c === 'full' ? 4 : c === 'half' ? 2 : 0;
}
