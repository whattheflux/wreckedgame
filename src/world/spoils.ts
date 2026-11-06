import { allLoot, giveInjury, type GameState, type Injury, type ItemId } from '../engine';
import { rand, type RngHolder } from '../engine/rng';

/**
 * The end of a won fight: whatever is still lying on the ground, and any rival left out cold. The player takes what
 * they want and decides each prisoner's fate. Camp-side handling of captives (workers, fighters, ransom...) comes later;
 * for now they are just kept.
 */

export interface Prisoner {
  id: string;
  name: string;
  role: string;
  sprite?: string;
}

export interface Captive {
  /** unique across the whole game, unlike a battle unit id */
  uid: string;
  name: string;
  role: string;
  sprite?: string;
  /** hurt in the fight or since; same injuries as the squad. Absent on older saves (treated as none). */
  injuries?: Injury[];
  /** what they are now: kept prisoner, or turned into a worker or a fighter */
  status?: 'captive' | 'worker' | 'fighter';
  /** 0-100: how hard they resist being turned. Starts high, drops when they are beaten. */
  defiance?: number;
  /** the camp day they last had something done to them (one thing a day) */
  actedDay?: number;
}

export type Disposition = 'execute' | 'capture' | 'release';

/** How the player has treated people; later stories (thanks, grudges) hang off this. */
export interface Mercy {
  spared: Array<{ name: string; role: string }>;
  executed: number;
  captured: number;
  /** rivals killed outright in fights */
  killed: number;
  /** counter for captive uids */
  seq: number;
  /** captives sold back for ransom */
  ransomed?: number;
  /** beatings, target practice and the like */
  cruelty?: number;
}

/** The part of the world the spoils touch (kept narrow so it is easy to test). */
export interface SpoilsHolder {
  stash?: ItemId[];
  captives?: Captive[];
  mercy?: Mercy;
}

export interface Spoils {
  loot: ItemId[];
  prisoners: Prisoner[];
  /** rivals who died in this fight */
  killed: number;
}

export const newMercy = (): Mercy => ({ spared: [], executed: 0, captured: 0, killed: 0, seq: 0 });

/** Fill in the fields older saves do not have. */
export function ensureStores(w: SpoilsHolder): Required<SpoilsHolder> {
  w.stash ??= [];
  w.captives ??= [];
  w.mercy ??= newMercy();
  return w as Required<SpoilsHolder>;
}

/** What a won battle leaves: nothing at all for a defeat or a retreat (you did not hold the field). */
export function collectSpoils(state: GameState): Spoils {
  if (state.winner !== 'player') return { loot: [], prisoners: [], killed: 0 };
  const rivals = state.units.filter((u) => u.team === 'enemy' && !u.alive);
  return {
    loot: allLoot(state),
    prisoners: rivals.filter((u) => u.fate === 'unconscious').map((u) => ({ id: u.id, name: u.name, role: u.role, ...(u.sprite ? { sprite: u.sprite } : {}) })),
    killed: rivals.filter((u) => u.fate === 'dead').length,
  };
}

export interface SpoilsChoice {
  /** indexes into `loot` that the squad takes; the rest stay behind */
  take: number[];
  /** a fate per prisoner id; anyone missing is let go */
  fates: Record<string, Disposition>;
}

/** Take everything; let every prisoner go. */
export const defaultChoice = (s: Spoils): SpoilsChoice => ({ take: s.loot.map((_, i) => i), fates: {} });

/** Apply the choices to the world and return the log lines. Executing someone leaves remains. */
/** Someone taken captive after being knocked out has this chance of coming round with an injury. */
export const CAPTIVE_HURT_CHANCE = 0.35;

export function resolveSpoils(world: SpoilsHolder, spoils: Spoils, choice: SpoilsChoice, rng?: RngHolder): string[] {
  const st = ensureStores(world);
  const notes: string[] = [];
  const taken = [...new Set(choice.take)].filter((i) => i >= 0 && i < spoils.loot.length).sort((a, b) => a - b);
  for (const i of taken) st.stash.push(spoils.loot[i]);
  if (taken.length > 0) notes.push(`Took ${taken.length} item${taken.length === 1 ? '' : 's'} from the field.`);
  st.mercy.killed += spoils.killed;

  for (const p of spoils.prisoners) {
    const fate = choice.fates[p.id] ?? 'release';
    if (fate === 'execute') {
      st.mercy.executed += 1;
      st.stash.push('remains');
      notes.push(`${p.name} was executed.`);
    } else if (fate === 'capture') {
      st.mercy.captured += 1;
      st.mercy.seq += 1;
      const injuries: Injury[] = [];
      const captive: Captive = { uid: `c${st.mercy.seq}`, name: p.name, role: p.role, ...(p.sprite ? { sprite: p.sprite } : {}), injuries, status: 'captive', defiance: 60 };
      if (rng && rand(rng) < CAPTIVE_HURT_CHANCE) giveInjury({ injuries }, rng);
      st.captives.push(captive);
      notes.push(`${p.name} was taken captive.`);
    } else {
      st.mercy.spared.push({ name: p.name, role: p.role });
      notes.push(`${p.name} was let go.`);
    }
  }
  return notes;
}
