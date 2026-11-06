import { describe, expect, it } from 'vitest';
import {
  BALL,
  BEAKER,
  CLASS_SKILLS,
  CLIQUE_SKILLS,
  EXTRA_SKILLS,
  MAKEOVERS,
  addStatus,
  addXp,
  charmChance,
  createStarterRoster,
  deployRoster,
  endTurn,
  enemyStep,
  hasStatus,
  isHiddenFrom,
  memberSpec,
  moveUnit,
  newMember,
  resolveShot,
  setOverwatch,
  shoot,
  skillBlock,
  skillIdsFor,
  skillsOf,
  spriteKey,
  tickStatuses,
  useSkill,
  usesLeft,
  xpToNext,
} from './index';
import { arena, open, unit } from './testutil';

const hero = (over: Parameters<typeof unit>[0] extends infer T ? Partial<T> : never = {}) =>
  unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, skills: ['throwBall', 'acidBeaker', 'charm', 'incognito', 'patchUp'], gear: { belt1: 'bandage' }, ...over });

describe('which skills a kid gets', () => {
  it('maps cliques and classes to skills without duplicates', () => {
    expect(skillIdsFor('popular', 'sport')).toEqual(['charm', 'throwBall']);
    expect(skillIdsFor('nerd', 'science')).toEqual(['acidBeaker']);
    expect(skillIdsFor('drama', 'drama')).toEqual(['incognito']);
    expect(skillIdsFor('stoner', 'woodwork')).toEqual([]);
    for (const id of [...Object.values(CLIQUE_SKILLS).flat(), ...Object.values(CLASS_SKILLS).flat()]) expect(EXTRA_SKILLS[id]).toBeTruthy();
  });

  it('every skill has its own hotkey, none clashing with the base keys', () => {
    const keys = Object.values(EXTRA_SKILLS).map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ['m', 'f', 'o', 'v', 'r', 'i', 'e', 'w', 'n', 'x']) expect(keys).not.toContain(k);
  });

  it('the starting squad has the skills the design called for', () => {
    const roster = createStarterRoster();
    const by = Object.fromEntries(roster.map((m) => [m.name, memberSpec(m, 0, 0).skills]));
    expect(by.Amy).toEqual(expect.arrayContaining(['charm', 'patchUp'])); // popular girl charm, Home Ec medic
    expect(by.Scott).toContain('throwBall'); // sport guy throws balls
    expect(by.Tyson).toContain('acidBeaker'); // nerd throws acid
    expect(by.Anna).toContain('incognito'); // drama kid hides
  });

  it('skillsOf lists base skills first, then the unit extras', () => {
    expect(skillsOf(unit({ id: 'x', team: 'player', skills: ['charm'] })).map((s) => s.id)).toEqual(['overwatch', 'reload', 'revive', 'charm']);
    expect(skillsOf(undefined).map((s) => s.id)).toEqual(['overwatch', 'reload', 'revive']);
  });

  it('deployed units carry their skills into the battle', () => {
    const roster = createStarterRoster();
    const sc = deployRoster({ name: 't', seed: 1, map: () => arena(open(8, 8), []).map, units: roster.slice(0, 4).map((m, i) => ({ ...memberSpec(m, i, 0) })) }, roster);
    expect(sc.units.some((u) => u.skills?.includes('charm'))).toBe(true);
  });
});

describe('thrown skills', () => {
  it('Throw Ball is a light ranged attack that uses no ammo and costs 1 AP', () => {
    const a = hero({ ammo: 0 }); // empty gun does not matter
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 5, y: 1 }, hp: 50, maxHp: 50 });
    const s = arena(open(10, 4), [a, e]);
    const r = useSkill(s, 'a', 'throwBall', 'e');
    expect(r.ok).toBe(true);
    expect(a.ap).toBe(1);
    expect(a.ammo).toBe(0);
    expect(r.events[0]).toMatchObject({ type: 'shoot', attackerId: 'a', targetId: 'e' });
    expect(s.log.at(-1)?.text).toContain('Thrown Ball');
    if (e.hp < 50) expect(50 - e.hp).toBeGreaterThanOrEqual(BALL.damage[0]);
    expect(useSkill(s, 'a', 'throwBall', 'e').ok).toBe(true); // light: a second throw is fine
    expect(useSkill(s, 'a', 'throwBall', 'e').ok).toBe(false); // out of AP
  });

  it('respects range and line of sight', () => {
    const a = hero();
    const far = unit({ id: 'f', team: 'enemy', pos: { x: 9, y: 1 } });
    const s = arena(open(12, 4), [a, far]);
    expect(useSkill(s, 'a', 'throwBall', 'f')).toMatchObject({ ok: false, error: 'Out of range' });
    const walled = arena(['.#....', '.#....', '.#....'], [hero({ pos: { x: 0, y: 1 } }), unit({ id: 'w', team: 'enemy', pos: { x: 3, y: 1 } })]);
    expect(useSkill(walled, 'a', 'throwBall', 'w').ok).toBe(false);
    expect(walled.units[0].ap).toBe(2); // a failed throw costs nothing
  });

  it('Acid Beaker has two uses a battle and tends to set the target burning', () => {
    let burned = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = hero({ aim: 200 });
      const e = unit({ id: 'e', team: 'enemy', pos: { x: 3, y: 1 }, hp: 60, maxHp: 60 });
      const s = arena(open(8, 4), [a, e], seed);
      expect(useSkill(s, 'a', 'acidBeaker', 'e').ok).toBe(true);
      if (hasStatus(e, 'burn')) burned++;
      a.ap = 2;
      expect(useSkill(s, 'a', 'acidBeaker', 'e').ok).toBe(true);
      a.ap = 2;
      expect(usesLeft(a, EXTRA_SKILLS.acidBeaker)).toBe(0);
      expect(useSkill(s, 'a', 'acidBeaker', 'e')).toMatchObject({ ok: false, error: 'None left this battle.' });
    }
    expect(burned).toBeGreaterThan(20); // 80% chance, 40 trials
    expect(BEAKER.inflicts?.[0].effect).toBe('burn');
  });

  it('a throw that kills ends the battle like any other shot', () => {
    const a = hero({ aim: 500 });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 2, y: 1 }, hp: 1, maxHp: 1 });
    const s = arena(open(6, 4), [a, e]);
    useSkill(s, 'a', 'throwBall', 'e');
    expect(s.winner).toBe('player');
    expect(a.kills).toBe(1);
  });

  it('a thrown skill does not break the weapon in hand', () => {
    const a = hero({ weapon: { ...unit({ id: 'z', team: 'player' }).weapon, breakChance: 1 }, gear: { rightHand: 'stick' } });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 3, y: 1 }, hp: 50, maxHp: 50 });
    const s = arena(open(8, 4), [a, e]);
    const ev = useSkill(s, 'a', 'throwBall', 'e').events[0];
    expect(ev).not.toHaveProperty('broke');
    expect(a.gear?.rightHand).toBe('stick');
  });

  it('cannot throw at an ally or a corpse', () => {
    const a = hero();
    const friend = unit({ id: 'f', team: 'player', pos: { x: 2, y: 1 } });
    const dead = unit({ id: 'd', team: 'enemy', pos: { x: 3, y: 1 }, alive: false });
    const s = arena(open(6, 4), [a, friend, dead]);
    expect(useSkill(s, 'a', 'throwBall', 'f').ok).toBe(false);
    expect(useSkill(s, 'a', 'throwBall', 'd').ok).toBe(false);
    expect(useSkill(s, 'a', 'throwBall').ok).toBe(false);
  });
});

describe('Charm', () => {
  it('chance falls as the target gets tougher and stays in bounds', () => {
    expect(charmChance({ maxHp: 8 })).toBeGreaterThan(charmChance({ maxHp: 14 }));
    expect(charmChance({ maxHp: 1 })).toBe(85);
    expect(charmChance({ maxHp: 100 })).toBe(15);
  });

  it('a charmed rival loses its turns, and a hit snaps it out of it', () => {
    let s = arena(open(10, 4), []);
    let a = hero();
    let e = unit({ id: 'e', team: 'enemy', pos: { x: 4, y: 1 }, maxHp: 1, hp: 1 });
    // find a seed where it takes
    for (let seed = 1; seed < 50; seed++) {
      a = hero();
      e = unit({ id: 'e', team: 'enemy', pos: { x: 4, y: 1 }, maxHp: 4, hp: 4 });
      s = arena(open(10, 4), [a, e], seed);
      useSkill(s, 'a', 'charm', 'e');
      if (hasStatus(e, 'charmed')) break;
    }
    expect(hasStatus(e, 'charmed')).toBe(true);
    endTurn(s); // enemy turn starts: charm costs it the turn
    expect(e.ap).toBe(0);
    expect(enemyStep(s)).toBeNull();
    // a hit that does not kill breaks the charm
    const e2 = unit({ id: 'e2', team: 'enemy', pos: { x: 4, y: 2 }, hp: 10 });
    addStatus(e2, 'charmed');
    const att = hero({ id: 'b', pos: { x: 1, y: 2 } });
    const s2 = arena(open(10, 4), [att, e2]);
    resolveShot(s2, att, e2, { canShoot: true, hitChance: 100, critChance: 0, cover: 'none', flanked: false, exposed: true, dmgMin: 1, dmgMax: 1, distance: 3, range: 12, optimal: 12, melee: false, rangePenalty: 0, coverPenalty: 0 }, false);
    expect(hasStatus(e2, 'charmed')).toBe(false);
  });

  it('is limited to once a battle, needs sight and range, and silence stops it', () => {
    const a = hero();
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 4, y: 1 } });
    const s = arena(open(10, 4), [a, e]);
    expect(useSkill(s, 'a', 'charm', 'e').ok).toBe(true);
    a.ap = 2;
    expect(useSkill(s, 'a', 'charm', 'e')).toMatchObject({ ok: false, error: 'Already used this battle.' });

    const far = unit({ id: 'f', team: 'enemy', pos: { x: 9, y: 1 } });
    const s2 = arena(open(12, 4), [hero(), far]);
    expect(useSkill(s2, 'a', 'charm', 'f')).toMatchObject({ ok: false, error: 'Out of range' });
    expect(s2.units[0].ap).toBe(2);

    const mute = hero();
    addStatus(mute, 'silenced');
    const s3 = arena(open(10, 4), [mute, unit({ id: 'e', team: 'enemy', pos: { x: 4, y: 1 } })]);
    expect(useSkill(s3, 'a', 'charm', 'e').ok).toBe(false);
  });

  it('charming a sleeping rival wakes its pod', () => {
    const e1 = unit({ id: 'e1', team: 'enemy', pos: { x: 4, y: 1 }, pod: 'p', dormant: true });
    const e2 = unit({ id: 'e2', team: 'enemy', pos: { x: 6, y: 2 }, pod: 'p', dormant: true });
    const s = arena(open(10, 4), [hero(), e1, e2]);
    useSkill(s, 'a', 'charm', 'e1');
    expect(e1.dormant).toBe(false);
    expect(e2.dormant).toBe(false);
  });
});

describe('Incognito', () => {
  it('hides you from distant rivals but not adjacent ones', () => {
    const a = hero();
    const far = unit({ id: 'far', team: 'enemy', pos: { x: 6, y: 1 } });
    const s = arena(open(10, 4), [a, far]);
    expect(useSkill(s, 'a', 'incognito').ok).toBe(true);
    expect(hasStatus(a, 'hidden')).toBe(true);
    expect(isHiddenFrom(a, far)).toBe(true);
    expect(isHiddenFrom(a, unit({ id: 'near', team: 'enemy', pos: { x: 2, y: 2 } }))).toBe(false);
  });

  it('rival AI ignores a hidden squad and never fires at it', () => {
    const a = hero();
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 8, y: 1 } });
    const s = arena(open(10, 4), [a, e]);
    useSkill(s, 'a', 'incognito');
    endTurn(s);
    const hp = a.hp;
    for (let i = 0; i < 6 && s.active === 'enemy'; i++) enemyStep(s);
    expect(a.hp).toBe(hp);
    expect(s.log.some((l) => l.team === 'enemy' && l.text.includes('->'))).toBe(false);
  });

  it('hidden units do not eat overwatch shots', () => {
    const a = hero({ pos: { x: 1, y: 1 } });
    const watcher = unit({ id: 'w', team: 'enemy', pos: { x: 8, y: 1 } });
    const s = arena(open(10, 4), [a, watcher]);
    s.active = 'enemy';
    watcher.ap = 2;
    expect(setOverwatch(s, 'w').ok).toBe(true);
    s.active = 'player';
    useSkill(s, 'a', 'incognito');
    const hp = a.hp;
    moveUnit(s, 'a', { x: 3, y: 1 }); // 2 tiles, still far from the watcher
    expect(a.hp).toBe(hp);
    expect(watcher.overwatch).toBe(true); // still waiting
  });

  it('attacking gives you away, and it times out after two of your turns', () => {
    const a = hero();
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 6, y: 1 }, hp: 99, maxHp: 99 });
    const s = arena(open(10, 4), [a, e]);
    useSkill(s, 'a', 'incognito');
    shoot(s, 'a', 'e');
    expect(hasStatus(a, 'hidden')).toBe(false);

    const b = hero({ id: 'b', pos: { x: 1, y: 2 } });
    const s2 = arena(open(10, 4), [b, unit({ id: 'e', team: 'enemy', pos: { x: 8, y: 1 } })]);
    useSkill(s2, 'b', 'incognito');
    tickStatuses(s2, 'player');
    expect(hasStatus(b, 'hidden')).toBe(true);
    tickStatuses(s2, 'player');
    expect(hasStatus(b, 'hidden')).toBe(false);
  });
});

describe('Patch Up', () => {
  it('uses a bandage to heal an adjacent ally and stop bleeding', () => {
    const a = hero({ gear: { belt1: 'bandage', belt2: 'energybar' } });
    const friend = unit({ id: 'f', team: 'player', pos: { x: 2, y: 1 }, hp: 3, maxHp: 10 });
    addStatus(friend, 'bleed');
    const s = arena(open(6, 4), [a, friend]);
    expect(useSkill(s, 'a', 'patchUp', 'f').ok).toBe(true);
    expect(friend.hp).toBe(7);
    expect(hasStatus(friend, 'bleed')).toBe(false);
    expect(a.gear).toEqual({ belt2: 'energybar' });
    expect(a.ap).toBe(1);
  });

  it('finds a bandage in the pack and heals the hurtest by default; never overheals', () => {
    const a = hero({ hp: 9, maxHp: 10, gear: { back: 'schoolbag', pack1: 'bandage' } });
    const friend = unit({ id: 'f', team: 'player', pos: { x: 1, y: 2 }, hp: 2, maxHp: 10 });
    const s = arena(open(6, 4), [a, friend]);
    useSkill(s, 'a', 'patchUp');
    expect(friend.hp).toBe(6);
    expect(a.hp).toBe(9);
    expect(a.gear?.pack1).toBeUndefined();
    const b = hero({ hp: 9, maxHp: 10, gear: { belt1: 'bandage' } });
    useSkill(arena(open(6, 4), [b]), 'a', 'patchUp');
    expect(b.hp).toBe(10);
  });

  it('is refused without a bandage, without a patient, and from the far side of the map', () => {
    const none = hero({ hp: 5, gear: {} });
    expect(useSkill(arena(open(6, 4), [none]), 'a', 'patchUp')).toMatchObject({ ok: false, error: 'No bandage on the belt or in the pack.' });
    const healthy = hero();
    expect(useSkill(arena(open(6, 4), [healthy]), 'a', 'patchUp')).toMatchObject({ ok: false });
    const a = hero();
    const far = unit({ id: 'f', team: 'player', pos: { x: 5, y: 3 }, hp: 1 });
    expect(useSkill(arena(open(6, 4), [a, far]), 'a', 'patchUp', 'f').ok).toBe(false);
    expect(a.gear?.belt1).toBe('bandage'); // nothing was spent
  });

  it('cannot patch up a knocked-down ally (that is what Revive is for) or an enemy', () => {
    const a = hero();
    const down = unit({ id: 'd', team: 'player', pos: { x: 2, y: 1 }, hp: 0, alive: false, downed: true });
    const foe = unit({ id: 'e', team: 'enemy', pos: { x: 1, y: 2 }, hp: 1 });
    const s = arena(open(6, 4), [a, down, foe]);
    expect(useSkill(s, 'a', 'patchUp', 'd').ok).toBe(false);
    expect(useSkill(s, 'a', 'patchUp', 'e').ok).toBe(false);
  });
});

describe('general skill rules', () => {
  it('only the unit that has a skill can use it, and only on its own turn', () => {
    const plain = unit({ id: 'p', team: 'player' });
    const s = arena(open(6, 4), [plain, unit({ id: 'e', team: 'enemy', pos: { x: 3, y: 0 } })]);
    expect(useSkill(s, 'p', 'throwBall', 'e')).toMatchObject({ ok: false });
    const a = hero();
    const s2 = arena(open(6, 4), [a, unit({ id: 'e', team: 'enemy', pos: { x: 3, y: 1 } })]);
    s2.active = 'enemy';
    expect(skillBlock(s2, a, EXTRA_SKILLS.throwBall)).toBe('Not your turn.');
    s2.active = 'player';
    s2.winner = 'player';
    expect(useSkill(s2, 'a', 'throwBall', 'e').ok).toBe(false);
  });

  it('unknown skills and units fail cleanly', () => {
    const s = arena(open(6, 4), [hero()]);
    expect(useSkill(s, 'a', 'nope').ok).toBe(false);
    expect(useSkill(s, 'ghost', 'charm', 'x').ok).toBe(false);
  });

  it('uses reset with a new battle (they live on the unit, which is rebuilt per fight)', () => {
    const roster = createStarterRoster();
    const sc = memberSpec(roster[1], 0, 0);
    expect(sc).not.toHaveProperty('uses');
  });
});

describe("Anna's makeover", () => {
  const anna = () => newMember('p4', 'Anna', 'drama', 'drama');
  it('happens when she reaches level 3 and not before', () => {
    const m = anna();
    expect(spriteKey(m)).toBe('anna');
    const notes: string[] = [];
    addXp(m, xpToNext(1), { rngState: 5 }, notes);
    expect(m.level).toBe(2);
    expect(m.makeover).toBeUndefined();
    addXp(m, xpToNext(2), { rngState: 5 }, notes);
    expect(m.level).toBe(3);
    expect(m.makeover).toBe(true);
    expect(spriteKey(m)).toBe('anna-makeover');
    expect(notes.join(' ')).toContain(MAKEOVERS.p4.note);
  });

  it('only fires once and never for the player character', () => {
    const m = anna();
    const notes: string[] = [];
    addXp(m, 10000, { rngState: 5 }, notes);
    expect(notes.filter((n) => n.includes('makeover')).length).toBe(1);
    const pc = newMember('p4', 'Anna', 'drama', 'drama', true);
    addXp(pc, 10000, { rngState: 5 }, []);
    expect(pc.makeover).toBeUndefined();
  });
});
