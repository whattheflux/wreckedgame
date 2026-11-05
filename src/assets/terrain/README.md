# Terrain art

The battle board draws its ground from here when art exists, and from code-drawn pixel textures when it does not
(so nothing is blank before any art is made). Files are picked up automatically at build time.

    src/assets/terrain/<biome>/<kind>-<n>.png      n = 1, 2, 3 ... (any count; a tile picks one by its position)
    src/assets/terrain/common/<kind>-<n>.png       fallback for any biome that has none of its own

Biomes: beach, forest, wastes, marsh, mountain, canyon, volcano.

Kinds:

| kind    | what it is                                   | image                                                              |
|---------|----------------------------------------------|--------------------------------------------------------------------|
| `floor` | the walkable ground                          | opaque, seamless square. Make several (4-6) that tile together     |
| `water` | impassable water (or lava on volcano)        | opaque, seamless square. 2-3 variants                              |
| `wall`  | impassable wall / cliff / wreck              | opaque square. 2 variants                                          |
| `half`  | low cover (crate, bush, rubble) - half shield | transparent PNG, drawn on top of a floor tile, object ~60% of tile |
| `full`  | tall cover (boulder, wreck, tree) - full shield | transparent PNG, drawn on top of a floor tile, object ~90% of tile |

Square art of any size works (64 or 128 px is plenty); it is drawn scaled with no smoothing.
`floor` pieces must tile with each other with no visible seams. Keep detail low-contrast so units and the
move / range / cover overlays stay readable on top.
