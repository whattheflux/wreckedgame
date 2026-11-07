import { describe, expect, it } from 'vitest';
import { createWorld, WORLD } from './world';
import { dayOf, morning } from './camp';
import { ensureStores } from './spoils';
import {
  FACILITY,
  FACILITY_IDS,
  HOUSES,
  MAX_ACTIVE,
  PRICES,
  SELL_RATE,
  SETTLEMENTS,
  SITE_CLEAR_STANDING,
  TIERS,
  TRAINING,
  TRAIN_PER_DAY,
  abandonMission,
  acceptMission,
  addStanding,
  boardRegions,
  buyHouse,
  buyItem,
  costOf,
  deliver,
  discountOf,
  ensureSettlement,
  facilityOpen,
  houseCost,
  houseOf,
  isSettlement,
  openSites,
  peopleAt,
  priceOf,
  refreshSettlement,
  reportMission,
  restBonusOf,
  sellItem,
  sellValue,
  sellable,
  settlementDef,
  standingToNext,
  stockPool,
  tierDef,
  tierOf,
  trainMember,
  trainingLeft,
  visitedSettlements,
  type SettlementState,
} from './settlement';
import { ITEMS, effectiveStats, livingSquad } from '../engine';
import { DONATION_PER_STANDING, isComplete, rollBoard, type Mission } from './missions';

const SITE = 'camp';

/** A world with the settlement already woken up and stocked, at the given standing. */
function at(standing = 0, seed = 5): { w: ReturnType<typeof createWorld>; st: SettlementState } {
  const w = createWorld(seed);
  const st = ensureSettlement(w, SITE);
  st.standing = standing;
  refreshSettlement(w, st);
  return { w, st };
}

/** Put a job straight into the active list, bypassing the board. */
const give = (st: SettlementState, m: Partial<Mission>): Mission => {
  const full: Mission = { id: 'job', kind: 'cull', title: 'A job', blurb: '', need: 1, done: 0, scrap: 10, standing: 10, xp: 5, ...m };
  st.active.push(full);
  return full;
};

describe('which places are settlements', () => {
  it('is the camp, and it has a site to stand on', () => {
    expect(Object.keys(SETTLEMENTS)).toContain('camp');
    for (const id of Object.keys(SETTLEMENTS)) {
      const site = WORLD.sites.find((s) => s.id === id);
      expect(site, `${id} has no site`).toBeTruthy();
      expect(isSettlement(site)).toBe(true);
      const def = settlementDef(id)!;
      expect(def.npcs.length).toBeGreaterThan(0);
      expect(def.wants.length).toBeGreaterThan(0);
      for (const want of def.wants) expect(ITEMS[want], want).toBeTruthy();
    }
    expect(isSettlement(WORLD.sites.find((s) => s.id === 'crater'))).toBe(false);
    expect(isSettlement(null)).toBe(false);
  });

  it('is created the first time anyone asks, and remembered after that', () => {
    const w = createWorld(1);
    expect(w.settlements).toBeUndefined();
    const st = ensureSettlement(w, SITE);
    expect(st.standing).toBe(0);
    expect(ensureSettlement(w, SITE)).toBe(st);
    expect(visitedSettlements(w)).toEqual([st]);
  });
});

describe('tiers', () => {
  it('climb with standing, in order, starting at a shanty', () => {
    const { st } = at();
    expect(tierOf(st)).toBe(1);
    expect(tierDef(1).name).toBe('Shanty');
    for (const t of TIERS) {
      st.standing = t.standing;
      expect(tierOf(st)).toBe(t.tier);
    }
    st.standing = 99999;
    expect(tierOf(st)).toBe(TIERS[TIERS.length - 1].tier);
    expect(TIERS.map((t) => t.standing)).toEqual([...TIERS.map((t) => t.standing)].sort((a, b) => a - b));
  });

  it('says how far it is to the next one, and nothing at the top', () => {
    const { st } = at(0);
    expect(standingToNext(st)).toBe(TIERS[1].standing);
    st.standing = TIERS[1].standing - 5;
    expect(standingToNext(st)).toBe(5);
    st.standing = TIERS[TIERS.length - 1].standing;
    expect(standingToNext(st)).toBeNull();
  });

  it('opens the board and the store at once, and the rest as it grows', () => {
    const { st } = at(0);
    expect(facilityOpen(st, 'board')).toBe(true);
    expect(facilityOpen(st, 'store')).toBe(true);
    expect(facilityOpen(st, 'training')).toBe(false);
    expect(facilityOpen(st, 'houses')).toBe(false);
    st.standing = TIERS[1].standing;
    expect(facilityOpen(st, 'training')).toBe(true);
    expect(facilityOpen(st, 'houses')).toBe(false);
    st.standing = TIERS[2].standing;
    expect(facilityOpen(st, 'houses')).toBe(true);
    for (const f of FACILITY_IDS) expect(FACILITY[f].tier).toBeLessThanOrEqual(TIERS.length);
  });

  it('announces growing, once, and never drops below nothing', () => {
    const { st } = at(0);
    expect(addStanding(st, 1).grew).toBe(false);
    const jump = addStanding(st, TIERS[1].standing);
    expect(jump.grew).toBe(true);
    expect(jump.note).toContain(tierDef(2).name.toLowerCase());
    expect(addStanding(st, 1).grew).toBe(false);
    addStanding(st, -99999);
    expect(st.standing).toBe(0);
  });
});

describe('the board', () => {
  it('is drawn on arrival and redrawn the next day, not before', () => {
    const { w, st } = at();
    expect(st.board.length).toBeGreaterThan(0);
    const same = [...st.board];
    refreshSettlement(w, st);
    expect(st.board).toEqual(same);
    w.day = dayOf(w) + 1;
    refreshSettlement(w, st);
    expect(st.boardDay).toBe(dayOf(w));
  });

  it('only posts clears for sites still standing', () => {
    const { w } = at();
    expect(openSites(w).length).toBeGreaterThan(0);
    const first = openSites(w)[0];
    w.cleared[first.id] = true;
    expect(openSites(w).map((s) => s.id)).not.toContain(first.id);
    expect(boardRegions().every((r) => r.danger > 0)).toBe(true);
  });

  it('takes a job off the board and onto your list, up to the limit', () => {
    const { w, st } = at();
    st.board = [];
    st.boardDay = dayOf(w);
    for (let i = 0; i < MAX_ACTIVE + 1; i++) st.board.push({ id: `j${i}`, kind: 'cull', title: `Job ${i}`, blurb: '', need: 1, done: 0, scrap: 1, standing: 1, xp: 1 });
    for (let i = 0; i < MAX_ACTIVE; i++) expect(acceptMission(st, `j${i}`).ok).toBe(true);
    expect(st.active).toHaveLength(MAX_ACTIVE);
    expect(acceptMission(st, `j${MAX_ACTIVE}`)).toMatchObject({ ok: false });
    expect(acceptMission(st, 'nonsense')).toMatchObject({ ok: false });
    expect(st.board.map((m) => m.id)).toEqual([`j${MAX_ACTIVE}`]);
  });

  it('gives board work back to the board, with its progress reset', () => {
    const { st } = at();
    give(st, { id: 'b1', title: 'Board job', need: 3, done: 2 });
    expect(abandonMission(st, 'b1').ok).toBe(true);
    expect(st.active).toHaveLength(0);
    expect(st.board.find((m) => m.id === 'b1')?.done).toBe(0);
    expect(abandonMission(st, 'b1').ok).toBe(false);
  });

  it('does not keep story work on the board: storyOffers decides whether it comes back', () => {
    const { st } = at(999);
    give(st, { id: 's1', title: 'Story job', story: true, from: 'marla' });
    expect(abandonMission(st, 's1').ok).toBe(true);
    expect(st.board.some((m) => m.id === 's1')).toBe(false);
  });

  it('puts story work on the board without it crowding out the day job', () => {
    const { st } = at(999);
    expect(st.board.some((m) => m.story)).toBe(true);
    expect(st.board.some((m) => !m.story)).toBe(true);
  });
});

describe('reporting in', () => {
  it('pays scrap, standing and experience to everyone still standing', () => {
    const { w, st } = at();
    w.scrap = 0;
    const m = give(st, { need: 1, done: 1, scrap: 30, standing: 12, xp: 10 });
    const before = livingSquad(w.roster).map((x) => x.xp);
    const r = reportMission(w, st, m.id);
    expect(r.ok).toBe(true);
    expect(w.scrap).toBe(30);
    expect(st.standing).toBe(12);
    expect(st.doneIds).toContain(m.id);
    expect(st.active).toHaveLength(0);
    expect(livingSquad(w.roster).map((x) => x.xp)).not.toEqual(before);
  });

  it('refuses one that is not finished, and one you are not carrying', () => {
    const { w, st } = at();
    const m = give(st, { need: 3, done: 1 });
    expect(reportMission(w, st, m.id)).toMatchObject({ ok: false });
    expect(reportMission(w, st, 'ghost')).toMatchObject({ ok: false });
    expect(st.active).toHaveLength(1);
  });

  it('hands over a reward item into the stash, and prints the story line', () => {
    const { w, st } = at();
    const m = give(st, { need: 1, done: 1, item: 'hikingpack', outro: 'They nod, once.' });
    const r = reportMission(w, st, m.id);
    expect(ensureStores(w).stash).toContain('hikingpack');
    expect(r.notes.join(' ')).toContain('They nod, once.');
  });

  it('can grow the settlement, and says so', () => {
    const { w, st } = at(TIERS[1].standing - 1);
    const m = give(st, { need: 1, done: 1, standing: 5 });
    const r = reportMission(w, st, m.id);
    expect(tierOf(st)).toBe(2);
    expect(r.notes.join(' ')).toContain('grown');
  });

  it('a dead squad member earns nothing', () => {
    const { w, st } = at();
    w.roster[1].dead = true;
    const was = w.roster[1].xp;
    reportMission(w, st, give(st, { need: 1, done: 1, xp: 50 }).id);
    expect(w.roster[1].xp).toBe(was);
  });
});

describe('handing things over', () => {
  it('takes scrap for a donation and finishes it', () => {
    const { w, st } = at();
    w.scrap = 40;
    const m = give(st, { kind: 'supply', need: 25, scrap: 0 });
    expect(deliver(w, st, m.id).ok).toBe(true);
    expect(w.scrap).toBe(15);
    expect(isComplete(m)).toBe(true);
    expect(deliver(w, st, m.id).ok).toBe(false);
  });

  it('takes items out of the stash for a fetch', () => {
    const { w, st } = at();
    const stores = ensureStores(w);
    stores.stash.push('bandage', 'bandage', 'cap');
    const m = give(st, { kind: 'fetch', target: 'bandage', targetName: 'Bandage', need: 2 });
    expect(deliver(w, st, m.id).ok).toBe(true);
    expect(stores.stash).toEqual(['cap']);
    expect(isComplete(m)).toBe(true);
  });

  it('refuses the jobs that are finished out in the world', () => {
    const { w, st } = at();
    expect(deliver(w, st, give(st, { kind: 'clear', target: 'hull' }).id)).toMatchObject({ ok: false });
    expect(deliver(w, st, 'ghost')).toMatchObject({ ok: false });
  });
});

describe('the store', () => {
  it('prices everything it stocks, and never asks nothing for anything', () => {
    for (const id of stockPool(TIERS.length)) {
      expect(ITEMS[id], id).toBeTruthy();
      expect(priceOf(id), id).toBeGreaterThan(0);
      expect(sellValue(id), id).toBeGreaterThan(0);
    }
    expect(priceOf('made-up-item')).toBeGreaterThan(0); // a new item never breaks the shop
    for (const id of Object.keys(PRICES)) expect(ITEMS[id], `${id} is priced but does not exist`).toBeTruthy();
  });

  it('stocks more, and better, as the place grows', () => {
    for (let t = 2; t <= TIERS.length; t++) {
      expect(stockPool(t).length).toBeGreaterThan(stockPool(t - 1).length);
      for (const id of stockPool(t - 1)) expect(stockPool(t)).toContain(id);
    }
    const small = at(0).st;
    const big = at(TIERS[3].standing).st;
    expect(big.stock.length).toBeGreaterThan(small.stock.length);
    const best = Math.max(...big.stock.map(priceOf));
    expect(best).toBeGreaterThan(Math.max(...small.stock.map(priceOf)));
  });

  it('restocks daily and holds at most two of a consumable, one of anything else', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { st } = at(TIERS[3].standing, seed);
      for (const id of new Set(st.stock)) {
        const n = st.stock.filter((x) => x === id).length;
        expect(n, `${id} x${n}`).toBeLessThanOrEqual(ITEMS[id]?.kind === 'small' ? 2 : 1);
      }
    }
    const { w, st } = at(0);
    const before = [...st.stock];
    refreshSettlement(w, st);
    expect(st.stock).toEqual(before);
    w.day = dayOf(w) + 1;
    refreshSettlement(w, st);
    expect(st.stockDay).toBe(dayOf(w));
  });

  it('sells you something and takes the scrap for it', () => {
    const { w, st } = at();
    const id = st.stock[0];
    const cost = costOf(st, id);
    const shelfWas = st.stock.length;
    w.scrap = cost;
    expect(buyItem(w, st, 0).ok).toBe(true);
    expect(w.scrap).toBe(0);
    expect(ensureStores(w).stash).toContain(id);
    expect(st.stock).toHaveLength(shelfWas - 1); // the one you bought came off the shelf
    expect(buyItem(w, st, 0)).toMatchObject({ ok: false }); // no scrap left
    expect(buyItem(w, st, 99)).toMatchObject({ ok: false });
  });

  it('buys from you at a fraction of list, and will not touch remains', () => {
    const { w, st } = at();
    w.scrap = 0;
    const stores = ensureStores(w);
    stores.stash.push('machete', 'remains');
    expect(sellItem(w, st, 0).ok).toBe(true);
    expect(w.scrap).toBe(sellValue('machete'));
    expect(sellValue('machete')).toBeLessThan(priceOf('machete'));
    expect(Math.round(priceOf('machete') * SELL_RATE)).toBe(sellValue('machete'));
    expect(sellable('remains')).toBe(false);
    expect(sellItem(w, st, 0)).toMatchObject({ ok: false });
    expect(sellItem(w, st, 9)).toMatchObject({ ok: false });
  });
});

describe('training', () => {
  it('needs the guild open, and the tier for the better sessions', () => {
    const { w, st } = at(0);
    const who = livingSquad(w.roster)[0].id;
    w.scrap = 9999;
    expect(trainMember(w, st, who, 'spar')).toMatchObject({ ok: false });
    st.standing = TIERS[1].standing;
    expect(trainMember(w, st, who, 'spar').ok).toBe(true);
    expect(trainMember(w, st, who, 'hard')).toMatchObject({ ok: false });
    st.standing = TIERS[3].standing;
    expect(trainMember(w, st, who, 'hard').ok).toBe(true);
    for (const t of TRAINING) expect(t.cost).toBeGreaterThan(0);
  });

  it('spends scrap and pays experience to the one who trained, nobody else', () => {
    const { w, st } = at(TIERS[1].standing);
    w.scrap = 100;
    const [a, b] = livingSquad(w.roster);
    const otherWas = b.xp;
    const r = trainMember(w, st, a.id, 'spar');
    expect(r.ok).toBe(true);
    expect(w.scrap).toBe(100 - TRAINING[0].cost);
    expect(a.xp + a.level * 1000).toBeGreaterThan(0);
    expect(b.xp).toBe(otherWas);
  });

  it('is capped per day and resets with the day', () => {
    const { w, st } = at(TIERS[1].standing);
    w.scrap = 9999;
    const who = livingSquad(w.roster)[0].id;
    expect(trainingLeft(w, st)).toBe(TRAIN_PER_DAY);
    for (let i = 0; i < TRAIN_PER_DAY; i++) expect(trainMember(w, st, who, 'spar').ok).toBe(true);
    expect(trainingLeft(w, st)).toBe(0);
    expect(trainMember(w, st, who, 'spar')).toMatchObject({ ok: false });
    w.day = dayOf(w) + 1;
    expect(trainingLeft(w, st)).toBe(TRAIN_PER_DAY);
    expect(trainMember(w, st, who, 'spar').ok).toBe(true);
  });

  it('refuses without the scrap, and refuses the dead', () => {
    const { w, st } = at(TIERS[1].standing);
    const who = livingSquad(w.roster)[0].id;
    w.scrap = 0;
    expect(trainMember(w, st, who, 'spar')).toMatchObject({ ok: false });
    w.scrap = 500;
    w.roster[1].dead = true;
    expect(trainMember(w, st, w.roster[1].id, 'spar')).toMatchObject({ ok: false });
    expect(trainMember(w, st, 'nobody', 'spar')).toMatchObject({ ok: false });
    expect(trainMember(w, st, who, 'nonsense')).toMatchObject({ ok: false });
  });
});

describe('houses', () => {
  it('are not for sale until the place is a village', () => {
    const { w, st } = at(0);
    w.scrap = 9999;
    expect(buyHouse(w, st, 'bunk')).toMatchObject({ ok: false });
    st.standing = TIERS[2].standing;
    expect(buyHouse(w, st, 'bunk').ok).toBe(true);
    expect(houseOf(st)?.id).toBe('bunk');
  });

  it('costs scrap, and the best one needs a town', () => {
    const { w, st } = at(TIERS[2].standing);
    w.scrap = HOUSES[0].cost;
    expect(buyHouse(w, st, 'bunk').ok).toBe(true);
    expect(w.scrap).toBe(0);
    st.house = undefined;
    w.scrap = 9999;
    expect(buyHouse(w, st, 'house')).toMatchObject({ ok: false }); // needs a town
    st.standing = TIERS[3].standing;
    expect(buyHouse(w, st, 'house').ok).toBe(true);
  });

  it('trades the old one in when you move up, and will not sell you a downgrade', () => {
    const { w, st } = at(TIERS[3].standing);
    w.scrap = 9999;
    buyHouse(w, st, 'cabin');
    const cabin = HOUSES.find((h) => h.id === 'cabin')!;
    const better = HOUSES.find((h) => h.id === 'house')!;
    expect(houseCost(st, better)).toBe(better.cost - Math.round(cabin.cost * 0.5));
    const before = w.scrap;
    expect(buyHouse(w, st, 'house').ok).toBe(true);
    expect(before - w.scrap).toBe(better.cost - Math.round(cabin.cost * 0.5));
    expect(buyHouse(w, st, 'bunk')).toMatchObject({ ok: false });
    expect(buyHouse(w, st, 'house')).toMatchObject({ ok: false }); // you live there
    expect(buyHouse(w, st, 'mansion')).toMatchObject({ ok: false });
  });

  it('are worth having: a discount at the store and faster mending', () => {
    const { w, st } = at(TIERS[3].standing);
    expect(discountOf(st)).toBe(0);
    expect(restBonusOf(st)).toBe(0);
    w.scrap = 9999;
    buyHouse(w, st, 'house');
    const h = houseOf(st)!;
    expect(discountOf(st)).toBe(h.discount);
    expect(restBonusOf(st)).toBe(h.heal);
    expect(costOf(st, 'machete')).toBeLessThan(priceOf('machete'));

    // a night in your own bed takes more off an injury than a night in a tent
    const hurt = livingSquad(w.roster)[0];
    hurt.injuries = [{ id: 'torn-tendon', left: 6 }];
    morning(w, 'home', undefined, restBonusOf(st));
    expect(hurt.injuries[0].left).toBe(6 - (2 + h.heal));
  });

  it('every house is sane and they get better down the list', () => {
    for (let i = 1; i < HOUSES.length; i++) {
      expect(HOUSES[i].cost).toBeGreaterThan(HOUSES[i - 1].cost);
      expect(HOUSES[i].heal + HOUSES[i].discount).toBeGreaterThanOrEqual(HOUSES[i - 1].heal + HOUSES[i - 1].discount);
      expect(HOUSES[i].tier).toBeGreaterThanOrEqual(HOUSES[i - 1].tier);
    }
  });
});

describe('the people', () => {
  it('will only talk to you once the place is big enough', () => {
    const { st } = at(0);
    const early = peopleAt(st);
    expect(early.length).toBeGreaterThan(0);
    st.standing = TIERS[3].standing;
    expect(peopleAt(st).length).toBeGreaterThan(early.length);
    for (const n of peopleAt(st)) expect(settlementDef(st.id)?.npcs).toContain(n.id);
  });
});

describe('standing from the world', () => {
  it('a cleared site is worth something to everyone living here', () => {
    const { st } = at(0);
    addStanding(st, SITE_CLEAR_STANDING * 3);
    expect(st.standing).toBe(SITE_CLEAR_STANDING * 3);
    expect(SITE_CLEAR_STANDING).toBeGreaterThan(0);
  });

  it('getting to a village is a real amount of work, not an afternoon', () => {
    const { st } = at(0);
    // board jobs pay roughly 5-20 standing: a village should take the best part of ten of them
    expect(TIERS[2].standing / 20).toBeGreaterThanOrEqual(3);
    expect(tierOf(st)).toBe(1);
  });

  it('survives a save and reload as plain data', () => {
    const { w, st } = at(TIERS[2].standing);
    w.scrap = 500;
    buyHouse(w, st, 'bunk');
    give(st, { id: 'keep', need: 2, done: 1 });
    const back = JSON.parse(JSON.stringify(w)) as typeof w;
    const copy = back.settlements![SITE];
    expect(copy.standing).toBe(st.standing);
    expect(copy.house).toBe('bunk');
    expect(copy.active[0]).toMatchObject({ id: 'keep', done: 1 });
    expect(tierOf(copy)).toBe(tierOf(st));
    expect(effectiveStats(back.roster[0]).hp).toBeGreaterThan(0);
  });
});

describe('donations are a poor way to buy standing', () => {
  it('pays far less standing per point of effort than doing the work', () => {
    const board = rollBoard({ rngState: 4 }, {
      sites: [{ id: 'hull', name: 'Hull', difficulty: 2 }],
      regions: [],
      wants: [],
      itemName: (id) => id,
      tier: 2,
      day: 1,
      count: 5,
    });
    const donate = board.find((m) => m.kind === 'supply');
    const clear = board.find((m) => m.kind === 'clear');
    expect(donate).toBeTruthy();
    expect(clear).toBeTruthy();
    // a donation worth more scrap than the clear pays should still be worth less standing
    expect(donate!.standing).toBeLessThan(clear!.standing);
    expect(donate!.standing).toBeGreaterThanOrEqual(2);
    expect(Math.round(donate!.need / DONATION_PER_STANDING)).toBeLessThanOrEqual(donate!.standing);
  });

  it('cannot buy a village out of a big pile of scrap in one go', () => {
    const { w, st } = at(0);
    w.scrap = 500;
    const m = give(st, { kind: 'supply', need: 40, scrap: 0, standing: Math.max(2, Math.round(40 / DONATION_PER_STANDING)) });
    expect(deliver(w, st, m.id).ok).toBe(true);
    reportMission(w, st, m.id);
    expect(tierOf(st)).toBe(1); // nowhere near a village
    expect(st.standing).toBeLessThan(TIERS[1].standing);
  });
});
