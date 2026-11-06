import { describe, expect, it } from 'vitest';
import { WEAPONS, STATUSES, addStatus, computeShot, endTurn, hasStatus, moveUnit, reviveUnit, setOverwatch, shoot, resolveShot, tickStatuses, ITEMS } from './index';
import { arena, open, unit } from './testutil';

const bat = WEAPONS.stick;

describe('melee weapons', () => {
  it('only reach adjacent targets, ignore cover and never use ammo', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, weapon: WEAPONS.knife });
    const near = unit({ id: 'n', team: 'enemy', pos: { x: 2, y: 1 } });
    const far = unit({ id: 'f', team: 'enemy', pos: { x: 4, y: 1 } });
    const s = arena(open(8, 4), [a, near, far]);
    expect(computeShot(s.map, a, a.pos, near).canShoot).toBe(true);
    expect(computeShot(s.map, a, a.pos, near).cover).toBe('none');
    expect(computeShot(s.map, a, a.pos, far)).toMatchObject({ canShoot: false, reason: 'Out of range' });
    const ammo = a.ammo;
    expect(shoot(s, 'a', 'n').ok).toBe(true);
    expect(a.ammo).toBe(ammo);
  });

  it('cannot hold overwatch', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, weapon: bat });
    const s = arena(open(8, 4), [a, unit({ id: 'e', team: 'enemy', pos: { x: 6, y: 3 } })]);
    expect(setOverwatch(s, 'a').ok).toBe(false);
  });

  it('every melee weapon has an item, a tier and a sane break chance; low tiers are more fragile', () => {
    const melee = Object.entries(WEAPONS).filter(([, w]) => (w as { melee?: boolean }).melee);
    expect(melee.length).toBeGreaterThanOrEqual(15);
    const avg = (t: number): number => {
      const l = melee.filter(([, w]) => (w as { tier?: number }).tier === t).map(([, w]) => (w as { breakChance?: number }).breakChance ?? 0);
      return l.reduce((x, y) => x + y, 0) / l.length;
    };
    expect(avg(0)).toBeGreaterThan(avg(1));
    expect(avg(1)).toBeGreaterThan(avg(2));
    for (const [k] of melee) expect(ITEMS[k]).toBeTruthy();
  });

  it('a weapon with a break chance eventually breaks and the unit falls back to fists', () => {
    const w = { ...bat, breakChance: 1, damage: [1, 1] as [number, number] };
    const a = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, weapon: w, gear: { rightHand: 'stick' } });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 2, y: 1 }, hp: 50, maxHp: 50 });
    const s = arena(open(8, 4), [a, e]);
    const ev = resolveShot(s, a, e, computeShot(s.map, a, a.pos, e), false);
    expect(ev.type === 'shoot' && ev.broke).toBe(true);
    expect(a.gear?.rightHand).toBeUndefined();
    expect(a.weapon.name).toBe('Fists');
  });
});

describe('status effects', () => {
  it('a hit can inflict a status, and re-inflicting only lengthens it', () => {
    const w = { ...bat, breakChance: 0, damage: [1, 1] as [number, number], inflicts: [{ effect: 'bleed' as const, chance: 1 }] };
    const a = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, aim: 500, weapon: w });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 2, y: 1 }, hp: 20, maxHp: 20 });
    const s = arena(open(8, 4), [a, e]);
    resolveShot(s, a, e, computeShot(s.map, a, a.pos, e), false);
    expect(hasStatus(e, 'bleed')).toBe(true);
    addStatus(e, 'bleed', 1);
    expect(e.status?.[0].turns).toBe(STATUSES.bleed.turns);
  });

  it('bleed hurts at the start of its owner’s turn, then runs out; poison never kills', () => {
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 2, y: 1 }, hp: 5, maxHp: 5 });
    const p = unit({ id: 'p', team: 'player', pos: { x: 1, y: 1 }, hp: 1, maxHp: 5 });
    const s = arena(open(8, 4), [p, e]);
    addStatus(e, 'bleed', 2);
    addStatus(p, 'poison', 3);
    tickStatuses(s, 'enemy');
    expect(e.hp).toBe(4);
    tickStatuses(s, 'enemy');
    expect(e.hp).toBe(3);
    expect(e.status).toBeUndefined();
    tickStatuses(s, 'player');
    expect(p.hp).toBe(1);
    expect(p.alive).toBe(true);
  });

  it('burn can kill, and a stun costs the whole next turn', () => {
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 2, y: 1 }, hp: 2, maxHp: 5 });
    const p = unit({ id: 'p', team: 'player', pos: { x: 1, y: 1 } });
    const s = arena(open(8, 4), [p, e]);
    addStatus(e, 'burn', 2);
    tickStatuses(s, 'enemy');
    expect(e.alive).toBe(false);
    addStatus(p, 'stun');
    s.active = 'enemy';
    endTurn(s);
    expect(s.active).toBe('player');
    expect(p.ap).toBe(0);
    expect(p.status).toBeUndefined();
  });

  it('silenced units cannot revive and blind ruins aim', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 } });
    const d = unit({ id: 'd', team: 'player', pos: { x: 2, y: 1 }, alive: false, downed: true });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 6, y: 1 } });
    const s = arena(open(8, 4), [a, d, e]);
    addStatus(a, 'silenced');
    expect(reviveUnit(s, 'a', 'd').ok).toBe(false);
    expect(setOverwatch(s, 'a').ok).toBe(false);
    const clear = computeShot(s.map, { ...a, status: undefined }, a.pos, e).hitChance;
    addStatus(a, 'blind');
    expect(computeShot(s.map, a, a.pos, e).hitChance).toBeLessThan(clear);
  });
});

describe('opportunity attacks', () => {
  it('walking away from an adjacent melee enemy draws a free swing; ranged enemies do not', () => {
    const mover = unit({ id: 'm', team: 'player', pos: { x: 3, y: 2 }, mobility: 6, hp: 99, maxHp: 99 });
    const brute = unit({ id: 'b', team: 'enemy', pos: { x: 4, y: 2 }, aim: 500, weapon: { ...WEAPONS.stick, breakChance: 0 } });
    const s = arena(open(10, 6), [mover, brute]);
    const r = moveUnit(s, 'm', { x: 1, y: 2 });
    expect(r.ok).toBe(true);
    const swings = r.events.filter((e) => e.type === 'shoot' && e.opportunity);
    expect(swings).toHaveLength(1);
    expect(brute.ap).toBe(brute.maxAp);

    const shooter = unit({ id: 's', team: 'enemy', pos: { x: 4, y: 2 }, aim: 500 });
    const m2 = unit({ id: 'm', team: 'player', pos: { x: 3, y: 2 }, mobility: 6 });
    const s2 = arena(open(10, 6), [m2, shooter]);
    expect(moveUnit(s2, 'm', { x: 1, y: 2 }).events.some((e) => e.type === 'shoot')).toBe(false);
  });

  it('a stunned enemy gets no parting blow, and moving along its edge does not provoke', () => {
    const mover = unit({ id: 'm', team: 'player', pos: { x: 3, y: 2 }, mobility: 6 });
    const brute = unit({ id: 'b', team: 'enemy', pos: { x: 4, y: 2 }, aim: 500, weapon: WEAPONS.stick });
    addStatus(brute, 'stun');
    const s = arena(open(10, 6), [mover, brute]);
    expect(moveUnit(s, 'm', { x: 1, y: 2 }).events.some((e) => e.type === 'shoot')).toBe(false);
    const m3 = unit({ id: 'm', team: 'player', pos: { x: 3, y: 2 }, mobility: 6 });
    const b3 = unit({ id: 'b', team: 'enemy', pos: { x: 4, y: 2 }, aim: 500, weapon: WEAPONS.stick });
    const s3 = arena(open(10, 6), [m3, b3]);
    expect(moveUnit(s3, 'm', { x: 3, y: 3 }).events.some((e) => e.type === 'shoot')).toBe(false);
  });
});
