import { describe, expect, it } from 'vitest';
import { zeroStats, FISTS, ITEMS, WEAPONS, gearMods, gearProblem, moveItem, packCapacity, quickMove, rivalGear, slotsOf, startingGear, weaponOfGear } from './index';
import { type Gear } from './items';

describe('items', () => {
  it('every stock weapon has an item, and every item id is unique to its def', () => {
    for (const k of Object.keys(WEAPONS)) expect(ITEMS[k]?.weapon, k).toBe(k);
    for (const [id, d] of Object.entries(ITEMS)) expect(d.id).toBe(id);
  });

  it('hands decide the weapon, falling back to fists', () => {
    expect(weaponOfGear({ rightHand: 'javelin' })).toBe(WEAPONS.javelin);
    expect(weaponOfGear({ leftHand: 'slingshot' })).toBe(WEAPONS.slingshot);
    expect(weaponOfGear({})).toBe(FISTS);
  });

  it('worn armour adds stats; carried armour does not', () => {
    expect(gearMods({ head: 'helmet', shoes: 'runners' })).toMatchObject({ rangedDefense: 3, meleeDefense: 3, mobility: 1 });
    expect(gearMods({ schoolbag: 'x', pack0: 'helmet', back: 'schoolbag' } as Gear).rangedDefense).toBe(0);
  });

  it('a two-hander takes both hands', () => {
    const g: Gear = { leftHand: 'slingshot' };
    const ground = ['javelin'];
    // dropping it on the left hand sends it right, and the sling in the left hand is in the way
    expect(moveItem(g, ground, { ground: 0 }, { slot: 'leftHand' }).ok).toBe(false);
    expect(g).toEqual({ leftHand: 'slingshot' });
    delete g.leftHand;
    expect(moveItem(g, ground, { ground: 0 }, { slot: 'leftHand' }).ok).toBe(true);
    expect(g.rightHand).toBe('javelin');
    expect(moveItem(g, [], { slot: 'rightHand' }, { slot: 'leftHand' }).ok).toBe(true);
    expect(gearProblem(g)).toBeNull();
  });

  it('swaps when the target is full and the other item fits back', () => {
    const g: Gear = { head: 'cap' };
    const ground = ['helmet'];
    expect(moveItem(g, ground, { ground: 0 }, { slot: 'head' }).ok).toBe(true);
    expect(g.head).toBe('helmet');
    expect(ground).toEqual(['cap']);
  });

  it('rejects items in the wrong slot and leaves everything alone', () => {
    const g: Gear = {};
    const ground = ['helmet'];
    expect(moveItem(g, ground, { ground: 0 }, { slot: 'shoes' }).ok).toBe(false);
    expect(ground).toEqual(['helmet']);
  });

  it('pack slots exist only while a pack is worn, and cannot hold a pack', () => {
    const g: Gear = { back: 'schoolbag' };
    expect(packCapacity(g)).toBe(4);
    expect(slotsOf(g)).toContain('pack3');
    const ground = ['bandage', 'hikingpack'];
    expect(moveItem(g, ground, { ground: 0 }, { slot: 'pack0' }).ok).toBe(true);
    expect(moveItem(g, ground, { ground: 0 }, { slot: 'pack1' }).ok).toBe(false);
    // taking the bag off with things in it is refused
    expect(moveItem(g, ground, { slot: 'back' }, { ground: 0 }).ok).toBe(false);
    expect(g.back).toBe('schoolbag');
  });

  it('quick move equips from the ground and stows worn items', () => {
    const g: Gear = { back: 'schoolbag' };
    const ground = ['boots', 'bandage'];
    expect(quickMove(g, ground, { ground: 0 }).ok).toBe(true);
    expect(g.shoes).toBe('boots');
    expect(quickMove(g, ground, { ground: 0 }).ok).toBe(true);
    expect(g.belt1).toBe('bandage');
    expect(quickMove(g, ground, { slot: 'shoes' }).ok).toBe(true);
    expect(g.pack0).toBe('boots');
  });

  it('starting kits change nothing: class weapon, no stat mods', () => {
    const g = startingGear('javelin', true);
    expect(weaponOfGear(g)).toBe(WEAPONS.javelin);
    expect(gearMods(g)).toEqual(zeroStats());
    expect(gearProblem(g)).toBeNull();
  });

  it('rival gear is seeded and always legal', () => {
    const a = rivalGear('pole', 3, { rngState: 7 });
    const b = rivalGear('pole', 3, { rngState: 7 });
    expect(a).toEqual(b);
    for (let i = 0; i < 100; i++) {
      const g = rivalGear('javelin', 1 + (i % 4), { rngState: i });
      expect(gearProblem(g)).toBeNull();
      expect(weaponOfGear(g).name).toBe('Javelin');
    }
  });
});
