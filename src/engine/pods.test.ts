import { describe, expect, it } from 'vitest';
import {
  HINT_AFTER_TURNS,
  SCENARIOS,
  SIGHT_RANGE,
  beachLanding,
  coverAgainst,
  createBattle,
  dist,
  endTurn,
  enemyStep,
  getHint,
  living,
  moveUnit,
  podsToWake,
  reachableTiles,
  setOverwatch,
  shoot,
  updateExplored,
  visibleTiles,
  type GameState,
} from './index';
import { arena, open, unit } from './testutil';

/** Run one full enemy turn through the real step loop. */
function enemyTurn(s: GameState): void {
  s.active = 'enemy';
  for (const u of s.units) if (u.team === 'enemy' && u.alive) u.ap = u.dormant ? 0 : u.maxAp;
  let guard = 0;
  while (enemyStep(s) !== null) if (++guard > 300) throw new Error('enemy turn did not terminate');
}

describe('fog of war', () => {
  it('sees within sight range and line of sight, not beyond or behind walls', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 2, y: 3 } });
    const s = arena(['....................', '....................', '....................', '....................', '....................', '....................', '....................'], [a]);
    let vis = visibleTiles(s);
    expect(vis[3][2]).toBe(true);
    expect(vis[3][2 + SIGHT_RANGE]).toBe(true);
    expect(vis[3][2 + SIGHT_RANGE + 2]).toBe(false); // out of range

    const walled = arena(['..........', '....#.....', '....#.....', '....#.....', '....#.....', '....#.....'], [unit({ id: 'a', team: 'player', pos: { x: 2, y: 3 } })]);
    vis = visibleTiles(walled);
    expect(vis[3][4]).toBe(true); // the wall itself is visible
    expect(vis[3][6]).toBe(false); // behind it is not
  });

  it('remembers explored tiles after the squad moves on', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 0, y: 0 } });
    const s = arena(open(40, 3), [a, unit({ id: 'e', team: 'enemy', pos: { x: 39, y: 2 } })]);
    updateExplored(s);
    expect(s.explored[0][5]).toBe(true);
    expect(s.explored[0][30]).toBe(false);
    a.pos = { x: 35, y: 0 };
    updateExplored(s);
    expect(s.explored[0][30]).toBe(true); // newly seen
    expect(s.explored[0][5]).toBe(true); // still remembered
  });
});

describe('pods', () => {
  it('start dormant and do nothing on the enemy turn', () => {
    const s = createBattle(beachLanding);
    const before = s.units.filter((u) => u.team === 'enemy').map((u) => `${u.pos.x},${u.pos.y}`);
    expect(s.units.filter((u) => u.team === 'enemy').every((u) => u.dormant)).toBe(true);
    enemyTurn(s);
    const after = s.units.filter((u) => u.team === 'enemy').map((u) => `${u.pos.x},${u.pos.y}`);
    expect(after).toEqual(before);
    expect(s.active).toBe('player');
  });

  it('wake together when any member is seen, and only that pod', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 0, y: 2 } });
    const e1 = unit({ id: 'e1', team: 'enemy', pos: { x: 10, y: 2 }, pod: 'A', dormant: true, ap: 0 });
    const e2 = unit({ id: 'e2', team: 'enemy', pos: { x: 10, y: 4 }, pod: 'A', dormant: true, ap: 0 });
    const far = unit({ id: 'f', team: 'enemy', pos: { x: 39, y: 4 }, pod: 'B', dormant: true, ap: 0 });
    const s = arena(open(40, 6), [a, e1, e2, far]);
    expect(podsToWake(s)).toEqual(['A']);
    const res = moveUnit(s, 'a', { x: 1, y: 2 });
    expect(res.ok).toBe(true);
    expect(res.events.some((e) => e.type === 'reveal' && e.podId === 'A')).toBe(true);
    expect(e1.dormant).toBe(false);
    expect(e2.dormant).toBe(false);
    expect(far.dormant).toBe(true);
  });

  it('are not discovered through walls or beyond sight range', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 0, y: 1 } });
    const behind = unit({ id: 'b', team: 'enemy', pos: { x: 6, y: 1 }, pod: 'A', dormant: true, ap: 0 });
    const s = arena(['..........', '...#......', '..........'], [a, behind]);
    s.map.tiles[1][3] = 'wall';
    expect(podsToWake(s)).toEqual([]);
    const far = unit({ id: 'f', team: 'enemy', pos: { x: 30, y: 1 }, pod: 'B', dormant: true, ap: 0 });
    const s2 = arena(open(40, 3), [unit({ id: 'a', team: 'player', pos: { x: 0, y: 1 } }), far]);
    expect(podsToWake(s2)).toEqual([]);
  });

  it('interrupt movement on discovery and charge only for the ground covered', () => {
    // Pod sits 14 tiles away: sight is 12, so the first step west->east that reaches 12 tiles reveals it.
    const a = unit({ id: 'a', team: 'player', pos: { x: 0, y: 1 }, mobility: 5 });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 14, y: 1 }, pod: 'A', dormant: true, ap: 0 });
    const s = arena(open(20, 3), [a, e]);
    const res = moveUnit(s, 'a', { x: 10, y: 1 }); // planned 2-AP dash
    expect(res.ok).toBe(true);
    const mv = res.events.find((ev) => ev.type === 'move');
    expect(mv && mv.type === 'move' && mv.path.length).toBeLessThan(10);
    expect(a.pos.x).toBeLessThan(10);
    expect(a.pos.x).toBeGreaterThanOrEqual(2); // stopped as soon as the pod came within 12
    expect(a.ap).toBe(1); // 2 steps, so a single AP was spent, not the full dash
    expect(e.dormant).toBe(false);
    expect(s.turnsSinceContact).toBe(0);
  });

  it('scamper into cover facing the squad when discovered', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 0, y: 1 } });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 9, y: 1 }, pod: 'A', dormant: true, ap: 0 });
    const s = arena(open(14, 6), [a, e]);
    s.map.tiles[3][6] = 'half'; // a crate within one move of the pod member
    expect(coverAgainst(s.map, { x: 1, y: 1 }, e.pos)).toBe('none'); // starts exposed

    const res = moveUnit(s, 'a', { x: 1, y: 1 });
    expect(res.ok).toBe(true);
    expect(e.dormant).toBe(false);
    expect(res.events.some((ev) => ev.type === 'move' && ev.unitId === 'e')).toBe(true);
    expect(coverAgainst(s.map, a.pos, e.pos)).toBe('half'); // ended behind the crate, not just further away
    expect(dist(a.pos, e.pos)).toBeLessThan(SIGHT_RANGE + 1); // dove for cover instead of fleeing
    expect(e.ap).toBe(0); // scamper is a free reaction, not a turn
    expect(s.log.some((l) => l.text.startsWith('CONTACT!'))).toBe(true);
  });

  it('a squad-mate on overwatch gets reaction fire on a scampering pod', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 0, y: 1 } });
    const watcher = unit({ id: 'w', team: 'player', pos: { x: 0, y: 3 }, overwatch: true, ap: 0, aim: 90 });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 9, y: 1 }, pod: 'A', dormant: true, ap: 0, hp: 100, maxHp: 100 });
    const s = arena(open(14, 6), [a, watcher, e]);
    s.map.tiles[3][6] = 'half';
    const res = moveUnit(s, 'a', { x: 1, y: 1 });
    const reaction = res.events.find((ev) => ev.type === 'shoot' && ev.overwatch && ev.attackerId === 'w');
    expect(reaction).toBeDefined();
    expect(watcher.overwatch).toBe(false);
  });

  it('wake when shot at, and the player cannot win while any dormant pod remains', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 0, y: 1 }, aim: 500 });
    const near = unit({ id: 'n', team: 'enemy', pos: { x: 6, y: 1 }, pod: 'A', dormant: true, ap: 0, hp: 1, maxHp: 1 });
    const mate = unit({ id: 'm', team: 'enemy', pos: { x: 6, y: 2 }, pod: 'A', dormant: true, ap: 0 });
    const lone = unit({ id: 'l', team: 'enemy', pos: { x: 39, y: 1 }, pod: 'B', dormant: true, ap: 0 });
    const s = arena(open(40, 4), [a, near, mate, lone]);
    shoot(s, 'a', 'n');
    expect(mate.dormant).toBe(false); // woke when its pod-mate was shot
    expect(lone.dormant).toBe(true); // other pods stay asleep

    mate.alive = false;
    for (let i = 0; i < 30 && near.alive; i++) {
      a.ap = 2;
      a.ammo = 6;
      shoot(s, 'a', 'n');
    }
    expect(near.alive).toBe(false);
    expect(living(s, 'enemy')).toHaveLength(1); // the far pod still counts
    expect(s.winner).toBeNull();
  });

  it('keep the waking pod from attacking until its own turn', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 0, y: 1 } });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 9, y: 1 }, pod: 'A', dormant: true, ap: 0 });
    const s = arena(open(20, 3), [a, e]);
    moveUnit(s, 'a', { x: 1, y: 1 });
    expect(e.ap).toBe(0); // scamper is free movement, not a turn
    expect(setOverwatch(s, 'a').ok).toBe(true);
  });
});

describe('contact hint', () => {
  function worldWithPodEast(): GameState {
    const a = unit({ id: 'a', team: 'player', pos: { x: 2, y: 20 } });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 32, y: 20 }, pod: 'A', dormant: true, ap: 0 });
    return arena(open(40, 40), [a, e]);
  }

  it('stays silent until the squad has gone too long without contact', () => {
    const s = worldWithPodEast();
    expect(getHint(s)).toBeNull();
    for (let i = 0; i < HINT_AFTER_TURNS - 1; i++) {
      endTurn(s);
      endTurn(s);
    }
    expect(s.turnsSinceContact).toBe(HINT_AFTER_TURNS - 1);
    expect(getHint(s)).toBeNull();
    endTurn(s);
    endTurn(s);
    expect(getHint(s)).not.toBeNull();
  });

  it('points the right way, vaguely', () => {
    const s = worldWithPodEast();
    s.turnsSinceContact = HINT_AFTER_TURNS;
    const h = getHint(s)!;
    expect(h.direction).toBe('E');
    expect(h.angle).toBe(0);
    expect(h.distance % 5).toBe(0);
    expect(h.distance).toBe(30);
    expect(h.band).toBe('far');

    const north = arena(open(40, 40), [unit({ id: 'a', team: 'player', pos: { x: 20, y: 35 } }), unit({ id: 'e', team: 'enemy', pos: { x: 22, y: 5 }, pod: 'A', dormant: true, ap: 0 })]);
    north.turnsSinceContact = HINT_AFTER_TURNS;
    expect(getHint(north)!.direction).toBe('N');

    const sw = arena(open(40, 40), [unit({ id: 'a', team: 'player', pos: { x: 30, y: 10 } }), unit({ id: 'e', team: 'enemy', pos: { x: 10, y: 30 }, pod: 'A', dormant: true, ap: 0 })]);
    sw.turnsSinceContact = HINT_AFTER_TURNS;
    expect(getHint(sw)!.direction).toBe('SW');
  });

  it('targets the NEAREST dormant pod, ignores awake and dead pods, and clears when none remain', () => {
    const s = worldWithPodEast();
    s.units.push(unit({ id: 'w', team: 'enemy', pos: { x: 2, y: 5 }, pod: 'B', dormant: true, ap: 0 }));
    s.turnsSinceContact = HINT_AFTER_TURNS;
    expect(getHint(s)!.direction).toBe('N'); // 15 tiles north is nearer than 30 tiles east
    s.units[2].dormant = false; // awake: no longer something to find
    expect(getHint(s)!.direction).toBe('E');
    s.units[1].alive = false;
    expect(getHint(s)).toBeNull();
  });

  it('resets when a pod is discovered', () => {
    const a = unit({ id: 'a', team: 'player', pos: { x: 0, y: 1 } });
    const e = unit({ id: 'e', team: 'enemy', pos: { x: 14, y: 1 }, pod: 'A', dormant: true, ap: 0 });
    const s = arena(open(20, 3), [a, e]);
    s.turnsSinceContact = 7;
    moveUnit(s, 'a', { x: 3, y: 1 });
    expect(s.turnsSinceContact).toBe(0);
  });
});

describe('scenarios', () => {
  it.each(SCENARIOS.map((sc) => [sc.name, sc] as const))('%s: every unit can be reached from the squad start', (_name, sc) => {
    const s = createBattle(sc);
    const player = s.units.find((u) => u.team === 'player')!;
    const reach = reachableTiles(s.map, [], player, 9999);
    for (const u of s.units) expect(reach.has(`${u.pos.x},${u.pos.y}`), `${u.name} at ${u.pos.x},${u.pos.y} is cut off`).toBe(true);
  });

  it.each(SCENARIOS.map((sc) => [sc.name, sc] as const))('%s: no pod is discoverable at the start', (_name, sc) => {
    const s = createBattle(sc);
    expect(podsToWake(s)).toEqual([]);
  });

  it('Jungle Interior is genuinely big, with several pods', () => {
    const s = createBattle(SCENARIOS[1]);
    expect(s.map.width * s.map.height).toBeGreaterThan(900);
    expect(new Set(s.units.filter((u) => u.pod).map((u) => u.pod)).size).toBeGreaterThanOrEqual(3);
  });
});
