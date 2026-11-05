import { describe, expect, it } from 'vitest';
import {
  CLIQUES,
  INJURIES,
  MAX_LEVEL,
  SQUAD_TEMPLATE,
  XP_PARTICIPATION,
  XP_PER_HIT,
  XP_PER_KILL,
  XP_VICTORY,
  applyBattleResult,
  baseStats,
  beachLanding,
  createBattle,
  createStarterRoster,
  deployRoster,
  effectiveStats,
  encounterScenario,
  restAtCamp,
  shoot,
  xpToNext,
  type GameState,
  type Roster,
  type RosterMember,
} from './index';
import { arena, open, unit } from './testutil';

const byId = (r: Roster, id: string): RosterMember => r.find((m) => m.id === id)!;
const unitOf = (s: GameState, id: string) => s.units.find((u) => u.id === id)!;
const battleFor = (r: Roster): GameState => createBattle(deployRoster(beachLanding, r));
const rng = (seed = 1) => ({ rngState: seed });

describe('starter roster', () => {
  it('reproduces the original squad template exactly at level 1 (balance guard)', () => {
    const roster = createStarterRoster();
    expect(roster).toHaveLength(SQUAD_TEMPLATE.length);
    SQUAD_TEMPLATE.forEach((t, i) => {
      const m = roster[i];
      const s = effectiveStats(m);
      expect(m.id).toBe(t.id);
      expect(m.name).toBe(t.name);
      expect(CLIQUES[m.clique].label).toBe(t.role);
      expect(s).toEqual({ hp: t.hp, mobility: t.mobility, aim: t.aim, defense: t.defense, crit: t.crit });
      expect(m.hp).toBe(t.hp);
    });
  });

  it('deploys into a battle identical to the hand-built squad', () => {
    const plain = createBattle(beachLanding);
    const fromRoster = battleFor(createStarterRoster());
    expect(fromRoster.units).toEqual(plain.units);
  });
});

describe('effectiveStats', () => {
  it('grows by clique each level, with mobility on its own schedule', () => {
    const jock = baseStats('jock', 3);
    expect(jock).toMatchObject({ hp: 14 + 2 * 2, aim: 62 + 2, crit: 5 + 2, mobility: 5 });
    expect(baseStats('scout', 3).mobility).toBe(6);
    expect(baseStats('scout', 4).mobility).toBe(7);
  });

  it('stacks traits and injuries', () => {
    const m = createStarterRoster()[1]; // Jonah, jock
    m.traits = ['tough', 'eagle-eyed'];
    m.injuries = [{ id: 'twisted-ankle', left: 2 }];
    expect(effectiveStats(m)).toMatchObject({ hp: 16, aim: 67, mobility: 4 });
  });

  it('never drops below the floors', () => {
    const m = createStarterRoster()[2]; // Priya, aim 75
    m.injuries = Array.from({ length: 6 }, () => ({ id: 'concussion' as const, left: 2 }));
    expect(effectiveStats(m).aim).toBe(30);
  });
});

describe('deployRoster', () => {
  const sc = encounterScenario({ seed: 5, biome: 'forest', pods: 2, podSize: 3, difficulty: 2 });

  it('keeps slot positions and order, and leaves the enemies and map alone', () => {
    const out = deployRoster(sc, createStarterRoster());
    const slots = sc.units.filter((u) => u.team === 'player');
    const squad = out.units.filter((u) => u.team === 'player');
    expect(squad.map((u) => [u.x, u.y])).toEqual(slots.map((u) => [u.x, u.y]));
    expect(out.units.filter((u) => u.team === 'enemy')).toEqual(sc.units.filter((u) => u.team === 'enemy'));
    expect(out.map()).toEqual(sc.map());
  });

  it('deploys a wounded member below max HP', () => {
    const roster = createStarterRoster();
    byId(roster, 'p2').hp = 5;
    const u = unitOf(battleFor(roster), 'p2');
    expect(u.hp).toBe(5);
    expect(u.maxHp).toBe(14);
  });

  it('applies injury penalties, and clamps HP to the reduced maximum', () => {
    const roster = createStarterRoster();
    const mia = byId(roster, 'p1');
    mia.injuries = [{ id: 'twisted-ankle', left: 2 }];
    const ned = byId(roster, 'p3');
    ned.injuries = [{ id: 'cracked-ribs', left: 3 }];
    ned.hp = 99;
    const s = battleFor(roster);
    expect(unitOf(s, 'p1').mobility).toBe(5);
    expect(unitOf(s, 'p3').maxHp).toBe(9 - 3);
    expect(unitOf(s, 'p3').hp).toBe(9 - 3);
  });

  it('deploys only as many members as there are slots', () => {
    const twoSlots = { ...sc, units: [...sc.units.filter((u) => u.team === 'player').slice(0, 2), ...sc.units.filter((u) => u.team === 'enemy')] };
    const out = deployRoster(twoSlots, createStarterRoster());
    expect(out.units.filter((u) => u.team === 'player').map((u) => u.id)).toEqual(['p1', 'p2']);
  });
});

describe('hit and kill counters', () => {
  it('count landed shots and downed targets on the attacker', () => {
    let hits = 0;
    let kills = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = arena(
        open(8, 3),
        [unit({ id: 'a', team: 'player', pos: { x: 0, y: 1 }, aim: 90 }), unit({ id: 'b', team: 'enemy', pos: { x: 3, y: 1 }, hp: 1, maxHp: 1 })],
        seed,
      );
      const res = shoot(s, 'a', 'b');
      const ev = res.events[0];
      if (ev.type !== 'shoot') throw new Error('expected a shot');
      const a = unitOf(s, 'a');
      expect(a.hits ?? 0).toBe(ev.hit ? 1 : 0);
      expect(a.kills ?? 0).toBe(ev.killed ? 1 : 0);
      if (ev.hit) hits++;
      if (ev.killed) kills++;
    }
    expect(hits).toBeGreaterThan(0);
    expect(kills).toBe(hits); // target has 1 HP, so every hit is a kill
  });
});

describe('applyBattleResult', () => {
  it('carries surviving HP forward', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    unitOf(s, 'p1').hp = 4;
    s.winner = 'player';
    applyBattleResult(roster, s, rng());
    expect(byId(roster, 'p1').hp).toBe(4);
    expect(byId(roster, 'p2').hp).toBe(14);
  });

  it('brings a downed unit back at 1 HP with an injury', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    const down = unitOf(s, 'p2');
    down.hp = 0;
    down.alive = false;
    s.winner = 'player';
    const report = applyBattleResult(roster, s, rng());
    const m = byId(roster, 'p2');
    expect(m.hp).toBe(1);
    expect(m.injuries).toHaveLength(1);
    expect(m.injuries[0].left).toBe(INJURIES[m.injuries[0].id].recovery);
    expect(report.notes.some((n) => n.startsWith('Jonah went down hard'))).toBe(true);
  });

  it('awards XP for taking part, hits, kills and winning', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    const u = unitOf(s, 'p1');
    u.hits = 3;
    u.kills = 1;
    s.winner = 'player';
    applyBattleResult(roster, s, rng());
    expect(byId(roster, 'p1').xp).toBe(XP_PARTICIPATION + 3 * XP_PER_HIT + XP_PER_KILL + XP_VICTORY);
    expect(byId(roster, 'p4').xp).toBe(XP_PARTICIPATION + XP_VICTORY);
  });

  it('levels up, grants a trait, and heals the max HP it gained', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    const u = unitOf(s, 'p2');
    u.hp = 5;
    u.hits = 5;
    u.kills = 2;
    s.winner = 'player';
    const report = applyBattleResult(roster, s, rng());
    const m = byId(roster, 'p2');
    const total = XP_PARTICIPATION + 5 * XP_PER_HIT + 2 * XP_PER_KILL + XP_VICTORY;
    expect(m.level).toBe(2);
    expect(m.xp).toBe(total - xpToNext(1));
    expect(m.traits).toHaveLength(1);
    expect(m.hp).toBe(5 + (effectiveStats(m).hp - 14));
    expect(report.notes.some((n) => n.includes('reaches level 2') && n.includes('New trait'))).toBe(true);
  });

  it('can level several times at once, picking a trait at each trait level without repeats', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    unitOf(s, 'p3').kills = 20;
    s.winner = 'player';
    applyBattleResult(roster, s, rng(3));
    const m = byId(roster, 'p3');
    expect(m.level).toBe(4);
    expect(m.traits).toHaveLength(2);
    expect(new Set(m.traits).size).toBe(2);
  });

  it('stops earning XP at the level cap', () => {
    const roster = createStarterRoster();
    const m = byId(roster, 'p1');
    m.level = MAX_LEVEL;
    m.hp = effectiveStats(m).hp;
    const s = battleFor(roster);
    unitOf(s, 'p1').kills = 5;
    s.winner = 'player';
    applyBattleResult(roster, s, rng());
    expect(m.level).toBe(MAX_LEVEL);
    expect(m.xp).toBe(0);
    expect(xpToNext(MAX_LEVEL)).toBe(Infinity);
  });

  it('a defeat downs everyone and gives participation XP only', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    for (const u of s.units.filter((x) => x.team === 'player')) {
      u.hp = 0;
      u.alive = false;
    }
    s.winner = 'enemy';
    applyBattleResult(roster, s, rng());
    for (const m of roster) {
      expect(m.hp).toBe(1);
      expect(m.injuries).toHaveLength(1);
      expect(m.xp).toBe(XP_PARTICIPATION);
    }
  });

  it('a retreat keeps HP and injuries from going down, but gives no XP and heals nothing', () => {
    const roster = createStarterRoster();
    byId(roster, 'p1').injuries = [{ id: 'twisted-ankle', left: 2 }];
    const s = battleFor(roster);
    unitOf(s, 'p1').hp = 3;
    unitOf(s, 'p1').kills = 2;
    const down = unitOf(s, 'p2');
    down.hp = 0;
    down.alive = false;
    expect(s.winner).toBeNull();
    const report = applyBattleResult(roster, s, rng());
    expect(report.outcome).toBe('retreat');
    expect(byId(roster, 'p1').hp).toBe(3);
    expect(byId(roster, 'p1').xp).toBe(0);
    expect(byId(roster, 'p1').injuries).toEqual([{ id: 'twisted-ankle', left: 2 }]); // not ticked
    expect(byId(roster, 'p2').injuries).toHaveLength(1); // going down still costs you
  });

  it('heals old injuries on a completed fight, and new ones keep their full duration', () => {
    const roster = createStarterRoster();
    const m = byId(roster, 'p2');
    m.injuries = [{ id: 'shaken', left: 1 }];
    const s = battleFor(roster);
    const u = unitOf(s, 'p2');
    u.hp = 0;
    u.alive = false;
    s.winner = 'player';
    const report = applyBattleResult(roster, s, rng());
    expect(m.injuries).toHaveLength(1);
    expect(m.injuries[0].left).toBe(INJURIES[m.injuries[0].id].recovery);
    expect(report.notes.some((n) => n.includes('recovered from shaken up'))).toBe(true);
  });

  it('caps injuries, replacing whichever is closest to healing', () => {
    const roster = createStarterRoster();
    const m = byId(roster, 'p2');
    m.injuries = [
      { id: 'twisted-ankle', left: 2 },
      { id: 'concussion', left: 1 },
    ];
    const s = battleFor(roster);
    const u = unitOf(s, 'p2');
    u.hp = 0;
    u.alive = false; // no winner: a retreat, so nothing ticks
    applyBattleResult(roster, s, rng());
    const ids = m.injuries.map((i) => i.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('twisted-ankle');
    expect(ids).not.toContain('concussion');
  });

  it('leaves members who stayed at camp untouched', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    s.units = s.units.filter((u) => u.id !== 'p4');
    s.winner = 'player';
    const before = structuredClone(byId(roster, 'p4'));
    applyBattleResult(roster, s, rng());
    expect(byId(roster, 'p4')).toEqual(before);
  });

  it('is reproducible for a given seed', () => {
    const run = (seed: number): string => {
      const roster = createStarterRoster();
      const s = battleFor(roster);
      for (const id of ['p1', 'p3']) {
        const u = unitOf(s, id);
        u.hp = 0;
        u.alive = false;
      }
      unitOf(s, 'p2').kills = 8;
      s.winner = 'player';
      const report = applyBattleResult(roster, s, rng(seed));
      return JSON.stringify({ roster, report });
    };
    expect(run(7)).toBe(run(7));
  });
});

describe('restAtCamp', () => {
  it('restores HP to the (injury-adjusted) maximum and leaves injuries alone', () => {
    const roster = createStarterRoster();
    const m = byId(roster, 'p2');
    m.injuries = [{ id: 'cracked-ribs', left: 3 }];
    m.hp = 3;
    byId(roster, 'p1').hp = 2;
    expect(restAtCamp(roster)).toBe(2);
    expect(m.hp).toBe(14 - 3);
    expect(m.injuries).toEqual([{ id: 'cracked-ribs', left: 3 }]);
    expect(byId(roster, 'p1').hp).toBe(10);
    expect(restAtCamp(roster)).toBe(0);
  });
});

describe('serialisation', () => {
  it('survives a JSON round trip with identical derived stats', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    unitOf(s, 'p1').hp = 0;
    unitOf(s, 'p1').alive = false;
    unitOf(s, 'p2').kills = 10;
    s.winner = 'player';
    applyBattleResult(roster, s, rng(9));
    const copy: Roster = JSON.parse(JSON.stringify(roster));
    expect(copy).toEqual(roster);
    copy.forEach((m, i) => expect(effectiveStats(m)).toEqual(effectiveStats(roster[i])));
  });
});
