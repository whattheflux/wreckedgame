import { describe, expect, it } from 'vitest';
import { applyBattleResult, beachLanding, createBattle, deployRoster } from '../engine';
import { SAVE_KEY, SAVE_VERSION, clearSave, hasSave, loadGame, saveGame, type KeyValueStore } from './save';
import { createWorld } from './world';

const memoryStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

describe('save and load', () => {
  it('round-trips a world exactly, including the roster after a fight', () => {
    const w = createWorld(42, { name: 'Dale', clique: 'weirdo', schoolClass: 'art' });
    const s = createBattle(deployRoster(beachLanding, w.roster));
    s.units.find((u) => u.id === 'p2')!.kills = 6;
    s.winner = 'player';
    applyBattleResult(w.roster, s, w);
    w.scrap = 7;
    w.squad = ['p3', 'p1'];
    const store = memoryStore();
    expect(saveGame(w, store)).toBe(true);
    expect(loadGame(store)).toEqual(w);
    expect(hasSave(store)).toBe(true);
  });

  it('loads nothing when empty, corrupt, or from another version', () => {
    const store = memoryStore();
    expect(loadGame(store)).toBeNull();
    store.setItem(SAVE_KEY, '{not json');
    expect(loadGame(store)).toBeNull();
    store.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION + 1, world: createWorld(1) }));
    expect(loadGame(store)).toBeNull();
  });

  it('rejects a save whose roster is malformed', () => {
    const w = createWorld(1);
    const store = memoryStore();
    const bad = structuredClone(w) as unknown as { roster: Array<{ schoolClass: string }> };
    bad.roster[1].schoolClass = 'basketweaving';
    store.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, world: bad }));
    expect(loadGame(store)).toBeNull();
    const noLeader = structuredClone(w);
    noLeader.roster.forEach((m) => (m.protagonist = false));
    store.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, world: noLeader }));
    expect(loadGame(store)).toBeNull();
  });

  it('survives storage that is missing or throws', () => {
    const w = createWorld(1);
    expect(saveGame(w, null)).toBe(false);
    expect(loadGame(null)).toBeNull();
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(saveGame(w, broken)).toBe(false);
    expect(loadGame(broken)).toBeNull();
    expect(() => clearSave(broken)).not.toThrow();
  });

  it('clearSave removes it', () => {
    const store = memoryStore();
    saveGame(createWorld(1), store);
    clearSave(store);
    expect(hasSave(store)).toBe(false);
  });
});
