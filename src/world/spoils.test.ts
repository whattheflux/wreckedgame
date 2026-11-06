import { describe, expect, it } from 'vitest';
import { arena, open, unit } from '../engine/testutil';
import { collectSpoils, defaultChoice, ensureStores, resolveSpoils, type SpoilsHolder } from './spoils';

const won = () => {
  const state = arena(open(8, 4), [
    unit({ id: 'p', team: 'player' }),
    unit({ id: 'k', team: 'enemy', alive: false, fate: 'dead', name: 'Kyle', pos: { x: 3, y: 1 } }),
    unit({ id: 'o', team: 'enemy', alive: false, fate: 'unconscious', name: 'Orla', role: 'Goth', pos: { x: 4, y: 1 } }),
  ]);
  state.ground = { '3,1': ['remains', 'bandage'], '4,1': ['cap'] };
  state.winner = 'player';
  return state;
};

describe('spoils', () => {
  it('a win leaves the ground and the out-cold rivals; a loss or retreat leaves nothing', () => {
    const s = collectSpoils(won());
    expect(s.loot.sort()).toEqual(['bandage', 'cap', 'remains']);
    expect(s.prisoners.map((p) => p.name)).toEqual(['Orla']);
    expect(s.killed).toBe(1);
    const lost = won();
    lost.winner = 'enemy';
    expect(collectSpoils(lost)).toEqual({ loot: [], prisoners: [], killed: 0 });
    const left = won();
    left.winner = null;
    expect(collectSpoils(left).loot).toEqual([]);
  });

  it('takes the picked items only and lets prisoners go by default', () => {
    const w: SpoilsHolder = {};
    const s = collectSpoils(won());
    resolveSpoils(w, s, { take: [0], fates: {} });
    expect(w.stash).toHaveLength(1);
    expect(w.mercy?.spared).toEqual([{ name: 'Orla', role: 'Goth' }]);
    expect(w.mercy?.killed).toBe(1);
    expect(w.captives).toEqual([]);
  });

  it('capture keeps them with a unique id; execute leaves remains and is counted', () => {
    const w: SpoilsHolder = {};
    const s = collectSpoils(won());
    resolveSpoils(w, s, { ...defaultChoice(s), fates: { o: 'capture' } });
    resolveSpoils(w, s, { take: [], fates: { o: 'capture' } });
    expect(new Set(w.captives?.map((c) => c.uid)).size).toBe(2);
    expect(w.mercy?.captured).toBe(2);
    const w2: SpoilsHolder = {};
    resolveSpoils(w2, s, { take: [], fates: { o: 'execute' } });
    expect(w2.stash).toEqual(['remains']);
    expect(w2.mercy?.executed).toBe(1);
  });

  it('ignores bad indexes and fills in an old save\'s missing fields', () => {
    const w: SpoilsHolder = {};
    expect(ensureStores(w)).toMatchObject({ stash: [], captives: [] });
    resolveSpoils(w, collectSpoils(won()), { take: [-1, 99, 1, 1], fates: {} });
    expect(w.stash).toHaveLength(1);
  });
});
