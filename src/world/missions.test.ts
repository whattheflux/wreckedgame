import { describe, expect, it } from 'vitest';
import {
  MISSION_KINDS,
  NPCS,
  STORY_MISSIONS,
  handIn,
  isComplete,
  isHandIn,
  missionStatus,
  npcById,
  progress,
  recordClear,
  recordKills,
  recordWin,
  rollBoard,
  storyOffers,
  type BoardOptions,
  type Mission,
} from './missions';
import { ITEMS } from '../engine';

const opts = (over: Partial<BoardOptions> = {}): BoardOptions => ({
  sites: [
    { id: 'hull', name: 'Wrecked Hull', difficulty: 1 },
    { id: 'crater', name: 'Crater Peak', difficulty: 4 },
  ],
  regions: [
    { id: 'forest', name: 'Old Forest', danger: 2 },
    { id: 'marsh', name: 'Shadow Marsh', danger: 2 },
  ],
  wants: ['bandage', 'energybar'],
  itemName: (id) => ITEMS[id]?.name ?? id,
  tier: 2,
  day: 3,
  ...over,
});

const mission = (over: Partial<Mission> = {}): Mission => ({
  id: 'm1',
  kind: 'cull',
  title: 'Put down 3 rivals',
  blurb: '',
  need: 3,
  done: 0,
  scrap: 10,
  standing: 5,
  xp: 8,
  ...over,
});

describe('the board', () => {
  it('posts the number asked for, all distinct, all payable', () => {
    const board = rollBoard({ rngState: 11 }, opts({ count: 4 }));
    expect(board).toHaveLength(4);
    expect(new Set(board.map((m) => m.id)).size).toBe(4);
    for (const m of board) {
      expect(MISSION_KINDS).toContain(m.kind);
      expect(m.need).toBeGreaterThan(0);
      expect(m.done).toBe(0);
      expect(m.standing).toBeGreaterThan(0);
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.blurb.length).toBeGreaterThan(0);
    }
  });

  it('is the same board for the same day, so reloading cannot reshuffle it', () => {
    const a = rollBoard({ rngState: 99 }, opts());
    const b = rollBoard({ rngState: 99 }, opts());
    expect(a).toEqual(b);
  });

  it('never posts the same site, region or item twice, and only one of each open-ended job', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const board = rollBoard({ rngState: seed }, opts({ count: 5 }));
      const by = (kind: Mission['kind']): string[] => board.filter((m) => m.kind === kind).map((m) => m.target ?? '');
      for (const kind of ['clear', 'patrol', 'fetch'] as const) expect(new Set(by(kind)).size, `${kind} seed ${seed}`).toBe(by(kind).length);
      expect(board.filter((m) => m.kind === 'cull').length).toBeLessThanOrEqual(1);
      expect(board.filter((m) => m.kind === 'supply').length).toBeLessThanOrEqual(1);
    }
  });

  it('pays more for harder work, and a bigger settlement pays better', () => {
    /** The clear posted for a one-site board, which is always posted somewhere in a board of five. */
    const clearFor = (difficulty: number, tier: number): Mission => {
      const board = rollBoard({ rngState: 3 }, opts({ sites: [{ id: 'hull', name: 'Hull', difficulty }], regions: [], wants: [], tier, count: 5 }));
      const m = board.find((x) => x.kind === 'clear');
      expect(m, `no clear posted for difficulty ${difficulty}`).toBeTruthy();
      return m as Mission;
    };
    const easy = clearFor(1, 2);
    const hard = clearFor(4, 2);
    expect(hard.scrap).toBeGreaterThan(easy.scrap);
    expect(hard.standing).toBeGreaterThan(easy.standing);
    expect(hard.xp).toBeGreaterThan(easy.xp);
    expect(clearFor(2, 4).scrap).toBeGreaterThan(clearFor(2, 1).scrap);
  });

  it('posts a donation that pays no scrap, because you are the one giving', () => {
    const board = rollBoard({ rngState: 7 }, opts({ sites: [], regions: [], wants: [], count: 1 }));
    const supply = board.find((m) => m.kind === 'supply');
    if (supply) {
      expect(supply.scrap).toBe(0);
      expect(supply.standing).toBeGreaterThan(0);
    }
  });

  it('only posts what there is to post: no sites, no clears', () => {
    const board = rollBoard({ rngState: 5 }, opts({ sites: [], regions: [], wants: [], count: 3 }));
    expect(board.every((m) => m.kind === 'cull' || m.kind === 'supply')).toBe(true);
    expect(board.length).toBeGreaterThan(0);
  });

  it('scales up with the settlement, and uses the day in its ids', () => {
    expect(rollBoard({ rngState: 2 }, opts({ tier: 1 })).length).toBeLessThan(rollBoard({ rngState: 2 }, opts({ tier: 4 })).length);
    for (const m of rollBoard({ rngState: 2 }, opts({ day: 12 }))) expect(m.id.startsWith('m12-')).toBe(true);
  });
});

describe('progress', () => {
  it('a cleared site finishes the job that wanted it gone, and nothing else', () => {
    const want = mission({ id: 'a', kind: 'clear', target: 'hull', need: 1 });
    const other = mission({ id: 'b', kind: 'clear', target: 'crater', need: 1 });
    const done = recordClear([want, other], 'hull');
    expect(done).toEqual([want]);
    expect(isComplete(want)).toBe(true);
    expect(isComplete(other)).toBe(false);
    expect(recordClear([want], 'hull')).toEqual([]); // already done: not reported twice
  });

  it('a win finishes a patrol of that region only', () => {
    const here = mission({ id: 'a', kind: 'patrol', target: 'forest', need: 1 });
    const there = mission({ id: 'b', kind: 'patrol', target: 'marsh', need: 1 });
    expect(recordWin([here, there], 'forest')).toEqual([here]);
    expect(isComplete(there)).toBe(false);
  });

  it('kills accumulate across fights and never overshoot', () => {
    const m = mission({ need: 5 });
    expect(recordKills([m], 2)).toEqual([]);
    expect(m.done).toBe(2);
    expect(recordKills([m], 9)).toEqual([m]);
    expect(m.done).toBe(5);
    expect(recordKills([m], 3)).toEqual([]); // finished, stays finished
    expect(m.done).toBe(5);
    expect(recordKills([mission()], 0)).toEqual([]);
  });

  it('reads out what is left in words', () => {
    expect(missionStatus(mission({ done: 1, need: 4 }))).toBe('1/4 put down');
    expect(missionStatus(mission({ kind: 'clear', target: 'hull', targetName: 'The Hull', need: 1 }))).toContain('The Hull');
    expect(missionStatus(mission({ kind: 'supply', need: 20, done: 5 }))).toBe('5/20 scrap delivered');
    expect(missionStatus(mission({ done: 3, need: 3 }))).toBe('Done: report back');
    expect(missionStatus(mission({ kind: 'supply', done: 3, need: 3 }))).toBe('Ready to hand over');
    expect(progress(mission({ done: 1, need: 4 }))).toBeCloseTo(0.25);
    expect(progress(mission({ need: 0 }))).toBe(1);
  });
});

describe('handing things over', () => {
  it('takes as much scrap as there is, and finishes when it adds up', () => {
    const m = mission({ kind: 'supply', need: 20 });
    const first = handIn(m, { scrap: 8, stash: [] });
    expect(first).toMatchObject({ ok: true, scrapSpent: 8 });
    expect(m.done).toBe(8);
    const second = handIn(m, { scrap: 50, stash: [] });
    expect(second.scrapSpent).toBe(12); // only what was still wanted
    expect(isComplete(m)).toBe(true);
    expect(handIn(m, { scrap: 50, stash: [] }).ok).toBe(false);
  });

  it('takes matching items out of the stash, up to what is wanted', () => {
    const m = mission({ kind: 'fetch', target: 'bandage', targetName: 'Bandage', need: 2 });
    const r = handIn(m, { scrap: 0, stash: ['energybar', 'bandage', 'bandage', 'bandage'] });
    expect(r.ok).toBe(true);
    expect(r.itemsSpent).toEqual(['bandage', 'bandage']);
    expect(isComplete(m)).toBe(true);
  });

  it('refuses with nothing to give, and refuses the jobs that are not handed in', () => {
    expect(handIn(mission({ kind: 'supply', need: 5 }), { scrap: 0, stash: [] }).ok).toBe(false);
    expect(handIn(mission({ kind: 'fetch', target: 'bandage', need: 1 }), { scrap: 9, stash: ['cap'] }).ok).toBe(false);
    expect(handIn(mission({ kind: 'clear', need: 1 }), { scrap: 9, stash: [] }).ok).toBe(false);
    expect(isHandIn('supply')).toBe(true);
    expect(isHandIn('clear')).toBe(false);
  });
});

describe('the people and their chain', () => {
  it('every NPC is whole, and every story mission belongs to one of them', () => {
    for (const n of NPCS) {
      expect(n.name.length).toBeGreaterThan(0);
      expect(n.role.length).toBeGreaterThan(0);
      expect(n.blurb.length).toBeGreaterThan(0);
      expect(n.tier).toBeGreaterThanOrEqual(1);
      expect(npcById(n.id)).toBe(n);
    }
    for (const m of STORY_MISSIONS) {
      expect(m.story).toBe(true);
      expect(npcById(m.from ?? ''), m.id).toBeTruthy();
      expect(m.standing).toBeGreaterThan(0);
      expect(m.outro?.length ?? 0).toBeGreaterThan(0);
      if (m.after) expect(STORY_MISSIONS.some((x) => x.id === m.after)).toBe(true);
    }
  });

  it('offers the first one only, until it is done', () => {
    const first = STORY_MISSIONS[0];
    const second = STORY_MISSIONS[1];
    expect(storyOffers(4, [], []).map((m) => m.id)).toEqual([first.id]);
    expect(storyOffers(4, [first.id], []).map((m) => m.id)).toEqual([second.id]);
    expect(storyOffers(1, [first.id], []).map((m) => m.id)).toEqual([]); // the second one wants a bigger camp
  });

  it('does not re-offer what is already taken, and hands back copies', () => {
    const first = STORY_MISSIONS[0];
    expect(storyOffers(4, [], [first.id])).toEqual([]);
    const offer = storyOffers(4, [], [])[0];
    offer.done = 99;
    expect(STORY_MISSIONS[0].done).toBe(0);
  });

  it('needs the whole chain done to see the last one', () => {
    const ids = STORY_MISSIONS.map((m) => m.id);
    expect(storyOffers(4, ids.slice(0, -1), []).map((m) => m.id)).toEqual([ids[ids.length - 1]]);
    expect(storyOffers(4, ids, [])).toEqual([]);
  });
});
