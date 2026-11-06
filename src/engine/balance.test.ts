import { describe, expect, it } from 'vitest';
import {
  MAX_LEVEL,
  addXp,
  autoSpend,
  aiStep,
  createBattle,
  createStarterRoster,
  deployRoster,
  effectiveStats,
  encounterScenario,
  xpMultiplier,
  xpToNext,
  type GameState,
  type Roster,
} from './index';
import { type RngHolder } from './rng';

/**
 * Where the difficulty curve actually sits.
 *
 * This plays whole battles with a real roster on one side and a generated rival school on the other,
 * both driven by simple policies, and checks the results land in sensible bands: a fresh squad should
 * handle the easy fights and lose the hard ones, and a squad at the cap should handle the hard ones.
 *
 * The bands are deliberately wide. The point is to catch a change that makes the game trivial or
 * impossible, not to pin the numbers down — and the summary it prints is the quickest way to see what
 * a balance change did.
 */

/** A roster taken to `level` with every pick spent by `autoSpend`. */
function grownRoster(level: number, seed: number): Roster {
  const roster = createStarterRoster();
  if (level <= 1) return roster;
  const rng: RngHolder = { rngState: seed };
  for (const m of roster) {
    let guard = 400;
    while (m.level < level && guard-- > 0) {
      const need = Math.max(1, Math.ceil((xpToNext(m.level) - m.xp) / xpMultiplier(m.attributes)));
      const was = m.level;
      addXp(m, need, rng, []);
      if (m.level === was) addXp(m, 2, rng, []);
    }
    autoSpend(m);
    m.hp = effectiveStats(m).hp;
  }
  return roster;
}

/** Run one side's whole turn through the shared brain. Both sides get the same one, which is the
 *  point: the result measures the characters, not how well a policy was written for one of them. */
function runTurn(s: GameState, team: 'player' | 'enemy', label: string): void {
  let guard = 0;
  for (let ev = aiStep(s, team); ev !== null; ev = aiStep(s, team)) {
    if (++guard > 500) throw new Error(`${label}: ${team} turn did not terminate`);
  }
}

interface Result {
  wins: number;
  losses: number;
  draws: number;
  rounds: number;
}

/** The same fight the world actually generates at this danger level (see `randomEncounter`). */
const encounterFor = (difficulty: number, seed: number, level: number): ReturnType<typeof encounterScenario> =>
  encounterScenario({
    seed,
    level,
    biome: 'forest',
    pods: difficulty >= 3 ? 2 : 1,
    podSize: difficulty === 2 ? 3 : 2,
    difficulty,
  });

/** Play `seeds` whole battles of a squad at `level` against the fight the world would give it. */
function play(level: number, difficulty: number, seeds = 16, maxRounds = 24): Result {
  const out: Result = { wins: 0, losses: 0, draws: 0, rounds: 0 };
  for (let seed = 1; seed <= seeds; seed++) {
    const roster = grownRoster(level, seed * 13);
    const s = createBattle(deployRoster(encounterFor(difficulty, seed * 977, level), roster));
    const label = `level ${level} vs ${difficulty} seed ${seed}`;
    let round = 1;
    for (; round <= maxRounds && !s.winner; round++) {
      runTurn(s, 'player', label);
      if (s.winner) break;
      runTurn(s, 'enemy', label);
    }
    out.rounds += round;
    if (s.winner === 'player') out.wins++;
    else if (s.winner === 'enemy') out.losses++;
    else out.draws++;
  }
  return out;
}

const pct = (r: Result, seeds: number): number => Math.round((r.wins / seeds) * 100);

describe('the difficulty curve', () => {
  const SEEDS = 16;

  it('is a curve: easy fights are winnable fresh, hard ones are not, and growing fixes that', () => {
    const table: Array<[string, Result]> = [];
    const run = (level: number, difficulty: number): Result => {
      const r = play(level, difficulty, SEEDS);
      table.push([`level ${level} vs difficulty ${difficulty}`, r]);
      return r;
    };
    const fresh1 = run(1, 1);
    const fresh4 = run(1, 4);
    const mid4 = run(6, 4);
    const grown4 = run(MAX_LEVEL, 4);

    // eslint-disable-next-line no-console
    console.log(
      ['', ...table.map(([name, r]) => `  ${name.padEnd(26)} won ${String(pct(r, SEEDS)).padStart(3)}%  (${r.wins}W ${r.losses}L ${r.draws}unfinished)`)].join('\n'),
    );

    // A first fight you would normally expect to come through.
    expect(pct(fresh1, SEEDS), 'a fresh squad should handle the easiest fight').toBeGreaterThanOrEqual(70);
    // The worst the island has, walked into on day one: it should go badly more often than not.
    expect(pct(fresh4, SEEDS), 'a fresh squad should not be walking the hardest fights').toBeLessThanOrEqual(50);
    // Growing has to be worth real money, not a rounding error.
    expect(pct(grown4, SEEDS) - pct(fresh4, SEEDS), 'twelve levels should be worth a lot').toBeGreaterThanOrEqual(25);
    // ...and it should show up by the middle of a run, not only at the end.
    expect(pct(mid4, SEEDS), 'the middle of a run should already feel better').toBeGreaterThan(pct(fresh4, SEEDS));
    // ...but never a formality: rivals scale too.
    expect(pct(grown4, SEEDS), 'the hardest fight should not be a formality even at the cap').toBeLessThan(100);
  });

  it('finishes: battles reach a result rather than grinding on forever', () => {
    const r = play(6, 2, 10, 24);
    expect(r.draws, 'battles that never resolved').toBeLessThanOrEqual(2);
  });

  it('never breaks an invariant along the way', () => {
    const roster = grownRoster(MAX_LEVEL, 5);
    const sc = encounterScenario({ seed: 31, biome: 'volcano', pods: 2, podSize: 3, difficulty: 4, level: MAX_LEVEL });
    const s = createBattle(deployRoster(sc, roster));
    for (let round = 1; round <= 20 && !s.winner; round++) {
      runTurn(s, 'player', 'invariants');
      for (const u of s.units) {
        expect(u.hp).toBeGreaterThanOrEqual(0);
        expect(u.hp).toBeLessThanOrEqual(u.maxHp);
        expect(u.alive).toBe(u.hp > 0);
      }
      if (s.winner) break;
      runTurn(s, 'enemy', 'invariants');
    }
    const seen = new Set<string>();
    for (const u of s.units.filter((x) => x.alive)) {
      const k = `${u.pos.x},${u.pos.y}`;
      expect(seen.has(k), `overlap at ${k}`).toBe(false);
      seen.add(k);
    }
  });
});
