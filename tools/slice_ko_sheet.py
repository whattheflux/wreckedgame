#!/usr/bin/env python3
"""
Cut a green-screen sheet of knocked-out (lying down) sprites into src/assets/sprites/<name>/ko.png.

  python3 tools/slice_ko_sheet.py SHEET.jpg name1,name2,... [--scale S]

The names are the art keys of the figures in reading order (rows top to bottom, left to right within a
row); rows are found from the figures themselves, so a sheet may have a different number in each row.
Labels over the figures are dropped (anything short). Each figure lands centred on a 256x256 canvas at
the same scale as the standing sprites (0.385), so a body lies at the size it stands.
Needs Pillow, numpy and scipy.
"""
import argparse, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'sprites')


def figures(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    ground = (g - r > 45) & (g - b > 45) & (b < 34)
    fg = ndi.binary_opening(~ground, iterations=1)
    joined, n = ndi.label(ndi.binary_dilation(fg, iterations=10))
    found = []
    for i, sl in enumerate(ndi.find_objects(joined), start=1):
        mask = fg & (joined == i)
        ys, xs = np.where(mask)
        if len(ys) == 0 or ys.max() - ys.min() < 120:  # labels, specks
            continue
        mask = ndi.binary_fill_holes(mask) & ~ground
        found.append((float(ys.mean()), float(xs.mean()), mask))
    # rows: cluster by y centroid
    found.sort(key=lambda f: f[0])
    rows, cur = [], [found[0]]
    for f in found[1:]:
        if f[0] - cur[-1][0] > 150:
            rows.append(cur)
            cur = [f]
        else:
            cur.append(f)
    rows.append(cur)
    ordered = []
    for row in rows:
        ordered += sorted(row, key=lambda f: f[1])
    return a, [f[2] for f in ordered]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet')
    ap.add_argument('names')
    ap.add_argument('--scale', type=float, default=0.385)
    o = ap.parse_args()
    names = o.names.split(',')
    a, masks = figures(o.sheet)
    if len(masks) != len(names):
        raise SystemExit(f'found {len(masks)} figures but {len(names)} names')
    for name, m in zip(names, masks):
        ys, xs = np.where(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        cell = a[y0:y1, x0:x1].copy()
        keep = m[y0:y1, x0:x1]
        # despill the green fringe on the outline
        edge = ndi.binary_dilation(~keep, iterations=2) & keep
        cap = np.maximum(cell[..., 0], cell[..., 2]) + 12
        cell[..., 1] = np.where(edge, np.minimum(cell[..., 1], cap), cell[..., 1])
        rgba = np.dstack([cell, np.where(keep, 255.0, 0.0)]).astype(np.uint8)
        rgba[~keep] = 0
        im = Image.fromarray(rgba)
        w, h = max(1, round(im.width * o.scale)), max(1, round(im.height * o.scale))
        im = im.resize((w, h), Image.LANCZOS)
        canvas = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
        canvas.paste(im, ((256 - w) // 2, (256 - h) // 2), im)
        folder = os.path.join(OUT, name)
        os.makedirs(folder, exist_ok=True)
        canvas.save(os.path.join(folder, 'ko.png'))
        print(f'{name}: {w}x{h}')


if __name__ == '__main__':
    main()
