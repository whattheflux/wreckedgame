import { allLoot, type GameState, type ItemId } from '../engine';

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
export function resolveSpoils(world: SpoilsHolder, spoils: Spoils, choice: SpoilsChoice): string[] {
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
      st.captives.push({ uid: `c${st.mercy.seq}`, name: p.name, role: p.role, ...(p.sprite ? { sprite: p.sprite } : {}) });
      notes.push(`${p.name} was taken captive.`);
    } else {
      st.mercy.spared.push({ name: p.name, role: p.role });
      notes.push(`${p.name} was let go.`);
    }
  }
  return notes;
}
