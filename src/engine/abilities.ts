import type { BattleEvent, GameState, Pos, Unit, Weapon } from './types';
import type { ActionResult } from './battle';
import { checkWin, getUnit, wakePod, walkPath } from './battle';
import { computeShot, resolveShot } from './combat';
import { dist, pathTo, reachableTiles } from './grid';
import { slotsOf } from './items';
import { hasFlag } from './perks';
import { rand } from './rng';
import { addStatus, canUseSkills, clearBadStatuses, hasStatus, removeStatus } from './status';
import { EXTRA_SKILLS, type Skill } from './skills';

/**
 * Using the class and clique skills. Pure rules on the battle state, like battle.ts, which it builds
 * on; overwatch, reload and revive stay there because everybody has them.
 *
 * Each skill is one branch of `useSkill`, and perks bend them through `hasFlag`. The shapes are:
 * thrown (resolves as a shot with its own weapon), aimed-at-an-enemy, on-an-adjacent-ally, and
 * on-yourself (including the two shouts, which reach everyone nearby).
 */

const fail = (error: string): ActionResult => ({ ok: false, error, events: [] });

export const PATCH_HEAL = 4;
export const FIELD_MEDIC_BONUS = 3;
export const RATIONS_HEAL = 3;
export const MELLOW_HEAL = 3;
export const CHARM_RANGE = 7;
export const SHOWSTOPPER_BONUS = 20;
export const TACKLE_STUN = 0.5;
export const INCOGNITO_TURNS = 2;

/** What a tackle hits with: your shoulder, not whatever is in your hands. */
export const TACKLE_HIT: Weapon = {
  name: 'Tackle',
  damage: [2, 4],
  range: 1.5,
  optimal: 1,
  aimMod: 10,
  critMod: 0,
  clip: 99,
  hands: 1,
  heavy: false,
  melee: true,
  inflicts: [{ effect: 'stun', chance: TACKLE_STUN }],
};

const adjacent = (a: Pos, b: Pos): boolean => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;

/** Charm chance by the target's toughness, plus the thrower's Charm attribute and perk. */
export function charmChance(target: Pick<Unit, 'maxHp'>, charm = 0, showstopper = false): number {
  return Math.max(5, Math.min(95, 90 - 4 * target.maxHp + charm * 4 + (showstopper ? SHOWSTOPPER_BONUS : 0)));
}

/** Uses a skill gets in one battle, after perks. */
export function limitFor(u: Pick<Unit, 'flags'>, skill: Skill): number {
  if (skill.perBattle === undefined) return Infinity;
  if (skill.id === 'acidBeaker' && hasFlag(u, 'chemist')) return skill.perBattle + 1;
  return skill.perBattle;
}

export const usesLeft = (u: Pick<Unit, 'uses' | 'flags'>, skill: Skill): number => limitFor(u, skill) - (u.uses?.[skill.id] ?? 0);

/** The AP a skill costs this unit, after perks. */
export const apFor = (u: Pick<Unit, 'flags'>, skill: Skill): number => (skill.id === 'patchUp' && hasFlag(u, 'fieldMedic') ? 0 : (skill.ap ?? 1));

/** The weapon a thrown skill actually uses, after perks. */
export function thrownWeapon(u: Pick<Unit, 'flags'>, skill: Skill): Weapon | undefined {
  const w = skill.throws;
  if (!w) return undefined;
  if (skill.id === 'throwBall' && hasFlag(u, 'cannonArm')) {
    return { ...w, range: w.range + 2, optimal: w.optimal + 1, damage: [w.damage[0], w.damage[1] + 1] };
  }
  if (skill.id === 'acidBeaker' && hasFlag(u, 'chemist')) {
    return { ...w, damage: [w.damage[0] + 1, w.damage[1] + 1], inflicts: (w.inflicts ?? []).map((i) => ({ ...i, chance: Math.min(1, i.chance + 0.15) })) };
  }
  return w;
}

/** Where the item a skill needs is on this unit (belt or pack), or null. */
export function itemSlot(u: Pick<Unit, 'gear'>, id: string): string | null {
  const gear = u.gear ?? {};
  return slotsOf(gear).find((s) => gear[s] === id) ?? null;
}

/** Allies next to `u` (and `u` itself) that this skill would do something for. */
export function helpable(state: GameState, u: Unit, skill: Skill): Unit[] {
  const near = state.units.filter((t) => t.alive && t.team === u.team && adjacent(t.pos, u.pos));
  if (skill.id === 'rally') return near.filter((t) => t.id !== u.id && (t.ap < t.maxAp || hasStatus(t, 'shaken') || hasStatus(t, 'scared')));
  if (skill.id === 'rations') return near.filter((t) => t.hp < t.maxHp || hasStatus(t, 'shaken') || hasStatus(t, 'scared'));
  return near.filter((t) => t.hp < t.maxHp || hasStatus(t, 'bleed'));
}

/** Kept for the Patch Up tooltip and older callers. */
export const patchable = (state: GameState, u: Unit): Unit[] => helpable(state, u, EXTRA_SKILLS.patchUp);
export const bandageSlot = (u: Pick<Unit, 'gear'>): string | null => itemSlot(u, 'bandage');

/** Why this unit cannot use this skill right now (ignoring which target), or null. Drives greyed-out buttons. */
export function skillBlock(state: GameState, u: Unit, skill: Skill): string | null {
  if (state.winner) return 'The fight is over.';
  if (!u.alive) return 'Down.';
  if (u.team !== state.active) return 'Not your turn.';
  if (!u.skills?.includes(skill.id)) return 'They do not have that skill.';
  if (u.ap < apFor(u, skill)) return 'Not enough AP.';
  if (usesLeft(u, skill) <= 0) return limitFor(u, skill) === 1 ? 'Already used this battle.' : 'None left this battle.';
  if ((skill.id === 'charm' || skill.id === 'analyse') && !canUseSkills(u)) return 'Silenced: cannot do that.';
  if (skill.needsItem && !itemSlot(u, skill.needsItem)) return `No ${skill.needsItem === 'bandage' ? 'bandage' : 'energy bar'} on the belt or in the pack.`;
  if (skill.target === 'ally' && helpable(state, u, skill).length === 0) return 'Nobody next to you needs that.';
  if (skill.id === 'incognito' && hasStatus(u, 'hidden')) return 'Already hidden.';
  if (skill.id === 'brace' && hasStatus(u, 'braced')) return 'Already braced.';
  return null;
}

/**
 * Use a skill. `targetId` is the enemy for aimed skills, or optionally the ally for the helping ones
 * (the one who needs it most by default). Spends the AP and the use; an attempt that does not take
 * (a charm they are not buying) still counts.
 */
export function useSkill(state: GameState, id: string, skillId: string, targetId?: string): ActionResult {
  const unit = getUnit(state, id);
  const skill = EXTRA_SKILLS[skillId];
  if (!unit) return fail('No such unit');
  if (!skill) return fail('No such skill');
  const blocked = skillBlock(state, unit, skill);
  if (blocked) return fail(blocked);

  const spend = (): void => {
    unit.ap -= apFor(unit, skill);
    if (skill.endsTurn) unit.ap = 0;
    unit.uses = { ...unit.uses, [skill.id]: (unit.uses?.[skill.id] ?? 0) + 1 };
  };
  const consumeItem = (): void => {
    const slot = skill.needsItem ? itemSlot(unit, skill.needsItem) : null;
    if (slot) delete (unit.gear as Record<string, string>)[slot];
  };
  const events: BattleEvent[] = [];
  const done = (ok: boolean, target?: Unit): ActionResult => {
    events.push({ type: 'skill', unitId: unit.id, skillId, ...(target ? { targetId: target.id } : {}), ok });
    return { ok: true, events };
  };

  // ---- on yourself (and, for the two shouts, on everyone nearby) ----
  if (skill.target === 'self') {
    if (skillId === 'incognito') {
      spend();
      addStatus(unit, 'hidden', INCOGNITO_TURNS + (hasFlag(unit, 'understudy') ? 1 : 0));
      state.log.push({ team: unit.team, text: `${unit.name} fades into the background.`, at: [{ ...unit.pos }] });
      return done(true);
    }
    if (skillId === 'brace') {
      spend();
      addStatus(unit, 'braced');
      state.log.push({ team: unit.team, text: `${unit.name} braces.`, at: [{ ...unit.pos }] });
      return done(true);
    }
    if (skillId === 'mellow') {
      spend();
      const gone = clearBadStatuses(unit);
      const was = unit.hp;
      unit.hp = Math.min(unit.maxHp, unit.hp + MELLOW_HEAL);
      state.log.push({
        team: unit.team,
        text: `${unit.name} takes a moment${gone.length ? ` and shakes off ${gone.length} thing${gone.length === 1 ? '' : 's'}` : ''} (+${unit.hp - was} HP).`,
        at: [{ ...unit.pos }],
      });
      return done(true);
    }
    // the shouts
    const effect = skillId === 'warCry' ? 'shaken' : 'scared';
    const reach = skill.range ?? 4;
    spend();
    const caught = state.units.filter((e) => e.alive && e.team !== unit.team && !e.dormant && dist(unit.pos, e.pos) <= reach && addStatus(e, effect));
    state.log.push({
      team: unit.team,
      text: caught.length ? `${unit.name} ${skillId === 'warCry' ? 'roars' : 'unsettles everyone'}: ${caught.length} rival${caught.length === 1 ? '' : 's'} ${effect}.` : `${unit.name} shouts, and nobody flinches.`,
      at: [{ ...unit.pos }, ...caught.map((c) => ({ ...c.pos }))],
    });
    return done(caught.length > 0);
  }

  // ---- on an ally next to you (or yourself) ----
  if (skill.target === 'ally') {
    const options = helpable(state, unit, skill);
    const target = (targetId ? options.find((t) => t.id === targetId) : undefined) ?? [...options].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!target) return fail('Nobody to help');
    spend();
    consumeItem();
    const who = target === unit ? 'themselves' : target.name;
    if (skillId === 'rally') {
      target.ap = Math.min(target.maxAp, target.ap + 1);
      removeStatus(target, 'shaken');
      removeStatus(target, 'scared');
      state.log.push({ team: unit.team, text: `${unit.name} rallies ${who}: +1 AP.`, at: [{ ...unit.pos }, { ...target.pos }] });
      return done(true, target);
    }
    const heal = skillId === 'rations' ? RATIONS_HEAL : PATCH_HEAL + (hasFlag(unit, 'fieldMedic') ? FIELD_MEDIC_BONUS : 0);
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + heal);
    const extra =
      skillId === 'rations'
        ? [removeStatus(target, 'shaken'), removeStatus(target, 'scared')].some(Boolean) && ', nerves settled'
        : removeStatus(target, 'bleed') && ', bleeding stopped';
    state.log.push({
      team: unit.team,
      text: `${unit.name} ${skillId === 'rations' ? 'feeds' : 'patches up'} ${who}: +${target.hp - before} HP${extra || ''}.`,
      at: [{ ...unit.pos }, { ...target.pos }],
    });
    return done(true, target);
  }

  // ---- aimed at a rival ----
  const target = targetId ? getUnit(state, targetId) : undefined;
  if (!target || !target.alive) return fail('No such target');
  if (target.team === unit.team) return fail('Cannot target an ally');

  const thrown = thrownWeapon(unit, skill);
  if (thrown) {
    const pv = computeShot(state.map, { aim: unit.aim, meleeAim: unit.meleeAim, critChance: unit.critChance, weapon: thrown, status: unit.status, flags: unit.flags }, unit.pos, target);
    if (!pv.canShoot) return fail(pv.reason ?? 'Cannot throw');
    const wasDormant = target.dormant;
    spend();
    unit.attacked = true;
    unit.idleTurns = 0;
    events.push(resolveShot(state, unit, target, pv, false, false, thrown));
    if (wasDormant && target.pod) events.push(...wakePod(state, target.pod));
    checkWin(state, events);
    return { ok: true, events };
  }

  if (skillId === 'tackle') {
    // Charge: the nearest tile you can reach next to them, then a shoulder into the ribs.
    const reach = reachableTiles(state.map, state.units, unit, unit.mobility);
    let best: { key: string; cost: number } | null = null;
    for (const [key, node] of reach) {
      if (!adjacent(node.pos, target.pos)) continue;
      if (!best || node.cost < best.cost) best = { key, cost: node.cost };
    }
    if (!best && !adjacent(unit.pos, target.pos)) return fail('Cannot reach them');
    const wasDormant = target.dormant;
    const from = { ...unit.pos };
    spend();
    if (best && best.cost > 0) {
      const path = pathTo(reach, best.key);
      const w = walkPath(state, unit, path, false);
      events.push({ type: 'move', unitId: unit.id, from, path: w.traveled }, ...w.reactions);
    }
    if (unit.alive && adjacent(unit.pos, target.pos)) {
      const pv = computeShot(state.map, { aim: unit.aim, meleeAim: unit.meleeAim, critChance: unit.critChance, weapon: TACKLE_HIT, status: unit.status, flags: unit.flags }, unit.pos, target);
      if (pv.canShoot) {
        unit.attacked = true;
        unit.idleTurns = 0;
        events.push(resolveShot(state, unit, target, pv, false, false, TACKLE_HIT));
      }
    }
    if (wasDormant && target.pod) events.push(...wakePod(state, target.pod));
    checkWin(state, events);
    return { ok: true, events };
  }

  // ---- the two that just need sight and range ----
  const reachOf = skill.range ?? CHARM_RANGE;
  if (dist(unit.pos, target.pos) > reachOf) return fail('Out of range');
  const sightCheck = computeShot(
    state.map,
    { aim: 0, critChance: 0, weapon: { name: skill.name, damage: [0, 0], range: reachOf, optimal: reachOf, aimMod: 0, critMod: 0, clip: 99, hands: 1, heavy: false } },
    unit.pos,
    target,
  );
  if (!sightCheck.canShoot) return fail(sightCheck.reason ?? 'Cannot do that from here');
  const wasDormant = target.dormant;

  if (skillId === 'analyse') {
    spend();
    addStatus(target, 'marked');
    state.log.push({ team: unit.team, text: `${unit.name} reads ${target.name} and calls out the gap.`, at: [{ ...unit.pos }, { ...target.pos }] });
    if (wasDormant && target.pod) events.push(...wakePod(state, target.pod));
    return done(true, target);
  }

  if (skillId === 'charm') {
    if (hasStatus(target, 'charmed')) return fail('Already charmed');
    spend();
    const chance = charmChance(target, charmOf(unit), hasFlag(unit, 'showstopper'));
    const ok = rand(state) * 100 < chance && addStatus(target, 'charmed');
    state.log.push({
      team: unit.team,
      text: ok ? `${unit.name} charms ${target.name}: starry-eyed.` : `${unit.name} tries to charm ${target.name}, who is not buying it.`,
      at: [{ ...unit.pos }, { ...target.pos }],
    });
    if (wasDormant && target.pod) events.push(...wakePod(state, target.pod));
    return done(ok, target);
  }

  return fail('That skill cannot be used like that');
}

/** The Charm attribute of whoever is talking; deployed units carry it, hand-built ones do not. */
const charmOf = (u: Unit): number => u.charm ?? 0;
