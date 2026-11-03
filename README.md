# Wrecked

A tactical turn-based RPG. A cruise ship has wrecked on an abandoned island. You're a teenager on the end-of-year school trip, everyone is scattered, and the cliques from the ship have split into rival factions. Build camps, research your way from spears to metalwork to chemistry, gunpowder, steam and electricity, and fight XCOM 2-style skirmishes (cover, action points, overwatch) across a world map with free-roaming random encounters.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine unit tests (vitest)
npm run build    # typecheck + production build
```

## Controls (battle prototype)

| Input | Action |
| --- | --- |
| Click your unit / `1`-`9` / `Tab` | Select |
| Click blue tile | Move (1 AP) |
| Click yellow tile | Dash (2 AP) |
| Click enemy | Shoot (1 AP, 1 ammo) |
| `O` | Overwatch (uses remaining AP; reaction shot at -15 aim on the first enemy that moves into sight) |
| `R` | Reload (1 AP) |
| `E` | End turn |
| `N` | Restart |

## Combat rules (current)

- 2 AP per unit per turn. Moving up to `mobility` tiles costs 1 AP, up to double costs 2 (dash).
- Cover is directional: a half/full cover object only counts if it sits between the target and the attacker. Half = -20 hit, full = -40.
- A target hugging cover but shot from an uncovered side is **flanked**: +25 crit chance.
- Walls block line of sight; cover objects can be shot over. Water is impassable.
- Hit chance = aim + weapon mod - defense - cover - range falloff (4% per tile past optimal), clamped 5-95.
- All randomness comes from a seeded PRNG stored on the game state, so battles are deterministic and replayable.

## Architecture

```
src/engine/   pure game logic, no DOM/rendering. Plain-JSON state (saveable), fully unit-tested
  types.ts      state, units, events
  grid.ts       map parsing, line of sight, cover, pathfinding
  combat.ts     shot maths (also used by UI previews, overwatch and AI) + resolution
  battle.ts     turn/AP state machine: move, shoot, overwatch, reload, end turn
  ai.ts         enemy decision-making, one action per call so the UI can pace it
  scenarios.ts  weapon table + the Beach Landing test map
src/render/   canvas board renderer
src/main.ts   input, panel, log, enemy-phase pacing
```

The strategic layer (world map, base, research) and the free-roam overworld will sit on top of the same game state and call into the battle engine for encounters.

## Roadmap

1. [x] Battle engine + playable prototype (this commit)
2. [ ] Fog of war / enemy awareness, so enemies don't all rush the squad on turn 1
3. [ ] Enemy AI: move to cover when advancing, use overwatch deliberately
4. [ ] Unit model: clique archetypes, classes, traits, injuries, levelling
5. [ ] Tech tree as data (spears -> metalwork -> chemistry/gunpowder -> crossbows -> steam -> electricity) gating weapons, armour, buildings
6. [ ] Base view: building placement + resource loop
7. [ ] World map: faction territories, missions
8. [ ] Free-roam overworld with random encounters that drop into the battle engine
9. [ ] Story layer
