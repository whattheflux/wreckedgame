import { describe, expect, it } from 'vitest';
import {
  ENCOUNTER_H,
  ENCOUNTER_W,
  SIGHT_RANGE,
  createBattle,
  dist,
  encounterScenario,
  reachableTiles,
  type Biome,
} from './index';

const BIOMES: Biome[] = ['beach', 'forest', 'wastes', 'marsh', 'mountain', 'canyon', 'volcano'];

describe('encounterScenario', () => {
  it('is deterministic for the same options and differs across seeds', () => {
    const a = encounterScenario({ seed: 5, biome: 'forest', pods: 2, podSize: 3, difficulty: 2 });
    const b = encounterScenario({ seed: 5, biome: 'forest', pods: 2, podSize: 3, difficulty: 2 });
    const c = encounterScenario({ seed: 6, biome: 'forest', pods: 2, podSize: 3, difficulty: 2 });
    expect(JSON.stringify(a.map())).toBe(JSON.stringify(b.map()));
    expect(JSON.stringify(a.units)).toBe(JSON.stringify(b.units));
    expect(JSON.stringify(a.map())).not.toBe(JSON.stringify(c.map()));
  });

  it('map() hands out independent copies', () => {
    const sc = encounterScenario({ seed: 1, biome: 'beach', pods: 1, podSize: 2, difficulty: 1 });
    const m = sc.map();
    const before = sc.map().tiles[9][9];
    m.tiles[9][9] = before === 'water' ? 'floor' : 'water';
    expect(sc.map().tiles[9][9]).toBe(before);
    expect(sc.map()).not.toBe(m);
  });

  for (const biome of BIOMES) {
    it(`${biome}: 60 seeds keep every invariant`, () => {
      for (let seed = 1; seed <= 60; seed++) {
        const pods = 1 + (seed % 4);
        const podSize = 2 + (seed % 3);
        const sc = encounterScenario({ seed, biome, pods, podSize, difficulty: 1 + (seed % 4) });
        const st = createBattle(sc);
        const where = `${biome} seed ${seed}`;

        expect(st.map.width).toBe(ENCOUNTER_W);
        expect(st.map.height).toBe(ENCOUNTER_H);
        expect(st.map.biome, where).toBe(biome);

        const players = st.units.filter((u) => u.team === 'player');
        const foes = st.units.filter((u) => u.team === 'enemy');
        expect(players).toHaveLength(4);
        expect(foes).toHaveLength(pods * podSize);

        // everyone stands on distinct floor tiles
        const keys = new Set<string>();
        for (const u of st.units) {
          expect(st.map.tiles[u.pos.y][u.pos.x], `${where}: ${u.id} not on floor`).toBe('floor');
          const k = `${u.pos.x},${u.pos.y}`;
          expect(keys.has(k), `${where}: two units on ${k}`).toBe(false);
          keys.add(k);
        }

        // no pod is discoverable at turn 1
        for (const f of foes) {
          expect(f.dormant).toBe(true);
          for (const p of players) expect(dist(f.pos, p.pos), `${where}: ${f.id} too close`).toBeGreaterThan(SIGHT_RANGE);
        }

        // everyone is connected: the lead player can walk to every other unit's tile
        const reach = reachableTiles(st.map, [], players[0], 999);
        for (const u of st.units) expect(reach.has(`${u.pos.x},${u.pos.y}`), `${where}: ${u.id} cut off`).toBe(true);

        // names are unique
        expect(new Set(foes.map((f) => f.name)).size).toBe(foes.length);
      }
    });
  }

  it('higher difficulty means tougher enemies', () => {
    const avg = (d: number): { hp: number; aim: number } => {
      const f = encounterScenario({ seed: 3, biome: 'wastes', pods: 2, podSize: 3, difficulty: d }).units.filter((u) => u.team === 'enemy');
      return { hp: f.reduce((a, u) => a + u.hp, 0) / f.length, aim: f.reduce((a, u) => a + u.aim, 0) / f.length };
    };
    expect(avg(4).hp).toBeGreaterThan(avg(1).hp);
    expect(avg(4).aim).toBeGreaterThan(avg(1).aim);
  });

  it('clamps silly options instead of crashing', () => {
    const sc = encounterScenario({ seed: 1, biome: 'canyon', pods: 99, podSize: 99, difficulty: 99 });
    expect(sc.units.filter((u) => u.team === 'enemy').length).toBeLessThanOrEqual(5 * 8);
    const sc0 = encounterScenario({ seed: 1, biome: 'canyon', pods: 0, podSize: 0, difficulty: 0 });
    expect(sc0.units.filter((u) => u.team === 'enemy').length).toBeGreaterThanOrEqual(1);
  });
});

describe('ambush encounters', () => {
  it('put the enemy close to the squad instead of out of sight', () => {
    for (let seed = 1; seed < 15; seed++) {
      const sc = encounterScenario({ seed, biome: 'forest', pods: 1, podSize: 2, difficulty: 2, ambush: true });
      const foes = sc.units.filter((u) => u.team === 'enemy');
      const nearest = Math.min(...foes.map((f) => f.x));
      expect(nearest, `seed ${seed}`).toBeLessThanOrEqual(14);
    }
  });
});
