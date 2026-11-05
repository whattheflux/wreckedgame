#!/usr/bin/env python3
"""
Cut a 4x2 facing sheet (labels on top of each cell, flat grey background) into transparent 256x256
sprites under src/assets/sprites/<name>/<facing>.png.

  python3 tools/slice_sprite_sheet.py SHEET.jpg NAME [--scale S] [--flood] [--only dir,dir] [--flip src:dst,...] [--copy src:dst,...]

--scale  pixels-per-source-pixel; keep the same value for every character so they stay in proportion
         (the player sheets used 0.4257). Default: fit this sheet's tallest figure to 232 px.
--flood  use a connected-ground cut (for dark grounds where dark boots/shadow sit close to the ground colour)
--only   keep just these facings (when a sheet has some that do not match the rest)
--flip   make dst by mirroring src (e.g. down-left:down-right)
--copy   make dst as a copy of src (a stand-in until real art exists)

Needs Pillow, numpy and scipy. Sheet layout (left to right, top row then bottom row):
down-left, down-right, up-left, up-right / up, down, left, right.
"""
import argparse, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

DIRS = [['down-left', 'down-right', 'up-left', 'up-right'], ['up', 'down', 'left', 'right']]
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'sprites')


def cut(path, flood=False):
    a = np.asarray(Image.open(path).convert('RGB')).astype(float)
    H, W = a.shape[:2]
    cw, ch = W / 4, H / 2
    # the ground colour varies between sheets: it is the commonest colour, so take the median
    BG = np.median(a[::7, ::7].reshape(-1, 3), axis=0)
    print('ground', BG.round())
    res = {}
    for r in range(2):
        for c in range(4):
            x0, x1 = int(c * cw) + 8, int((c + 1) * cw) - 8
            y0, y1 = int(r * ch + ch * 0.17), int((r + 1) * ch) - 4
            cell = a[y0:y1, x0:x1]
            d = np.sqrt(((cell - BG) ** 2).sum(2))
            spread = cell.max(2) - cell.min(2)
            # Figure = clearly different from the neutral grey, or tinted (the ground and its grid are
            # neutral, so a tinted pixel is hair, skin or cloth even when it is close in brightness).
            if flood:
                # Dark ground: dark boots and shadow are close to it in colour, so instead of a colour
                # threshold take everything connected to the cell edge that still looks like ground.
                mxc = cell.max(2)
                # ground, its grid, and the flat dark-neutral floor shadow (the board draws its own base)
                neutral = (spread < 8) & (mxc > 18) & (mxc < 52)
                # only big flat neutral areas (grid squares, the shadow ellipse), not the odd dark boot pixel
                big = ndi.binary_dilation(ndi.binary_opening(neutral, structure=np.ones((7, 7))), iterations=2) & neutral
                ground = (d < 12) | big
                gl, gn = ndi.label(ground)
                edge = set(gl[0, :]) | set(gl[-1, :]) | set(gl[:, 0]) | set(gl[:, -1])
                edge.discard(0)
                fg = ~np.isin(gl, list(edge))
                fg = ndi.binary_opening(fg, iterations=1)
            else:
                fg = ndi.binary_opening((d > 30) | ((spread > 14) & (d > 10)), iterations=1)
            lab, n = ndi.label(fg)
            if n == 0:
                raise SystemExit(f'empty cell {DIRS[r][c]}')
            keep = ndi.binary_fill_holes(lab == 1 + int(np.argmax(ndi.sum(fg, lab, range(1, n + 1)))))
            alpha = np.where(keep, 255.0, 0.0)
            mx = cell.max(2)
            if not flood:
                alpha[keep & (mx < 58) & (spread < 9)] = 110  # the floor shadow: translucent
            rgba = np.dstack([cell, alpha]).astype(np.uint8)
            rgba[~keep] = 0
            ys, xs = np.where(keep)
            res[DIRS[r][c]] = Image.fromarray(rgba).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet')
    ap.add_argument('name')
    ap.add_argument('--scale', type=float)
    ap.add_argument('--flood', action='store_true', help='for sheets on a dark ground')
    ap.add_argument('--only')
    ap.add_argument('--flip', default='')
    ap.add_argument('--copy', default='')
    o = ap.parse_args()
    cells = cut(o.sheet, o.flood)
    if o.only:
        cells = {k: v for k, v in cells.items() if k in o.only.split(',')}
    scale = o.scale or 232 / max(im.height for im in cells.values())
    out = {}
    for d, im in cells.items():
        w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
        im = im.resize((w, h), Image.LANCZOS)
        canvas = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
        canvas.paste(im, ((256 - w) // 2, 256 - 6 - h), im)
        out[d] = canvas
    for pair in filter(None, o.flip.split(',')):
        s, d = pair.split(':')
        out[d] = out[s].transpose(Image.FLIP_LEFT_RIGHT)
    for pair in filter(None, o.copy.split(',')):
        s, d = pair.split(':')
        out[d] = out[s].copy()
    folder = os.path.join(OUT, o.name)
    os.makedirs(folder, exist_ok=True)
    for d, im in out.items():
        im.save(os.path.join(folder, f'{d}.png'))
    print(f'{o.name}: scale {scale:.4f}, wrote {sorted(out)}')


if __name__ == '__main__':
    main()
