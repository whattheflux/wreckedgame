import { ITEMS, addXp, effectiveStats, livingSquad, rand, type ItemId, type RosterMember } from '../engine';
import { WORLD, type Site } from './world';
import { dayOf } from './camp';
import { ensureStores } from './spoils';
import {
  NPCS,
  handIn,
  isComplete,
  isHandIn,
  rollBoard,
  storyOffers,
  type BoardRegion,
  type BoardSite,
  type Mission,
  type Npc,
} from './missions';
import type { WorldState } from './world';

/**
 * Settlements: places other people live, which you earn a position in rather than build.
 *
 * A settlement grows through *standing*, which you get by doing its work. Each tier opens more of
 * the place up: the store stocks better, the training guild opens, houses go up for sale, and the
 * people who matter start talking to you. Nothing here is the player's to construct.
 *
 * All of it is plain JSON on `world.settlements`, created on demand, so an older save just works.
 */

export interface SettlementDef {
  /** the site id it sits on */
  id: string;
  name: string;
  /** what the place is, before you have done anything for it */
  intro: string;
  /** who lives here */
  npcs: string[];
  /** what they will ask you to bring them */
  wants: ItemId[];
}

/** Every settlement on the island. Adding another is an entry here plus a site in the world data. */
export const SETTLEMENTS: Record<string, SettlementDef> = {
  camp: {
    id: 'camp',
    name: "Survivors' Camp",
    intro: 'Tarpaulins over deck chairs, a cooking fire, and about thirty kids who got off the ship and stopped running.',
    npcs: ['marla', 'deke', 'ivy'],
    wants: ['bandage', 'energybar', 'waterbottle', 'firecracker'],
  },
};

export const settlementDef = (siteId: string): SettlementDef | undefined => SETTLEMENTS[siteId];
export const isSettlement = (site: Site | null | undefined): boolean => !!site && !!SETTLEMENTS[site.id];

// ---------- tiers ----------

export interface TierDef {
  tier: number;
  name: string;
  /** standing needed to reach it */
  standing: number;
  blurb: string;
}

export const TIERS: readonly TierDef[] = [
  { tier: 1, name: 'Shanty', standing: 0, blurb: 'A board nailed to a post and someone sharing out tins.' },
  { tier: 2, name: 'Camp', standing: 25, blurb: 'Proper tents, a store worth the name, and somewhere to train.' },
  { tier: 3, name: 'Village', standing: 75, blurb: 'Walls, a gate, and space going spare: they will sell you somewhere to live.' },
  { tier: 4, name: 'Town', standing: 160, blurb: 'The only real place left on the island, and you are part of why.' },
];

/** What a settlement offers. Each opens at a tier. */
export type Facility = 'board' | 'store' | 'training' | 'houses' | 'people';

export const FACILITY: Record<Facility, { label: string; tier: number; blurb: string }> = {
  board: { label: 'Mission guild', tier: 1, blurb: 'Work going, posted on the board.' },
  store: { label: 'Store', tier: 1, blurb: 'Whatever they can spare, for scrap.' },
  training: { label: 'Training guild', tier: 2, blurb: 'Someone who will knock your squad into shape, for a price.' },
  houses: { label: 'Houses', tier: 3, blurb: 'Somewhere of your own, once they trust you with a key.' },
  people: { label: 'People', tier: 1, blurb: 'The ones who run the place.' },
};

export const FACILITY_IDS = Object.keys(FACILITY) as Facility[];

// ---------- the store ----------

/** What the store charges. Anything missing falls back by kind, so a new item never breaks the shop. */
export const PRICES: Record<ItemId, number> = {
  // weapons
  stick: 3,
  sharpStick: 5,
  sandSock: 6,
  rollingPin: 7,
  slingshot: 8,
  humanBone: 9,
  fryingPan: 10,
  torch: 11,
  pipe: 12,
  pole: 12,
  knife: 14,
  javelin: 16,
  weightedClub: 18,
  crudeSword: 20,
  flareGun: 22,
  nailBat: 24,
  machete: 28,
  poisonDagger: 30,
  fireAxe: 34,
  // worn
  uniform: 2,
  trousers: 2,
  sneakers: 2,
  cap: 4,
  hoodie: 6,
  boots: 8,
  shinguards: 10,
  helmet: 14,
  lifejacket: 14,
  letterman: 16,
  runners: 12,
  // packs
  schoolbag: 10,
  hikingpack: 26,
  // small
  energybar: 3,
  waterbottle: 3,
  bandage: 5,
  firecracker: 6,
};

const FALLBACK_PRICE: Record<string, number> = { weapon: 12, armor: 6, pack: 12, small: 4, remains: 0 };

/** List price before any resident's discount. */
export const priceOf = (id: ItemId): number => PRICES[id] ?? FALLBACK_PRICE[ITEMS[id]?.kind ?? ''] ?? 5;

/** What they will give you for one. */
export const SELL_RATE = 0.4;
export const sellValue = (id: ItemId): number => Math.max(1, Math.round(priceOf(id) * SELL_RATE));

/** They will not take what is left of a person. */
export const sellable = (id: ItemId): boolean => ITEMS[id]?.kind !== 'remains';

/** What each tier will stock, on top of everything the tiers below it stock. */
export const STOCK_BY_TIER: Record<number, ItemId[]> = {
  1: ['bandage', 'energybar', 'waterbottle', 'stick', 'sharpStick', 'uniform', 'trousers', 'sneakers'],
  2: ['knife', 'cap', 'hoodie', 'runners', 'schoolbag', 'firecracker', 'sandSock', 'rollingPin', 'fryingPan', 'pipe', 'slingshot'],
  3: ['helmet', 'letterman', 'shinguards', 'boots', 'lifejacket', 'crudeSword', 'nailBat', 'weightedClub', 'javelin', 'pole', 'hikingpack'],
  4: ['machete', 'poisonDagger', 'fireAxe', 'flareGun', 'torch'],
};

/** Everything a settlement of this tier could have on the shelf. */
export const stockPool = (tier: number): ItemId[] => Array.from({ length: tier }, (_, i) => STOCK_BY_TIER[i + 1] ?? []).flat();

export const stockSize = (tier: number): number => 4 + tier * 2;

// ---------- training ----------

export interface TrainingDef {
  id: string;
  name: string;
  tier: number;
  cost: number;
  xp: number;
  blurb: string;
}

/**
 * Training buys experience, never attribute or combat points directly: levelling stays the only
 * place those come from, so no amount of scrap can take the progression curve apart.
 */
export const TRAINING: readonly TrainingDef[] = [
  { id: 'spar', name: 'Sparring', tier: 2, cost: 12, xp: 20, blurb: 'An afternoon of getting knocked over by someone who knows how.' },
  { id: 'drill', name: 'Drills', tier: 3, cost: 32, xp: 55, blurb: 'Formation, footwork, and throwing until your arm gives out.' },
  { id: 'hard', name: 'Hard lessons', tier: 4, cost: 75, xp: 140, blurb: 'A week with the people who held the gate. You will not enjoy it.' },
];

export const trainingById = (id: string): TrainingDef | undefined => TRAINING.find((t) => t.id === id);

/** Sessions anyone can take in a day, across the whole squad. */
export const TRAIN_PER_DAY = 3;

// ---------- houses ----------

export interface HouseDef {
  id: string;
  name: string;
  tier: number;
  cost: number;
  /** extra days of injury healing for a night slept here */
  heal: number;
  /** taken off the store's prices, 0-1 */
  discount: number;
  blurb: string;
}

export const HOUSES: readonly HouseDef[] = [
  { id: 'bunk', name: 'Bunk in the long hut', tier: 3, cost: 60, heal: 1, discount: 0, blurb: 'A mattress, a shelf, and a curtain. It is yours.' },
  { id: 'cabin', name: 'Driftwood cabin', tier: 3, cost: 170, heal: 1, discount: 0.1, blurb: 'One room, a door that shuts, and a reputation as a resident.' },
  { id: 'house', name: 'Hull-plate house', tier: 4, cost: 360, heal: 2, discount: 0.15, blurb: 'Welded plate, a real roof, and a stove. People knock before coming in.' },
];

export const houseById = (id: string): HouseDef | undefined => HOUSES.find((h) => h.id === id);

// ---------- state ----------

export interface SettlementState {
  id: string;
  /** how much they reckon they owe you */
  standing: number;
  /** work on the board right now */
  board: Mission[];
  /** the day the board was drawn */
  boardDay: number;
  /** work you have taken on */
  active: Mission[];
  /** ids of everything finished here */
  doneIds: string[];
  /** what is on the shelf */
  stock: ItemId[];
  stockDay: number;
  /** the house you own here, if any */
  house?: string;
  /** training sessions used, and the day they were used */
  trainDay?: number;
  trainUsed?: number;
}

/** Most jobs you can carry at once. */
export const MAX_ACTIVE = 3;

/** Standing for taking a hostile site off the map, per point of its difficulty. */
export const SITE_CLEAR_STANDING = 2;

export const tierOf = (st: SettlementState): number => TIERS.reduce((t, d) => (st.standing >= d.standing ? d.tier : t), 1);
export const tierDef = (tier: number): TierDef => TIERS.find((t) => t.tier === tier) ?? TIERS[0];
export const nextTierDef = (st: SettlementState): TierDef | null => TIERS.find((t) => t.tier === tierOf(st) + 1) ?? null;

/** Standing still needed for the next tier, or null at the top. */
export function standingToNext(st: SettlementState): number | null {
  const next = nextTierDef(st);
  return next ? Math.max(0, next.standing - st.standing) : null;
}

export const facilityOpen = (st: SettlementState, f: Facility): boolean => tierOf(st) >= FACILITY[f].tier;

/** The house they live in here, if any. */
export const houseOf = (st: SettlementState): HouseDef | undefined => (st.house ? houseById(st.house) : undefined);
export const discountOf = (st: SettlementState): number => houseOf(st)?.discount ?? 0;
/** Extra days of injury healing for a night spent at this settlement. */
export const restBonusOf = (st: SettlementState): number => houseOf(st)?.heal ?? 0;

/** What you actually pay, after any resident's discount. */
export const costOf = (st: SettlementState, id: ItemId): number => Math.max(1, Math.round(priceOf(id) * (1 - discountOf(st))));

export const trainingLeft = (w: WorldState, st: SettlementState): number => (st.trainDay === dayOf(w) ? Math.max(0, TRAIN_PER_DAY - (st.trainUsed ?? 0)) : TRAIN_PER_DAY);

/** The settlement's state, created the first time anybody asks for it. */
export function ensureSettlement(w: WorldState, id: string): SettlementState {
  w.settlements ??= {};
  return (w.settlements[id] ??= { id, standing: 0, board: [], boardDay: 0, active: [], doneIds: [], stock: [], stockDay: 0 });
}

/** Every settlement the player has visited. */
export const visitedSettlements = (w: WorldState): SettlementState[] => Object.values(w.settlements ?? {});

// ---------- the daily refresh ----------

/** Hostile sites still standing: what a settlement will post a clear for. */
export function openSites(w: WorldState): BoardSite[] {
  return WORLD.sites.filter((s) => s.difficulty && !w.cleared[s.id]).map((s) => ({ id: s.id, name: s.name, difficulty: s.difficulty ?? 1 }));
}

export const boardRegions = (): BoardRegion[] => WORLD.regions.filter((r) => r.danger > 0).map((r) => ({ id: r.id, name: r.name, danger: r.danger }));

/**
 * Draw today's board and shelf if they have not been drawn yet. Story work is added on top of the
 * rolled board, so it is never crowded out by a bad roll.
 */
export function refreshSettlement(w: WorldState, st: SettlementState): void {
  const day = dayOf(w);
  const tier = tierOf(st);
  const def = settlementDef(st.id);
  if (st.boardDay !== day) {
    st.boardDay = day;
    st.board = rollBoard(w, {
      sites: openSites(w),
      regions: boardRegions(),
      wants: def?.wants ?? [],
      itemName: (id) => ITEMS[id]?.name ?? id,
      tier,
      day,
    });
  }
  // story work does not wait for a new day, and is dropped once taken or finished
  const offers = storyOffers(
    tier,
    st.doneIds,
    st.active.map((m) => m.id),
  ).filter((m) => (def ? def.npcs.includes(m.from ?? '') : true));
  st.board = [...st.board.filter((m) => !m.story), ...offers];

  if (st.stockDay !== day) {
    st.stockDay = day;
    const pool = stockPool(tier);
    const want = stockSize(tier);
    const picked: ItemId[] = [];
    let guard = 200;
    while (picked.length < want && pool.length > 0 && guard-- > 0) {
      const id = pool[Math.floor(rand(w) * pool.length)];
      // the shelf can hold two of a consumable, one of anything else
      const cap = ITEMS[id]?.kind === 'small' ? 2 : 1;
      if (picked.filter((x) => x === id).length < cap) picked.push(id);
    }
    st.stock = picked;
  }
}

// ---------- actions ----------

export interface ActionResult {
  ok: boolean;
  msg: string;
}

const no = (msg: string): ActionResult => ({ ok: false, msg });

/** Give the settlement standing, and say so when it grows. */
export function addStanding(st: SettlementState, amount: number): { grew: boolean; tier: number; note?: string } {
  const before = tierOf(st);
  st.standing = Math.max(0, st.standing + amount);
  const after = tierOf(st);
  if (after > before) {
    const d = tierDef(after);
    return { grew: true, tier: after, note: `${SETTLEMENTS[st.id]?.name ?? 'The settlement'} has grown into a ${d.name.toLowerCase()}. ${d.blurb}` };
  }
  return { grew: false, tier: after };
}

export function acceptMission(st: SettlementState, missionId: string): ActionResult {
  if (!facilityOpen(st, 'board')) return no('No board here yet.');
  const m = st.board.find((x) => x.id === missionId);
  if (!m) return no('That work is gone.');
  if (st.active.length >= MAX_ACTIVE) return no(`You are carrying ${MAX_ACTIVE} jobs already.`);
  if (st.active.some((x) => x.id === missionId)) return no('Already taken.');
  st.board = st.board.filter((x) => x.id !== missionId);
  st.active.push({ ...m });
  return { ok: true, msg: `Took on: ${m.title}.` };
}

/** Give a job back. Story work goes back on the board; board work is simply gone for the day. */
export function abandonMission(st: SettlementState, missionId: string): ActionResult {
  const m = st.active.find((x) => x.id === missionId);
  if (!m) return no('Not carrying that.');
  st.active = st.active.filter((x) => x.id !== missionId);
  if (!m.story) st.board.push({ ...m, done: 0 });
  return { ok: true, msg: `Gave back: ${m.title}.` };
}

/** Hand over the scrap or the goods a job asked for. */
export function deliver(w: WorldState, st: SettlementState, missionId: string): ActionResult {
  const m = st.active.find((x) => x.id === missionId);
  if (!m) return no('Not carrying that.');
  if (!isHandIn(m.kind)) return no('That one is finished out in the world.');
  const stores = ensureStores(w);
  const r = handIn(m, { scrap: w.scrap, stash: stores.stash });
  if (!r.ok) return no(r.msg);
  if (r.scrapSpent) w.scrap -= r.scrapSpent;
  for (const id of r.itemsSpent ?? []) {
    const i = stores.stash.indexOf(id);
    if (i >= 0) stores.stash.splice(i, 1);
  }
  return { ok: true, msg: r.msg };
}

export interface ReportResult extends ActionResult {
  /** lines for the world log */
  notes: string[];
}

/** Collect on a finished job: scrap, standing, experience for everyone still standing, and any reward. */
export function reportMission(w: WorldState, st: SettlementState, missionId: string): ReportResult {
  const m = st.active.find((x) => x.id === missionId);
  if (!m) return { ...no('Not carrying that.'), notes: [] };
  if (!isComplete(m)) return { ...no('Not finished yet.'), notes: [] };

  st.active = st.active.filter((x) => x.id !== missionId);
  st.doneIds.push(m.id);
  w.scrap += m.scrap;
  const notes: string[] = [`${m.title}: done.${m.scrap ? ` +${m.scrap} scrap.` : ''}`];
  if (m.outro) notes.push(m.outro);
  if (m.item) {
    ensureStores(w).stash.push(m.item);
    notes.push(`They hand over a ${ITEMS[m.item]?.name ?? m.item}.`);
  }
  for (const member of livingSquad(w.roster)) addXp(member, m.xp, w, notes);
  const grew = addStanding(st, m.standing);
  if (grew.note) notes.push(grew.note);
  return { ok: true, msg: notes[0], notes };
}

export function buyItem(w: WorldState, st: SettlementState, index: number): ActionResult {
  if (!facilityOpen(st, 'store')) return no('Nothing for sale here yet.');
  const id = st.stock[index];
  if (!id) return no('Gone already.');
  const cost = costOf(st, id);
  if (w.scrap < cost) return no(`Need ${cost} scrap.`);
  w.scrap -= cost;
  st.stock.splice(index, 1);
  ensureStores(w).stash.push(id);
  return { ok: true, msg: `Bought ${ITEMS[id]?.name ?? id} for ${cost} scrap.` };
}

export function sellItem(w: WorldState, st: SettlementState, stashIndex: number): ActionResult {
  if (!facilityOpen(st, 'store')) return no('Nobody here is buying yet.');
  const stores = ensureStores(w);
  const id = stores.stash[stashIndex];
  if (!id) return no('Nothing there.');
  if (!sellable(id)) return no('They will not touch that.');
  const value = sellValue(id);
  stores.stash.splice(stashIndex, 1);
  w.scrap += value;
  return { ok: true, msg: `Sold ${ITEMS[id]?.name ?? id} for ${value} scrap.` };
}

/** Put a squad member through a session. Costs scrap, pays experience, limited per day. */
export function trainMember(w: WorldState, st: SettlementState, memberId: string, trainingId: string): ReportResult {
  const t = trainingById(trainingId);
  if (!t) return { ...no('No such training.'), notes: [] };
  if (!facilityOpen(st, 'training')) return { ...no('No training guild here yet.'), notes: [] };
  if (tierOf(st) < t.tier) return { ...no(`${t.name} needs a ${tierDef(t.tier).name.toLowerCase()}.`), notes: [] };
  const member = livingSquad(w.roster).find((m) => m.id === memberId);
  if (!member) return { ...no('Nobody by that name.'), notes: [] };
  if (trainingLeft(w, st) <= 0) return { ...no('That is all the training they have time for today.'), notes: [] };
  if (w.scrap < t.cost) return { ...no(`Need ${t.cost} scrap.`), notes: [] };

  w.scrap -= t.cost;
  if (st.trainDay !== dayOf(w)) {
    st.trainDay = dayOf(w);
    st.trainUsed = 0;
  }
  st.trainUsed = (st.trainUsed ?? 0) + 1;
  const notes: string[] = [];
  addXp(member, t.xp, w, notes);
  const line = `${member.name} puts in a session of ${t.name.toLowerCase()} (-${t.cost} scrap).`;
  return { ok: true, msg: line, notes: [line, ...notes] };
}

export function buyHouse(w: WorldState, st: SettlementState, houseId: string): ActionResult {
  const h = houseById(houseId);
  if (!h) return no('No such place.');
  if (!facilityOpen(st, 'houses')) return no('They are not selling to outsiders yet.');
  if (tierOf(st) < h.tier) return no(`${h.name} needs a ${tierDef(h.tier).name.toLowerCase()}.`);
  const owned = houseOf(st);
  if (owned?.id === h.id) return no('You live there already.');
  if (owned && HOUSES.indexOf(owned) > HOUSES.indexOf(h)) return no('You already have somewhere better.');
  const cost = owned ? Math.max(1, h.cost - Math.round(owned.cost * 0.5)) : h.cost;
  if (w.scrap < cost) return no(`Need ${cost} scrap.`);
  w.scrap -= cost;
  st.house = h.id;
  return { ok: true, msg: owned ? `Moved up to ${h.name} for ${cost} scrap.` : `Bought ${h.name} for ${cost} scrap.` };
}

/** What it would cost this player to move into a house, allowing for trading the old one in. */
export function houseCost(st: SettlementState, h: HouseDef): number {
  const owned = houseOf(st);
  return owned && HOUSES.indexOf(owned) < HOUSES.indexOf(h) ? Math.max(1, h.cost - Math.round(owned.cost * 0.5)) : h.cost;
}

/** The people here who will talk to you at this tier. */
export function peopleAt(st: SettlementState): Npc[] {
  const def = settlementDef(st.id);
  const tier = tierOf(st);
  return NPCS.filter((n) => def?.npcs.includes(n.id) && n.tier <= tier);
}

/** A squad member the training guild would put forward: alive, and furthest from their next level. */
export function suggestTrainee(w: WorldState): RosterMember | undefined {
  return [...livingSquad(w.roster)].sort((a, b) => a.level - b.level || effectiveStats(a).hp - effectiveStats(b).hp)[0];
}
