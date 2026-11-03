import { describe, expect, it } from 'vitest';
import {
  beachLanding,
  computeShot,
  coverAgainst,
  createBattle,
  enemyStep,
  hasLineOfSight,
  isFlanked,
  moveUnit,
  parseMap,
  reachableFor,
  setOverwatch,
  shoot,
  terrainAt,
  WEAPONS,
  type GameState,
  type Unit,
} from './index';

function unit(over: Partial<Unit> & Pick<Unit, 'id' | 'team'>): Unit {
  return {
    name: over.id,
    role: 'test',
    pos: { x: 0, y: 0 },
    hp: 10,
    maxHp: 10,
    ap: 2,
    maxAp: 2,
    mobility: 5,
    aim: 70,
    defense: 0,
    critChance: 0,
    weapon: { name: 'Test', damage: [3, 3], range: 12, optimal: 12, aimMod: 0, critMod: 0, clip: 6 },
    ammo: 6,
    overwatch: false,
    alive: true,
    ...over,
  };
}

function arena(rows: string[], units: Unit[], seed = 1): GameState {
  return { name: 'test', map: parseMap(rows), units, active: 'player', turn: 1, rngState: seed, winner: null, log: [] };
}

const open = (w: number, h: number): string[] => Array.from({ length: h }, () => '.'.repeat(w));

/** Reads the active team through a call so TS doesn't keep a stale narrowed literal type. */
const activeTeam = (s: GameState): string => s.active;

describe('scenario data', () => {
  it('has a valid map with every unit on a free floor tile', () => {
    const s = createBattle(beachLanding);
    const seen = new Set<string>();
    for (const u of s.units) {
      expect(terrainAt(s.map, u.pos.x, u.pos.y)).toBe('floor');
      const k = `${u.pos.x},${u.pos.y}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
    expect(s.units.filter((u) => u.team === 'player').length).toBeGreaterThan(0);
    expect(s.units.filter((u) => u.team === 'enemy').length).toBeGreaterThan(0);
  });
});

describe('line of sight and cover', () => {
  it('walls block sight, cover objects do not', () => {
    const wall = parseMap(['.....', '..#..', '.....']);
    expect(hasLineOfSight(wall, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(false);
    expect(hasLineOfSight(wall, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    const low = parseMap(['.....', '..h..', '.....']);
    expect(hasLineOfSight(low, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(true);
  });

  it('only counts cover on the side facing the attacker', () => {
    const map = parseMap(['.....', '..hT.', '.....'].map((r) => r.replace('T', '.')));
    const target = { x: 3, y: 1 };
    expect(coverAgainst(map, { x: 0, y: 1 }, target)).toBe('half'); // shooting from behind the crate's side
    expect(coverAgainst(map, { x: 6, y: 1 }, target)).toBe('none'); // opposite side
    expect(isFlanked(map, { x: 6, y: 1 }, target)).toBe(true);
    expect(isFlanked(map, { x: 0, y: 1 }, target)).toBe(false);
  });

  it('prefers full cover over half when both face the attacker, and is not flanked in open ground', () => {
    // Target at (2,1): half cover to the north (2,0), full cover to the east (3,1)
    const map = parseMap(['..h...', '...F..', '......']);
    const target = { x: 2, y: 1 };
    expect(coverAgainst(map, { x: 5, y: 0 }, target)).toBe('full'); // NE attacker sees both -> best wins
    expect(coverAgainst(map, { x: 2, y: 2 }, target)).toBe('none'); // from the south: exposed
    expect(coverAgainst(map, { x: 0, y: 1 }, target)).toBe('none'); // from the west: exposed
    expect(isFlanked(map, { x: 0, y: 1 }, target)).toBe(true);
    const open3 = parseMap(open(5, 3));
    expect(isFlanked(open3, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(false);
  });
});

describe('shot maths', () => {
  const rows = ['.......', '...F...', '.......'];
  const map = parseMap(rows);
  const shooter = { aim: 70, critChance: 0, weapon: { ...WEAPONS.slingshot, optimal: 20, range: 20, aimMod: 0, critMod: 0 } };

  it('applies cover penalties 0 / 20 / 40', () => {
    const exposed = computeShot(map, shooter, { x: 0, y: 0 }, { defense: 0, pos: { x: 6, y: 0 }, hp: 10 });
    expect(exposed.hitChance).toBe(70);
    // Target at (4,1) has full cover at (3,1) on its west side; attacker from the west
    const covered = computeShot(map, shooter, { x: 0, y: 1 }, { defense: 0, pos: { x: 4, y: 1 }, hp: 10 });
    expect(covered.cover).toBe('full');
    expect(covered.hitChance).toBe(30);
    const hMap = parseMap(['.......', '...h...', '.......']);
    const half = computeShot(hMap, shooter, { x: 0, y: 1 }, { defense: 0, pos: { x: 4, y: 1 }, hp: 10 });
    expect(half.hitChance).toBe(50);
  });

  it('overwatch is less accurate, range is penalised, and chance is clamped', () => {
    const base = { defense: 0, pos: { x: 6, y: 0 }, hp: 10 };
    expect(computeShot(map, shooter, { x: 0, y: 0 }, base, true).hitChance).toBe(55);
    const far = computeShot(map, { ...shooter, weapon: { ...shooter.weapon, optimal: 2 } }, { x: 0, y: 0 }, base);
    expect(far.hitChance).toBe(70 - 4 * 4);
    expect(computeShot(map, { ...shooter, aim: 500 }, { x: 0, y: 0 }, base).hitChance).toBe(95);
    expect(computeShot(map, { ...shooter, aim: -500 }, { x: 0, y: 0 }, base).hitChance).toBe(5);
  });

  it('rejects out-of-range and blocked shots', () => {
    const short = { ...shooter, weapon: { ...shooter.weapon, range: 3 } };
    expect(computeShot(map, short, { x: 0, y: 0 }, { defense: 0, pos: { x: 6, y: 0 }, hp: 10 }).canShoot).toBe(false);
    const walled = parseMap(['.....', '..#..', '.....']);
    const pv = computeShot(walled, shooter, { x: 0, y: 1 }, { defense: 0, pos: { x: 4, y: 1 }, hp: 10 });
    expect(pv.canShoot).toBe(false);
    expect(pv.reason).toMatch(/sight/i);
  });
});

describe('movement and AP', () => {
  it('walls and units block movement; reach is limited by AP', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 0, y: 2 } });
    const blocker = unit({ id: 'b', team: 'enemy', pos: { x: 3, y: 2 } });
    // Wall column at x=5 with a single gap on the bottom row
    const s = arena(['.....#....', '.....#....', '.....#....', '.....#....', '..........'], [a, blocker]);
    const full = reachableFor(s, a); // 2 AP -> up to 10 steps
    expect(full.has('3,2')).toBe(false); // occupied by the enemy
    expect(full.has('5,0')).toBe(false); // wall
    expect(full.has('4,2')).toBe(true);
    expect(full.has('6,2')).toBe(true); // reachable only by going round through the gap
    a.ap = 1; // 1 AP -> up to 5 steps: can't get round the wall
    const half = reachableFor(s, a);
    expect(half.has('6,2')).toBe(false);
    expect(Math.max(...[...half.values()].map((n) => n.cost))).toBeLessThanOrEqual(5);
    a.ap = 0;
    expect(reachableFor(s, a).size).toBe(1); // only the start tile
  });

  it('charges 1 AP up to mobility tiles, 2 AP up to double (dash), and refuses further', () => {
    const mk = (): { s: GameState; a: Unit } => {
      const a = unit({ id: 'a', team: 'player', pos: { x: 0, y: 0 }, mobility: 4 });
      return { s: arena(open(14, 3), [a, unit({ id: 'e', team: 'enemy', pos: { x: 13, y: 2 } })]), a };
    };
    let { s, a } = mk();
    expect(moveUnit(s, 'a', { x: 4, y: 0 }).ok).toBe(true);
    expect(a.ap).toBe(1);
    ({ s, a } = mk());
    expect(moveUnit(s, 'a', { x: 8, y: 0 }).ok).toBe(true);
    expect(a.ap).toBe(0);
    ({ s, a } = mk());
    const bad = moveUnit(s, 'a', { x: 9, y: 0 });
    expect(bad.ok).toBe(false);
    expect(a.ap).toBe(2);
  });

  it('shooting costs 1 AP and 1 ammo; overwatch ends the unit\'s turn; out of ammo is refused', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 0, y: 0 }, aim: 200 });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 3, y: 0 }, hp: 100, maxHp: 100 });
    const s = arena(open(6, 2), [a, e]);
    expect(shoot(s, 'a', 'e').ok).toBe(true);
    expect(a.ap).toBe(1);
    expect(a.ammo).toBe(5);
    expect(setOverwatch(s, 'a').ok).toBe(true);
    expect(a.ap).toBe(0);
    expect(a.overwatch).toBe(true);
    a.ap = 1;
    a.ammo = 0;
    expect(shoot(s, 'a', 'e').ok).toBe(false);
  });

  it('only lets the active team act', () => {
    const a = unit({ id: 'a', team: 'player' });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 2, y: 0 } });
    const s = arena(open(5, 2), [a, e]);
    expect(moveUnit(s, 'e', { x: 3, y: 0 }).ok).toBe(false);
  });
});

describe('overwatch', () => {
  it('gives a reaction shot to a mover entering line of sight, once', () => {
    const watcher = unit({ id: 'w', team: 'player', pos: { x: 0, y: 1 }, overwatch: true, ap: 0 });
    const mover = unit({ id: 'm', team: 'enemy', pos: { x: 9, y: 1 }, hp: 100, maxHp: 100 });
    const s = arena(open(10, 3), [watcher, mover]);
    s.active = 'enemy';
    const res = moveUnit(s, 'm', { x: 5, y: 1 });
    expect(res.ok).toBe(true);
    const shots = res.events.filter((ev) => ev.type === 'shoot' && ev.overwatch);
    expect(shots).toHaveLength(1);
    expect(watcher.overwatch).toBe(false);
    expect(watcher.ammo).toBe(5);
  });

  it('a mover killed by overwatch stops walking', () => {
    const watcher = unit({ id: 'w', team: 'player', pos: { x: 0, y: 1 }, overwatch: true, ap: 0, aim: 500, weapon: { ...WEAPONS.slingshot, damage: [50, 50], range: 20, optimal: 20, aimMod: 100 } });
    const mover = unit({ id: 'm', team: 'enemy', pos: { x: 9, y: 1 }, hp: 5, maxHp: 5 });
    const other = unit({ id: 'x', team: 'enemy', pos: { x: 9, y: 2 } });
    const s = arena(open(10, 3), [watcher, mover, other]);
    s.active = 'enemy';
    // 95% hit clamp: search for a seed that hits so the assertion is deterministic
    let killedRun: ReturnType<typeof moveUnit> | null = null;
    for (let seed = 1; seed < 200 && !killedRun; seed++) {
      watcher.overwatch = true;
      watcher.ammo = 6;
      mover.alive = true;
      mover.hp = 5;
      mover.pos = { x: 9, y: 1 };
      mover.ap = 2;
      s.rngState = seed;
      s.winner = null;
      const r = moveUnit(s, 'm', { x: 4, y: 1 });
      if (!mover.alive) killedRun = r;
    }
    expect(killedRun).not.toBeNull();
    const mv = killedRun!.events.find((ev) => ev.type === 'move');
    expect(mv && mv.type === 'move' && mv.path.length).toBeLessThan(5);
  });
});

describe('win condition', () => {
  it('declares victory when the last enemy falls', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 0, y: 0 }, aim: 500 });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 2, y: 0 }, hp: 1, maxHp: 1 });
    const s = arena(open(4, 2), [a, e]);
    for (let i = 0; i < 50 && !s.winner; i++) {
      a.ap = 2;
      a.ammo = 6;
      shoot(s, 'a', 'e');
    }
    expect(s.winner).toBe('player');
    expect(shoot(s, 'a', 'e').ok).toBe(false);
  });
});

describe('enemy AI and determinism', () => {
  function playEnemyTurn(s: GameState): number {
    let steps = 0;
    while (enemyStep(s) !== null) {
      steps++;
      if (steps > 300) throw new Error('enemy turn did not terminate');
    }
    return steps;
  }

  it('always terminates, hands the turn back, and never overlaps units', () => {
    const s = createBattle(beachLanding);
    for (let round = 0; round < 6 && !s.winner; round++) {
      s.active = 'enemy';
      for (const u of s.units) if (u.team === 'enemy' && u.alive) u.ap = u.maxAp;
      playEnemyTurn(s);
      // Either the turn came back to the player, or the (idle) squad was wiped and the battle is over.
      expect(s.winner !== null || activeTeam(s) === 'player').toBe(true);
      const keys = s.units.filter((u) => u.alive).map((u) => `${u.pos.x},${u.pos.y}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const u of s.units) expect(u.ap).toBeGreaterThanOrEqual(0);
    }
  });

  it('advances toward the player when nothing is in reach', () => {
    const s = createBattle(beachLanding);
    const before = s.units.filter((u) => u.team === 'enemy').map((u) => u.pos.x);
    s.active = 'enemy';
    for (const u of s.units) if (u.team === 'enemy') u.ap = u.maxAp;
    playEnemyTurn(s);
    const after = s.units.filter((u) => u.team === 'enemy').map((u) => u.pos.x);
    expect(after.reduce((a, b) => a + b, 0)).toBeLessThan(before.reduce((a, b) => a + b, 0));
  });

  it('is deterministic for a given seed and action sequence', () => {
    const run = (): string => {
      const s = createBattle(beachLanding);
      for (let round = 0; round < 4 && !s.winner; round++) {
        s.active = 'enemy';
        for (const u of s.units) if (u.team === 'enemy' && u.alive) u.ap = u.maxAp;
        playEnemyTurn(s);
      }
      return JSON.stringify({ log: s.log, units: s.units.map((u) => [u.id, u.pos, u.hp]) });
    };
    expect(run()).toBe(run());
  });
});
