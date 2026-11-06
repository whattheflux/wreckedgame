import { describe, expect, it } from 'vitest';
import { addXp, applyBattleResult, attrTotal, autoSpend, beachLanding, createBattle, deployRoster, effectiveStats, migrateRoster } from '../engine';
import { LOADABLE_VERSIONS, SAVE_KEY, SAVE_VERSION, clearSave, hasSave, loadGame, saveGame, type KeyValueStore } from './save';
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

describe('saves written before the progression system', () => {
  /** A v2 world: a roster with levels and traits but no attributes, training, perks or pending picks. */
  const oldWorld = (): Record<string, unknown> => {
    const w = structuredClone(createWorld(7)) as unknown as { roster: Array<Record<string, unknown>> };
    for (const m of w.roster) {
      m.level = 4;
      m.xp = 10;
      delete m.attributes;
      delete m.combat;
      delete m.perks;
      delete m.pending;
      m.traits = [];
    }
    return w as unknown as Record<string, unknown>;
  };

  it('are still loadable: the old version is accepted rather than thrown away', () => {
    const store = memoryStore();
    store.setItem(SAVE_KEY, JSON.stringify({ v: 2, world: oldWorld() }));
    const loaded = loadGame(store);
    expect(loaded).not.toBeNull();
    expect(LOADABLE_VERSIONS).toContain(2);
    expect(LOADABLE_VERSIONS).toContain(SAVE_VERSION);
  });

  it('are brought up to date, with every pick their level had earned handed back', () => {
    const store = memoryStore();
    store.setItem(SAVE_KEY, JSON.stringify({ v: 2, world: oldWorld() }));
    const w = loadGame(store)!;
    expect(migrateRoster(w.roster, w)).toBe(true);
    for (const m of w.roster) {
      expect(m.level).toBe(4);
      expect(attrTotal(m.attributes)).toBeGreaterThan(0);
      expect(m.perks.length).toBeGreaterThan(0);
      expect(m.traits).toHaveLength(1);
      expect(m.pending.filter((p) => p.kind === 'attribute')).toHaveLength(3);
      expect(m.hp).toBeGreaterThan(0);
      expect(m.hp).toBeLessThanOrEqual(effectiveStats(m).hp);
    }
    // and the repaired world saves and loads again like any other
    expect(saveGame(w, store)).toBe(true);
    expect(loadGame(store)).toEqual(w);
  });

  it('a current save needs no repair', () => {
    const w = createWorld(3);
    expect(migrateRoster(w.roster, w)).toBe(false);
  });

  it('keeps a part-spent character exactly as it was', () => {
    const w = createWorld(11);
    const m = w.roster[0];
    addXp(m, 400, w, []);
    autoSpend(m);
    addXp(m, 400, w, []);
    const store = memoryStore();
    saveGame(w, store);
    const back = loadGame(store)!;
    expect(back.roster[0].attributes).toEqual(m.attributes);
    expect(back.roster[0].combat).toEqual(m.combat);
    expect(back.roster[0].perks).toEqual(m.perks);
    expect(back.roster[0].pending).toEqual(m.pending);
  });
});
