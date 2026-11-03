import type { BattleEvent, CoverType, GameMap, GameState, Pos, Unit } from './types';
import { coverAgainst, dist, hasLineOfSight, isFlanked } from './grid';
import { rand, randInt } from './rng';

export const COVER_PENALTY: Record<CoverType, number> = { none: 0, half: 20, full: 40 };
export const OVERWATCH_PENALTY = 15;
export const FLANK_CRIT_BONUS = 25;
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
  dmgMin: number;
  dmgMax: number;
  distance: number;
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
  const base = { cover, flanked, dmgMin: w.damage[0], dmgMax: w.damage[1], distance, hitChance: 0, critChance: 0 };

  if (distance > w.range) return { ...base, canShoot: false, reason: 'Out of range' };
  if (!hasLineOfSight(map, from, target.pos)) return { ...base, canShoot: false, reason: 'No line of sight' };

  const rangePenalty = Math.max(0, distance - w.optimal) * RANGE_PENALTY_PER_TILE;
  const hit =
    shooter.aim + w.aimMod - target.defense - COVER_PENALTY[cover] - rangePenalty - (overwatch ? OVERWATCH_PENALTY : 0);
  const crit = shooter.critChance + w.critMod + (flanked ? FLANK_CRIT_BONUS : 0);

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

  if (hit) {
    crit = rand(state) * 100 < preview.critChance;
    damage = randInt(state, attacker.weapon.damage[0], attacker.weapon.damage[1]);
    if (crit) damage = Math.floor(damage * 1.5);
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp === 0) {
      target.alive = false;
      target.overwatch = false;
      killed = true;
    }
  }

  const prefix = overwatch ? 'Overwatch: ' : '';
  const outcome = hit ? `${crit ? 'CRIT ' : ''}${damage} dmg${killed ? ' - down!' : ''}` : 'miss';
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
    overwatch,
    hitChance: preview.hitChance,
  };
}
