# Character sprites

Drop a file named after the unit (lowercase) into this folder and that unit is drawn with it on the
battle board instead of a coloured circle:

    amy.png   scott.png   tyson.png   anna.png

No code change and no manifest: Vite bundles whatever is here. A unit with no file keeps its circle,
and nothing is requested for art that doesn't exist. Enemy names work too (`brock.png`, ...).

## Spec

- **Format:** PNG or WebP, transparent background.
- **One image per character**, a single full-body figure. Static for now: no animation frames, and
  no left/right variants (the same image is used however the unit is facing).
- **Square canvas**, 256x256 recommended. It is drawn about 1.3 tiles tall (roughly 40-60 px on
  screen), so 256 leaves headroom for the planned camera zoom. Non-square images keep their aspect.
- **Feet on the bottom edge, horizontally centred**, with a little empty margin at the sides and top.
  The renderer plants the bottom edge of the image on the tile and puts a team-coloured base under it.
- **Same scale for everyone**: size characters relative to each other on the canvas (a taller
  character just fills more of it), rather than resizing each to fill the frame.
- Keep a calm, readable silhouette: the figure is small on screen, so contrast against grass, sand and
  rock matters more than fine detail.
