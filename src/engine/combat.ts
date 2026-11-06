import type { BattleEvent, CoverType, GameMap, GameState, Pos, Unit, Weapon } from './types';
import { coverAgainst, dist, hasLineOfSight, isFlanked } from './grid';
import { rand, randInt } from './rng';
import { breakWeapon, knockDown } from './loot';
import { STATUSES, addStatus, breakOnHit, removeStatus, statusMods } from './status';
import { hasFlag } from './perks';
import type { StatusId } from './types';

export const COVER_PENALTY: Record<CoverType, number> = { none: 0, half: 20, full: 40 };
export const OVERWATCH_PENALTY = 15;
/** A flanked target (hugging cover, but not on the side you are shooting from) is crit-certain: if the shot lands, it crits. */
export const FLANK_CRIT_CHANCE = 100;
/** A target with no cover against you at all (and nothing to flank) is easier to hurt badly: +crit points. */
export const EXPOSED_CRIT_BONUS = 15;
export const RANGE_PENALTY_PER_TILE = 4;

// ---- what perks are worth, in one place so the numbers are easy to find ----
/** Point Blank: ranged attacks inside this range get the bonus. */
export const POINT_BLANK_RANGE = 3;
export const POINT_BLANK_BONUS = 15;
/** Brawler: extra crit points when swinging at someone. */
export const BRAWLER_CRIT = 12;
/** Tough Hide: every hit taken is this much lighter (never below 1). */
export const TOUGH_HIDE = 1;
/** Second Wind: HP recovered for putting someone down. */
export const SECOND_WIND_HEAL = 3;
/** Duelist: aim added to your own parting blows. */
export const DUELIST_AIM = 20;

export { hasFlag };

export type Shooter = Pick<Unit, 'aim' | 'critChance' | 'weapon'> & Partial<Pick<Unit, 'status' | 'meleeAim' | 'flags'>>;
export type Targetable = Pick<Unit, 'defense' | 'pos' | 'hp'> & Partial<Pick<Unit, 'status' | 'meleeDefense' | 'flags'>>;

/** Attack value for the kind of blow being thrown: melee and ranged are trained separately. */
export const aimOf = (s: Shooter, melee: boolean): number => (melee ? (s.meleeAim ?? s.aim) : s.aim);
/** Defense value against the kind of blow coming in. */
export const defenseOf = (t: Targetable, melee: boolean): number => (melee ? (t.meleeDefense ?? t.defense) : t.defense);

export interface ShotPreview {
  canShoot: boolean;
  reason?: string;
  hitChance: number;
  critChance: number;
  cover: CoverType;
  flanked: boolean;
  /** no cover against this shooter and not flanked: standing in the open, so the crit chance gets EXPOSED_CRIT_BONUS */
  exposed: boolean;
  dmgMin: number;
  dmgMax: number;
  distance: number;
  /** the shooter's weapon range (max, and where accuracy starts to fall off), so a UI can explain 'out of range' */
  range: number;
  optimal: number;
  /** a melee blow: adjacent only, cover and range falloff do not apply */
  melee: boolean;
  /** the parts of the hit chance, for tooltips (all in points; penalties are positive) */
  rangePenalty: number;
  coverPenalty: number;
  /** the target's cover was there but the shooter's perk ignored it */
  coverIgnored: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Pure shot maths from a (possibly hypothetical) position. Used by the player UI preview, overwatch and the AI. */
export function computeShot(
  map: GameMap,
  shooter: Shooter,
  from: Pos,
  target: Targetable,
  overwatch = false,
): ShotPreview {
  const w = shooter.weapon;
  const distance = dist(from, target.pos);
  const melee = !!w.melee;
  // a blow in the face: cover means nothing, there is no falloff, and nobody is flanked
  const realCover = melee ? 'none' : coverAgainst(map, from, target.pos);
  // Cover Breaker: you shoot at the bit of them that is sticking out, so half cover stops counting.
  const coverIgnored = realCover === 'half' && hasFlag(shooter, 'coverBreaker');
  const cover: CoverType = coverIgnored ? 'none' : realCover;
  const flanked = melee ? false : isFlanked(map, from, target.pos);
  const exposed = cover === 'none' && !flanked;
  const falloff = Math.max(0, distance - w.optimal) * RANGE_PENALTY_PER_TILE;
  const rangePenalty = melee ? 0 : falloff * (hasFlag(shooter, 'deadeye') ? 0.5 : 1);
  const mods = statusMods(shooter);
  const theirs = statusMods(target);
  const base = {
    melee,
    cover,
    coverIgnored,
    flanked,
    exposed,
    dmgMin: w.damage[0],
    dmgMax: w.damage[1],
    distance,
    hitChance: 0,
    critChance: 0,
    range: w.range,
    optimal: w.optimal,
    rangePenalty: Math.round(rangePenalty),
    coverPenalty: COVER_PENALTY[cover],
  };

  if (distance > w.range) return { ...base, canShoot: false, reason: 'Out of range' };
  if (!melee && !hasLineOfSight(map, from, target.pos)) return { ...base, canShoot: false, reason: 'No line of sight' };

  const pointBlank = !melee && distance <= POINT_BLANK_RANGE && hasFlag(shooter, 'pointBlank') ? POINT_BLANK_BONUS : 0;
  const watchCost = overwatch && !hasFlag(shooter, 'steadyAim') ? OVERWATCH_PENALTY : 0;
  const hit =
    aimOf(shooter, melee) +
    mods.aim +
    w.aimMod +
    pointBlank -
    (defenseOf(target, melee) + theirs.defense) -
    COVER_PENALTY[cover] -
    rangePenalty -
    watchCost;
  const crit = flanked
    ? FLANK_CRIT_CHANCE
    : shooter.critChance + mods.crit + w.critMod + (melee ? (hasFlag(shooter, 'brawler') ? BRAWLER_CRIT : 0) : exposed ? EXPOSED_CRIT_BONUS : 0);

  return {
    ...base,
    canShoot: true,
    hitChance: Math.round(clamp(hit, 5, 95)),
    critChance: Math.round(clamp(crit, 0, 100)),
  };
}

/** Roll the shot, apply damage, log it. Caller has already spent AP/ammo. */
export function resolveShot(
  state: GameState,
  attacker: Unit,
  target: Unit,
  preview: ShotPreview,
  overwatch: boolean,
  opportunity = false,
  /** the weapon actually used, when it is not the one in hand (a thrown ball, a beaker) */
  weapon: Weapon = attacker.weapon,
): BattleEvent {
  removeStatus(attacker, 'hidden'); // attacking gives you away
  const hit = rand(state) * 100 < preview.hitChance;
  let crit = false;
  let damage = 0;
  let killed = false;
  let wentDown = false;
  let held = false;
  let fate: 'dead' | 'unconscious' | undefined;
  const inflicted: StatusId[] = [];

  if (hit) {
    crit = rand(state) * 100 < preview.critChance;
    damage = randInt(state, weapon.damage[0], weapon.damage[1]);
    if (crit) damage = Math.floor(damage * 1.5);
    if (hasFlag(target, 'toughHide')) damage = Math.max(1, damage - TOUGH_HIDE);
    target.hp = Math.max(0, target.hp - damage);
    attacker.hits = (attacker.hits ?? 0) + 1;
    if (target.hp === 0) {
      const r = knockDown(state, target, attacker, { crit, damage, heavy: weapon.heavy });
      if (r === 'held') {
        held = true;
      } else if (r === 'downed') {
        killed = true;
        target.downed = true;
        wentDown = true;
      } else {
        killed = true;
        fate = r;
        if (hasFlag(attacker, 'secondWind') && attacker.alive) {
          const was = attacker.hp;
          attacker.hp = Math.min(attacker.maxHp, attacker.hp + SECOND_WIND_HEAL);
          if (attacker.hp > was) state.log.push({ team: attacker.team, text: `${attacker.name} gets a second wind (+${attacker.hp - was} HP).`, at: [{ ...attacker.pos }] });
        }
      }
    }
    if (!killed) {
      breakOnHit(target);
      for (const inf of weapon.inflicts ?? []) {
        if (rand(state) < inf.chance && addStatus(target, inf.effect, inf.turns)) inflicted.push(inf.effect);
      }
    }
  }
  // fragile weapons give out; only the thing actually in your hands can break
  let broke = false;
  const br = weapon.breakChance;
  if (br && weapon === attacker.weapon && attacker.alive !== false && rand(state) < br) broke = true;

  const prefix = overwatch ? 'Overwatch: ' : opportunity ? 'Parting blow: ' : '';
  const fall = wentDown
    ? ` - ${target.name} is DOWN, needs a revive!`
    : held
      ? ` - ${target.name} will not go down!`
      : fate === 'unconscious'
        ? ' - knocked out!'
        : fate === 'dead' && target.team === 'enemy'
          ? ' - killed!'
          : ' - down!';
  const names = inflicted.map((i) => STATUSES[i].name.toLowerCase());
  const outcome = hit ? `${crit ? 'CRIT ' : ''}${damage} dmg${killed || held ? fall : ''}${names.length ? ` (${names.join(', ')})` : ''}` : 'miss';
  state.log.push({
    team: attacker.team,
    text: `${prefix}${attacker.name} (${weapon.name}) -> ${target.name}: ${outcome} [${preview.hitChance}%]`,
    at: [{ ...attacker.pos }, { ...target.pos }],
  });
  const weaponName = weapon.name;
  if (broke) breakWeapon(state, attacker);

  return {
    type: 'shoot',
    attackerId: attacker.id,
    targetId: target.id,
    hit,
    crit,
    damage,
    killed,
    ...(wentDown ? { downed: true } : {}),
    ...(held ? { held: true } : {}),
    ...(fate && target.team === 'enemy' ? { fate } : {}),
    overwatch,
    hitChance: preview.hitChance,
    ...(opportunity ? { opportunity: true } : {}),
    ...(broke ? { broke: true, weaponName } : {}),
    ...(inflicted.length ? { inflicted } : {}),
  };
}
