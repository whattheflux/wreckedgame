import { describe, expect, it } from 'vitest';
import { spriteUrl } from '../render/sprites';
import { RIVAL_KINDS, rivalCrew, rivalLooks } from './rivals';
import { encounterScenario } from './encounter';

const PARTY_ART = ['pc-male', 'pc-female', 'amy', 'scott', 'tyson', 'anna'];

describe('rival crews', () => {
  it('only uses bundled art, and none of the party kinds', () => {
    for (const { sprite } of rivalLooks()) {
      expect(spriteUrl(sprite, 'down'), sprite).toBeTruthy();
      expect(PARTY_ART).not.toContain(sprite);
    }
  });

  it('is deterministic per seed, with unique names and a school', () => {
    const a = rivalCrew(42, 8);
    expect(rivalCrew(42, 8)).toEqual(a);
    expect(new Set(a.members.map((m) => m.name)).size).toBe(8);
    expect(a.school.length).toBeGreaterThan(0);
    expect(rivalCrew(43, 8)).not.toEqual(a);
  });

  it('mixes kinds: a crew as big as the deck has every look exactly once', () => {
    const looks = rivalLooks().length;
    const crew = rivalCrew(7, looks);
    expect(new Set(crew.members.map((m) => m.sprite)).size).toBe(looks);
    expect(new Set(crew.members.map((m) => m.role.split(' (')[0])).size).toBe(RIVAL_KINDS.length);
  });

  it('encounters field a rival school with art, without changing the map for a seed', () => {
    const sc = encounterScenario({ seed: 11, biome: 'forest', pods: 3, podSize: 3, difficulty: 2 });
    const foes = sc.units.filter((u) => u.team === 'enemy');
    expect(foes).toHaveLength(9);
    for (const f of foes) {
      expect(f.sprite).toBeTruthy();
      expect(f.role).toMatch(/\(.+\)$/);
    }
    expect(sc.name).toContain(':');
    expect(JSON.stringify(encounterScenario({ seed: 11, biome: 'forest', pods: 3, podSize: 3, difficulty: 2 }).map())).toBe(JSON.stringify(sc.map()));
  });
});
