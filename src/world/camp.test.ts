import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { AMBUSH_BY_DANGER, ambushChance, bandages, captiveAction, canAct, convertChance, dayOf, followers, morning, rollAmbush, treatMember } from './camp';
import { ensureStores, type Captive } from './spoils';

const world = (seed = 5) => createWorld(seed);
const captive = (over: Partial<Captive> = {}): Captive => ({ uid: 'c1', name: 'Orla', role: 'Goth', injuries: [], status: 'captive', defiance: 60, ...over });

describe('the night', () => {
  it('safe ground never ambushes; danger raises the odds; a watch halves them', () => {
    const w = world();
    expect(rollAmbush(w, { danger: 0 })).toBe(false);
    for (let d = 1; d <= 4; d++) expect(ambushChance(d, false)).toBeGreaterThan(ambushChance(d - 1, false));
    expect(ambushChance(3, true)).toBeCloseTo(AMBUSH_BY_DANGER[3] / 2);
    let hits = 0;
    for (let i = 0; i < 2000; i++) if (rollAmbush(world(i), { danger: 4 })) hits++;
    expect(hits / 2000).toBeGreaterThan(0.3);
    expect(hits / 2000).toBeLessThan(0.5);
  });

  it('morning advances the day, heals by how the night went, and ticks injuries', () => {
    const w = world();
    const [pc, amy] = w.roster;
    pc.hp = 1;
    amy.hp = 1;
    amy.injuries = [{ id: 'shaken', left: 1 }, { id: 'torn-tendon', left: 6 }];
    expect(dayOf(w)).toBe(1);
    const notes = morning(w, 'quiet', pc.id);
    expect(w.day).toBe(2);
    expect(amy.hp).toBeGreaterThan(pc.hp); // the watcher heals less
    expect(amy.injuries).toEqual([{ id: 'torn-tendon', left: 5 }]);
    expect(notes.join(' ')).toMatch(/recovered from shaken up/);
    morning(w, 'home');
    expect(w.roster.every((m) => m.dead || m.hp > 0)).toBe(true);
    expect(amy.injuries[0].left).toBe(3); // twice as fast at home
  });

  it('a rough night heals less than a quiet one', () => {
    const a = world();
    const b = world();
    a.roster[1].hp = 1;
    b.roster[1].hp = 1;
    morning(a, 'quiet');
    morning(b, 'ambushed');
    expect(a.roster[1].hp).toBeGreaterThan(b.roster[1].hp);
  });
});

describe('treating the wounded', () => {
  it('uses a bandage, takes days off, and cannot treat a scar', () => {
    const w = world();
    const m = w.roster[2];
    m.injuries = [{ id: 'torn-tendon', left: 6 }, { id: 'lost-leg', left: 0 }];
    expect(treatMember(w, m.id, 'torn-tendon').ok).toBe(false); // no bandage yet
    ensureStores(w).stash.push('bandage', 'bandage');
    expect(bandages(w)).toBe(2);
    const r = treatMember(w, m.id, 'torn-tendon');
    expect(r.ok).toBe(true);
    expect(bandages(w)).toBe(1);
    expect(m.injuries.find((i) => i.id === 'torn-tendon')!.left).toBeLessThanOrEqual(4); // Home Ec on the squad: 3 days
    expect(treatMember(w, m.id, 'lost-leg').ok).toBe(false);
    expect(bandages(w)).toBe(1);
  });
});

describe('prisoners', () => {
  const setup = (c: Partial<Captive> = {}) => {
    const w = world();
    ensureStores(w).captives.push(captive(c));
    return w;
  };

  it('conversion odds fall with defiance and a beating lowers it', () => {
    expect(convertChance(captive({ defiance: 90 }))).toBeLessThan(convertChance(captive({ defiance: 30 })));
    const w = setup();
    const before = w.captives![0].defiance!;
    expect(captiveAction(w, 'c1', 'beat').ok).toBe(true);
    expect(w.captives![0].defiance).toBe(before - 20);
    expect(w.mercy?.cruelty).toBe(1);
  });

  it('one thing a day, except execution', () => {
    const w = setup();
    expect(captiveAction(w, 'c1', 'beat').ok).toBe(true);
    expect(captiveAction(w, 'c1', 'beat').ok).toBe(false);
    expect(canAct(w, w.captives![0], 'execute')).toBeNull();
    morning(w, 'quiet');
    expect(captiveAction(w, 'c1', 'beat').ok).toBe(true);
  });

  it('a willing prisoner becomes a worker or a fighter; they stop being a prisoner', () => {
    const w = setup({ defiance: 0 });
    let r = captiveAction(w, 'c1', 'worker');
    for (let i = 0; i < 12 && w.captives![0].status === 'captive'; i++) {
      w.captives![0].actedDay = undefined;
      r = captiveAction(w, 'c1', 'worker');
    }
    expect(r.ok).toBe(true);
    expect(w.captives![0].status).toBe('worker');
    expect(followers(w, 'worker')).toHaveLength(1);
    expect(captiveAction(w, 'c1', 'fighter').ok).toBe(false);
  });

  it('ransom pays scrap and frees them; execute leaves remains', () => {
    let freed = false;
    for (let seed = 1; seed < 30 && !freed; seed++) {
      const w = world(seed);
      ensureStores(w).captives.push(captive());
      const scrap = w.scrap;
      captiveAction(w, 'c1', 'ransom');
      if (w.captives!.length === 0) {
        freed = true;
        expect(w.scrap).toBeGreaterThan(scrap);
        expect(w.mercy?.ransomed).toBe(1);
      }
    }
    expect(freed).toBe(true);
    const w = setup();
    captiveAction(w, 'c1', 'execute');
    expect(w.captives).toEqual([]);
    expect(w.stash).toContain('remains');
    expect(w.mercy?.executed).toBe(1);
  });

  it('target practice trains the helper and hurts or kills the prisoner; medical practice needs a bandage and an injury', () => {
    const w = setup();
    const helper = w.roster[1];
    const xp = helper.xp;
    expect(captiveAction(w, 'c1', 'target', helper.id).ok).toBe(true);
    expect(helper.xp).toBeGreaterThan(xp);
    const w2 = setup({ injuries: [{ id: 'concussion', left: 2 }] });
    expect(captiveAction(w2, 'c1', 'medical', w2.roster[1].id).ok).toBe(false); // no bandage
    ensureStores(w2).stash.push('bandage');
    expect(captiveAction(w2, 'c1', 'medical', w2.roster[1].id).ok).toBe(true);
    expect(bandages(w2)).toBe(0);
    expect(setup() && captiveAction(setup(), 'c1', 'medical').ok).toBe(false); // nothing to treat
  });
});
