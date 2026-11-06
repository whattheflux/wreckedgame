import { describe, expect, it } from 'vitest';
import {
  ATTRS,
  ATTR_IDS,
  ATTR_MAX,
  CLASS_PERK_EVERY,
  CLIQUE_PERK_EVERY,
  COMBAT_SKILLS,
  COMBAT_SKILL_IDS,
  MAX_LEVEL,
  PERKS,
  PERK_OPTIONS,
  STAT_FLOOR,
  XP_CAMP_TASK,
  XP_DISCOVERY,
  addMods,
  addXp,
  encounterScenario,
  veterancy,
  VET_CAP,
  attributeStats,
  autoSpend,
  canRaise,
  canTrain,
  combatSpent,
  combatStats,
  combatValue,
  createStarterRoster,
  effectiveStats,
  grantXp,
  hasPending,
  luckFactor,
  memberSpec,
  migrateMember,
  migrateRoster,
  modsText,
  newMember,
  pendingCount,
  pendingOf,
  picksForLevel,
  skillsFor,
  spendAttribute,
  spendCombat,
  startingAttributes,
  sumMods,
  takePerk,
  xpMultiplier,
  xpToNext,
  zeroCombat,
  zeroStats,
  type AttrId,
  type RosterMember,
} from './index';

const rng = (n = 1): { rngState: number } => ({ rngState: n });
const scott = (): RosterMember => createStarterRoster().find((m) => m.id === 'p2')!;

/** Push a member to exactly `level`, one level at a time, leaving every pick unspent. */
function levelTo(m: RosterMember, level: number, seed = 1): RosterMember {
  const r = rng(seed);
  const notes: string[] = [];
  let guard = 400;
  while (m.level < level && guard-- > 0) {
    const need = Math.max(1, Math.ceil((xpToNext(m.level) - m.xp) / xpMultiplier(m.attributes)));
    const was = m.level;
    addXp(m, need, r, notes);
    if (m.level === was) addXp(m, 2, r, notes);
  }
  return m;
}

describe('the stat block', () => {
  it('adds plain changes, and treats aim and defense as "both kinds"', () => {
    const s = addMods(zeroStats(), { aim: 5, defense: 3, hp: 2 });
    expect(s).toMatchObject({ rangedAim: 5, meleeAim: 5, rangedDefense: 3, meleeDefense: 3, hp: 2 });
    const split = addMods(zeroStats(), { meleeAim: 4, rangedDefense: 1 });
    expect(split).toMatchObject({ meleeAim: 4, rangedAim: 0, rangedDefense: 1, meleeDefense: 0 });
    expect(sumMods([{ hp: 1 }, { hp: 2 }, undefined]).hp).toBe(3);
  });

  it('writes a change out in words, and says nothing when there is nothing to say', () => {
    expect(modsText({ hp: 2, mobility: -1 })).toBe('+2 HP, -1 Move');
    expect(modsText({ hp: 0 })).toBe('');
    expect(modsText(undefined)).toBe('');
  });
});

describe('SCHOLAR', () => {
  it('is seven attributes whose letters spell it', () => {
    expect(ATTR_IDS).toHaveLength(7);
    expect(ATTR_IDS.map((id) => ATTRS[id].letter).join('')).toBe('SCHOLAR');
    for (const id of ATTR_IDS) {
      expect(ATTRS[id].label.length).toBeGreaterThan(0);
      expect(ATTRS[id].effects.length).toBeGreaterThan(0);
    }
  });

  it('each attribute moves the thing it says it moves', () => {
    const base = Object.fromEntries(ATTR_IDS.map((id) => [id, 3])) as Record<AttrId, number>;
    const plus = (id: AttrId): ReturnType<typeof attributeStats> => attributeStats({ ...base, [id]: base[id] + 2 });
    const flat = attributeStats(base);
    expect(plus('strength').meleeAim).toBeGreaterThan(flat.meleeAim);
    expect(plus('strength').rangedAim).toBe(flat.rangedAim);
    expect(plus('observation').rangedAim).toBeGreaterThan(flat.rangedAim);
    expect(plus('observation').sight).toBeGreaterThan(flat.sight);
    expect(plus('hustle').mobility).toBeGreaterThan(flat.mobility);
    expect(plus('hustle').rangedDefense).toBeGreaterThan(flat.rangedDefense);
    expect(plus('luck').crit).toBeGreaterThan(flat.crit);
    expect(plus('resilience').hp).toBeGreaterThan(flat.hp);
    // Charm and Aptitude pay off outside the shot maths
    expect(plus('charm')).toEqual(flat);
    expect(plus('aptitude')).toEqual(flat);
    expect(xpMultiplier({ ...base, aptitude: 5 })).toBeGreaterThan(xpMultiplier(base));
    expect(luckFactor({ ...base, luck: 5 })).toBeLessThan(luckFactor(base));
  });

  it('never lets a floor be crossed and never goes past the cap', () => {
    const bottom = Object.fromEntries(ATTR_IDS.map((id) => [id, 1])) as Record<AttrId, number>;
    const s = attributeStats(bottom);
    for (const k of Object.keys(STAT_FLOOR) as Array<keyof typeof STAT_FLOOR>) expect(s[k]).toBeGreaterThanOrEqual(0);
    const maxed = Object.fromEntries(ATTR_IDS.map((id) => [id, ATTR_MAX])) as Record<AttrId, number>;
    expect(canRaise(maxed, 'luck')).toBe(false);
    expect(canRaise(bottom, 'luck')).toBe(true);
  });
});

describe('combat skills', () => {
  it('are five, each worth a known amount per point and capped', () => {
    expect(COMBAT_SKILL_IDS).toHaveLength(5);
    for (const id of COMBAT_SKILL_IDS) {
      expect(COMBAT_SKILLS[id].per).toBeGreaterThan(0);
      expect(COMBAT_SKILLS[id].maxPoints).toBeGreaterThan(0);
    }
    const c = { ...zeroCombat(), meleeAttack: 3 };
    expect(combatValue(c, 'meleeAttack')).toBe(3 * COMBAT_SKILLS.meleeAttack.per);
    expect(combatSpent(c)).toBe(3);
  });

  it('feed the right line, with speed buying a tile every two points', () => {
    expect(combatStats({ ...zeroCombat(), meleeAttack: 2 })).toMatchObject({ meleeAim: 2 * COMBAT_SKILLS.meleeAttack.per, rangedAim: 0 });
    expect(combatStats({ ...zeroCombat(), rangedDefense: 2 })).toMatchObject({ rangedDefense: 2 * COMBAT_SKILLS.rangedDefense.per, meleeDefense: 0 });
    expect(combatStats({ ...zeroCombat(), speed: 1 }).mobility).toBe(0);
    expect(combatStats({ ...zeroCombat(), speed: 2 }).mobility).toBe(1);
    expect(combatStats({ ...zeroCombat(), speed: 6 }).mobility).toBe(3);
  });
});

describe('what a level hands out', () => {
  it('is an attribute point and a training point every time', () => {
    const m = scott();
    for (const lv of [2, 4, 5, 7]) {
      const picks = picksForLevel(m, lv, rng());
      expect(picks.filter((p) => p.kind === 'attribute')).toHaveLength(1);
      expect(picks.filter((p) => p.kind === 'combat')).toHaveLength(1);
      expect(picks.every((p) => p.level === lv)).toBe(true);
    }
  });

  it('adds a class perk every third level and a clique perk every sixth', () => {
    const m = scott();
    expect(picksForLevel(m, CLASS_PERK_EVERY, rng()).some((p) => p.kind === 'classPerk')).toBe(true);
    expect(picksForLevel(m, CLASS_PERK_EVERY + 1, rng()).some((p) => p.kind === 'classPerk')).toBe(false);
    const six = picksForLevel(m, CLIQUE_PERK_EVERY, rng());
    expect(six.some((p) => p.kind === 'classPerk')).toBe(true); // 6 is a multiple of 3 as well
    expect(six.some((p) => p.kind === 'cliquePerk')).toBe(true);
  });

  it('offers the right number of real perks, and never the same one in both picks of a level', () => {
    const m = scott();
    const six = picksForLevel(m, CLIQUE_PERK_EVERY, rng(12));
    const perkPicks = six.filter((p) => p.kind === 'classPerk' || p.kind === 'cliquePerk');
    const all = perkPicks.flatMap((p) => p.options ?? []);
    expect(new Set(all).size).toBe(all.length);
    for (const p of perkPicks) {
      expect(p.options?.length).toBe(PERK_OPTIONS);
      for (const id of p.options ?? []) expect(PERKS[id]).toBeTruthy();
    }
  });

  it('never offers a perk the member already has', () => {
    const m = scott();
    m.perks = [...m.perks, ...(picksForLevel(m, 3, rng(4)).find((p) => p.kind === 'classPerk')?.options ?? [])];
    const again = picksForLevel(m, 6, rng(4)).find((p) => p.kind === 'classPerk');
    for (const id of again?.options ?? []) expect(m.perks).not.toContain(id);
  });
});

describe('spending the picks', () => {
  it('puts an attribute point where you ask, once', () => {
    const m = levelTo(scott(), 2);
    const before = m.attributes.strength;
    expect(pendingOf(m, 'attribute')).toBeTruthy();
    expect(spendAttribute(m, 'strength').ok).toBe(true);
    expect(m.attributes.strength).toBe(before + 1);
    expect(pendingOf(m, 'attribute')).toBeUndefined();
    expect(spendAttribute(m, 'strength')).toMatchObject({ ok: false, error: 'No attribute point to spend.' });
  });

  it('refuses an attribute that is already at the cap, and keeps the point', () => {
    const m = levelTo(scott(), 2);
    m.attributes.luck = ATTR_MAX;
    expect(spendAttribute(m, 'luck').ok).toBe(false);
    expect(pendingOf(m, 'attribute')).toBeTruthy();
    expect(spendAttribute(m, 'charm').ok).toBe(true);
  });

  it('trains a combat skill, and stops at its cap', () => {
    const m = levelTo(scott(), 2);
    expect(spendCombat(m, 'meleeAttack').ok).toBe(true);
    expect(m.combat.meleeAttack).toBe(1);
    expect(effectiveStats(m).meleeAim).toBe(effectiveStats({ ...m, combat: zeroCombat() }).meleeAim + COMBAT_SKILLS.meleeAttack.per);

    const maxed = levelTo(scott(), 3);
    maxed.combat.speed = COMBAT_SKILLS.speed.maxPoints;
    expect(canTrain(maxed.combat, 'speed')).toBe(false);
    expect(spendCombat(maxed, 'speed').ok).toBe(false);
    expect(pendingOf(maxed, 'combat')).toBeTruthy();
  });

  it('only takes a perk that was actually offered, and only once', () => {
    const m = levelTo(scott(), 3);
    const pick = m.pending.find((p) => p.kind === 'classPerk')!;
    const chosen = pick.options![0];
    const other = pick.options![1];
    expect(takePerk(m, 'conditioning')).toMatchObject({ ok: false, error: 'That perk is not on offer.' });
    expect(takePerk(m, chosen).ok).toBe(true);
    expect(m.perks).toContain(chosen);
    expect(m.perks).not.toContain(other); // the one you turned down is gone
    expect(takePerk(m, other)).toMatchObject({ ok: false });
  });

  it('a perk that teaches a skill puts it on the action bar straight away', () => {
    const m = newMember('x', 'Test', 'jock', 'sport');
    expect(skillsFor(m)).toEqual(['warCry', 'throwBall']);
    m.perks.push('tackle');
    expect(skillsFor(m)).toContain('tackle');
    expect(memberSpec(m, 0, 0).skills).toContain('tackle');
  });

  it('never leaves someone on less health than they started a level-up with', () => {
    const m = levelTo(scott(), 2);
    m.hp = 3;
    const maxBefore = effectiveStats(m).hp;
    spendAttribute(m, 'resilience');
    expect(effectiveStats(m).hp).toBeGreaterThan(maxBefore);
    expect(m.hp).toBe(3 + (effectiveStats(m).hp - maxBefore));
  });

  it('counts what is owed across the squad', () => {
    const roster = createStarterRoster();
    expect(pendingCount(roster)).toBe(0);
    levelTo(roster[1], 3);
    expect(pendingCount(roster)).toBe(roster[1].pending.length);
    roster[1].dead = true;
    expect(pendingCount(roster)).toBe(0);
  });
});

describe('deciding for them', () => {
  it('spends everything and leaves a sane character', () => {
    const m = levelTo(scott(), 7);
    const owed = m.pending.length;
    const notes = autoSpend(m);
    expect(hasPending(m)).toBe(false);
    expect(notes.length).toBeGreaterThan(0);
    expect(combatSpent(m.combat) + (m.attributes.strength - startingAttributes('jock', 'sport').strength)).toBeGreaterThan(0);
    expect(owed).toBeGreaterThanOrEqual(m.perks.length - 2);
  });

  it('trains to suit the weapon in hand', () => {
    const melee = levelTo(newMember('a', 'A', 'jock', 'metalwork'), 3);
    melee.gear = { rightHand: 'machete' };
    autoSpend(melee);
    expect(melee.combat.meleeAttack).toBeGreaterThan(0);

    const ranged = levelTo(newMember('b', 'B', 'nerd', 'science'), 3);
    ranged.gear = { rightHand: 'slingshot' };
    autoSpend(ranged);
    expect(ranged.combat.rangedAttack).toBeGreaterThan(0);
  });

  it('cannot get stuck when everything is already at its cap', () => {
    const m = levelTo(scott(), 6);
    for (const id of ATTR_IDS) m.attributes[id] = ATTR_MAX;
    for (const id of COMBAT_SKILL_IDS) m.combat[id] = COMBAT_SKILLS[id].maxPoints;
    autoSpend(m);
    expect(hasPending(m)).toBe(false);
  });
});

describe('experience', () => {
  it('needs more each level and stops at the cap', () => {
    expect(xpToNext(1)).toBeLessThan(xpToNext(5));
    expect(xpToNext(MAX_LEVEL)).toBe(Infinity);
    expect(MAX_LEVEL).toBeGreaterThanOrEqual(CLIQUE_PERK_EVERY * 2); // at least two clique picks in a run
  });

  it('is multiplied by Aptitude, and a quick study gets there first', () => {
    const slow = newMember('a', 'A', 'jock', 'metalwork');
    const quick = newMember('b', 'B', 'nerd', 'science');
    addXp(slow, 100, rng(), []);
    addXp(quick, 100, rng(), []);
    expect(quick.xp + quick.level * 1000).toBeGreaterThan(slow.xp + slow.level * 1000);
  });

  it('stops dead at the level cap and banks nothing', () => {
    const m = scott();
    m.level = MAX_LEVEL;
    addXp(m, 9999, rng(), []);
    expect(m.level).toBe(MAX_LEVEL);
    expect(m.xp).toBe(0);
    expect(m.pending).toHaveLength(0);
  });

  it('a world event pays everyone still standing, and skips the fallen', () => {
    const roster = createStarterRoster();
    roster[2].dead = true;
    const notes = grantXp(roster, XP_DISCOVERY, rng());
    expect(notes).toEqual([]); // nobody levelled on six XP
    expect(roster[0].xp).toBeGreaterThan(0);
    expect(roster[2].xp).toBe(0);
    expect(XP_CAMP_TASK).toBeGreaterThan(0);
  });

  it('levels through several at once and queues every one of them', () => {
    const m = scott();
    addXp(m, 2000, rng(5), []);
    expect(m.level).toBeGreaterThan(3);
    const levels = m.pending.map((p) => p.level);
    expect(Math.min(...levels)).toBe(2);
    expect(Math.max(...levels)).toBe(m.level);
  });
});

describe('older saves', () => {
  const ancient = (): RosterMember => {
    const m = scott() as RosterMember & Record<string, unknown>;
    // what a save written before any of this looked like
    delete (m as Partial<RosterMember>).attributes;
    delete (m as Partial<RosterMember>).combat;
    delete (m as Partial<RosterMember>).perks;
    delete (m as Partial<RosterMember>).pending;
    m.traits = [];
    m.level = 4;
    m.hp = 12;
    return m as RosterMember;
  };

  it('rebuilds what is missing and hands back every pick the level had earned', () => {
    const m = ancient();
    expect(migrateMember(m, rng())).toBe(true);
    expect(m.attributes).toEqual(startingAttributes('jock', 'sport'));
    expect(m.combat).toEqual(zeroCombat());
    expect(m.perks.length).toBeGreaterThan(0);
    expect(m.traits).toHaveLength(1);
    expect(m.pending.filter((p) => p.kind === 'attribute')).toHaveLength(3); // levels 2, 3 and 4
    expect(m.pending.some((p) => p.kind === 'classPerk' && p.level === 3)).toBe(true);
    expect(m.hp).toBeLessThanOrEqual(effectiveStats(m).hp);
  });

  it('leaves an up-to-date member alone, so it is safe to run on every load', () => {
    const m = levelTo(scott(), 3);
    const before = structuredClone(m);
    expect(migrateMember(m, rng())).toBe(false);
    expect(m).toEqual(before);
  });

  it('repairs a whole roster and reports whether it touched anything', () => {
    const roster = [ancient(), scott()];
    expect(migrateRoster(roster, rng())).toBe(true);
    expect(migrateRoster(roster, rng())).toBe(false);
    for (const m of roster) expect(effectiveStats(m).hp).toBeGreaterThan(0);
  });

  it('a migrated member still deploys', () => {
    const m = ancient();
    migrateMember(m, rng());
    const spec = memberSpec(m, 1, 1);
    expect(spec.aim).toBeGreaterThan(0);
    expect(spec.meleeAim).toBeGreaterThan(0);
    expect(spec.skills?.length).toBeGreaterThan(0);
  });
});

describe('a whole career', () => {
  it('takes a character to the cap with every pick spent and nothing out of bounds', () => {
    const m = levelTo(newMember('x', 'Grown', 'weirdo', 'metalwork'), MAX_LEVEL, 11);
    autoSpend(m);
    expect(m.level).toBe(MAX_LEVEL);
    expect(hasPending(m)).toBe(false);
    for (const id of ATTR_IDS) expect(m.attributes[id]).toBeLessThanOrEqual(ATTR_MAX);
    for (const id of COMBAT_SKILL_IDS) expect(m.combat[id]).toBeLessThanOrEqual(COMBAT_SKILLS[id].maxPoints);
    // 11 level-ups: one attribute point and one training point each
    expect(combatSpent(m.combat)).toBeLessThanOrEqual(MAX_LEVEL - 1);
    expect(new Set(m.perks).size).toBe(m.perks.length);
    const s = effectiveStats(m);
    expect(s.hp).toBeGreaterThan(effectiveStats(newMember('y', 'Fresh', 'weirdo', 'metalwork')).hp - 1);
    expect(s.rangedAim).toBeLessThan(200);
  });

  it('a grown character is clearly better than a fresh one, without being absurd', () => {
    const fresh = newMember('f', 'Fresh', 'nerd', 'science');
    const grown = levelTo(newMember('g', 'Grown', 'nerd', 'science'), MAX_LEVEL, 3);
    autoSpend(grown);
    const a = effectiveStats(fresh);
    const b = effectiveStats(grown);
    expect(b.hp).toBeGreaterThanOrEqual(a.hp);
    expect(b.rangedAim).toBeGreaterThan(a.rangedAim);
    expect(b.rangedAim - a.rangedAim).toBeLessThan(60);
    expect(b.mobility - a.mobility).toBeLessThanOrEqual(4);
  });
});

describe('rivals keep up', () => {
  const rivalsOf = (level?: number) =>
    encounterScenario({ seed: 42, biome: 'forest', pods: 2, podSize: 3, difficulty: 2, ...(level === undefined ? {} : { level }) }).units.filter((u) => u.team === 'enemy');

  it('are tougher against a seasoned squad than a fresh one', () => {
    const fresh = rivalsOf(1);
    const late = rivalsOf(13);
    expect(late).toHaveLength(fresh.length);
    const total = (us: typeof fresh, k: 'aim' | 'hp' | 'defense'): number => us.reduce((n, u) => n + (u[k] ?? 0), 0);
    for (const k of ['aim', 'hp', 'defense'] as const) expect(total(late, k), k).toBeGreaterThan(total(fresh, k));
    expect(late[0].meleeDefense).toBeGreaterThan(fresh[0].meleeDefense!);
  });

  it('stop improving at the cap, and a missing level means a fresh squad', () => {
    expect(veterancy(1)).toBe(0);
    expect(veterancy(undefined)).toBe(0);
    expect(veterancy(2)).toBe(0); // they only notice every second level
    expect(veterancy(5)).toBe(2);
    expect(veterancy(MAX_LEVEL * 4)).toBe(VET_CAP);
    expect(rivalsOf(99)[0].aim).toBe(rivalsOf(1 + VET_CAP * 2)[0].aim);
  });

  it('leaves the map and the crew alone: only their stats move', () => {
    const fresh = rivalsOf(1);
    const late = rivalsOf(9);
    expect(late.map((u) => [u.x, u.y])).toEqual(fresh.map((u) => [u.x, u.y]));
    expect(late.map((u) => u.name)).toEqual(fresh.map((u) => u.name));
    expect(late.map((u) => u.weapon.name)).toEqual(fresh.map((u) => u.weapon.name));
  });
});

describe('levelling several times at once', () => {
  it('never offers the same perk in two queued picks', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const m = newMember('x', 'Jump', 'jock', 'sport');
      addXp(m, 4000, rng(seed), []);
      const offered = m.pending.flatMap((p) => p.options ?? []);
      expect(new Set(offered).size, `seed ${seed} repeated an offer`).toBe(offered.length);
      for (const id of offered) expect(m.perks).not.toContain(id);
    }
  });

  it('a migrated save gets the same treatment', () => {
    const m = newMember('x', 'Old', 'nerd', 'science');
    m.level = MAX_LEVEL;
    delete (m as Partial<RosterMember>).pending;
    migrateMember(m, rng(3));
    const offered = m.pending.flatMap((p) => p.options ?? []);
    expect(new Set(offered).size).toBe(offered.length);
  });

  it('refuses a perk whose requirement has not been taken', () => {
    const m = newMember('x', 'Req', 'jock', 'sport');
    m.pending = [{ kind: 'classPerk', level: 3, options: ['cannonArm'] }];
    m.perks = ['holler']; // no Throwing Arm
    expect(takePerk(m, 'cannonArm')).toMatchObject({ ok: false });
    m.perks.push('throwArm');
    expect(takePerk(m, 'cannonArm').ok).toBe(true);
  });
});
