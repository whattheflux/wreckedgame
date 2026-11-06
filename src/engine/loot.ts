import { rand } from './rng';
import { SIGHT_RANGE } from './vision';
import { ITEMS, gearMods, itemsIn, moveItem, quickMove, slotsOf, weaponOfGear, weaponOfItem, type Gear, type GearLoc, type ItemId } from './items';
import type { GameState, Pos, Unit } from './types';
import { hasFlag } from './perks';

/**
 * What a fall leaves behind, and picking it up. Pure rules on the battle state: the ground is a list of item ids
 * per tile, a fallen unit is just a non-living unit still standing on its tile.
 */

export const tileKey = (p: Pos): string => `${p.x},${p.y}`;

/** Items lying on a tile (a copy; use `groundList` to change it). */
export const lootAt = (state: GameState, p: Pos): ItemId[] => [...(state.ground?.[tileKey(p)] ?? [])];

/** The live list for a tile, created on demand. Call `tidyGround` after changing it. */
export function groundList(state: GameState, p: Pos): ItemId[] {
  state.ground ??= {};
  return (state.ground[tileKey(p)] ??= []);
}

export function tidyGround(state: GameState): void {
  if (!state.ground) return;
  for (const k of Object.keys(state.ground)) if (state.ground[k].length === 0) delete state.ground[k];
  if (Object.keys(state.ground).length === 0) delete state.ground;
}

/** Everything on the ground anywhere, tile by tile in key order. */
export const allLoot = (state: GameState): ItemId[] => Object.keys(state.ground ?? {}).sort().flatMap((k) => state.ground?.[k] ?? []);

/** Fallen units lying on a tile (killed or out cold; a downed leader counts too). */
export const bodiesAt = (state: GameState, p: Pos): Unit[] => state.units.filter((u) => !u.alive && u.pos.x === p.x && u.pos.y === p.y);

// ---------- how a rival goes down ----------

export const DEATH_BASE = 0.35;
export const DEATH_CRIT = 0.2;
export const DEATH_OVERKILL = 0.15;
export const DEATH_HEAVY = 0.1;

/**
 * The chance a rival who just hit 0 HP is dead rather than out cold. Crits, a blow that took well over their health
 * in one go, and heavy weapons push it up. Clamped so neither outcome is ever certain.
 */
export function deathChance(blow: { crit: boolean; damage: number; heavy: boolean }, victim: Pick<Unit, 'maxHp'>): number {
  let p = DEATH_BASE;
  if (blow.crit) p += DEATH_CRIT;
  if (blow.damage >= victim.maxHp * 0.6) p += DEATH_OVERKILL;
  if (blow.heavy) p += DEATH_HEAVY;
  return Math.min(0.85, Math.max(0.15, p));
}

/**
 * Not everything survives its owner. Out cold, you keep everything on you (and can be stripped of it). Killed, each
 * item only survives by its own lootChance: the useful small stuff mostly does, worn clothes mostly do not. Remains
 * are what is left of someone who was killed.
 */
export const SCROUNGER_BONUS = 0.25;

export function dropsOf(gear: Gear, fate: 'dead' | 'unconscious', rng: { rngState: number }, bonus = 0): ItemId[] {
  const items = itemsIn(gear);
  if (fate === 'unconscious') return items;
  const out = items.filter((id) => rand(rng) < (ITEMS[id]?.loot ?? 0) + bonus);
  out.push('remains');
  return out;
}

/**
 * A unit has just gone to 0 HP and is not getting back up on its own (the leader's first fall is handled by the
 * caller). Rivals roll for death; fallen companions are always a loss, and their gear is theirs to be picked up.
 * Whatever is lootable lands on their tile and the unit is left with nothing.
 */
export function onFall(state: GameState, victim: Unit, blow: { crit: boolean; damage: number; heavy: boolean }, by?: Unit | null): 'dead' | 'unconscious' {
  let fate: 'dead' | 'unconscious' = 'dead';
  if (victim.team === 'enemy') fate = rand(state) < deathChance(blow, victim) ? 'dead' : 'unconscious';
  victim.fate = fate;
  const gear = victim.gear ?? {};
  const drops = victim.team === 'enemy' ? dropsOf(gear, fate, state, hasFlag(by ?? undefined, 'scrounger') ? SCROUNGER_BONUS : 0) : itemsIn(gear);
  if (drops.length > 0) groundList(state, victim.pos).push(...drops);
  victim.gear = {};
  return fate;
}

/**
 * Hit points hit zero: the one place a unit goes down, whether a blow or a condition did it. The leader's first fall in
 * a battle is a knock-down an ally can revive; everyone else rolls death vs unconscious and drops what they carry.
 * `attacker` is null when no one is to blame (bleeding, burning) and gets no kill.
 */
export function knockDown(
  state: GameState,
  target: Unit,
  attacker: Unit | null,
  blow: { crit: boolean; damage: number; heavy: boolean },
): 'dead' | 'unconscious' | 'downed' | 'held' {
  // Iron Will: the first blow in a battle that should finish you simply does not, once.
  if (hasFlag(target, 'ironWill') && !target.uses?.ironWill) {
    target.uses = { ...target.uses, ironWill: 1 };
    target.hp = 1;
    state.log.push({ team: target.team, text: `${target.name} refuses to go down.`, at: [{ ...target.pos }] });
    return 'held';
  }
  target.alive = false;
  target.overwatch = false;
  delete target.status;
  if (target.protagonist && (target.downs ?? 0) === 0) {
    target.downs = 1;
    target.downed = true;
    return 'downed';
  }
  if (attacker) attacker.kills = (attacker.kills ?? 0) + 1;
  return onFall(state, target, blow, attacker);
}

/** A weapon gives out: take it out of whichever hand held it. The unit falls back to what is in the other hand, or fists. */
export function breakWeapon(state: GameState, u: Unit): void {
  const g = u.gear ?? {};
  const before: Gear = { ...g };
  const slot = weaponOfItem(g.rightHand ?? '') ? 'rightHand' : weaponOfItem(g.leftHand ?? '') ? 'leftHand' : null;
  if (!slot) return;
  const name = u.weapon.name;
  delete g[slot];
  u.gear = g;
  refreshFromGear(u, before);
  state.log.push({ team: u.team, text: `${u.name}'s ${name.toLowerCase()} breaks!`, at: [{ ...u.pos }] });
}

// ---------- changing gear mid-battle ----------

/** Apply a change of gear to the unit: its weapon (a new one starts with a full clip) and the stat mods of what is worn. */
export function refreshFromGear(u: Unit, before: Gear): void {
  const was = gearMods(before);
  const now = gearMods(u.gear ?? {});
  const oldWeapon = u.weapon;
  u.weapon = weaponOfGear(u.gear ?? {});
  if (u.weapon !== oldWeapon) u.ammo = u.weapon.clip;
  u.maxHp += now.hp - was.hp;
  u.hp = Math.min(u.hp, u.maxHp);
  if (u.hp < 1 && u.alive) u.hp = 1;
  u.mobility += now.mobility - was.mobility;
  u.aim += now.rangedAim - was.rangedAim;
  u.meleeAim = (u.meleeAim ?? u.aim) + (now.meleeAim - was.meleeAim);
  u.defense += now.rangedDefense - was.rangedDefense;
  u.meleeDefense = (u.meleeDefense ?? u.defense) + (now.meleeDefense - was.meleeDefense);
  u.sight = (u.sight ?? SIGHT_RANGE) + (now.sight - was.sight);
  u.critChance += now.crit - was.crit;
}

export interface GearResult {
  ok: boolean;
  error?: string;
  /** AP the change cost */
  ap: number;
}

/** Changing what is in your hands in the middle of a fight costs this much; everything else (armour, belt, pack, the ground) is free. */
export const SWAP_WEAPON_AP = 1;

type Edit = (gear: Gear, list: ItemId[]) => { ok: boolean; error?: string };

function editGear(state: GameState, u: Unit, edit: Edit): GearResult {
  if (state.winner) return { ok: false, error: 'The fight is over.', ap: 0 };
  if (!u.alive) return { ok: false, error: 'They cannot do that.', ap: 0 };
  if (u.team !== state.active) return { ok: false, error: 'Not your turn.', ap: 0 };
  const before: Gear = { ...(u.gear ?? {}) };
  const gear: Gear = { ...before };
  const list = groundList(state, u.pos);
  const trial = [...list];
  const r = edit(gear, trial);
  if (!r.ok) {
    tidyGround(state);
    return { ok: false, error: r.error, ap: 0 };
  }
  const swapped = weaponOfGear(gear) !== weaponOfGear(before);
  const ap = swapped && !hasFlag(u, 'fastHands') ? SWAP_WEAPON_AP : 0;
  if (ap > u.ap) {
    tidyGround(state);
    return { ok: false, error: 'Swapping weapons takes 1 AP.', ap: 0 };
  }
  u.gear = gear;
  list.length = 0;
  list.push(...trial);
  tidyGround(state);
  u.ap -= ap;
  if (swapped) u.overwatch = false;
  refreshFromGear(u, before);
  return { ok: true, ap };
}

/** Move an item between the unit's slots and the ground under it (a slot, or `{ground: index}`). */
export const moveGear = (state: GameState, u: Unit, from: GearLoc, to: GearLoc): GearResult => editGear(state, u, (g, l) => moveItem(g, l, from, to));

/** Double-click: equip it from the ground / pack, or stow a worn item. */
export const quickMoveGear = (state: GameState, u: Unit, from: GearLoc): GearResult => editGear(state, u, (g, l) => quickMove(g, l, from));

/** Slots with something in them, for display. */
export const filledSlots = (u: Unit): string[] => slotsOf(u.gear ?? {}).filter((s) => u.gear?.[s]);

