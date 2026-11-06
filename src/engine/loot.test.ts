import { describe, expect, it } from 'vitest';
import { WEAPONS, allLoot, bodiesAt, deathChance, dropsOf, lootAt, moveGear, onFall, quickMoveGear, resolveShot, computeShot, createStarterRoster, deployRoster, applyBattleResult, gearOf, weaponOf, effectiveStats, beachLanding, createBattle } from './index';
import { arena, open, unit } from './testutil';

const sling = WEAPONS.slingshot;

describe('how rivals go down', () => {
  it('crits, overkill and heavy weapons make death likelier, and it is never certain', () => {
    const v = { maxHp: 10 };
    const base = deathChance({ crit: false, damage: 1, heavy: false }, v);
    expect(deathChance({ crit: true, damage: 1, heavy: false }, v)).toBeGreaterThan(base);
    expect(deathChance({ crit: false, damage: 9, heavy: false }, v)).toBeGreaterThan(base);
    expect(deathChance({ crit: false, damage: 1, heavy: true }, v)).toBeGreaterThan(base);
    expect(deathChance({ crit: true, damage: 99, heavy: true }, v)).toBeLessThan(1);
    expect(base).toBeGreaterThan(0);
  });

  it('out cold keeps everything; killed keeps each item by its own chance, plus remains', () => {
    const gear = { rightHand: 'javelin', head: 'helmet', belt1: 'bandage', chest: 'uniform' };
    expect(dropsOf(gear, 'unconscious', { rngState: 1 }).sort()).toEqual(['bandage', 'helmet', 'javelin', 'uniform']);
    const lots = Array.from({ length: 200 }, (_, i) => dropsOf(gear, 'dead', { rngState: i }));
    expect(lots.every((d) => d.includes('remains'))).toBe(true);
    const uniform = lots.filter((d) => d.includes('uniform')).length;
    const bandage = lots.filter((d) => d.includes('bandage')).length;
    expect(bandage).toBeGreaterThan(uniform);
    expect(uniform).toBeLessThan(200);
    expect(uniform).toBeGreaterThan(0);
  });

  it('a rival who is shot to 0 either dies or is knocked out, and what is lootable lands on their tile', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 200 && seen.size < 2; seed++) {
      const a = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, aim: 200, weapon: { ...sling, damage: [20, 20] } });
      const e = unit({ id: 'e', team: 'enemy', pos: { x: 3, y: 1 }, hp: 5, maxHp: 5, gear: { rightHand: 'slingshot', belt1: 'bandage' } });
      const state = arena(open(8, 4), [a, e], seed);
      const ev = resolveShot(state, a, e, computeShot(state.map, a, a.pos, e), false);
      if (e.alive) continue; // missed
      expect(e.fate).toBe(ev.type === 'shoot' ? ev.fate : undefined);
      seen.add(e.fate as string);
      expect(bodiesAt(state, e.pos)).toEqual([e]);
      expect(e.gear).toEqual({});
      if (e.fate === 'unconscious') expect(lootAt(state, e.pos).sort()).toEqual(['bandage', 'slingshot']);
      else expect(lootAt(state, e.pos)).toContain('remains');
    }
    expect(seen).toEqual(new Set(['dead', 'unconscious']));
  });

  it('a fallen companion drops everything they had', () => {
    const state = arena(open(6, 4), [unit({ id: 'p', team: 'player', pos: { x: 2, y: 2 }, gear: { rightHand: 'javelin', head: 'cap' } })]);
    onFall(state, state.units[0], { crit: false, damage: 3, heavy: false });
    expect(allLoot(state).sort()).toEqual(['cap', 'javelin']);
  });
});

describe('changing gear in a fight', () => {
  const setup = (gear: Record<string, string>, ground: string[] = []) => {
    const u = unit({ id: 'p', team: 'player', pos: { x: 2, y: 2 }, gear, weapon: WEAPONS.slingshot, ammo: 2, maxHp: 10, hp: 10 });
    const state = arena(open(6, 4), [u]);
    if (ground.length) state.ground = { '2,2': ground };
    return { u, state };
  };

  it('armour is free and changes stats at once', () => {
    const { u, state } = setup({ rightHand: 'slingshot' }, ['helmet']);
    const r = moveGear(state, u, { ground: 0 }, { slot: 'head' });
    expect(r).toMatchObject({ ok: true, ap: 0 });
    expect(u.defense).toBe(3);
    expect(u.ap).toBe(2);
    expect(state.ground).toBeUndefined();
    moveGear(state, u, { slot: 'head' }, { ground: 0 });
    expect(u.defense).toBe(0);
    expect(lootAt(state, u.pos)).toEqual(['helmet']);
  });

  it('a new weapon costs 1 AP, comes with a full clip, and needs the AP', () => {
    const { u, state } = setup({ rightHand: 'slingshot' }, ['flareGun']);
    u.ap = 0;
    expect(moveGear(state, u, { ground: 0 }, { slot: 'rightHand' }).ok).toBe(false);
    expect(u.weapon).toBe(WEAPONS.slingshot);
    expect(lootAt(state, u.pos)).toEqual(['flareGun']);
    u.ap = 2;
    expect(moveGear(state, u, { ground: 0 }, { slot: 'rightHand' })).toMatchObject({ ok: true, ap: 1 });
    expect(u.ap).toBe(1);
    expect(u.weapon).toBe(WEAPONS.flareGun);
    expect(u.ammo).toBe(WEAPONS.flareGun.clip);
    expect(lootAt(state, u.pos)).toEqual(['slingshot']);
  });

  it('a pack can be worn and loaded; quick move fills the first free slot', () => {
    const { u, state } = setup({ rightHand: 'slingshot', belt1: 'bandage' }, ['schoolbag']);
    expect(quickMoveGear(state, u, { ground: 0 }).ok).toBe(true);
    expect(u.gear?.back).toBe('schoolbag');
    expect(quickMoveGear(state, u, { slot: 'belt1' }).ok).toBe(true);
    expect(u.gear?.pack0).toBe('bandage');
  });

  it('refuses on the other side\'s turn or once the fight is over', () => {
    const { u, state } = setup({ rightHand: 'slingshot' }, ['helmet']);
    state.active = 'enemy';
    expect(moveGear(state, u, { ground: 0 }, { slot: 'head' }).ok).toBe(false);
    state.active = 'player';
    state.winner = 'player';
    expect(moveGear(state, u, { ground: 0 }, { slot: 'head' }).ok).toBe(false);
  });
});

describe('gear and the roster', () => {
  it('starting kits change nothing about stats or weapons', () => {
    const roster = createStarterRoster();
    const scott = roster.find((m) => m.id === 'p2')!;
    expect(weaponOf(scott)).toBe(WEAPONS.javelin);
    const bare = effectiveStats({ ...scott, gear: { rightHand: 'javelin' } });
    expect(effectiveStats(scott)).toEqual(bare);
  });

  it('a save with no gear gets the class kit', () => {
    const m = createStarterRoster()[1];
    delete m.gear;
    expect(gearOf(m).rightHand).toBe('slingshot');
  });

  it('worn armour raises stats; deploying and coming home carries gear both ways', () => {
    const roster = createStarterRoster();
    const amy = roster.find((m) => m.id === 'p1')!;
    const before = effectiveStats(amy).rangedDefense;
    amy.gear = { ...gearOf(amy), head: 'helmet' };
    expect(effectiveStats(amy).rangedDefense).toBe(before + 3);
    const sc = deployRoster(beachLanding, roster);
    const spec = sc.units.find((u) => u.id === 'p1')!;
    expect(spec.gear?.head).toBe('helmet');
    expect(spec.defense).toBe(before + 3);
  });

  it('gear picked up in a fight is kept after it, and the dead leave nothing behind', () => {
    const roster = createStarterRoster();
    const sc = deployRoster(beachLanding, roster);
    const state = createBattle(sc);
    const amy = state.units.find((u) => u.id === 'p1')!;
    amy.gear = { ...amy.gear, shoes: 'boots' };
    const tyson = state.units.find((u) => u.id === 'p3')!;
    tyson.alive = false;
    tyson.hp = 0;
    state.winner = 'player';
    applyBattleResult(roster, state, { rngState: 3 });
    expect(roster.find((m) => m.id === 'p1')!.gear?.shoes).toBe('boots');
    expect(roster.find((m) => m.id === 'p3')).toMatchObject({ dead: true, gear: {} });
  });
});
