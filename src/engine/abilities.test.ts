import { describe, expect, it } from 'vitest';
import {
  BALL,
  BEAKER,
  CLASS_POOL,
  CLASS_STARTER,
  CLIQUE_POOL,
  CLIQUE_STARTER,
  PERKS,
  grantedSkills,
  startingPerks,
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
  skillsOf,
  spriteKey,
  tickStatuses,
  useSkill,
  usesLeft,
  thrownWeapon,
  PATCH_HEAL,
  FIELD_MEDIC_BONUS,
  computeShot,
  xpToNext,
} from './index';
import { arena, open, unit } from './testutil';

const hero = (over: Parameters<typeof unit>[0] extends infer T ? Partial<T> : never = {}) =>
  unit({ id: 'a', team: 'player', pos: { x: 1, y: 1 }, skills: ['throwBall', 'acidBeaker', 'charm', 'incognito', 'patchUp'], gear: { belt1: 'bandage' }, ...over });

describe('which skills a kid gets', () => {
  it('gives every clique and class a signature perk, and never the same skill twice', () => {
    expect(grantedSkills(startingPerks('popular', 'sport'))).toEqual(['charm', 'throwBall']);
    expect(grantedSkills(startingPerks('nerd', 'science'))).toEqual(['acidBeaker']); // both sides grant the lab kit: still one skill
    expect(startingPerks('nerd', 'science')).toEqual(['labKit']);
    expect(grantedSkills(startingPerks('drama', 'drama'))).toEqual(['incognito']);
    for (const id of [...Object.values(CLIQUE_STARTER), ...Object.values(CLASS_STARTER)]) expect(PERKS[id]).toBeTruthy();
    for (const id of [...Object.values(CLIQUE_POOL).flat(), ...Object.values(CLASS_POOL).flat()]) expect(PERKS[id], id).toBeTruthy();
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

  it('deployed units carry their skills and perk flags into the battle', () => {
    const roster = createStarterRoster();
    const sc = deployRoster({ name: 't', seed: 1, map: () => arena(open(8, 8), []).map, units: roster.slice(0, 4).map((m, i) => ({ ...memberSpec(m, i, 0) })) }, roster);
    expect(sc.units.some((u) => u.skills?.includes('charm'))).toBe(true);
    roster[0].perks.push('deadeye');
    const sc2 = deployRoster({ name: 't', seed: 1, map: () => arena(open(8, 8), []).map, units: roster.slice(0, 4).map((m, i) => ({ ...memberSpec(m, i, 0) })) }, roster);
    expect(sc2.units.find((u) => u.id === 'pc')?.flags).toContain('deadeye');
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
    expect(charmChance({ maxHp: 1 })).toBe(86);
    expect(charmChance({ maxHp: 100 })).toBe(5);
    // Charm the attribute, and the Showstopper perk, both push it up
    expect(charmChance({ maxHp: 14 }, 5)).toBe(charmChance({ maxHp: 14 }) + 20);
    expect(charmChance({ maxHp: 14 }, 0, true)).toBe(charmChance({ maxHp: 14 }) + 20);
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
    resolveShot(s2, att, e2, { canShoot: true, hitChance: 100, critChance: 0, cover: 'none', coverIgnored: false, flanked: false, exposed: true, dmgMin: 1, dmgMax: 1, distance: 3, range: 12, optimal: 12, melee: false, rangePenalty: 0, coverPenalty: 0 }, false);
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

// ---------- the skills the later perks teach ----------

const kid = (over: Record<string, unknown> = {}) =>
  unit({
    id: 'a',
    team: 'player',
    pos: { x: 1, y: 1 },
    skills: ['tackle', 'analyse', 'rally', 'brace', 'warCry', 'unsettle', 'mellow', 'rations', 'paintBomb', 'patchUp', 'throwBall', 'acidBeaker', 'incognito', 'charm'],
    gear: { belt1: 'bandage', belt2: 'energybar' },
    ...over,
  });

describe('Tackle', () => {
  it('charges across the gap, lands next to them and hits, ending the turn', () => {
    const a = kid({ aim: 300, meleeAim: 300, mobility: 5 });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 5, y: 1 }, hp: 60, maxHp: 60 });
    const s = arena(open(12, 4), [a, e]);
    const r = useSkill(s, 'a', 'tackle', 'e');
    expect(r.ok).toBe(true);
    expect(Math.max(Math.abs(a.pos.x - e.pos.x), Math.abs(a.pos.y - e.pos.y))).toBe(1);
    expect(a.ap).toBe(0); // ends the turn
    expect(e.hp).toBeLessThan(60);
    expect(r.events.some((ev) => ev.type === 'move')).toBe(true);
    expect(s.log.some((l) => l.text.includes('Tackle'))).toBe(true);
  });

  it('works from right beside them without moving', () => {
    const a = kid({ aim: 300, meleeAim: 300 });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 2, y: 1 }, hp: 60, maxHp: 60 });
    const s = arena(open(8, 4), [a, e]);
    expect(useSkill(s, 'a', 'tackle', 'e').ok).toBe(true);
    expect(a.pos).toEqual({ x: 1, y: 1 });
    expect(e.hp).toBeLessThan(60);
  });

  it('is refused when they are too far to reach, and costs nothing', () => {
    const a = kid({ mobility: 3 });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 11, y: 3 } });
    const s = arena(open(14, 5), [a, e]);
    expect(useSkill(s, 'a', 'tackle', 'e')).toMatchObject({ ok: false });
    expect(a.ap).toBe(2);
  });

  it('often leaves them stunned', () => {
    let stunned = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = kid({ aim: 300, meleeAim: 300 });
      const e = unit({ id: 'e', team: 'enemy', pos: { x: 3, y: 1 }, hp: 60, maxHp: 60 });
      const s = arena(open(10, 4), [a, e], seed);
      useSkill(s, 'a', 'tackle', 'e');
      if (hasStatus(e, 'stun')) stunned++;
    }
    expect(stunned).toBeGreaterThan(8);
    expect(stunned).toBeLessThan(40);
  });
});

describe('Analyse', () => {
  it('marks them so everyone finds them easier to hit', () => {
    const a = kid();
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 6, y: 1 }, defense: 20, meleeDefense: 20 });
    const s = arena(open(12, 4), [a, e]);
    const before = computeShot(s.map, a, a.pos, e).hitChance;
    expect(useSkill(s, 'a', 'analyse', 'e').ok).toBe(true);
    expect(hasStatus(e, 'marked')).toBe(true);
    expect(computeShot(s.map, a, a.pos, e).hitChance).toBeGreaterThan(before);
  });

  it('has a long reach but still needs to see them', () => {
    const a = kid();
    const far = unit({ id: 'f', team: 'enemy', pos: { x: 14, y: 1 } });
    expect(useSkill(arena(open(18, 4), [kid(), far]), 'a', 'analyse', 'f')).toMatchObject({ ok: false, error: 'Out of range' });
    const walled = arena(['.#....', '.#....', '.#....'], [kid({ pos: { x: 0, y: 1 } }), unit({ id: 'w', team: 'enemy', pos: { x: 3, y: 1 } })]);
    expect(useSkill(walled, 'a', 'analyse', 'w').ok).toBe(false);
    expect(a.ap).toBe(2);
  });
});

describe('Rally', () => {
  it('gives an adjacent friend an action point back and settles their nerves', () => {
    const a = kid();
    const friend = unit({ id: 'f', team: 'player', pos: { x: 2, y: 1 }, ap: 0 });
    addStatus(friend, 'shaken');
    const s = arena(open(8, 4), [a, friend]);
    expect(useSkill(s, 'a', 'rally', 'f').ok).toBe(true);
    expect(friend.ap).toBe(1);
    expect(hasStatus(friend, 'shaken')).toBe(false);
    expect(a.ap).toBe(1);
  });

  it('never gives more than a full turn, is not for yourself, and only once a battle', () => {
    const a = kid();
    const full = unit({ id: 'f', team: 'player', pos: { x: 2, y: 1 }, ap: 2 });
    expect(useSkill(arena(open(8, 4), [kid(), full]), 'a', 'rally', 'f')).toMatchObject({ ok: false });
    const tired = unit({ id: 'g', team: 'player', pos: { x: 2, y: 1 }, ap: 0 });
    const s = arena(open(8, 4), [a, tired]);
    expect(useSkill(s, 'a', 'rally').ok).toBe(true);
    tired.ap = 0;
    a.ap = 2;
    expect(useSkill(s, 'a', 'rally')).toMatchObject({ ok: false, error: 'Already used this battle.' });
  });
});

describe('Brace', () => {
  it('makes you much harder to hit until your next turn, and ends the turn', () => {
    const a = kid();
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 5, y: 1 }, aim: 80 });
    const s = arena(open(10, 4), [a, e]);
    const before = computeShot(s.map, e, e.pos, a).hitChance;
    expect(useSkill(s, 'a', 'brace').ok).toBe(true);
    expect(a.ap).toBe(0);
    expect(hasStatus(a, 'braced')).toBe(true);
    expect(computeShot(s.map, e, e.pos, a).hitChance).toBeLessThan(before);
    expect(useSkill(s, 'a', 'brace')).toMatchObject({ ok: false });
  });

  it('wears off at the start of your next turn', () => {
    const a = kid();
    const s = arena(open(8, 4), [a]);
    useSkill(s, 'a', 'brace');
    tickStatuses(s, 'player');
    expect(hasStatus(a, 'braced')).toBe(false);
  });
});

describe('the two shouts', () => {
  it('War Cry shakes every rival nearby and leaves the far ones alone', () => {
    const a = kid();
    const near = unit({ id: 'n', team: 'enemy', pos: { x: 4, y: 1 } });
    const far = unit({ id: 'f', team: 'enemy', pos: { x: 14, y: 1 } });
    const friend = unit({ id: 'p', team: 'player', pos: { x: 2, y: 1 } });
    const s = arena(open(18, 4), [a, near, far, friend]);
    expect(useSkill(s, 'a', 'warCry').ok).toBe(true);
    expect(hasStatus(near, 'shaken')).toBe(true);
    expect(hasStatus(far, 'shaken')).toBe(false);
    expect(hasStatus(friend, 'shaken')).toBe(false); // your own side is fine
  });

  it('Unsettle scares them instead, and neither wakes a sleeping pod by itself', () => {
    const a = kid();
    const sleeper = unit({ id: 'e', team: 'enemy', pos: { x: 3, y: 1 }, pod: 'p', dormant: true });
    const s = arena(open(10, 4), [a, sleeper]);
    expect(useSkill(s, 'a', 'unsettle').ok).toBe(true);
    expect(hasStatus(sleeper, 'scared')).toBe(false); // dormant rivals are not even noticed
    expect(sleeper.dormant).toBe(true);
  });

  it('reports honestly when there is nobody to shout at', () => {
    const a = kid();
    const s = arena(open(10, 4), [a, unit({ id: 'e', team: 'enemy', pos: { x: 9, y: 3 } })]);
    const r = useSkill(s, 'a', 'warCry');
    expect(r.ok).toBe(true);
    expect(r.events.find((e) => e.type === 'skill')).toMatchObject({ ok: false });
    expect(s.log.at(-1)?.text).toContain('nobody flinches');
  });
});

describe('Mellow Out', () => {
  it('clears everything bad and gives some health back, keeping the good', () => {
    const a = kid({ hp: 4, maxHp: 20 });
    addStatus(a, 'burn');
    addStatus(a, 'scared');
    addStatus(a, 'hidden');
    const s = arena(open(8, 4), [a]);
    expect(useSkill(s, 'a', 'mellow').ok).toBe(true);
    expect(hasStatus(a, 'burn')).toBe(false);
    expect(hasStatus(a, 'scared')).toBe(false);
    expect(hasStatus(a, 'hidden')).toBe(true);
    expect(a.hp).toBe(7);
  });
});

describe('Rations', () => {
  it('spends an energy bar to feed someone next to you', () => {
    const a = kid();
    const friend = unit({ id: 'f', team: 'player', pos: { x: 2, y: 1 }, hp: 2, maxHp: 10 });
    addStatus(friend, 'scared');
    const s = arena(open(8, 4), [a, friend]);
    expect(useSkill(s, 'a', 'rations', 'f').ok).toBe(true);
    expect(friend.hp).toBe(5);
    expect(hasStatus(friend, 'scared')).toBe(false);
    expect(a.gear).toEqual({ belt1: 'bandage' });
  });

  it('is refused with nothing to hand out', () => {
    const a = kid({ gear: { belt1: 'bandage' } });
    const friend = unit({ id: 'f', team: 'player', pos: { x: 2, y: 1 }, hp: 2, maxHp: 10 });
    expect(useSkill(arena(open(8, 4), [a, friend]), 'a', 'rations', 'f')).toMatchObject({ ok: false });
    expect(a.gear?.belt1).toBe('bandage');
  });
});

describe('Paint Bomb', () => {
  it('does little damage but usually blinds', () => {
    let blinded = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = kid({ aim: 300 });
      const e = unit({ id: 'e', team: 'enemy', pos: { x: 4, y: 1 }, hp: 60, maxHp: 60 });
      const s = arena(open(10, 4), [a, e], seed);
      useSkill(s, 'a', 'paintBomb', 'e');
      if (hasStatus(e, 'blind')) blinded++;
      expect(60 - e.hp).toBeLessThanOrEqual(3);
    }
    expect(blinded).toBeGreaterThan(18);
  });
});

describe('perks bend the skills they belong to', () => {
  const withFlags = (flags: string[], over: Record<string, unknown> = {}) => kid({ flags, ...over });

  it('Cannon Arm throws further and harder', () => {
    const plain = kid({ aim: 300 });
    const strong = withFlags(['cannonArm'], { aim: 300 });
    const e = () => unit({ id: 'e', team: 'enemy', pos: { x: 9, y: 1 }, hp: 90, maxHp: 90 });
    expect(useSkill(arena(open(14, 4), [plain, e()]), 'a', 'throwBall', 'e')).toMatchObject({ ok: false, error: 'Out of range' });
    const s = arena(open(14, 4), [strong, e()]);
    expect(useSkill(s, 'a', 'throwBall', 'e').ok).toBe(true);
    expect(thrownWeapon(strong, EXTRA_SKILLS.throwBall)?.damage[1]).toBe(EXTRA_SKILLS.throwBall.throws!.damage[1] + 1);
  });

  it('Chemist packs a spare beaker and a stronger mix', () => {
    const plain = kid();
    const chem = withFlags(['chemist']);
    expect(usesLeft(chem, EXTRA_SKILLS.acidBeaker)).toBe(usesLeft(plain, EXTRA_SKILLS.acidBeaker) + 1);
    const w = thrownWeapon(chem, EXTRA_SKILLS.acidBeaker)!;
    expect(w.damage[1]).toBeGreaterThan(EXTRA_SKILLS.acidBeaker.throws!.damage[1]);
    expect(w.inflicts?.[0].chance).toBeGreaterThan(EXTRA_SKILLS.acidBeaker.throws!.inflicts![0].chance);
  });

  it('Showstopper makes a charm far likelier; Charm the attribute does too', () => {
    expect(charmChance({ maxHp: 12 }, 0, true)).toBeGreaterThan(charmChance({ maxHp: 12 }));
    expect(charmChance({ maxHp: 12 }, 6)).toBeGreaterThan(charmChance({ maxHp: 12 }));
  });

  it('Understudy keeps you hidden a turn longer', () => {
    const plain = kid();
    const sneak = withFlags(['understudy']);
    useSkill(arena(open(8, 4), [plain]), 'a', 'incognito');
    useSkill(arena(open(8, 4), [sneak]), 'a', 'incognito');
    const turns = (u: typeof plain): number => u.status?.find((x) => x.id === 'hidden')?.turns ?? 0;
    expect(turns(sneak)).toBe(turns(plain) + 1);
  });

  it('Field Medic patches up better and for free', () => {
    const medic = withFlags(['fieldMedic']);
    const friend = unit({ id: 'f', team: 'player', pos: { x: 2, y: 1 }, hp: 1, maxHp: 30 });
    const s = arena(open(8, 4), [medic, friend]);
    expect(useSkill(s, 'a', 'patchUp', 'f').ok).toBe(true);
    expect(friend.hp).toBe(1 + PATCH_HEAL + FIELD_MEDIC_BONUS);
    expect(medic.ap).toBe(2); // free
  });
});
