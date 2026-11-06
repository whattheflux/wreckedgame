import type { BattleEvent, CoverType, GameMap, GameState, Pos, Unit, Weapon } from './types';
import { coverAgainst, dist, hasLineOfSight, isFlanked } from './grid';
import { rand, randInt } from './rng';
import { breakWeapon, knockDown } from './loot';
import { STATUSES, addStatus, breakOnHit, removeStatus, statusMods } from './status';
import type { StatusId } from './types';

export const COVER_PENALTY: Record<CoverType, number> = { none: 0, half: 20, full: 40 };
export const OVERWATCH_PENALTY = 15;
/** A flanked target (hugging cover, but not on the side you are shooting from) is crit-certain: if the shot lands, it crits. */
export const FLANK_CRIT_CHANCE = 100;
/** A target with no cover against you at all (and nothing to flank) is easier to hurt badly: +crit points. */
export const EXPOSED_CRIT_BONUS = 15;
export const RANGE_PENALTY_PER_TILE = 4;

export type Shooter = Pick<Unit, 'aim' | 'critChance' | 'weapon'> & Partial<Pick<Unit, 'status'>>;
export type Targetable = Pick<Unit, 'defense' | 'pos' | 'hp'>;

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
  const cover = melee ? 'none' : coverAgainst(map, from, target.pos);
  const flanked = melee ? false : isFlanked(map, from, target.pos);
  const exposed = cover === 'none' && !flanked;
  const rangePenalty = melee ? 0 : Math.max(0, distance - w.optimal) * RANGE_PENALTY_PER_TILE;
  const mods = statusMods(shooter);
  const base = {
    melee,
    cover,
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

  const hit =
    shooter.aim + mods.aim + w.aimMod - target.defense - COVER_PENALTY[cover] - rangePenalty - (overwatch ? OVERWATCH_PENALTY : 0);
  const crit = flanked ? FLANK_CRIT_CHANCE : shooter.critChance + mods.crit + w.critMod + (melee ? 0 : exposed ? EXPOSED_CRIT_BONUS : 0);

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
  let fate: 'dead' | 'unconscious' | undefined;
  const inflicted: StatusId[] = [];

  if (hit) {
    crit = rand(state) * 100 < preview.critChance;
    damage = randInt(state, weapon.damage[0], weapon.damage[1]);
    if (crit) damage = Math.floor(damage * 1.5);
    target.hp = Math.max(0, target.hp - damage);
    attacker.hits = (attacker.hits ?? 0) + 1;
    if (target.hp === 0) {
      killed = true;
      const r = knockDown(state, target, attacker, { crit, damage, heavy: weapon.heavy });
      if (r === 'downed') {
        target.downed = true;
        wentDown = true;
      } else fate = r;
    } else {
      breakOnHit(target);
      for (const inf of weapon.inflicts ?? []) {
        if (rand(state) < inf.chance) {
          addStatus(target, inf.effect, inf.turns);
          inflicted.push(inf.effect);
        }
      }
    }
  }
  // fragile weapons give out; rolled only for weapons that can (so old seeded fights are unchanged)
  let broke = false;
  const br = weapon.breakChance;
  if (br && weapon === attacker.weapon && attacker.alive !== false && rand(state) < br) broke = true;

  const prefix = overwatch ? 'Overwatch: ' : opportunity ? 'Parting blow: ' : '';
  const fall = wentDown
    ? ` - ${target.name} is DOWN, needs a revive!`
    : fate === 'unconscious'
      ? ' - knocked out!'
      : fate === 'dead' && target.team === 'enemy'
        ? ' - killed!'
        : ' - down!';
  const names = inflicted.map((i) => STATUSES[i].name.toLowerCase());
  const outcome = hit ? `${crit ? 'CRIT ' : ''}${damage} dmg${killed ? fall : ''}${names.length ? ` (${names.join(', ')})` : ''}` : 'miss';
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
    ...(fate && target.team === 'enemy' ? { fate } : {}),
    overwatch,
    hitChance: preview.hitChance,
    ...(opportunity ? { opportunity: true } : {}),
    ...(broke ? { broke: true, weaponName } : {}),
    ...(inflicted.length ? { inflicted } : {}),
  };
}
