import { rand, type RngHolder } from '../engine';
import type { ItemId } from '../engine';

/**
 * Work the settlements hand out, and the people who hand it out.
 *
 * Pure data and arithmetic: generation takes the world's facts as arguments rather than reading the
 * world, so it is trivially testable and a second settlement needs no new code. `settlement.ts` owns
 * the state these live in; this file knows nothing about it.
 *
 * Progress arrives through `recordClear`, `recordWin` and `recordKills`, which the world calls when
 * something happens, and through `handIn`, for the ones you carry back yourself.
 */

export type MissionKind =
  /** take a named hostile site off the map */
  | 'clear'
  /** put down this many rivals, anywhere */
  | 'cull'
  /** hand over this much scrap */
  | 'supply'
  /** bring them this many of an item */
  | 'fetch'
  /** win a fight in a named region */
  | 'patrol';

export const MISSION_KINDS: readonly MissionKind[] = ['clear', 'cull', 'supply', 'fetch', 'patrol'];

/** The ones you finish by walking back in and handing something over. */
export const isHandIn = (kind: MissionKind): boolean => kind === 'supply' || kind === 'fetch';

export interface Mission {
  id: string;
  kind: MissionKind;
  title: string;
  blurb: string;
  /** site id, region id or item id, depending on the kind */
  target?: string;
  /** readable name of the target, kept on the mission so the UI needs no lookups */
  targetName?: string;
  /** how much is needed */
  need: number;
  /** how much is done */
  done: number;
  scrap: number;
  standing: number;
  xp: number;
  /** a one-off reward handed over with the scrap */
  item?: ItemId;
  /** the NPC who posted it; absent for board work */
  from?: string;
  /** story work: fixed, written, and part of a chain */
  story?: boolean;
  /** story work only: the mission id that has to be done first */
  after?: string;
  /** the settlement tier needed before it appears */
  tier?: number;
  /** shown when it is handed in */
  outro?: string;
}

export const isComplete = (m: Mission): boolean => m.done >= m.need;

/** How far along, 0-1. */
export const progress = (m: Mission): number => Math.max(0, Math.min(1, m.need === 0 ? 1 : m.done / m.need));

/** One line of what is left to do. */
export function missionStatus(m: Mission): string {
  if (isComplete(m)) return isHandIn(m.kind) ? 'Ready to hand over' : 'Done: report back';
  switch (m.kind) {
    case 'clear':
      return `${m.targetName ?? 'the site'} still stands`;
    case 'patrol':
      return `No fight won in ${m.targetName ?? 'the area'} yet`;
    case 'cull':
      return `${m.done}/${m.need} put down`;
    case 'supply':
      return `${m.done}/${m.need} scrap delivered`;
    case 'fetch':
      return `${m.done}/${m.need} ${m.targetName ?? 'item'} delivered`;
  }
}

// ---------- the people who post the real work ----------

export interface Npc {
  id: string;
  name: string;
  role: string;
  /** the settlement tier at which they will talk to you */
  tier: number;
  blurb: string;
}

/**
 * The faces of the Survivors' Camp. Three is enough to carry a chain; the names and roles are
 * placeholders for a plot, and the missions attached to them are the hooks.
 */
export const NPCS: Npc[] = [
  { id: 'marla', name: 'Marla', role: 'Camp organiser', tier: 1, blurb: 'Ran the ship’s student council. Now she runs the board, the rations and the arguments.' },
  { id: 'deke', name: 'Deke', role: 'Quartermaster', tier: 2, blurb: 'Counts everything twice. Knows exactly what the camp is short of, and says so.' },
  { id: 'ivy', name: 'Ivy', role: 'Scout', tier: 3, blurb: 'Goes out further than anyone and comes back quieter each time.' },
];

export const npcById = (id: string): Npc | undefined => NPCS.find((n) => n.id === id);

/**
 * The written work. A chain: each one waits for the one before it and for the camp to be big enough
 * to care. Drop a plot in here and it arrives in the game with no other changes.
 */
export const STORY_MISSIONS: Mission[] = [
  {
    id: 'story-marla-1',
    kind: 'clear',
    title: 'The hut in the trees',
    blurb: 'Marla: "Someone has been living in that hut up in the forest, and watching us. Find out who, and make it stop."',
    target: 'hut',
    targetName: 'Forest Hut',
    need: 1,
    done: 0,
    scrap: 25,
    standing: 20,
    xp: 15,
    from: 'marla',
    story: true,
    tier: 1,
    outro: 'Marla turns the thing you brought back over in her hands for a long time and does not explain it.',
  },
  {
    id: 'story-deke-1',
    kind: 'clear',
    title: 'Whoever is on the bridge road',
    blurb: 'Deke: "Every run we send north comes back short. Someone is sitting on the road at the old ruins. Clear them off it."',
    target: 'ruins',
    targetName: 'Wildlands Ruins',
    need: 1,
    done: 0,
    scrap: 30,
    standing: 22,
    xp: 15,
    item: 'hikingpack',
    from: 'deke',
    story: true,
    tier: 2,
    after: 'story-marla-1',
    outro: 'Deke counts what you brought in twice, then hands you a pack without being asked.',
  },
  {
    id: 'story-ivy-1',
    kind: 'clear',
    title: 'What Ivy saw at the caves',
    blurb: 'Ivy: "I got close enough to the mountain caves to hear them. They are not another school. Go and look, and come back."',
    target: 'mcaves',
    targetName: 'Mountain Caves',
    need: 1,
    done: 0,
    scrap: 50,
    standing: 30,
    xp: 25,
    from: 'ivy',
    story: true,
    tier: 3,
    after: 'story-deke-1',
    outro: 'Ivy listens to the whole account without interrupting, then says the camp needs to hear it. Not yet, though.',
  },
];

/** The story missions a settlement will offer right now: in chain order, tier reached, previous one done. */
export function storyOffers(tier: number, doneIds: readonly string[], activeIds: readonly string[]): Mission[] {
  return STORY_MISSIONS.filter(
    (m) => (m.tier ?? 1) <= tier && !doneIds.includes(m.id) && !activeIds.includes(m.id) && (!m.after || doneIds.includes(m.after)),
  ).map((m) => ({ ...m }));
}

// ---------- the board ----------

export interface BoardSite {
  id: string;
  name: string;
  difficulty: number;
}

export interface BoardRegion {
  id: string;
  name: string;
  danger: number;
}

export interface BoardOptions {
  /** hostile sites still standing: the only ones worth posting a clear for */
  sites: readonly BoardSite[];
  /** regions worth patrolling */
  regions: readonly BoardRegion[];
  /** items the camp will ask you to bring */
  wants: readonly ItemId[];
  /** readable names for those items */
  itemName: (id: ItemId) => string;
  /** the settlement's tier: bigger camps ask for more and pay better */
  tier: number;
  /** which day it is, for mission ids */
  day: number;
  /** how many to post */
  count?: number;
}

const pick = <T,>(rng: RngHolder, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rand(rng) * list.length))];

/** Scrap handed over per point of standing. Deliberately poor value next to doing the work. */
export const DONATION_PER_STANDING = 8;

/** Scrap and standing scale with how much is being asked. */
const payFor = (effort: number, tier: number): { scrap: number; standing: number; xp: number } => ({
  scrap: Math.round(effort * (4 + tier)),
  standing: Math.max(3, Math.round(effort * 3)),
  xp: Math.round(effort * 4),
});

/**
 * Draw a mission board. Deterministic for a given rng state, so the same day always posts the same
 * work, and a save reloaded mid-day does not reshuffle it.
 */
export function rollBoard(rng: RngHolder, opts: BoardOptions): Mission[] {
  const count = opts.count ?? Math.min(5, 2 + opts.tier);
  const out: Mission[] = [];
  const kinds: MissionKind[] = [];
  if (opts.sites.length > 0) kinds.push('clear');
  if (opts.regions.length > 0) kinds.push('patrol');
  if (opts.wants.length > 0) kinds.push('fetch');
  kinds.push('cull', 'supply');

  let guard = 40;
  while (out.length < count && guard-- > 0) {
    const kind = pick(rng, kinds);
    const n = out.length;
    const id = `m${opts.day}-${n}-${kind}`;
    if (out.some((m) => m.id === id)) continue;

    if (kind === 'clear') {
      const site = pick(rng, opts.sites);
      if (out.some((m) => m.kind === 'clear' && m.target === site.id)) continue;
      const pay = payFor(2 + site.difficulty * 1.5, opts.tier);
      out.push({
        id,
        kind,
        title: `Clear ${site.name}`,
        blurb: `${site.name} is a problem for everyone on this side of the island. Take it off the map.`,
        target: site.id,
        targetName: site.name,
        need: 1,
        done: 0,
        ...pay,
      });
    } else if (kind === 'patrol') {
      const region = pick(rng, opts.regions);
      if (out.some((m) => m.kind === 'patrol' && m.target === region.id)) continue;
      const pay = payFor(1.5 + region.danger, opts.tier);
      out.push({
        id,
        kind,
        title: `Patrol ${region.name}`,
        blurb: `Show whoever is out in ${region.name} that this camp is not an easy mark. Win a fight there.`,
        target: region.id,
        targetName: region.name,
        need: 1,
        done: 0,
        ...pay,
      });
    } else if (kind === 'fetch') {
      const item = pick(rng, opts.wants);
      if (out.some((m) => m.kind === 'fetch' && m.target === item)) continue;
      const need = 1 + Math.floor(rand(rng) * (1 + opts.tier));
      const name = opts.itemName(item);
      const pay = payFor(need * 1.2, opts.tier);
      out.push({
        id,
        kind,
        title: `${need} x ${name}`,
        blurb: `The camp is short of ${name.toLowerCase()}. Bring what you can spare.`,
        target: item,
        targetName: name,
        need,
        done: 0,
        ...pay,
      });
    } else if (kind === 'cull') {
      if (out.some((m) => m.kind === 'cull')) continue;
      const need = 2 + Math.floor(rand(rng) * (2 + opts.tier));
      const pay = payFor(need * 0.9, opts.tier);
      out.push({
        id,
        kind,
        title: `Put down ${need} rivals`,
        blurb: 'Thin them out. It does not matter whose school they are from.',
        need,
        done: 0,
        ...pay,
      });
    } else {
      if (out.some((m) => m.kind === 'supply')) continue;
      const need = 10 + Math.floor(rand(rng) * 10) * (1 + opts.tier);
      out.push({
        id,
        kind,
        title: `Donate ${need} scrap`,
        blurb: 'Nails, wire, tin, anything. The camp will put it to use.',
        need,
        done: 0,
        scrap: 0, // you are giving, not getting
        // scrap is the easiest thing on the island to come by, so it buys standing slowly: the camp
        // grows because of what you do for it, not what you can afford to hand over
        standing: Math.max(2, Math.round(need / DONATION_PER_STANDING)),
        xp: Math.round(need * 0.3),
      });
    }
  }
  return out;
}

// ---------- progress ----------

/** A site came off the map: advance anything that wanted it gone. Returns the ones that finished. */
export function recordClear(active: readonly Mission[], siteId: string): Mission[] {
  const hit = active.filter((m) => m.kind === 'clear' && m.target === siteId && !isComplete(m));
  for (const m of hit) m.done = m.need;
  return hit;
}

/** A fight was won in a region: advance patrols there. */
export function recordWin(active: readonly Mission[], regionId: string): Mission[] {
  const hit = active.filter((m) => m.kind === 'patrol' && m.target === regionId && !isComplete(m));
  for (const m of hit) m.done = m.need;
  return hit;
}

/** Rivals were put down: advance culls, and return the ones that have now finished. */
export function recordKills(active: readonly Mission[], count: number): Mission[] {
  if (count <= 0) return [];
  const finished: Mission[] = [];
  for (const m of active) {
    if (m.kind !== 'cull' || isComplete(m)) continue;
    m.done = Math.min(m.need, m.done + count);
    if (isComplete(m)) finished.push(m);
  }
  return finished;
}

export interface HandInResult {
  ok: boolean
  msg: string;
  /** scrap taken off the player (a supply run) */
  scrapSpent?: number;
  /** items taken out of the stash (a fetch) */
  itemsSpent?: ItemId[];
}

/**
 * Hand over what a supply or fetch mission asked for, taking as much as is available. Pure: the
 * caller applies `scrapSpent` and `itemsSpent`. Anything else is finished out in the world.
 */
export function handIn(m: Mission, have: { scrap: number; stash: readonly ItemId[] }): HandInResult {
  if (isComplete(m)) return { ok: false, msg: 'Already done.' };
  if (m.kind === 'supply') {
    const want = m.need - m.done;
    const give = Math.min(want, have.scrap);
    if (give <= 0) return { ok: false, msg: 'Nothing to give.' };
    m.done += give;
    return { ok: true, msg: `Handed over ${give} scrap.`, scrapSpent: give };
  }
  if (m.kind === 'fetch') {
    const want = m.need - m.done;
    const matching = have.stash.filter((id) => id === m.target).slice(0, want);
    if (matching.length === 0) return { ok: false, msg: `No ${m.targetName ?? 'item'} in the stash.` };
    m.done += matching.length;
    return { ok: true, msg: `Handed over ${matching.length} x ${m.targetName ?? 'item'}.`, itemsSpent: matching };
  }
  return { ok: false, msg: 'That is finished out in the world, not here.' };
}
