# Wrecked

A tactical turn-based RPG. A cruise ship has wrecked on an abandoned island. You're a teenager on the end-of-year school trip, everyone is scattered, and the cliques from the ship have split into rival factions. Build camps, research your way from spears to metalwork to chemistry, gunpowder, steam and electricity, and fight XCOM 2-style skirmishes (cover, action points, overwatch) across a world map with free-roaming random encounters.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine unit tests + full-battle fuzz (vitest)
npm run build    # typecheck + production build
```

## Controls

### World map (free roam)

| Input | Action |
| --- | --- |
| `WASD` / arrows | Walk (slides along the coast) |
| Click the map | Travel there (A* route; clicking the sea snaps to the shore) |
| `E` | Enter the site you're standing in (assault a hostile site, or visit camp) |
| `G` | Debug overlay: walkable area and region circles |
| `B` / `J` | Sandbox battles on the two hand-built maps |

### Battle

| Input | Action |
| --- | --- |
| Click your unit / `1`-`9` / `Tab` | Select |
| Click blue tile | Move (1 AP) |
| Click yellow tile | Dash (2 AP) |
| Click enemy | Shoot (1 AP, 1 ammo) |
| `O` | Overwatch (uses remaining AP; reaction shot at -15 aim on the first enemy that moves into sight) |
| `R` | Reload (1 AP) |
| `E` | End turn |
| `W` | Retreat to the world map |
| `Enter` | After the fight: return to the world (rewards on victory, back to camp on defeat) |
| `N` / `X` | Restart / next map (sandbox battles only) |

## Combat rules

- 2 AP per unit per turn. Moving up to `mobility` tiles costs 1 AP, up to double costs 2 (dash).
- Cover is directional: a half/full cover object only counts if it sits between the target and the attacker. Half = -20 hit, full = -40.
- A target hugging cover but shot from an uncovered side is **flanked**: +25 crit chance.
- Walls block line of sight; cover objects can be shot over. Water is impassable.
- Hit chance = aim + weapon mod - defense - cover - range falloff (4% per tile past optimal), clamped 5-95.
- All randomness comes from a seeded PRNG stored on the game state, so battles are deterministic and replayable.

## World map

The painted map in `public/worldmap.png` is the playfield. Everything the code needs to know about it lives in `src/world/worlddata.json` (pixel coordinates in the 962x537 image):

- **coast**: polygon of walkable land. Compiled to a 6px walk grid; the party can't leave it.
- **regions**: circles/polygons, first match wins. Each has a `biome` (drives the battle map's terrain and colours) and a `danger` 0-4.
- **sites**: enterable places. A site with a `difficulty` is a hostile garrison you assault once (it then stays cleared) for a scrap reward; the rest are landmarks or camp.

**Random encounters.** Walking outside a danger-0 region accumulates `distance x danger`. Every 900-1800 of that, an ambush starts: a battle on a generated map for the current region's biome. Standing still never triggers one, and camp is safe. Site assaults use the same generator with a seed derived from the site id, so a site is always the same map.

**Generated battles** (`encounterScenario`): 30x18, per-biome clutter profile, squad on the left, pods always placed outside sight range (every fight starts with a search, so the contact hint matters), corridors carved if anything ended up walled off, stats and weapons scaled by difficulty.

Defeat sends the squad back to camp minus a quarter of its scrap. There is no HP persistence between fights yet.

## Finding the enemy

- **Pods.** Enemies start in dormant clusters. A pod does nothing until one of your units gets line of sight to any member within 12 tiles, or shoots at one. Then the whole pod wakes together.
- **Discovery interrupts movement.** Your unit stops the moment a pod is spotted and is only charged AP for the ground it actually covered.
- **Scamper.** A freshly spotted pod immediately dives for the best cover facing your squad (a free reaction, not their turn). Squad-mates on overwatch get reaction shots at them as they move.
- **Fog of war.** You only see enemies currently in your line of sight. Ground you've seen stays dimly mapped; the rest is black. Enemy activity in the fog doesn't appear in the log.
- **Contact hint.** After 3 player turns without discovering a pod, an arrow on the map edge and a panel note point toward the nearest undiscovered group: a compass direction and a deliberately rounded distance, never a position. It resets whenever contact is made, so big maps never leave you wandering blind.

## Enemy AI

Each awake enemy picks, in order: (1) if it already fired this turn and is exposed, duck into cover while staying in the fight; (2) take the best shot available, possibly after one move, weighing expected damage, kill chances, flanking and how exposed the firing tile is; (3) if dug into good cover with the squad close, hold overwatch and let them walk into it; (4) otherwise advance cover-to-cover, staying with its group and avoiding tiles covered by your overwatch. Holding position builds impatience, so the AI cannot stall forever.

## Architecture

```
src/engine/   pure game logic, no DOM/rendering. Plain-JSON state (saveable), fully unit-tested
  types.ts      state, units, events
  grid.ts       map parsing, line of sight, cover, pathfinding
  combat.ts     shot maths (also used by UI previews, overwatch and AI) + resolution
  vision.ts     sight range, visible/explored tiles, pod discovery
  hint.ts       "contact hint": direction to the nearest undiscovered pod
  tactics.ts    shared AI maths: expected incoming damage, cover value, nearest unit
  battle.ts     turn/AP state machine: move, shoot, overwatch, reload, pod wake + scamper, end turn
  ai.ts         enemy decision-making, one action per call so the UI can pace it
  scenarios.ts  weapon table, squad template + hand-built sandbox maps: Beach Landing, Jungle Interior
  encounter.ts  seeded per-biome battle generator used by world encounters and site assaults
src/world/    the free-roam layer (also pure logic, no DOM, except render.ts)
  worlddata.json  coast, regions, sites for the painted map
  world.ts      walk grid, A* + string-pulling, sliding movement, danger-weighted encounters
  render.ts     draws the map, sites, party, route
src/render/   canvas board renderer (terrain, fog, overlays, hint arrow, effects)
src/main.ts   mode switch (world <-> battle), input, panels, log, enemy-phase pacing
```

The overworld calls into the battle engine for encounters; base and research will sit alongside it.

## Roadmap

1. [x] Battle engine + playable prototype
2. [x] Fog of war, dormant enemy pods, scamper, contact hint
3. [x] Enemy AI: cover-to-cover advance, group cohesion, overwatch ambushes, shoot-and-scoot
4. [ ] Camera pan/zoom for large maps
5. [ ] Unit model: clique archetypes, classes, traits, injuries, levelling
6. [ ] Tech tree as data (spears -> metalwork -> chemistry/gunpowder -> crossbows -> steam -> electricity) gating weapons, armour, buildings
7. [ ] Base view: building placement + resource loop
8. [x] Free-roam world map (your painted map) with random encounters and assaultable sites
9. [ ] Faction territories and missions on the world map; persistent squad HP/injuries
10. [ ] Story layer
