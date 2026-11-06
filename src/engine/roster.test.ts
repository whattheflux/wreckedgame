import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  CLIQUES,
  FIELD_SIZE,
  INJURIES,
  MAX_LEVEL,
  MAX_ROSTER,
  SQUAD_TEMPLATE,
  STAT_FLOOR,
  XP_PARTICIPATION,
  XP_PER_HIT,
  XP_PER_KILL,
  XP_VICTORY,
  applyBattleResult,
  baseStats,
  beachLanding,
  chooseSquad,
  createBattle,
  createStarterRoster,
  deployRoster,
  effectiveStats,
  encounterScenario,
  fateOfDowned,
  gameOverReason,
  livingSquad,
  restAtCamp,
  reviveUnit,
  shoot,
  xpToNext,
  spriteKey,
  weaponOf,
  type Clique,
  type GameState,
  type Roster,
  type RosterMember,
  type SchoolClass,
} from './index';
import { arena, open, unit } from './testutil';

const byId = (r: Roster, id: string): RosterMember => r.find((m) => m.id === id)!;
const unitOf = (s: GameState, id: string) => s.units.find((u) => u.id === id)!;
/** Default field: the player character plus the first three companions (Anna sits out). */
const battleFor = (r: Roster, squad?: string[]): GameState => createBattle(deployRoster(beachLanding, r, squad));
const rng = (seed = 1) => ({ rngState: seed });
const knockDown = (s: GameState, id: string): void => {
  const u = unitOf(s, id);
  u.hp = 0;
  u.alive = false;
  u.downed = true;
  u.downs = 1;
};
const kill = (s: GameState, id: string): void => {
  const u = unitOf(s, id);
  u.hp = 0;
  u.alive = false;
};

describe('starter roster', () => {
  it('is the player character plus four companions, capped at the roster maximum', () => {
    const roster = createStarterRoster({ name: 'Dale', clique: 'weirdo', schoolClass: 'metalwork' });
    expect(roster).toHaveLength(MAX_ROSTER);
    expect(roster.map((m) => m.name)).toEqual(['Dale', 'Amy', 'Scott', 'Tyson', 'Anna']);
    expect(roster.filter((m) => m.protagonist).map((m) => m.id)).toEqual(['pc']);
    expect(roster.every((m) => !m.dead && m.level === 1)).toBe(true);
    expect(FIELD_SIZE).toBeLessThan(MAX_ROSTER);
  });

  it('builds the player from their clique and class choice, weapon from the class', () => {
    const pc = createStarterRoster({ name: 'Dale', clique: 'stoner', schoolClass: 'science' })[0];
    expect(pc).toMatchObject({ id: 'pc', name: 'Dale', clique: 'stoner', schoolClass: 'science', weapon: 'flareGun', protagonist: true });
    expect(pc.hp).toBe(effectiveStats(pc).hp);
  });

  it('records the body for the player character only, and keys art from it', () => {
    const girl = createStarterRoster({ name: 'Max', clique: 'jock', schoolClass: 'sport', look: 'female' });
    expect(girl[0].look).toBe('female');
    expect(spriteKey(girl[0])).toBe('pc-female');
    expect(girl[1].look).toBeUndefined();
    expect(spriteKey(girl[1])).toBe('amy');
    expect(createStarterRoster()[0].look).toBe('male'); // default
    const legacy = { ...girl[0] } as { look?: string };
    delete legacy.look; // saves from before bodies existed
    expect(spriteKey(legacy as typeof girl[0])).toBe('pc-male');
    expect(unitOf(battleFor(girl), 'pc').sprite).toBe('pc-female');
    expect(unitOf(battleFor(girl), 'p1').sprite).toBe('amy');
  });

  it('trims the name and falls back when it is blank', () => {
    expect(createStarterRoster({ name: '  Max  ', clique: 'jock', schoolClass: 'sport' })[0].name).toBe('Max');
    expect(createStarterRoster({ name: '   ', clique: 'jock', schoolClass: 'sport' })[0].name).toBe('You');
    expect(createStarterRoster({ name: 'x'.repeat(40), clique: 'jock', schoolClass: 'sport' })[0].name).toHaveLength(16);
  });

  it('matches the sandbox squad template for the companions (balance guard)', () => {
    const companions = createStarterRoster().slice(1);
    expect(companions).toHaveLength(SQUAD_TEMPLATE.length);
    SQUAD_TEMPLATE.forEach((t, i) => {
      const m = companions[i];
      const s = effectiveStats(m);
      expect(m.id).toBe(t.id);
      expect(m.name).toBe(t.name);
      expect(`${CLIQUES[m.clique].label} / ${CLASSES[m.schoolClass].label}`).toBe(t.role);
      expect(s).toEqual({ hp: t.hp, mobility: t.mobility, aim: t.aim, defense: t.defense, crit: t.crit });
      expect(weaponOf(m)).toEqual(t.weapon);
      expect(m.hp).toBe(t.hp);
    });
  });

  it('every clique and class combination is a playable character', () => {
    const cliques = Object.keys(CLIQUES) as Clique[];
    const classes = Object.keys(CLASSES) as SchoolClass[];
    for (const clique of cliques) {
      for (const schoolClass of classes) {
        const pc = createStarterRoster({ name: 'T', clique, schoolClass })[0];
        const s = effectiveStats(pc);
        for (const k of Object.keys(s) as Array<keyof typeof s>) expect(s[k]).toBeGreaterThanOrEqual(STAT_FLOOR[k]);
        expect(s.hp).toBeGreaterThanOrEqual(9);
        expect(s.aim).toBeGreaterThanOrEqual(58);
      }
    }
  });
});

describe('effectiveStats', () => {
  it('adds clique and class, growing each level, with mobility on its own schedule', () => {
    expect(baseStats('jock', 'sport', 1)).toEqual({ hp: 16, mobility: 6, aim: 62, defense: 0, crit: 5 });
    expect(baseStats('jock', 'sport', 3)).toMatchObject({ hp: 16 + 3 * 2, aim: 62 + 2, crit: 5 + 2, mobility: 6 });
    expect(baseStats('popular', 'sport', 3).mobility).toBe(7);
    expect(baseStats('popular', 'sport', 4).mobility).toBe(8);
  });

  it('lets the same clique play differently by class', () => {
    expect(baseStats('nerd', 'metalwork', 1).defense).toBeGreaterThan(baseStats('nerd', 'science', 1).defense);
    expect(baseStats('nerd', 'science', 1).aim).toBeGreaterThan(baseStats('nerd', 'metalwork', 1).aim);
  });

  it('stacks traits and injuries', () => {
    const m = byId(createStarterRoster(), 'p2'); // Scott, jock / sport
    m.traits = ['tough', 'eagle-eyed'];
    m.injuries = [{ id: 'twisted-ankle', left: 2 }];
    expect(effectiveStats(m)).toMatchObject({ hp: 18, aim: 67, mobility: 5 });
  });

  it('never drops below the floors', () => {
    const m = byId(createStarterRoster(), 'p3'); // Tyson, aim 78
    m.injuries = Array.from({ length: 6 }, () => ({ id: 'concussion' as const, left: 2 }));
    expect(effectiveStats(m).aim).toBe(30);
  });
});

describe('chooseSquad', () => {
  const roster = createStarterRoster();

  it('always takes the player character, then fills from the roster in order', () => {
    expect(chooseSquad(roster)).toEqual(['pc', 'p1', 'p2', 'p3']);
  });

  it('honours the pick order and never exceeds the field size', () => {
    expect(chooseSquad(roster, ['p4', 'p2'])).toEqual(['pc', 'p4', 'p2', 'p1']);
    expect(chooseSquad(roster, ['p4', 'p3', 'p2', 'p1'])).toEqual(['pc', 'p4', 'p3', 'p2']);
  });

  it('ignores the dead, strangers and duplicates', () => {
    const r = createStarterRoster();
    byId(r, 'p2').dead = true;
    expect(chooseSquad(r, ['p2', 'nobody', 'p4', 'p4'])).toEqual(['pc', 'p4', 'p1', 'p3']);
  });

  it('takes fewer when fewer are alive', () => {
    const r = createStarterRoster();
    for (const id of ['p1', 'p2', 'p3']) byId(r, id).dead = true;
    expect(chooseSquad(r)).toEqual(['pc', 'p4']);
    expect(livingSquad(r)).toHaveLength(2);
  });
});

describe('deployRoster', () => {
  const sc = encounterScenario({ seed: 5, biome: 'forest', pods: 2, podSize: 3, difficulty: 2 });

  it('keeps slot positions and order, and leaves the enemies and map alone', () => {
    const out = deployRoster(sc, createStarterRoster());
    const slots = sc.units.filter((u) => u.team === 'player');
    const squad = out.units.filter((u) => u.team === 'player');
    expect(squad).toHaveLength(FIELD_SIZE);
    expect(squad.map((u) => [u.x, u.y])).toEqual(slots.map((u) => [u.x, u.y]));
    expect(out.units.filter((u) => u.team === 'enemy')).toEqual(sc.units.filter((u) => u.team === 'enemy'));
    expect(out.map()).toEqual(sc.map());
  });

  it('fields the squad you picked, with the player character in the first slot', () => {
    const s = battleFor(createStarterRoster(), ['p4', 'p3']);
    expect(s.units.filter((u) => u.team === 'player').map((u) => u.id)).toEqual(['pc', 'p4', 'p3', 'p1']);
  });

  it('flags only the player character as the protagonist', () => {
    const s = battleFor(createStarterRoster());
    expect(unitOf(s, 'pc').protagonist).toBe(true);
    expect(s.units.filter((u) => u.protagonist).map((u) => u.id)).toEqual(['pc']);
  });

  it('deploys a wounded member below max HP', () => {
    const roster = createStarterRoster();
    byId(roster, 'p2').hp = 5;
    const u = unitOf(battleFor(roster), 'p2');
    expect(u.hp).toBe(5);
    expect(u.maxHp).toBe(16);
  });

  it('applies injury penalties, and clamps HP to the reduced maximum', () => {
    const roster = createStarterRoster();
    byId(roster, 'p1').injuries = [{ id: 'twisted-ankle', left: 2 }];
    const tyson = byId(roster, 'p3');
    tyson.injuries = [{ id: 'cracked-ribs', left: 3 }];
    tyson.hp = 99;
    const s = battleFor(roster);
    expect(unitOf(s, 'p1').mobility).toBe(5);
    expect(unitOf(s, 'p3').maxHp).toBe(9 - 3);
    expect(unitOf(s, 'p3').hp).toBe(9 - 3);
  });

  it('deploys only as many members as there are slots, player character first', () => {
    const twoSlots = { ...sc, units: [...sc.units.filter((u) => u.team === 'player').slice(0, 2), ...sc.units.filter((u) => u.team === 'enemy')] };
    const out = deployRoster(twoSlots, createStarterRoster());
    expect(out.units.filter((u) => u.team === 'player').map((u) => u.id)).toEqual(['pc', 'p1']);
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
    expect(byId(roster, 'p2').hp).toBe(16);
  });

  it('kills a companion who falls by default (permadeath) and reports it', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    kill(s, 'p2');
    s.winner = 'player';
    const report = applyBattleResult(roster, s, rng());
    const m = byId(roster, 'p2');
    expect(m.dead).toBe(true);
    expect(m.hp).toBe(0);
    expect(m.injuries).toHaveLength(0);
    expect(report.fallen).toEqual(['p2']);
    expect(report.notes).toContain("Scott didn't make it.");
    expect(fateOfDowned(m, unitOf(s, 'p2'))).toBe('dead');
  });

  it('brings a fallen companion back at 1 HP with an injury when the fate rule says so', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    kill(s, 'p2');
    s.winner = 'player';
    const report = applyBattleResult(roster, s, rng(), { fate: () => 'injured' });
    const m = byId(roster, 'p2');
    expect(m.dead).toBe(false);
    expect(m.hp).toBe(1);
    expect(m.injuries).toHaveLength(1);
    expect(m.injuries[0].left).toBe(INJURIES[m.injuries[0].id].recovery);
    expect(report.fallen).toEqual([]);
    expect(report.notes.some((n) => n.startsWith('Scott went down hard'))).toBe(true);
  });

  it('applies the fate rule per member, so a skill or item can spare just one', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    kill(s, 'p2');
    kill(s, 'p3');
    s.winner = 'player';
    applyBattleResult(roster, s, rng(), { fate: (m) => (m.id === 'p3' ? 'injured' : 'dead') });
    expect(byId(roster, 'p2').dead).toBe(true);
    expect(byId(roster, 'p3').dead).toBe(false);
    expect(byId(roster, 'p3').injuries).toHaveLength(1);
  });

  describe('the player character\'s fall', () => {
    it('a knock-down is survived: back at 1 HP with a serious injury, not dead', () => {
      const roster = createStarterRoster();
      const s = battleFor(roster);
      knockDown(s, 'pc');
      s.winner = 'player';
      const report = applyBattleResult(roster, s, rng());
      const pc = byId(roster, 'pc');
      expect(pc.dead).toBe(false);
      expect(pc.hp).toBe(1);
      expect(pc.injuries).toHaveLength(1);
      expect(report.fallen).toEqual([]);
      expect(fateOfDowned(pc, unitOf(s, 'pc'))).toBe('injured');
      expect(gameOverReason(roster, report.outcome)).toBeNull();
    });

    it('being revived mid-fight still costs an injury, and keeps the revived HP', () => {
      const roster = createStarterRoster();
      const s = battleFor(roster);
      const pc = unitOf(s, 'pc');
      pc.downs = 1;
      pc.hp = 5;
      s.winner = 'player';
      applyBattleResult(roster, s, rng());
      expect(byId(roster, 'pc').hp).toBe(5);
      expect(byId(roster, 'pc').injuries).toHaveLength(1);
      expect(byId(roster, 'pc').dead).toBe(false);
    });

    it('a second fall is death, and it ends the run', () => {
      const roster = createStarterRoster();
      const s = battleFor(roster);
      kill(s, 'pc');
      s.winner = 'enemy';
      const report = applyBattleResult(roster, s, rng());
      expect(byId(roster, 'pc').dead).toBe(true);
      expect(report.fallen).toContain('pc');
      expect(gameOverReason(roster, report.outcome)).toBe('protagonist-fell');
    });

    it('a downed leader still earns participation XP in a won fight', () => {
      const roster = createStarterRoster();
      const s = battleFor(roster);
      knockDown(s, 'pc');
      s.winner = 'player';
      applyBattleResult(roster, s, rng());
      expect(byId(roster, 'pc').xp).toBe(XP_PARTICIPATION + XP_VICTORY);
    });
  });

  it('never pays, revives or redeploys the dead', () => {
    const roster = createStarterRoster();
    const scott = byId(roster, 'p2');
    scott.dead = true;
    scott.hp = 0;
    const s = battleFor(roster);
    expect(s.units.filter((u) => u.team === 'player').map((u) => u.id)).toEqual(['pc', 'p1', 'p3', 'p4']);
    s.winner = 'player';
    applyBattleResult(roster, s, rng());
    expect(scott).toMatchObject({ dead: true, hp: 0, xp: 0, level: 1 });
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
    expect(byId(roster, 'p3').xp).toBe(XP_PARTICIPATION + XP_VICTORY);
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
    expect(m.hp).toBe(5 + (effectiveStats(m).hp - 16));
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

  it('a wipe kills the companions, and a defeat ends the run even if the leader survived the knock-down', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    for (const id of ['p1', 'p2', 'p3']) kill(s, id);
    knockDown(s, 'pc');
    s.winner = 'enemy';
    const report = applyBattleResult(roster, s, rng());
    expect(report.outcome).toBe('defeat');
    expect(report.fallen).toEqual(['p1', 'p2', 'p3']);
    expect(byId(roster, 'pc').dead).toBe(false);
    expect(byId(roster, 'p4').dead).toBe(false); // stayed at camp
    expect(gameOverReason(roster, report.outcome)).toBe('squad-lost');
  });

  it('a defeat gives participation XP only, if the fate rule spares everyone', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    for (const u of s.units.filter((x) => x.team === 'player')) {
      u.hp = 0;
      u.alive = false;
    }
    s.winner = 'enemy';
    applyBattleResult(roster, s, rng(), { fate: () => 'injured' });
    for (const id of ['pc', 'p1', 'p2', 'p3']) {
      const m = byId(roster, id);
      expect(m.hp).toBe(1);
      expect(m.injuries).toHaveLength(1);
      expect(m.xp).toBe(XP_PARTICIPATION);
    }
  });

  it('a retreat saves the living but gives no XP and heals nothing', () => {
    const roster = createStarterRoster();
    byId(roster, 'p1').injuries = [{ id: 'twisted-ankle', left: 2 }];
    const s = battleFor(roster);
    unitOf(s, 'p1').hp = 3;
    unitOf(s, 'p1').kills = 2;
    kill(s, 'p2');
    expect(s.winner).toBeNull();
    const report = applyBattleResult(roster, s, rng());
    expect(report.outcome).toBe('retreat');
    expect(byId(roster, 'p1').hp).toBe(3);
    expect(byId(roster, 'p1').xp).toBe(0);
    expect(byId(roster, 'p1').injuries).toEqual([{ id: 'twisted-ankle', left: 2 }]); // not ticked
    expect(byId(roster, 'p2').dead).toBe(true); // it fell before you pulled out
  });

  it('heals old injuries on a completed fight, and new ones keep their full duration', () => {
    const roster = createStarterRoster();
    const m = byId(roster, 'p2');
    m.injuries = [{ id: 'shaken', left: 1 }];
    const s = battleFor(roster);
    kill(s, 'p2');
    s.winner = 'player';
    const report = applyBattleResult(roster, s, rng(), { fate: () => 'injured' });
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
    kill(s, 'p2'); // no winner: a retreat, so nothing ticks
    applyBattleResult(roster, s, rng(), { fate: () => 'injured' });
    const ids = m.injuries.map((i) => i.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('twisted-ankle');
    expect(ids).not.toContain('concussion');
  });

  it('leaves members who stayed at camp untouched', () => {
    const roster = createStarterRoster();
    const s = battleFor(roster);
    expect(s.units.some((u) => u.id === 'p4')).toBe(false);
    s.winner = 'player';
    const before = structuredClone(byId(roster, 'p4'));
    applyBattleResult(roster, s, rng());
    expect(byId(roster, 'p4')).toEqual(before);
  });

  it('is reproducible for a given seed', () => {
    const run = (seed: number): string => {
      const roster = createStarterRoster();
      const s = battleFor(roster);
      knockDown(s, 'pc');
      kill(s, 'p3');
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
    expect(m.hp).toBe(16 - 3);
    expect(m.injuries).toEqual([{ id: 'cracked-ribs', left: 3 }]);
    expect(byId(roster, 'p1').hp).toBe(11);
    expect(restAtCamp(roster)).toBe(0);
  });

  it('skips the dead', () => {
    const roster = createStarterRoster();
    const anna = byId(roster, 'p4');
    anna.dead = true;
    anna.hp = 0;
    expect(restAtCamp(roster)).toBe(0);
    expect(anna.hp).toBe(0);
  });
});

describe('game over', () => {
  it('is null while the player character lives, however many companions have fallen', () => {
    const roster = createStarterRoster();
    expect(gameOverReason(roster)).toBeNull();
    for (const id of ['p1', 'p2', 'p3', 'p4']) byId(roster, id).dead = true;
    expect(gameOverReason(roster)).toBeNull();
    expect(livingSquad(roster).map((m) => m.id)).toEqual(['pc']);
  });

  it('is triggered when the player character is dead, even with others left', () => {
    const roster = createStarterRoster();
    byId(roster, 'pc').dead = true;
    expect(gameOverReason(roster)).toBe('protagonist-fell');
  });

  it('is triggered by a defeat (squad wipe) even though the leader was only knocked down', () => {
    expect(gameOverReason(createStarterRoster(), 'defeat')).toBe('squad-lost');
    expect(gameOverReason(createStarterRoster(), 'victory')).toBeNull();
    expect(gameOverReason(createStarterRoster(), 'retreat')).toBeNull();
  });

  it('is triggered when nobody is left (no protagonist flagged)', () => {
    const roster = createStarterRoster();
    for (const m of roster) {
      m.protagonist = false;
      m.dead = true;
    }
    expect(gameOverReason(roster)).toBe('squad-lost');
  });
});

describe('serialisation', () => {
  it('survives a JSON round trip with identical derived stats', () => {
    const roster = createStarterRoster({ name: 'Dale', clique: 'weirdo', schoolClass: 'art' });
    const s = battleFor(roster);
    knockDown(s, 'pc');
    unitOf(s, 'p2').kills = 10;
    s.winner = 'player';
    applyBattleResult(roster, s, rng(9));
    const copy: Roster = JSON.parse(JSON.stringify(roster));
    expect(copy).toEqual(roster);
    copy.forEach((m, i) => expect(effectiveStats(m)).toEqual(effectiveStats(roster[i])));
  });
});

describe('knock-down and revive (engine)', () => {
  /** A one-HP leader about to be shot by a certain-hit enemy, with an ally next to them. */
  const duel = (seed = 1): GameState =>
    arena(
      open(8, 3),
      [
        unit({ id: 'pc', team: 'player', pos: { x: 1, y: 1 }, hp: 1, maxHp: 10, protagonist: true }),
        unit({ id: 'ally', team: 'player', pos: { x: 2, y: 2 } }),
        unit({ id: 'foe', team: 'enemy', pos: { x: 5, y: 1 }, aim: 500, weapon: { name: 'T', damage: [3, 3], range: 12, optimal: 12, aimMod: 0, critMod: 0, clip: 6, hands: 1, heavy: false } }),
      ],
      seed,
    );
  /** Keep the foe shooting (a 95% shot can still miss) until the target stops being alive. */
  const shootUntilDown = (s: GameState, targetId: string): void => {
    for (let i = 0; i < 20 && unitOf(s, targetId).alive; i++) {
      const foe = unitOf(s, 'foe');
      foe.ap = 2;
      foe.ammo = 6;
      shoot(s, 'foe', targetId);
    }
  };
  const fall = (s: GameState): void => {
    s.active = 'enemy';
    shootUntilDown(s, 'pc');
  };

  it('the first fall is a knock-down: not alive, not dead, no kill credit, battle goes on', () => {
    const s = duel();
    fall(s);
    const pc = unitOf(s, 'pc');
    expect(pc).toMatchObject({ alive: false, downed: true, downs: 1, hp: 0 });
    expect(unitOf(s, 'foe').kills ?? 0).toBe(0);
    expect(s.winner).toBeNull();
    expect(s.log.some((l) => l.text.includes('is DOWN'))).toBe(true);
  });

  it('an adjacent ally can revive them at 40% HP for 1 AP; they have no AP left that turn', () => {
    const s = duel();
    fall(s);
    s.active = 'player';
    const res = reviveUnit(s, 'ally', 'pc');
    expect(res.ok).toBe(true);
    expect(unitOf(s, 'ally').ap).toBe(1);
    expect(unitOf(s, 'pc')).toMatchObject({ alive: true, downed: false, hp: 4, ap: 0 });
  });

  it('cannot revive from a distance, a living unit, or an enemy', () => {
    const s = duel();
    fall(s);
    s.active = 'player';
    unitOf(s, 'ally').pos = { x: 4, y: 2 };
    expect(reviveUnit(s, 'ally', 'pc').ok).toBe(false);
    unitOf(s, 'ally').pos = { x: 2, y: 2 };
    expect(reviveUnit(s, 'ally', 'ally').ok).toBe(false);
    expect(reviveUnit(s, 'ally', 'foe').ok).toBe(false);
  });

  it('a second fall is final: the leader is dead, not downed', () => {
    const s = duel();
    fall(s);
    s.active = 'player';
    reviveUnit(s, 'ally', 'pc');
    unitOf(s, 'pc').hp = 1;
    s.active = 'enemy';
    shootUntilDown(s, 'pc');
    const pc = unitOf(s, 'pc');
    expect(pc.alive).toBe(false);
    expect(pc.downed).toBe(false);
    expect(pc.downs).toBe(1);
  });

  it('a downed leader cannot be shot again, and the squad is only beaten once nobody is standing', () => {
    const s = duel();
    fall(s);
    expect(shoot(s, 'foe', 'pc').ok).toBe(false);
    expect(s.winner).toBeNull(); // the ally is still up
    unitOf(s, 'ally').pos = { x: 4, y: 2 };
    s.active = 'enemy';
    unitOf(s, 'ally').hp = 1;
    shootUntilDown(s, 'ally');
    expect(unitOf(s, 'ally').alive).toBe(false);
    expect(unitOf(s, 'pc').downed).toBe(true);
    expect(s.winner).toBe('enemy'); // wipe, even though the leader is only downed
  });

  it('only the protagonist gets the free knock-down; anyone else just dies', () => {
    const s = duel();
    unitOf(s, 'ally').hp = 1;
    s.active = 'enemy';
    unitOf(s, 'foe').pos = { x: 4, y: 2 };
    shoot(s, 'foe', 'ally');
    expect(unitOf(s, 'ally')).toMatchObject({ alive: false });
    expect(unitOf(s, 'ally').downed).toBeFalsy();
  });
});
