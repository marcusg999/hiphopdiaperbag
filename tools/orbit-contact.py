#!/usr/bin/env python3
"""Contact sheet of the orbit frames on the page's own ground colour, with a
per-frame hole report. This is the check that catches matte leaks: a hole is a
transparent island fully enclosed by opaque product, which is exactly what a
flood fill that escaped into the bag leaves behind."""
import glob
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

VOID = (10, 10, 11)


def holes(alpha):
    """Area of transparent islands that are NOT connected to the frame border."""
    empty = alpha < 40
    lab, n = ndimage.label(empty)
    if n == 0:
        return 0, 0
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge = edge[edge != 0]
    inner = np.isin(lab, edge, invert=True) & empty
    ilab, m = ndimage.label(inner)
    if m == 0:
        return 0, 0
    sizes = ndimage.sum(inner, ilab, range(1, m + 1))
    big = [s for s in sizes if s > 60]      # ignore stitch-level speckle
    return len(big), int(sum(big))


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "shots/orbit-contact.png"
    fs = sorted(glob.glob("assets/frames/orbit_*.webp"))
    if not fs:
        print("no frames")
        return 1

    worst = []
    for i, f in enumerate(fs):
        a = np.asarray(Image.open(f).convert("RGBA").split()[-1])
        n, area = holes(a)
        if n:
            worst.append((area, n, i, f))
    worst.sort(reverse=True)

    total_px = 800 * 800
    print(f"frames: {len(fs)}   frames with holes: {len(worst)}")
    for area, n, i, f in worst[:10]:
        print(f"  frame {i:3d}  {n} hole(s)  {area:7d}px  ({area / total_px * 100:.2f}% of frame)")
    if not worst:
        print("  no interior holes detected")

    # contact sheet: every 4th frame, 18 tiles
    W, COLS = 200, 6
    picks = list(range(0, len(fs), max(1, len(fs) // 18)))[:18]
    rows = (len(picks) + COLS - 1) // COLS
    sheet = Image.new("RGB", (W * COLS, W * rows), VOID)
    for k, i in enumerate(picks):
        im = Image.open(fs[i]).convert("RGBA")
        im.thumbnail((W, W), Image.LANCZOS)
        tile = Image.new("RGBA", (W, W), VOID + (255,))
        tile.alpha_composite(im, ((W - im.width) // 2, (W - im.height) // 2))
        sheet.paste(tile.convert("RGB"), ((k % COLS) * W, (k // COLS) * W))
    sheet.save(out)
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
