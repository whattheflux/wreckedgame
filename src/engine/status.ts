import type { GameState, Status, StatusId, Unit } from './types';
import { knockDown } from './loot';

/**
 * Conditions: what weapons, fire and poison leave on a unit. They live on the unit as plain JSON and tick at the start of
 * its own team's turn. Stun, bleed, poison, burn, shaken, scared, blind and silenced are in; charmed, confused and
 * terrified need AI and control changes and come later.
 */

export interface StatusDef {
  name: string;
  /** one line for tooltips */
  blurb: string;
  /** default length in the unit's own turns */
  turns: number;
  /** two letters on the unit's chip */
  tag: string;
  color: string;
  /** hit and crit chance changes for a unit carrying it (applied to its own attacks) */
  aim?: number;
  crit?: number;
  /** damage at the start of each of its turns */
  dot?: { damage: number; /** poison hurts but never finishes anyone */ lethal: boolean };
  /** the whole next turn is lost */
  skipsTurn?: boolean;
  /** no overwatch, no reviving */
  silences?: boolean;
  /** taking damage ends it */
  breaksOnHit?: boolean;
  /** enemies cannot see or target the unit unless they are adjacent; attacking ends it */
  stealth?: boolean;
}

export const STATUSES: Record<StatusId, StatusDef> = {
  stun: { name: 'Stunned', blurb: 'Loses its next turn.', turns: 1, tag: 'ST', color: '#f2d04a', skipsTurn: true },
  bleed: { name: 'Bleeding', blurb: '1 damage at the start of each turn.', turns: 3, tag: 'BL', color: '#e0503d', dot: { damage: 1, lethal: true } },
  poison: { name: 'Poisoned', blurb: '1 damage a turn (never fatal) and -5 aim.', turns: 4, tag: 'PO', color: '#7fcf5a', aim: -5, dot: { damage: 1, lethal: false } },
  burn: { name: 'Burning', blurb: '2 damage at the start of each turn.', turns: 3, tag: 'BU', color: '#f08a2a', dot: { damage: 2, lethal: true } },
  shaken: { name: 'Shaken', blurb: '-10 aim and -10 crit.', turns: 3, tag: 'SH', color: '#b9a5e8', aim: -10, crit: -10 },
  scared: { name: 'Scared', blurb: '-15 aim.', turns: 3, tag: 'SC', color: '#d98ad0', aim: -15 },
  blind: { name: 'Blinded', blurb: '-35 aim: swinging at shapes.', turns: 3, tag: 'BI', color: '#9aa7b3', aim: -35 },
  charmed: { name: 'Charmed', blurb: 'Starry-eyed: loses its turns until it is hurt.', turns: 2, tag: 'CH', color: '#f08ac0', skipsTurn: true, breaksOnHit: true },
  hidden: { name: 'Incognito', blurb: 'Cannot be seen or targeted from a distance. Attacking gives you away.', turns: 2, tag: 'IN', color: '#8ad0c0', stealth: true },
  silenced: { name: 'Silenced', blurb: 'Cannot hold overwatch, revive anyone or charm.', turns: 3, tag: 'SI', color: '#6ab0e0', silences: true },
};

export const STATUS_IDS = Object.keys(STATUSES) as StatusId[];

export const hasStatus = (u: Pick<Unit, 'status'>, id: StatusId): boolean => !!u.status?.some((s) => s.id === id);

/** Put a status on a unit, or lengthen one it already has (never shorten). */
export function addStatus(u: Pick<Unit, 'status'>, id: StatusId, turns?: number): Status {
  const t = turns ?? STATUSES[id].turns;
  u.status ??= [];
  const have = u.status.find((s) => s.id === id);
  if (have) {
    have.turns = Math.max(have.turns, t);
    return have;
  }
  const s: Status = { id, turns: t };
  u.status.push(s);
  return s;
}

/** Hit and crit changes from everything the unit is afflicted with. */
export function statusMods(u: Pick<Unit, 'status'>): { aim: number; crit: number } {
  let aim = 0;
  let crit = 0;
  for (const s of u.status ?? []) {
    aim += STATUSES[s.id].aim ?? 0;
    crit += STATUSES[s.id].crit ?? 0;
  }
  return { aim, crit };
}

export const canUseSkills = (u: Pick<Unit, 'status'>): boolean => !(u.status ?? []).some((s) => STATUSES[s.id].silences);

/** Is the unit hidden from this particular viewer? Adjacent units always notice. */
export const isHiddenFrom = (u: Pick<Unit, 'status' | 'pos'>, viewer: Pick<Unit, 'pos'>): boolean =>
  (u.status ?? []).some((s) => STATUSES[s.id].stealth) && Math.max(Math.abs(u.pos.x - viewer.pos.x), Math.abs(u.pos.y - viewer.pos.y)) > 1;

/** Take a status off a unit (all of it). */
export function removeStatus(u: Pick<Unit, 'status'>, id: StatusId): boolean {
  if (!u.status?.some((s) => s.id === id)) return false;
  u.status = u.status.filter((s) => s.id !== id);
  if (u.status.length === 0) delete u.status;
  return true;
}

/** Hurt: whatever breaks on a hit comes off (charm). */
export function breakOnHit(u: Pick<Unit, 'status'>): void {
  for (const s of [...(u.status ?? [])]) if (STATUSES[s.id].breaksOnHit) removeStatus(u, s.id);
}

/** Short text for panels: "Bleeding (2), Shaken (1)". */
export const statusLine = (u: Pick<Unit, 'status'>): string => (u.status ?? []).map((s) => `${STATUSES[s.id].name} (${s.turns})`).join(', ');

/**
 * The start of `team`'s turn: damage over time lands, a stun costs the whole turn, then every condition counts down and
 * the spent ones come off. Returns what happened for the log and any animation. A unit that falls to it is dealt with
 * the same as one that falls to a hit.
 */
export function tickStatuses(state: GameState, team: Unit['team']): Array<{ type: 'tick'; unitId: string; effect: StatusId; damage: number; fell?: boolean }> {
  const events: Array<{ type: 'tick'; unitId: string; effect: StatusId; damage: number; fell?: boolean }> = [];
  for (const u of state.units) {
    if (u.team !== team || !u.alive || !u.status?.length) continue;
    for (const s of [...u.status]) {
      const def = STATUSES[s.id];
      if (def.skipsTurn) {
        u.ap = 0;
        state.log.push({ team: u.team, text: `${u.name} is stunned and loses the turn.`, at: [{ ...u.pos }] });
      }
      if (def.dot && u.alive) {
        const dmg = def.dot.lethal ? def.dot.damage : Math.min(def.dot.damage, Math.max(0, u.hp - 1));
        if (dmg > 0) {
          u.hp = Math.max(0, u.hp - dmg);
          const text = `${u.name} takes ${dmg} from ${def.name.toLowerCase()}.`;
          const ev: { type: 'tick'; unitId: string; effect: StatusId; damage: number; fell?: boolean } = { type: 'tick', unitId: u.id, effect: s.id, damage: dmg };
          if (u.hp === 0) {
            const fate = knockDown(state, u, null, { crit: false, damage: dmg, heavy: false });
            ev.fell = true;
            state.log.push({ team: u.team, text: `${text} ${fate === 'dead' ? 'They are gone.' : fate === 'unconscious' ? 'They pass out.' : 'They are down!'}`, at: [{ ...u.pos }] });
          } else {
            state.log.push({ team: u.team, text, at: [{ ...u.pos }] });
          }
          events.push(ev);
        }
      }
    }
    if (!u.alive) {
      u.status = [];
      continue;
    }
    for (const s of u.status) s.turns -= 1;
    u.status = u.status.filter((s) => s.turns > 0);
    if (u.status.length === 0) delete u.status;
  }
  return events;
}
