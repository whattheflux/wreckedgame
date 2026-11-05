# Character sprites

Art is optional, bundled at build time, and picked up by name with no code change or manifest. A unit
with no art keeps its coloured circle, and nothing is requested for art that doesn't exist.

Two layouts, which can be mixed:

    amy.png                       one image, used whichever way the unit faces
    pc-male/down-left.png ...     a folder per character, one image per facing

A unit's art key is its `sprite` field if it has one, otherwise its lowercase name. Companions use
their name (`amy`, `scott`, `tyson`, `anna`), enemies theirs (`brock`), and the player character uses
`pc-male` or `pc-female` depending on the look picked at creation.

## Facings

Up to eight names per folder: `right`, `down-right`, `down`, `down-left`, `left`, `up-left`, `up`,
`up-right` (screen directions; `up` is toward the top of the board). A unit turns to face its last
step or its last target. Any facing you leave out falls back to the closest one you did draw, so a
folder can start with just `down` and `up` and grow. Units start facing right (squad) or left (enemies).

## Spec

- **Format:** PNG or WebP, transparent background.
- **Square canvas**, 256x256 recommended. It is drawn about 1.6 tiles tall, so the canvas leaves
  headroom for the planned camera zoom. Non-square images keep their aspect.
- **Feet near the bottom edge, horizontally centred**, with a little empty margin at the sides and top.
  The renderer plants the bottom edge of the image on the tile and puts a team-coloured base under it.
  Keep any shadow soft and semi-transparent (or leave it out): the board draws its own base.
- **Same scale for everyone**, and the same scale across all the facings of one character. Size
  characters relative to each other on the canvas rather than resizing each to fill the frame.
- Keep a calm, readable silhouette: the figure is small on screen, so contrast against grass, sand and
  rock matters more than fine detail.

## Making sprites from a facing sheet

`tools/slice_sprite_sheet.py` cuts a 4x2 sheet (labelled cells on a flat grey ground) into the eight
transparent 256x256 files. Use the same `--scale` for every character so they stay in proportion
(0.4257 matches the player, Scott, Amy and Tyson; the drama guy's sheet drew him larger, so he uses 0.4035; Anna's sheet was larger still, so she uses 0.385 with `--flood`). If a sheet is missing a view or one is in the wrong kit,
Stoner (male and female) sheets are on a flat green screen: use `--chroma --scale 0.385`; the cut drops the green ground, grid, and shadow, keeps green clothing (it tells ground from cloth by blue level), clears stray shadow green near the shoes, and despills the edge.
`--only` drops it, `--flip` mirrors another facing into its place and `--copy` makes a stand-in.
`--flood` is for sheets on a dark ground, where dark boots and the floor shadow sit close to the ground colour.

## Knocked-out poses

`<name>/ko.png` (optional) is the lying-down pose drawn while a unit is downed; without it the board falls back to a
grey crossed-out marker. Cut a green-screen sheet of lying figures with
`python3 -I tools/slice_ko_sheet.py SHEET.jpg name1,name2,...` (names in reading order; rows are found from the figures,
so rows may hold different counts). Same 0.385 scale as the standing sprites; each figure is centred on the 256 canvas.
