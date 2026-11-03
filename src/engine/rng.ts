/** Seeded PRNG (mulberry32). State lives on the game state so battles are replayable and saveable. */
export interface RngHolder {
  rngState: number;
}

export function rand(s: RngHolder): number {
  s.rngState = (s.rngState + 0x6d2b79f5) | 0;
  let t = s.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Inclusive integer in [min, max]. */
export function randInt(s: RngHolder, min: number, max: number): number {
  return min + Math.floor(rand(s) * (max - min + 1));
}
