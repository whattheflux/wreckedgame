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
| `E` | Enter the site you're standing in (assault a hostile site, or open the home camp: safe, full heal) |
| `C` | Make camp wherever you are (rest, treat wounds, deal with prisoners, risk a night ambush) |
| `I` | Inventory: every member's gear and the party stash |
| `G` | Debug overlay: walkable area and region circles |
| `B` / `J` | Sandbox battles on the two hand-built maps |
| `L` | On the game-over screen: load the last autosave |

### Battle

| Input | Action |
| --- | --- |
| Click your unit / `1`-`9` / `Tab` | Select |
| Click blue tile | Move (1 AP) |
| Click yellow tile | Dash (2 AP) |
| `F` / Basic Attack button, then click an enemy | Attack with the weapon in hand (1 AP, 1 ammo; a heavy weapon ends the turn, see below) |
| `O` | Overwatch (uses remaining AP; reaction shot at -15 aim on the first enemy that moves into sight) |
| `V` | Revive a knocked-down ally standing next to the selected unit (1 AP); clicking the downed unit does the same |
| `R` | Reload (1 AP) |
| `I` | Inventory for the selected unit, plus whatever lies on their tile (loot from fallen units). Armour, belt and pack changes are free; swapping what is in your hands costs 1 AP |
| `E` | End turn |
| `W` | Retreat to the world map |
| `Enter` | After the fight: return to the world (a defeat is a squad wipe and ends the run) |
| `N` / `X` | Restart / next map (sandbox battles only) |

## Combat rules

- 2 AP per unit per turn. Moving up to `mobility` tiles costs 1 AP, up to double costs 2 (dash).
- **Light weapons** (slingshot, flare gun) cost 1 AP to attack: move afterwards, or attack twice if you don't move.
- **Heavy weapons** (javelin, sharpened pole) are two-handed. An attack costs 1 AP *and ends the turn* (hover Basic Attack to see "1 AP (ends turn)"); move first if you need to, there is no moving or attacking again afterwards. Rivals follow the same rule.
- The action bar under the map shows the selected unit's weapon in hand (two-handers fill both hands, the left one faded; one-handers leave the left hand bare), then Move, Basic Attack and a button for each skill the unit has. Overwatch, Reload and Revive are the base skills everyone has; clique and class skills will join them.
- Fights open with a banner (Ambush, Assault, Skirmish) and end with Victory or Defeat. After a win choose **Loot** (the spoils screen) or **Leave** (the loot stays where it lies and anyone out cold is let go). Units walk square by square (rivals a little slower, and the rival phase waits for each walk to finish). Hovering a reachable tile draws the route on the ground, blue for a 1 AP move and amber for a 2 AP dash, with the cost at the destination.
- Cover is directional: a half/full cover object only counts if it sits between the target and the attacker. Half = -20 hit, full = -40.
- A target hugging cover but shot from an uncovered side is **flanked**: the cover penalty is gone and any hit is a guaranteed crit (+50% damage). Range falloff still applies, so a long flank shot can miss; if it lands, it crits. The same goes for the enemy flanking you. A target in the open (no cover at all) is **exposed**: not a guaranteed crit, but +15% crit chance (`EXPOSED_CRIT_BONUS`).
- Squad bar: the left side shows each squad member's face, name, HP and AP; click one, press 1-9, or Tab / Shift+Tab to select them and the camera eases onto them (Z toggles zoomed-in and whole-map view). Camera: mouse wheel zooms toward the cursor, +/- zoom, [ and ] rotate the view in quarter turns (buttons top-right of the board do the same); units stay upright and turn to match.
- On the board: hovering an enemy shows a tooltip (hit, crit, damage, range falloff, cover). Selecting a unit draws its weapon range as rings, green for full accuracy and dashed amber for maximum range. Enemies show a shield for cover (solid = full, half-filled = half) or a red broken shield when flanked, and reachable tiles show the cover you would get there. Hover a reachable tile to see the range rings and hit chances from it.
- Walls block line of sight; cover objects can be shot over. Water is impassable.
- Hit chance = aim + weapon mod - defense - cover - range falloff (4% per tile past optimal), clamped 5-95.
- All randomness comes from a seeded PRNG stored on the game state, so battles are deterministic and replayable.

## Gear, loot and prisoners

- Every unit has slots: head, chest, legs, shoes, two belt slots (small items), left and right hand, back, and pack slots while a bag is worn on the back. The inventory screen (`I`) shows them on a paper doll next to the pack and whatever is lying around. Click an item then click where it goes, or double-click to equip / stow it.
- Gear drives stats: the hands decide the weapon (a two-hander needs both hands; bare hands fall back to fists), and worn pieces add their bonuses. Starting kits match each class, so nothing changes until you swap something. Belt and pack items are stored only for now; there is no Use Item action yet.
- A rival who drops rolls for **death or knockout**: crits, overkill and heavy weapons make death likelier (`deathChance`). Knocked-out rivals keep all their gear; a killed rival's items each survive by their own chance, and leave **remains** (for cooking, rituals and worse back at camp, later). Loot lands on the tile and shows as a satchel; stand on it and press `I`. Fallen companions drop everything they had. Fallen units don't block movement.
- After a **won** fight a spoils screen lists what's left on the field (untick anything to leave it) and each rival still out cold: **Let go** (they may remember your mercy), **Capture** (kept as a captive) or **Execute** (leaves remains). Retreating or losing forfeits all of it. Loot goes in the party stash, captives in `world.captives`, and `world.mercy` counts who you spared, captured and killed.
- Not in yet: camp handling of captives (workers, fighters, ransom, beatings, target and medical practice), using belt items, and a way to tell the story when a spared rival turns up again.

## Melee weapons and status effects

- **Melee** weapons hit adjacent targets only, ignore cover (no flanking, no range falloff) and never run out of ammo. They cannot hold overwatch. Fists are tier 0 melee, so everyone can fight in a pinch.
- **Tiers**: 0 scrap (stick, rolling pin, frying pan, steel pipe, human bone), 1 hand-made (knife, sharpened stick, weighted club, torch, sand sock), 2 crude but deadly (crude sword, nail bat, machete, poison dagger, fire axe). Lower tiers break more often.
- **Breaking**: every swing rolls the weapon's `breakChance`; a broken weapon is destroyed and the unit falls back to the other hand or fists.
- **Opportunity attacks**: walking away from an awake, un-stunned enemy holding a melee weapon gives each such enemy one free swing. Moving along their edge (staying adjacent) does not provoke.
- **Statuses** (`src/engine/status.ts`): stun (lose next turn), bleed (1/turn), poison (1/turn, never fatal, -5 aim), burn (2/turn), shaken (-10 aim, -10 crit), scared (-15 aim), blind (-35 aim), silenced (no overwatch or revive). They tick at the start of the owner's turn and wear off; hits roll the weapon's `inflicts`. Charmed, confused and terrified are planned once skills and consumables exist.
- **Art**: placeholder icons are drawn in `src/ui/actionbar.ts`; drop a PNG named after the item id into `src/assets/items/` to replace one (see the README there).

## Camp, injuries and prisoners

- **Injuries** are tied to body parts and come in grades: light (shaken, broken nose, twisted ankle, concussion, cracked ribs, deep gash), serious (torn tendon: six days) and **permanent** scars (lost hand: no two-handers; lost leg; blind in one eye). The leader's knock-down is a serious injury with a 15% chance of a scar; anyone who ends a fight below 35% HP has a 40% chance of a knock that heals. A member carries at most two healing injuries (a new one replaces whichever is closest to mending); scars are extra. Healing is counted in days: one per night in camp (two at the home camp) and one per completed fight.
- **Making camp** (`C` anywhere, `E` at the home camp) opens the camp screen for the current day. Tend wounds with bandages from the stash (3 days off if Home Ec is in the squad, else 2; scars can't be treated), post a watch, change gear, and sleep. Morning heals 60% of max HP (the watcher half that); the home camp heals everyone fully, with no ambush risk.
- **Night ambush:** each night away from home rolls by region danger (12 / 20 / 30 / 40%; safe ground never), halved by a watch. A hit is a real battle: the enemy starts awake and close. Morning comes when it ends (a rough one: 30% heal).
- **Prisoners** (captured in spoils) can be dealt with once each per day: make a worker or fighter (odds fall with their defiance; beating lowers it), demand ransom (75% pays scrap and frees them), beat, target practice (squad member gains XP, prisoner is likely hurt and may die), medical practice (uses a bandage; XP; 12% goes wrong) or execute. Captives carry injuries the same way the squad does. Workers and fighters are just flags for now, waiting for the settlement.
- Not in yet: sleeping units / reduced gear in an ambush, food, the settlement (buildings, gathering, missions, garrisons, research, crafting), and a use for workers and fighters.

## World map

The painted map in `public/worldmap.png` is the playfield. Everything the code needs to know about it lives in `src/world/worlddata.json` (pixel coordinates in the 962x537 image):

- **coast**: polygon of walkable land. Compiled to a 6px walk grid; the party can't leave it.
- **regions**: circles/polygons, first match wins. Each has a `biome` (drives the battle map's terrain and colours) and a `danger` 0-4.
- **sites**: enterable places. A site with a `difficulty` is a hostile garrison you assault once (it then stays cleared) for a scrap reward; the rest are landmarks or camp.

**Random encounters.** Walking outside a danger-0 region accumulates `distance x danger`. Every 900-1800 of that, an ambush starts: a battle on a generated map for the current region's biome. Standing still never triggers one, and camp is safe. Site assaults use the same generator with a seed derived from the site id, so a site is always the same map.

**Generated battles** (`encounterScenario`): 30x18, per-biome clutter profile, squad on the left, pods always placed outside sight range (every fight starts with a search, so the contact hint matters), corridors carved if anything ended up walled off, stats and weapons scaled by difficulty.

Permadeath is on: anyone who goes down in a fight is gone for good, except the player character's first fall in a fight (see below).

## Squad and progression

You and your friends are a persistent roster (`src/engine/roster.ts`), not a fresh squad each fight.

- **You.** A new game starts with character creation: a name, a **clique** (Popular, Jock, Nerd, Drama kid, Weirdo, Stoner) and a **school class** (Sport, Science, Drama, Art, Home Ec, Woodwork, Metalwork). Any combination is allowed. The clique sets the stat line and growth; the class nudges the stats and decides the starting weapon. Four companions join you: Amy (Popular / Home Ec), Scott (Jock / Sport), Tyson (Nerd / Science), Anna (Drama kid / Drama). The roster holds at most 5.
- **Picking the squad.** Four take the field. Before each site assault you choose who goes (you always do); ambushes use your last pick. If you have four or fewer living, nobody is left out and there is no screen.
- **Levelling.** A fight earns 8 XP for taking part, +2 per hit, +12 per kill, +10 for winning. Level *n* needs 40*n* XP; the cap is level 6. A level-up adds the clique's and class's growth and heals the max HP it adds. Levels 2 and 4 grant a random trait (Sure-footed, Eagle-eyed, Tough, Thick-skinned, Jumpy, Showboat), each a flat stat tweak.
- **HP carries over.** Survivors keep the HP they finished with. Press `E` at camp to restore everyone to full.
- **Going down.** Everyone else who goes down is dead for good, including if you retreat afterwards (it fell before you pulled out). *You* get one free fall per fight: you are knocked down, not killed. A downed player character is ignored by the enemy and blocks the tile; an adjacent ally can spend 1 AP to revive you at 40% HP (with no AP that turn). Any fall leaves you with a serious injury after the fight. Falling a **second** time in the same fight is death and ends the run at once.
- **Game over.** The run ends when you are dead (second fall), or when the whole squad is wiped (a defeat). Play stops; press `L` to load the last autosave, or start a new game.
- **Saving.** The game autosaves to the browser every time you return to the map, and never after a game over, so the save is always the last good state and reloading is a real undo. `Continue` on the title screen picks it up. Dev: `?quick` skips the title and creation screens.
- **Softening permadeath later.** `fateOfDowned` (in `roster.ts`) is the one place that decides what going down costs. A future skill, item or story beat can return `'injured'` for a given unit and it will come back at 1 HP with a serious injury instead (twisted ankle, concussion, cracked ribs, shaken up: each a temporary stat penalty, at most two at once).
- **Injuries heal by fighting.** Every victory or defeat ticks every injury down by one fight. Resting at camp doesn't cure them, and retreating gives no XP and heals nothing, so neither can be farmed.
- Sandbox battles use the stock squad and change nothing.

### Character art

Art is optional and picked up by name from `src/assets/sprites/`: a single image per unit (`amy.png`), or a folder with up to eight facings (`pc-male/down-left.png`, ...). Units turn to face their last move or target. The player character picks a boy or girl look at creation, which selects `pc-male` or `pc-female`. Units without art keep their circle. The spec is in `src/assets/sprites/README.md`.

Stats are always derived (clique + class + level + traits + injuries, with floors), never stored, and the roster is plain JSON on `world.roster`, which is what the autosave stores.

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
  items.ts      item catalog, slots, equip / swap rules, gear stats, rival kits
  loot.ts       death-vs-knockout roll, drops on tiles, in-battle gear changes
  roster.ts     persistent squad: cliques x classes, levels, traits, injuries; squad pick, deploy into a battle, fold the result back
src/world/    the free-roam layer (also pure logic, no DOM, except render.ts)
  worlddata.json  coast, regions, sites for the painted map
  world.ts      walk grid, A* + string-pulling, sliding movement, danger-weighted encounters
  render.ts     draws the map, sites, party, route
  camp.ts       nights, ambush roll, treatment, prisoner actions
  spoils.ts     end-of-battle loot, prisoner fates, stash / captives / mercy
  save.ts       autosave to localStorage (validated, versioned, safe when storage is unavailable)
src/render/   canvas board renderer (terrain, fog, overlays, hint arrow, effects, optional character sprites)
src/assets/sprites/   drop-in character art, picked up automatically by name
src/ui/       full-stage screens: title, character creation, squad pick, inventory, spoils, camp
src/main.ts   mode switch (world <-> battle), input, panels, log, enemy-phase pacing
```

The overworld calls into the battle engine for encounters; base and research will sit alongside it.

## Roadmap

1. [x] Battle engine + playable prototype
2. [x] Fog of war, dormant enemy pods, scamper, contact hint
3. [x] Enemy AI: cover-to-cover advance, group cohesion, overwatch ambushes, shoot-and-scoot
4. [ ] Camera pan/zoom for large maps
5. [x] Unit model: clique x class, traits, injuries, levelling, squad pick, knock-down/revive, autosave (class abilities still to do)
6. [ ] Tech tree as data (spears -> metalwork -> chemistry/gunpowder -> crossbows -> steam -> electricity) gating weapons, armour, buildings
7. [ ] Base view: building placement + resource loop
8. [x] Free-roam world map (your painted map) with random encounters and assaultable sites
9. [ ] Faction territories and missions on the world map (persistent squad HP/injuries are done)
10. [ ] Story layer
