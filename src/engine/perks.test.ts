import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  CLASS_POOL,
  CLASS_STARTER,
  CLIQUES,
  CLIQUE_POOL,
  CLIQUE_STARTER,
  DUELIST_AIM,
  EXTRA_SKILLS,
  OVERWATCH_PENALTY,
  PERKS,
  POINT_BLANK_BONUS,
  SCROUNGER_BONUS,
  SECOND_WIND_HEAL,
  WEAPONS,
  addStatus,
  computeShot,
  createStarterRoster,
  dropsOf,
  eligible,
  grantedSkills,
  hasFlag,
  hasStatus,
  moveGear,
  moveUnit,
  offerPerks,
  perkFlags,
  perkMods,
  reload,
  resolveShot,
  setOverwatch,
  shoot,
  startingPerks,
  type Clique,
  type PerkFlag,
  type SchoolClass,
} from './index';
import { arena, open, unit } from './testutil';

const flagsUsed: PerkFlag[] = [
  'coverBreaker',
  'deadeye',
  'pointBlank',
  'brawler',
  'steadyAim',
  'toughHide',
  'ironWill',
  'nimble',
  'duelist',
  'scrounger',
  'fastHands',
  'quickDraw',
  'runAndGun',
  'secondWind',
  'fieldMedic',
  'chemist',
  'showstopper',
  'understudy',
  'cannonArm',
  'unflappable',
];

describe('the perk catalogue', () => {
  it('is internally consistent: real skills, real requirements, no stray ids', () => {
    for (const [id, perk] of Object.entries(PERKS)) {
      expect(perk.id, `${id} id mismatch`).toBe(id);
      expect(perk.name.length).toBeGreaterThan(0);
      expect(perk.blurb.length).toBeGreaterThan(0);
      if (perk.grants) expect(EXTRA_SKILLS[perk.grants], `${id} grants an unknown skill`).toBeTruthy();
      if (perk.requires) expect(PERKS[perk.requires], `${id} requires an unknown perk`).toBeTruthy();
      // a perk has to actually do something
      expect(!!perk.grants || !!perk.flag || !!perk.mods, `${id} does nothing`).toBe(true);
    }
  });

  it('every flag in the type is on a perk, and every perk flag is one of them', () => {
    const onPerks = new Set(Object.values(PERKS).flatMap((p) => (p.flag ? [p.flag] : [])));
    for (const f of flagsUsed) expect(onPerks.has(f), `no perk grants ${f}`).toBe(true);
    for (const f of onPerks) expect(flagsUsed, `${f} is not in the list this file checks`).toContain(f);
  });

  it('gives every clique and class a signature perk and a pool worth choosing from', () => {
    for (const c of Object.keys(CLIQUES) as Clique[]) {
      expect(PERKS[CLIQUE_STARTER[c]], `${c} has no starter`).toBeTruthy();
      expect(CLIQUE_POOL[c].length, `${c} pool too small`).toBeGreaterThanOrEqual(4);
    }
    for (const k of Object.keys(CLASSES) as SchoolClass[]) {
      expect(PERKS[CLASS_STARTER[k]], `${k} has no starter`).toBeTruthy();
      expect(CLASS_POOL[k].length, `${k} pool too small`).toBeGreaterThanOrEqual(5);
    }
  });

  it('never puts a perk in its own pool twice, or a starter back in the pool', () => {
    for (const [c, pool] of Object.entries(CLIQUE_POOL)) {
      expect(new Set(pool).size).toBe(pool.length);
      expect(pool).not.toContain(CLIQUE_STARTER[c]);
    }
    for (const [k, pool] of Object.entries(CLASS_POOL)) {
      expect(new Set(pool).size).toBe(pool.length);
      expect(pool).not.toContain(CLASS_STARTER[k]);
    }
  });

  it('reads a set of perks into skills, flags and stat changes', () => {
    const owned = ['charmer', 'conditioning', 'deadeye'];
    expect(grantedSkills(owned)).toEqual(['charm']);
    expect(perkFlags(owned)).toEqual(['deadeye']);
    expect(perkMods(owned)).toEqual([{ hp: 5 }]);
    expect(grantedSkills(['nonsense'])).toEqual([]);
  });
});

describe('what gets offered', () => {
  it('leaves out what you have, what you cannot have yet, and what would teach a skill twice', () => {
    expect(eligible(['cannonArm'], [])).toEqual([]); // needs Throwing Arm first
    expect(eligible(['cannonArm'], ['throwArm'])).toEqual(['cannonArm']);
    expect(eligible(['conditioning'], ['conditioning'])).toEqual([]);
    // Scene Partner and Monologue both teach Rally: once you know it, neither is on offer
    expect(eligible(['scenePartner', 'monologue'], [])).toHaveLength(2);
    expect(eligible(['scenePartner', 'monologue'], ['socialite'])).toEqual([]);
  });

  it('offers the number asked for, never a repeat, and stops when the pool runs dry', () => {
    const pool = CLASS_POOL.science;
    const offer = offerPerks(pool, ['labKit'], { rngState: 7 }, 2);
    expect(offer).toHaveLength(2);
    expect(new Set(offer).size).toBe(2);
    for (const id of offer) expect(pool).toContain(id);
    expect(offerPerks(['conditioning'], [], { rngState: 1 }, 2)).toEqual(['conditioning']);
    expect(offerPerks([], [], { rngState: 1 }, 2)).toEqual([]);
  });

  it('is fixed by the seed, so reopening the screen cannot reroll it', () => {
    const a = offerPerks(CLASS_POOL.sport, ['throwArm'], { rngState: 99 }, 2);
    const b = offerPerks(CLASS_POOL.sport, ['throwArm'], { rngState: 99 }, 2);
    expect(a).toEqual(b);
  });

  it('a nerd doing science is not offered the lab kit twice', () => {
    const owned = startingPerks('nerd', 'science');
    expect(owned).toEqual(['labKit']);
    expect(eligible(CLASS_POOL.science, owned)).not.toContain('labKit');
  });
});

// ---------- each flag, where it actually bites ----------

const shooter = (over: Record<string, unknown> = {}) => unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, aim: 70, ...over });

describe('perk flags change the rules', () => {
  it('Cover Breaker ignores half cover but not full', () => {
    const rows = ['.....', '.....', '..h..', '.....'];
    const a = unit({ id: 'a', team: 'player', pos: { x: 2, y: 0 } });
    const t = unit({ id: 't', team: 'enemy', pos: { x: 2, y: 3 } });
    const s = arena(rows, [a, t]);
    const plain = computeShot(s.map, a, a.pos, t);
    expect(plain.cover).toBe('half');
    const sharp = computeShot(s.map, { ...a, flags: ['coverBreaker'] }, a.pos, t);
    expect(sharp.cover).toBe('none');
    expect(sharp.coverIgnored).toBe(true);
    expect(sharp.hitChance).toBe(plain.hitChance + plain.coverPenalty);

    const full = arena(['.....', '.....', '..F..', '.....'], [a, t]);
    expect(computeShot(full.map, { ...a, flags: ['coverBreaker'] }, a.pos, t).cover).toBe('full');
  });

  it('Deadeye halves the range penalty and nothing else', () => {
    const a = shooter({ weapon: { ...WEAPONS.slingshot, range: 20, optimal: 2 } });
    const t = unit({ id: 't', team: 'enemy', pos: { x: 12, y: 1 } });
    const s = arena(open(20, 4), [a, t]);
    const plain = computeShot(s.map, a, a.pos, t);
    const sharp = computeShot(s.map, { ...a, flags: ['deadeye'] }, a.pos, t);
    expect(plain.rangePenalty).toBeGreaterThan(0);
    expect(sharp.rangePenalty).toBe(Math.round(plain.rangePenalty / 2));
    expect(sharp.hitChance).toBeGreaterThan(plain.hitChance);
  });

  it('Point Blank only helps up close, and never in melee', () => {
    const a = shooter();
    const near = unit({ id: 'n', team: 'enemy', pos: { x: 3, y: 1 } });
    const far = unit({ id: 'f', team: 'enemy', pos: { x: 8, y: 1 } });
    const s = arena(open(12, 4), [a, near, far]);
    const pb = { ...a, flags: ['pointBlank'] };
    expect(computeShot(s.map, pb, a.pos, near).hitChance).toBe(computeShot(s.map, a, a.pos, near).hitChance + POINT_BLANK_BONUS);
    expect(computeShot(s.map, pb, a.pos, far).hitChance).toBe(computeShot(s.map, a, a.pos, far).hitChance);
    const m = { ...a, weapon: WEAPONS.knife, flags: ['pointBlank'] };
    expect(computeShot(s.map, m, a.pos, near).canShoot).toBe(false); // out of melee reach anyway
  });

  it('Brawler adds crit to swings but not to shots', () => {
    const t = unit({ id: 't', team: 'enemy', pos: { x: 2, y: 1 } });
    const s = arena(open(8, 4), [t]);
    const melee = shooter({ weapon: WEAPONS.knife });
    const ranged = shooter({ weapon: WEAPONS.slingshot });
    expect(computeShot(s.map, { ...melee, flags: ['brawler'] }, melee.pos, t).critChance).toBeGreaterThan(computeShot(s.map, melee, melee.pos, t).critChance);
    expect(computeShot(s.map, { ...ranged, flags: ['brawler'] }, ranged.pos, t).critChance).toBe(computeShot(s.map, ranged, ranged.pos, t).critChance);
  });

  it('Steady Hand removes the overwatch penalty', () => {
    const a = shooter();
    const t = unit({ id: 't', team: 'enemy', pos: { x: 5, y: 1 } });
    const s = arena(open(10, 4), [a, t]);
    const normal = computeShot(s.map, a, a.pos, t, true);
    const steady = computeShot(s.map, { ...a, flags: ['steadyAim'] }, a.pos, t, true);
    expect(steady.hitChance).toBe(normal.hitChance + OVERWATCH_PENALTY);
    expect(steady.hitChance).toBe(computeShot(s.map, a, a.pos, t).hitChance);
  });

  it('Tough Hide takes a point off every hit, never below one', () => {
    const a = shooter({ aim: 500, critChance: -999, weapon: { ...WEAPONS.slingshot, damage: [4, 4] as [number, number], critMod: -999 } });
    const t = unit({ id: 't', team: 'enemy', pos: { x: 3, y: 1 }, hp: 50, maxHp: 50, flags: ['toughHide'] });
    const s = arena(open(8, 4), [a, t]);
    shoot(s, 'a', 't');
    expect(t.hp).toBe(47);

    const tiny = shooter({ id: 'b', aim: 500, critChance: -999, weapon: { ...WEAPONS.slingshot, damage: [1, 1] as [number, number], critMod: -999 } });
    const t2 = unit({ id: 't2', team: 'enemy', pos: { x: 3, y: 2 }, hp: 50, maxHp: 50, flags: ['toughHide'] });
    const s2 = arena(open(8, 4), [tiny, t2]);
    shoot(s2, 'b', 't2');
    expect(t2.hp).toBe(49);
  });

  it('Iron Will survives the first killing blow of a battle, once', () => {
    const a = shooter({ aim: 500, weapon: { ...WEAPONS.slingshot, damage: [20, 20] as [number, number] } });
    const t = unit({ id: 't', team: 'enemy', pos: { x: 3, y: 1 }, hp: 10, maxHp: 10, flags: ['ironWill'] });
    const s = arena(open(8, 4), [a, t]);
    const ev = shoot(s, 'a', 't').events[0];
    expect(t.alive).toBe(true);
    expect(t.hp).toBe(1);
    expect(ev).toMatchObject({ held: true, killed: false });
    expect(s.winner).toBeNull();

    expect(t.uses?.ironWill).toBe(1);
    // it only works once: keep swinging and they go down
    for (let i = 0; i < 8 && t.alive; i++) {
      a.ap = 2;
      a.ammo = 9;
      shoot(s, 'a', 't');
    }
    expect(t.alive).toBe(false);
  });

  it('Nimble Feet walks away from melee for free; Splinters makes your own parting blow land', () => {
    const brute = () => unit({ id: 'e', team: 'enemy', pos: { x: 2, y: 1 }, weapon: WEAPONS.knife, aim: 5 });

    const runner = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, flags: ['nimble'] });
    const s1 = arena(open(10, 4), [runner, brute()]);
    moveUnit(s1, 'a', { x: 6, y: 1 });
    expect(s1.log.some((l) => l.text.includes('Parting blow'))).toBe(false);

    const plain = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 } });
    const s2 = arena(open(10, 4), [plain, brute()]);
    moveUnit(s2, 'a', { x: 6, y: 1 });
    const swing = s2.log.find((l) => l.text.includes('Parting blow'));
    expect(swing).toBeTruthy();
    const plainChance = Number(/\[(\d+)%\]/.exec(swing?.text ?? '')?.[1]);

    const plain2 = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 } });
    const duellist = { ...brute(), flags: ['duelist'] };
    const s3 = arena(open(10, 4), [plain2, duellist]);
    moveUnit(s3, 'a', { x: 6, y: 1 });
    const better = Number(/\[(\d+)%\]/.exec(s3.log.find((l) => l.text.includes('Parting blow'))?.text ?? '')?.[1]);
    expect(better).toBe(Math.min(95, plainChance + DUELIST_AIM));
  });

  it('Scrounger keeps more off the people you put down', () => {
    const gear = { chest: 'uniform', legs: 'trousers', shoes: 'sneakers', head: 'cap' };
    const count = (bonus: number): number => {
      let total = 0;
      for (let seed = 1; seed <= 60; seed++) total += dropsOf(gear, 'dead', { rngState: seed }, bonus).length;
      return total;
    };
    expect(count(SCROUNGER_BONUS)).toBeGreaterThan(count(0));
  });

  it('Fast Hands makes a weapon swap free, and Quick Draw makes a reload free', () => {
    const swapper = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, gear: { rightHand: 'slingshot' }, flags: ['fastHands'] });
    const s = arena(open(6, 4), [swapper]);
    s.ground = { '1,1': ['knife'] };
    const r = moveGear(s, swapper, { ground: 0 }, { slot: 'leftHand' });
    expect(r).toMatchObject({ ok: true, ap: 0 });
    expect(swapper.ap).toBe(2);

    const quick = unit({ id: 'b', team: 'player', pos: { x: 1, y: 2 }, ammo: 0, ap: 0, flags: ['quickDraw'] });
    const s2 = arena(open(6, 4), [quick]);
    expect(reload(s2, 'b').ok).toBe(true);
    expect(quick.ammo).toBe(quick.weapon.clip);
    expect(quick.ap).toBe(0);
  });

  it('Heavy Hitter lets a heavy weapon leave you something to do', () => {
    const heavy = { ...WEAPONS.javelin };
    const a = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, weapon: heavy, ammo: 9, flags: ['runAndGun'] });
    const t = unit({ id: 't', team: 'enemy', pos: { x: 3, y: 1 }, hp: 99, maxHp: 99 });
    const s = arena(open(8, 4), [a, t]);
    shoot(s, 'a', 't');
    expect(a.ap).toBe(1);

    const b = unit({ id: 'b', team: 'player', pos: { x: 1, y: 2 }, weapon: heavy, ammo: 9 });
    const s2 = arena(open(8, 4), [b, unit({ id: 't2', team: 'enemy', pos: { x: 3, y: 2 }, hp: 99, maxHp: 99 })]);
    shoot(s2, 'b', 't2');
    expect(b.ap).toBe(0);
  });

  it('Second Wind patches you up for putting someone down, up to your maximum', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, aim: 500, hp: 4, maxHp: 20, flags: ['secondWind'] });
    const t = unit({ id: 't', team: 'enemy', pos: { x: 3, y: 1 }, hp: 1, maxHp: 1 });
    const s = arena(open(8, 4), [a, t, unit({ id: 't2', team: 'enemy', pos: { x: 6, y: 3 }, hp: 1, maxHp: 1 })]);
    shoot(s, 'a', 't');
    expect(a.hp).toBe(4 + SECOND_WIND_HEAL);

    const full = unit({ id: 'b', team: 'player', pos: { x: 1, y: 2 }, aim: 500, hp: 6, maxHp: 6, flags: ['secondWind'] });
    const s2 = arena(open(8, 4), [full, unit({ id: 'x', team: 'enemy', pos: { x: 3, y: 2 }, hp: 1, maxHp: 1 })]);
    shoot(s2, 'b', 'x');
    expect(full.hp).toBe(6);
  });

  it('the Unflappable are never shaken or scared, but still bleed', () => {
    const calm = unit({ id: 'a', team: 'player', flags: ['unflappable'] });
    expect(addStatus(calm, 'shaken')).toBe(false);
    expect(addStatus(calm, 'scared')).toBe(false);
    expect(hasStatus(calm, 'shaken')).toBe(false);
    expect(addStatus(calm, 'bleed')).toBe(true);
    expect(hasStatus(calm, 'bleed')).toBe(true);
  });

  it('a unit with no perks has no flags at all', () => {
    const plain = unit({ id: 'a', team: 'player' });
    for (const f of flagsUsed) expect(hasFlag(plain, f)).toBe(false);
    expect(hasFlag(undefined, 'deadeye')).toBe(false);
  });
});

describe('perks on the squad', () => {
  it('everyone starts knowing something, and the starting perks match the clique and class tables', () => {
    for (const m of createStarterRoster()) {
      expect(m.perks).toEqual(startingPerks(m.clique, m.schoolClass));
      expect(m.perks.length).toBeGreaterThan(0);
    }
  });

  it('an overwatch shot from a steady hand is a full-strength shot', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, flags: ['steadyAim'] });
    const mover = unit({ id: 'e', team: 'enemy', pos: { x: 8, y: 1 }, hp: 99, maxHp: 99 });
    const s = arena(open(12, 4), [a, mover]);
    expect(setOverwatch(s, 'a').ok).toBe(true);
    s.active = 'enemy';
    moveUnit(s, 'e', { x: 5, y: 1 });
    const shot = s.log.find((l) => l.text.includes('Overwatch:'));
    expect(shot).toBeTruthy();
  });

  it('resolveShot still works for a unit built with no flags field', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, aim: 500 });
    const t = unit({ id: 't', team: 'enemy', pos: { x: 3, y: 1 }, hp: 99, maxHp: 99 });
    const s = arena(open(8, 4), [a, t]);
    const pv = computeShot(s.map, a, a.pos, t);
    const ev = resolveShot(s, a, t, pv, false);
    expect(ev).toMatchObject({ type: 'shoot', hit: true });
  });
});
