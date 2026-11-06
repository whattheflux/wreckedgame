import { INJURIES, addXp, giveInjury, tickInjuries, effectiveStats, livingSquad, type InjuryId, type RosterMember } from '../engine';
import { rand, randInt } from '../engine/rng';
import { ensureStores, type Captive } from './spoils';
import type { WorldState } from './world';

/**
 * Making camp on the road: rest, mend, tend the wounded, deal with prisoners, and risk a night ambush. Pure logic on the
 * world (the screen just calls these and shows the result lines). Time is counted in days: every night is one.
 */

export const dayOf = (w: WorldState): number => (w.day ??= 1);

// ---------- the night ----------

/** Chance of an ambush in a night by region danger (0 = safe ground, 4 = the worst). */
export const AMBUSH_BY_DANGER = [0, 0.12, 0.2, 0.3, 0.4] as const;
/** Someone staying up to watch cuts it by this much (and does not get to heal that night). */
export const WATCH_FACTOR = 0.5;

export const ambushChance = (danger: number, watching: boolean): number => AMBUSH_BY_DANGER[Math.max(0, Math.min(4, danger))] * (watching ? WATCH_FACTOR : 1);

export type Morning = 'home' | 'quiet' | 'ambushed';

/** Share of max HP everyone recovers by morning. */
export const HEAL_SHARE: Record<Morning, number> = { home: 1, quiet: 0.6, ambushed: 0.3 };

export interface NightOptions {
  danger: number;
  /** a person staying up (an id from the roster) */
  watch?: string;
}

/** Does the night go badly? Always no on safe ground; one roll otherwise. */
export function rollAmbush(w: WorldState, opts: NightOptions): boolean {
  if (opts.danger <= 0) return false;
  return rand(w) < ambushChance(opts.danger, !!opts.watch);
}

/**
 * Morning comes: a day passes, everyone mends by `kind` (the watcher only half as much), healing injuries tick down
 * (twice as fast at home), prisoners recover too. Returns log lines.
 */
export function morning(w: WorldState, kind: Morning, watch?: string): string[] {
  const notes: string[] = [];
  w.day = dayOf(w) + 1;
  const days = kind === 'home' ? 2 : 1;
  for (const m of livingSquad(w.roster)) {
    const max = effectiveStats(m).hp;
    const share = m.id === watch ? HEAL_SHARE[kind] / 2 : HEAL_SHARE[kind];
    m.hp = Math.min(max, kind === 'home' && m.id !== watch ? max : m.hp + Math.max(1, Math.ceil(max * share)));
    tickInjuries(m, notes, days);
  }
  for (const c of ensureStores(w).captives) {
    if (c.injuries?.length) tickInjuries(prep(c), notes, days);
  }
  notes.push(kind === 'home' ? `Day ${w.day}: a full night's sleep at camp.` : kind === 'quiet' ? `Day ${w.day}: a quiet night.` : `Day ${w.day}: a rough night, barely any sleep.`);
  return notes;
}

// ---------- tending the wounded ----------

export interface ActionResult {
  ok: boolean;
  msg: string;
}
const no = (msg: string): ActionResult => ({ ok: false, msg });

export const bandages = (w: WorldState): number => ensureStores(w).stash.filter((id) => id === 'bandage').length;

function takeBandage(w: WorldState): boolean {
  const st = ensureStores(w).stash;
  const i = st.indexOf('bandage');
  if (i < 0) return false;
  st.splice(i, 1);
  return true;
}

/** Days a bandage takes off: Home Ec knows what they are doing. */
export const treatDays = (w: WorldState): number => (livingSquad(w.roster).some((m) => m.schoolClass === 'homeec') ? 3 : 2);

/** Use a bandage on one of a squad member's healing injuries. Scars cannot be treated. */
export function treatMember(w: WorldState, memberId: string, injury: InjuryId): ActionResult {
  const m = w.roster.find((x) => x.id === memberId && !x.dead);
  const inj = m?.injuries.find((i) => i.id === injury);
  if (!m || !inj) return no('Nobody to treat.');
  if (INJURIES[injury].permanent) return no(`${INJURIES[injury].name} will not heal.`);
  if (!takeBandage(w)) return no('No bandages in the stash.');
  const notes: string[] = [];
  inj.left -= treatDays(w);
  m.injuries = m.injuries.filter((i) => i.left > 0 || INJURIES[i.id].permanent);
  if (!m.injuries.includes(inj)) notes.push(`${m.name}'s ${INJURIES[injury].name.toLowerCase()} is mended.`);
  else notes.push(`${m.name}'s ${INJURIES[injury].name.toLowerCase()} is bandaged: ${inj.left} day${inj.left === 1 ? '' : 's'} to go.`);
  return { ok: true, msg: notes[0] };
}

// ---------- prisoners ----------

export type CaptiveAction = 'worker' | 'fighter' | 'ransom' | 'beat' | 'target' | 'medical' | 'execute';

export const CAPTIVE_ACTION_LABEL: Record<CaptiveAction, string> = {
  worker: 'Make a worker',
  fighter: 'Make a fighter',
  ransom: 'Demand ransom',
  beat: 'Beat',
  target: 'Target practice',
  medical: 'Medical practice',
  execute: 'Execute',
};

export const CAPTIVE_ACTION_TIP: Record<CaptiveAction, string> = {
  worker: 'Try to turn them into a camp worker (needed to build and gather later). The more defiant, the worse the odds.',
  fighter: 'Try to turn them into a fighter, to garrison the camp or join the party later.',
  ransom: 'Send word to their friends. Most pay; they go free either way.',
  beat: 'Wears down their resistance, and may hurt them badly.',
  target: 'Let someone in the squad practise on them. Brutal. The squad member gains experience; the prisoner is likely to be hurt, and may die.',
  medical: 'Let someone practise treating them. Uses a bandage; the squad member gains experience; it can go wrong.',
  execute: 'Kill them. Leaves remains.',
};

export const DEFIANCE_START = 60;
export const isPrisoner = (c: Captive): boolean => (c.status ?? 'captive') === 'captive';

function prep(c: Captive): Captive & { injuries: NonNullable<Captive['injuries']>; defiance: number } {
  c.injuries ??= [];
  c.defiance ??= DEFIANCE_START;
  c.status ??= 'captive';
  return c as Captive & { injuries: NonNullable<Captive['injuries']>; defiance: number };
}

/** Chance (0-1) that a conversion takes: low defiance is good, and someone already hurt is easier to talk round. */
export function convertChance(c: Captive): number {
  const d = c.defiance ?? DEFIANCE_START;
  return Math.min(0.9, Math.max(0.1, (100 - d) / 100 + (c.injuries?.length ? 0.1 : 0)));
}

/** True if the action needs a squad member to do it. */
export const needsHelper = (a: CaptiveAction): boolean => a === 'target' || a === 'medical';

/** What can be done to this captive right now (prisoners only; once turned they have a place in camp instead). */
export function canAct(w: WorldState, c: Captive, a: CaptiveAction): string | null {
  if (!isPrisoner(c)) return 'They are not a prisoner any more.';
  if (a === 'execute') return null;
  if (c.actedDay === dayOf(w)) return 'Already dealt with today.';
  if (a === 'medical' && bandages(w) === 0) return 'No bandages in the stash.';
  if (a === 'medical' && !c.injuries?.length) return 'Nothing to treat.';
  return null;
}

/** Do something to a prisoner. `by` is the squad member who helps (target practice, medical practice). */
export function captiveAction(w: WorldState, uid: string, a: CaptiveAction, by?: string): ActionResult {
  const st = ensureStores(w);
  const c = st.captives.find((x) => x.uid === uid);
  if (!c) return no('No such prisoner.');
  const blocked = canAct(w, c, a);
  if (blocked) return no(blocked);
  const cp = prep(c);
  const helper: RosterMember | undefined = needsHelper(a) ? (w.roster.find((m) => m.id === by && !m.dead) ?? livingSquad(w.roster)[0]) : undefined;
  const notes: string[] = [];
  const remove = (): void => {
    st.captives = st.captives.filter((x) => x.uid !== uid);
  };
  if (a !== 'execute') c.actedDay = dayOf(w);

  switch (a) {
    case 'worker':
    case 'fighter': {
      if (rand(w) < convertChance(c)) {
        c.status = a;
        notes.push(`${c.name} gives in and agrees to be a ${a}.`);
      } else {
        cp.defiance = Math.min(100, cp.defiance + 5);
        notes.push(`${c.name} spits at the idea.`);
      }
      break;
    }
    case 'ransom': {
      if (rand(w) < 0.75) {
        const pay = 3 + randInt(w, 0, 6);
        w.scrap += pay;
        st.mercy.ransomed = (st.mercy.ransomed ?? 0) + 1;
        st.mercy.spared.push({ name: c.name, role: c.role });
        remove();
        notes.push(`${c.name}'s friends pay ${pay} scrap. They are sent home.`);
      } else {
        cp.defiance = Math.max(0, cp.defiance - 5);
        notes.push(`Nobody answers for ${c.name}. No ransom.`);
      }
      break;
    }
    case 'beat': {
      cp.defiance = Math.max(0, cp.defiance - 20);
      st.mercy.cruelty = (st.mercy.cruelty ?? 0) + 1;
      const id = rand(w) < 0.5 ? giveInjury(cp, w, { permanentChance: 0.05 }) : null;
      notes.push(id ? `${c.name} is beaten: ${INJURIES[id].name.toLowerCase()}.` : `${c.name} is beaten, and breaks a little.`);
      break;
    }
    case 'target': {
      st.mercy.cruelty = (st.mercy.cruelty ?? 0) + 1;
      if (helper) addXp(helper, 6, w, notes);
      if (rand(w) < 0.1) {
        st.mercy.executed += 1;
        st.stash.push('remains');
        remove();
        notes.unshift(`${c.name} does not survive the practice.`);
      } else {
        const id = rand(w) < 0.8 ? giveInjury(cp, w, { permanentChance: 0.2 }) : null;
        notes.unshift(id ? `${c.name} is used for target practice: ${INJURIES[id].name.toLowerCase()}.` : `${c.name} is used for target practice, somehow unhurt.`);
      }
      break;
    }
    case 'medical': {
      takeBandage(w);
      if (helper) addXp(helper, 5, w, notes);
      if (rand(w) < 0.12) {
        const id = giveInjury(cp, w);
        notes.unshift(id ? `The treatment goes wrong: ${c.name} now has ${INJURIES[id].name.toLowerCase()}.` : 'The treatment goes wrong.');
      } else {
        tickInjuries(cp, notes, 2);
        notes.unshift(`${c.name} is patched up.`);
      }
      break;
    }
    case 'execute': {
      st.mercy.executed += 1;
      st.stash.push('remains');
      remove();
      notes.push(`${c.name} was executed.`);
      break;
    }
  }
  return { ok: true, msg: notes.join(' ') };
}

/** Workers and fighters the camp has turned. */
export const followers = (w: WorldState, status: 'worker' | 'fighter'): Captive[] => ensureStores(w).captives.filter((c) => c.status === status);
