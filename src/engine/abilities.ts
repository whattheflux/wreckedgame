import type { BattleEvent, GameState, Unit } from './types';
import type { ActionResult } from './battle';
import { checkWin, getUnit, wakePod } from './battle';
import { computeShot, resolveShot } from './combat';
import { slotsOf } from './items';
import { rand } from './rng';
import { addStatus, canUseSkills, hasStatus, removeStatus } from './status';
import { BALL, EXTRA_SKILLS, type Skill } from './skills';

/**
 * Using the class and clique skills (throwing, charming, hiding, patching up). Pure rules on the battle state, like
 * battle.ts, which it builds on. Overwatch, reload and revive stay in battle.ts.
 */

const fail = (error: string): ActionResult => ({ ok: false, error, events: [] });

export const PATCH_HEAL = 4;
export const CHARM_RANGE = 7;
/** Charm chance by the target's toughness: a bigger kid is harder to sweet-talk. */
export const charmChance = (target: Pick<Unit, 'maxHp'>): number => Math.max(15, Math.min(85, 90 - 4 * target.maxHp));

export const usesLeft = (u: Pick<Unit, 'uses'>, skill: Skill): number => (skill.perBattle === undefined ? Infinity : skill.perBattle - (u.uses?.[skill.id] ?? 0));

/** Where a bandage is on this unit (belt or pack), or null. */
export function bandageSlot(u: Pick<Unit, 'gear'>): string | null {
  const gear = u.gear ?? {};
  return slotsOf(gear).find((s) => gear[s] === 'bandage') ?? null;
}

/** Allies next to `u` (and `u` itself) that a bandage would help. */
export const patchable = (state: GameState, u: Unit): Unit[] =>
  state.units.filter(
    (t) => t.alive && t.team === u.team && Math.max(Math.abs(t.pos.x - u.pos.x), Math.abs(t.pos.y - u.pos.y)) <= 1 && (t.hp < t.maxHp || hasStatus(t, 'bleed')),
  );

/** Why this unit cannot use this skill right now (ignoring the target), or null. Used for greyed-out buttons. */
export function skillBlock(state: GameState, u: Unit, skill: Skill): string | null {
  if (state.winner) return 'The fight is over.';
  if (!u.alive) return 'Down.';
  if (u.team !== state.active) return 'Not your turn.';
  if (!u.skills?.includes(skill.id)) return 'They do not have that skill.';
  if (u.ap < (skill.ap ?? 1)) return 'Not enough AP.';
  if (usesLeft(u, skill) <= 0) return skill.perBattle === 1 ? 'Already used this battle.' : 'None left this battle.';
  if (skill.id === 'charm' && !canUseSkills(u)) return 'Silenced: cannot charm.';
  if (skill.id === 'incognito' && hasStatus(u, 'hidden')) return 'Already hidden.';
  if (skill.id === 'patchUp') {
    if (!bandageSlot(u)) return 'No bandage on the belt or in the pack.';
    if (patchable(state, u).length === 0) return 'Nobody next to you needs patching up.';
  }
  return null;
}

/**
 * Use a skill. `targetId` is the enemy for aimed skills, or optionally the ally for Patch Up (default: whoever is
 * hurt the most next to you). Spends the AP and the use; a charm that does not take still counts.
 */
export function useSkill(state: GameState, id: string, skillId: string, targetId?: string): ActionResult {
  const unit = getUnit(state, id);
  const skill = EXTRA_SKILLS[skillId];
  if (!unit) return fail('No such unit');
  if (!skill) return fail('No such skill');
  const blocked = skillBlock(state, unit, skill);
  if (blocked) return fail(blocked);

  const spend = (): void => {
    unit.ap -= skill.ap ?? 1;
    unit.uses = { ...unit.uses, [skill.id]: (unit.uses?.[skill.id] ?? 0) + 1 };
  };
  const events: BattleEvent[] = [];

  if (skill.target === 'self') {
    spend();
    addStatus(unit, 'hidden');
    state.log.push({ team: unit.team, text: `${unit.name} fades into the background.`, at: [{ ...unit.pos }] });
    events.push({ type: 'skill', unitId: unit.id, skillId, ok: true });
    return { ok: true, events };
  }

  if (skill.target === 'ally') {
    const options = patchable(state, unit);
    const target = (targetId ? options.find((t) => t.id === targetId) : undefined) ?? [...options].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!target) return fail('Nobody to patch up');
    const slot = bandageSlot(unit);
    if (!slot) return fail('No bandage');
    spend();
    delete (unit.gear as Record<string, string>)[slot];
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + PATCH_HEAL);
    const stopped = removeStatus(target, 'bleed');
    state.log.push({
      team: unit.team,
      text: `${unit.name} patches up ${target === unit ? 'themselves' : target.name}: +${target.hp - before} HP${stopped ? ', bleeding stopped' : ''}.`,
      at: [{ ...unit.pos }, { ...target.pos }],
    });
    events.push({ type: 'skill', unitId: unit.id, skillId, targetId: target.id, ok: true });
    return { ok: true, events };
  }

  // aimed at an enemy
  const target = targetId ? getUnit(state, targetId) : undefined;
  if (!target || !target.alive) return fail('No such target');
  if (target.team === unit.team) return fail('Cannot target an ally');

  if (skill.throws) {
    const pv = computeShot(state.map, { aim: unit.aim, critChance: unit.critChance, weapon: skill.throws, status: unit.status }, unit.pos, target);
    if (!pv.canShoot) return fail(pv.reason ?? 'Cannot throw');
    const wasDormant = target.dormant;
    spend();
    unit.attacked = true;
    unit.idleTurns = 0;
    events.push(resolveShot(state, unit, target, pv, false, false, skill.throws));
    if (wasDormant && target.pod) events.push(...wakePod(state, target.pod));
    checkWin(state, events);
    return { ok: true, events };
  }

  if (skill.id === 'charm') {
    const pv = computeShot(state.map, { aim: 0, critChance: 0, weapon: { ...BALL, range: CHARM_RANGE } }, unit.pos, target);
    if (!pv.canShoot) return fail(pv.reason === 'Out of range' ? 'Out of range' : 'No line of sight');
    if (hasStatus(target, 'charmed')) return fail('Already charmed');
    const wasDormant = target.dormant;
    spend();
    const ok = rand(state) * 100 < charmChance(target);
    if (ok) addStatus(target, 'charmed');
    state.log.push({
      team: unit.team,
      text: ok ? `${unit.name} charms ${target.name}: starry-eyed.` : `${unit.name} tries to charm ${target.name}, who is not buying it.`,
      at: [{ ...unit.pos }, { ...target.pos }],
    });
    events.push({ type: 'skill', unitId: unit.id, skillId, targetId: target.id, ok });
    if (wasDormant && target.pod) events.push(...wakePod(state, target.pod));
    return { ok: true, events };
  }

  return fail('That skill cannot be used like that');
}
