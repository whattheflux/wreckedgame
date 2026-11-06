import type { BattleEvent, CoverType, GameMap, GameState, Pos, Unit } from './types';
import { coverAgainst, dist, hasLineOfSight, isFlanked } from './grid';
import { rand, randInt } from './rng';
import { onFall } from './loot';

export const COVER_PENALTY: Record<CoverType, number> = { none: 0, half: 20, full: 40 };
export const OVERWATCH_PENALTY = 15;
/** A flanked target (hugging cover, but not on the side you are shooting from) is crit-certain: if the shot lands, it crits. */
export const FLANK_CRIT_CHANCE = 100;
/** A target with no cover against you at all (and nothing to flank) is easier to hurt badly: +crit points. */
export const EXPOSED_CRIT_BONUS = 15;
export const RANGE_PENALTY_PER_TILE = 4;

export type Shooter = Pick<Unit, 'aim' | 'critChance' | 'weapon'>;
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
  const cover = coverAgainst(map, from, target.pos);
  const flanked = isFlanked(map, from, target.pos);
  const exposed = cover === 'none' && !flanked;
  const rangePenalty = Math.max(0, distance - w.optimal) * RANGE_PENALTY_PER_TILE;
  const base = {
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
  if (!hasLineOfSight(map, from, target.pos)) return { ...base, canShoot: false, reason: 'No line of sight' };

  const hit =
    shooter.aim + w.aimMod - target.defense - COVER_PENALTY[cover] - rangePenalty - (overwatch ? OVERWATCH_PENALTY : 0);
  const crit = flanked ? FLANK_CRIT_CHANCE : shooter.critChance + w.critMod + (exposed ? EXPOSED_CRIT_BONUS : 0);

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
): BattleEvent {
  const hit = rand(state) * 100 < preview.hitChance;
  let crit = false;
  let damage = 0;
  let killed = false;
  let wentDown = false;
  let fate: 'dead' | 'unconscious' | undefined;

  if (hit) {
    crit = rand(state) * 100 < preview.critChance;
    damage = randInt(state, attacker.weapon.damage[0], attacker.weapon.damage[1]);
    if (crit) damage = Math.floor(damage * 1.5);
    target.hp = Math.max(0, target.hp - damage);
    attacker.hits = (attacker.hits ?? 0) + 1;
    if (target.hp === 0) {
      target.alive = false;
      target.overwatch = false;
      killed = true;
      if (target.protagonist && (target.downs ?? 0) === 0) {
        // The player character's first fall in a battle is a knock-down, not a death: an ally can revive them.
        target.downs = 1;
        target.downed = true;
        wentDown = true;
      } else {
        attacker.kills = (attacker.kills ?? 0) + 1;
        fate = onFall(state, target, { crit, damage, heavy: attacker.weapon.heavy });
      }
    }
  }

  const prefix = overwatch ? 'Overwatch: ' : '';
  const fall = wentDown
    ? ` - ${target.name} is DOWN, needs a revive!`
    : fate === 'unconscious'
      ? ' - knocked out!'
      : fate === 'dead' && target.team === 'enemy'
        ? ' - killed!'
        : ' - down!';
  const outcome = hit ? `${crit ? 'CRIT ' : ''}${damage} dmg${killed ? fall : ''}` : 'miss';
  state.log.push({
    team: attacker.team,
    text: `${prefix}${attacker.name} (${attacker.weapon.name}) -> ${target.name}: ${outcome} [${preview.hitChance}%]`,
    at: [{ ...attacker.pos }, { ...target.pos }],
  });

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
  };
}
