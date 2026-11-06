import { describe, expect, it } from 'vitest';
import {
  SCENARIOS,
  encounterScenario,
  type Biome,
  coverAgainst,
  createBattle,
  dist,
  endTurn,
  enemyStep,
  living,
  moveUnit,
  reachableFor,
  reload,
  setOverwatch,
  shoot,
  visibleTiles,
  type BattleEvent,
  type GameState,
  type Unit,
} from './index';
import { rand, randInt } from './rng';
import { arena, open, unit } from './testutil';

function runEnemyTurn(s: GameState): BattleEvent[] {
  s.active = 'enemy';
  for (const u of s.units) if (u.team === 'enemy' && u.alive) u.ap = u.dormant ? 0 : u.maxAp;
  const all: BattleEvent[] = [];
  let guard = 0;
  for (let ev = enemyStep(s); ev !== null; ev = enemyStep(s)) {
    all.push(...ev);
    if (++guard > 300) throw new Error('enemy turn did not terminate');
  }
  return all;
}

const shortGun = { name: 'Short', damage: [3, 3] as [number, number], range: 3, optimal: 3, aimMod: 0, critMod: 0, clip: 6, hands: 1 as const, heavy: false };

describe('enemy AI behaviour', () => {
  it('shoots when it has a shot instead of wandering', () => {
    const p = unit({ id: 'p', team: 'player', pos: { x: 0, y: 1 } });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 6, y: 1 } });
    const s = arena(open(12, 3), [p, e]);
    const ev = runEnemyTurn(s);
    expect(ev.some((x) => x.type === 'shoot' && x.attackerId === 'e')).toBe(true);
  });

  it('digs in with overwatch when in good cover and the squad is close but not yet in reach', () => {
    const p = unit({ id: 'p', team: 'player', pos: { x: 0, y: 2 } });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 6, y: 2 }, weapon: shortGun, ap: 1 });
    const s = arena(open(12, 5), [p, e]);
    s.map.tiles[2][5] = 'full'; // full cover on the squad-facing side
    s.active = 'enemy';
    const ev = enemyStep(s);
    expect(ev).not.toBeNull();
    expect(ev!.some((x) => x.type === 'overwatch')).toBe(true);
    expect(e.overwatch).toBe(true);
  });

  it('after firing from the open, ducks into cover and stays in the fight', () => {
    const p = unit({ id: 'p', team: 'player', pos: { x: 0, y: 2 } });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 8, y: 2 }, ap: 1, attacked: true });
    const s = arena(open(16, 7), [p, e]);
    s.map.tiles[5][6] = 'full'; // a crate west of (7,5), i.e. facing the squad
    expect(coverAgainst(s.map, p.pos, e.pos)).toBe('none');
    s.active = 'enemy';
    const ev = enemyStep(s);
    expect(ev!.some((x) => x.type === 'move')).toBe(true);
    expect(coverAgainst(s.map, p.pos, e.pos)).not.toBe('none');
    expect(dist(p.pos, e.pos)).toBeLessThanOrEqual(e.weapon.range);
  });

  it('stops short of a watched sightline instead of eating a free reaction shot', () => {
    const setup = (watching: boolean): { s: GameState; e: Unit } => {
      const watcher = unit({ id: 'w', team: 'player', pos: { x: 0, y: 1 }, overwatch: watching, ap: 0, weapon: { ...shortGun, range: 10, optimal: 10 } });
      const e = unit({ id: 'e', team: 'enemy', pos: { x: 18, y: 1 }, weapon: shortGun });
      return { s: arena(open(24, 3), [watcher, e]), e };
    };

    // Control: nobody is watching, so it dashes as far in as it can (inside the 10-tile zone).
    const control = setup(false);
    runEnemyTurn(control.s);
    expect(control.e.pos.x).toBeLessThanOrEqual(9);

    // Same situation with overwatch up: it holds at the edge of the watched zone and takes no fire.
    const watched = setup(true);
    const events = runEnemyTurn(watched.s);
    expect(events.some((x) => x.type === 'shoot' && x.overwatch)).toBe(false);
    expect(dist({ x: 0, y: 1 }, watched.e.pos)).toBeGreaterThan(10);
    expect(watched.e.pos.x).toBeLessThan(18); // it still advanced up to the edge
  });

  it('never stalemates: an enemy with a stationary squad eventually closes in', () => {
    const p = unit({ id: 'p', team: 'player', pos: { x: 0, y: 5 } });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 34, y: 5 }, weapon: shortGun });
    const s = arena(open(40, 11), [p, e]);
    for (const [x, y] of [[8, 4], [14, 6], [20, 4], [26, 6], [30, 5]] as const) s.map.tiles[y][x] = 'half';
    s.map.tiles[5][18] = 'full';
    const start = dist(p.pos, e.pos);
    for (let i = 0; i < 14 && s.units.every((u) => u.alive); i++) runEnemyTurn(s);
    expect(dist(p.pos, e.pos)).toBeLessThan(start - 15);
  });

  it('keeps pod-mates together while advancing', () => {
    const p = unit({ id: 'p', team: 'player', pos: { x: 0, y: 8 }, aim: 0 });
    const mates = [0, 1, 2].map((i) => unit({ id: `e${i}`, team: 'enemy', pos: { x: 38, y: 6 + i * 2 }, weapon: shortGun }));
    const s = arena(open(40, 17), [p, ...mates]);
    for (let i = 0; i < 4; i++) runEnemyTurn(s);
    const xs = mates.map((m) => m.pos.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(10);
    expect(Math.min(...xs)).toBeLessThan(38); // and they did actually advance
  });
});

// ---------- fuzz: whole battles under a simple player policy ----------

function assertInvariants(s: GameState, label: string): void {
  const seen = new Set<string>();
  for (const u of s.units) {
    expect(u.hp, `${label}: ${u.name} hp`).toBeGreaterThanOrEqual(0);
    expect(u.hp, `${label}: ${u.name} hp`).toBeLessThanOrEqual(u.maxHp);
    expect(u.ap, `${label}: ${u.name} ap`).toBeGreaterThanOrEqual(0);
    expect(u.ap, `${label}: ${u.name} ap`).toBeLessThanOrEqual(u.maxAp);
    expect(u.ammo, `${label}: ${u.name} ammo`).toBeGreaterThanOrEqual(0);
    expect(u.alive, `${label}: ${u.name} alive/hp`).toBe(u.hp > 0);
    if (!u.alive) continue;
    expect(s.map.tiles[u.pos.y][u.pos.x], `${label}: ${u.name} stands on ${u.pos.x},${u.pos.y}`).toBe('floor');
    const k = `${u.pos.x},${u.pos.y}`;
    expect(seen.has(k), `${label}: overlap at ${k}`).toBe(false);
    seen.add(k);
    if (u.dormant) expect(u.team, `${label}: dormant must be enemy`).toBe('enemy');
  }
}

/** Push toward the nearest enemy, shoot whatever is visible. Deliberately a bit dumb, and cheats on where enemies are. */
function playerTurn(s: GameState, rng: { rngState: number }): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (const u of living(s, 'player')) {
    for (let step = 0; step < 4 && u.alive && u.ap > 0 && !s.winner; step++) {
      const enemies = living(s, 'enemy');
      if (enemies.length === 0) return events;
      const vis = visibleTiles(s);
      const targets = enemies.filter((e) => vis[e.pos.y][e.pos.x]);
      const roll = rand(rng);
      if (u.ammo === 0) {
        events.push(...reload(s, u.id).events);
      } else if (targets.length > 0 && roll < 0.7) {
        const t = targets[randInt(rng, 0, targets.length - 1)];
        const r = shoot(s, u.id, t.id);
        events.push(...r.events);
        if (!r.ok) {
          events.push(...setOverwatch(s, u.id).events);
        }
      } else if (roll < 0.85 && u.ammo > 0) {
        events.push(...setOverwatch(s, u.id).events);
      } else {
        const nearest = enemies.reduce((a, b) => (dist(u.pos, a.pos) <= dist(u.pos, b.pos) ? a : b));
        const tiles = [...reachableFor(s, u).values()].filter((n) => n.cost > 0);
        if (tiles.length === 0) {
          u.ap = 0;
          break;
        }
        tiles.sort((a, b) => dist(a.pos, nearest.pos) - dist(b.pos, nearest.pos));
        const r = moveUnit(s, u.id, tiles[0].pos);
        events.push(...r.events);
        if (!r.ok) u.ap = 0;
      }
    }
  }
  return events;
}

const GENERATED = (['beach', 'forest', 'wastes', 'marsh', 'mountain', 'canyon', 'volcano'] as Biome[]).map((biome, i) =>
  encounterScenario({ seed: 100 + i, biome, pods: 2, podSize: 3, difficulty: 1 + (i % 4) }),
);

describe('fuzz: full battles hold their invariants', () => {
  for (const sc of [...SCENARIOS, ...GENERATED]) {
    it(`${sc.name}: 25 seeds x 14 rounds, discovery included`, () => {
      let reveals = 0;
      let finished = 0;
      for (let seed = 1; seed <= 25; seed++) {
        const s = createBattle({ ...sc, seed });
        const rng = { rngState: seed * 7919 };
        for (let round = 1; round <= 14 && !s.winner; round++) {
          const pev = playerTurn(s, rng);
          assertInvariants(s, `${sc.name} seed ${seed} round ${round} (player)`);
          if (s.winner) {
            for (const e of pev) if (e.type === 'reveal') reveals++;
            break;
          }
          for (const e of pev) if (e.type === 'reveal') reveals++;
          endTurn(s);
          let guard = 0;
          for (let ev = enemyStep(s); ev !== null; ev = enemyStep(s)) {
            if (++guard > 400) throw new Error(`${sc.name} seed ${seed}: enemy turn did not terminate`);
          }
          assertInvariants(s, `${sc.name} seed ${seed} round ${round} (enemy)`);
          if (!s.winner) expect(s.active).toBe('player');
        }
        if (s.winner) finished++;
      }
      expect(reveals).toBeGreaterThan(0); // discovery actually happened under play
      expect(finished).toBeGreaterThan(0); // and battles resolve
    });
  }

  it('dormant units never act or move until discovered', () => {
    const s = createBattle(SCENARIOS[1]);
    const dormant = s.units.filter((u) => u.dormant);
    const snap = dormant.map((u) => `${u.id}:${u.pos.x},${u.pos.y}:${u.hp}`);
    for (let i = 0; i < 6; i++) {
      endTurn(s); // -> enemy
      let guard = 0;
      while (enemyStep(s) !== null) if (++guard > 100) throw new Error('loop');
    }
    expect(dormant.map((u) => `${u.id}:${u.pos.x},${u.pos.y}:${u.hp}`)).toEqual(snap);
    expect(dormant.every((u) => u.dormant)).toBe(true);
  });
});

