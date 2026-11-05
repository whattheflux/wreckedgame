import { describe, expect, it } from 'vitest';
import { variantIndex } from './terrain';

describe('terrain variants', () => {
  it('picks the same variant for a tile every time, always in range', () => {
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 30; x++) {
        const v = variantIndex(x, y, 'floor', 6);
        expect(v).toBe(variantIndex(x, y, 'floor', 6));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(6);
      }
    }
  });

  it('spreads across all variants instead of clumping', () => {
    const seen = new Set<number>();
    const counts = new Array<number>(6).fill(0);
    for (let y = 0; y < 18; y++) for (let x = 0; x < 30; x++) counts[variantIndex(x, y, 'floor', 6)]++;
    for (const c of counts) expect(c).toBeGreaterThan(40); // 540 tiles, ~90 each
    counts.forEach((_, i) => seen.add(i));
    expect(seen.size).toBe(6);
    // different kinds do not move in lockstep
    let same = 0;
    for (let x = 0; x < 100; x++) if (variantIndex(x, 3, 'floor', 6) === variantIndex(x, 3, 'water', 6)) same++;
    expect(same).toBeLessThan(40);
  });

  it('copes with a single variant', () => {
    expect(variantIndex(5, 5, 'wall', 1)).toBe(0);
  });
});
