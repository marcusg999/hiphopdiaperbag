#!/usr/bin/env python3
"""
VITRINE — chroma-key orbit pipeline.

This replaces the flood-fill matte in orbit_pipeline.py, and it exists because
that approach hit a wall that could not be argued around. Keying the product off
a WHITE studio backdrop is ambiguous by construction: the graffiti print is
white ink, so the backdrop and the artwork are the same colour. Measured on the
old renders, the ink sat at luminance 209 against a 214 backdrop, and the front
panel's largest tag blobs were physically LARGER than the see-through gap between
the shoulder strap and the body. Neither brightness nor area could separate
"backdrop you should see the page through" from "part of the bag". Every setting
either left a white slab where a gap belonged, or punched a hole through the
print.

Green is not in the product. That single fact makes the matte exact rather than
a guess, and the strap gaps come out for free.

Three things here are not optional:

  1. KEY IN CHROMA, NOT RGB DISTANCE. Greenness is measured as how far the green
     channel sits above the stronger of red and blue. That is invariant to
     exposure, so a lit edge and a shadowed one key the same, and pure white and
     pure black — both everywhere in this print — are equally far from green.

  2. DESPILL. Green light bounces off the screen onto the subject and tints its
     edges. On a black-and-white product that reads as a sick green fringe and
     is the single biggest tell of a cheap key. Every pixel we keep gets its
     green channel clamped to the stronger neighbour, which neutralises the
     spill without touching genuinely green pixels (there are none here).

  3. FEATHER IN THE MATTE, NOT AFTERWARDS. Softening alpha after compositing
     leaves a dark halo, because the RGB underneath is still contaminated.

Usage:
  python3 tools/greenscreen.py assets/video/orbit-green.mp4 --out assets/frames
  python3 tools/greenscreen.py --self-test
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image
from scipy import ndimage

# How far above max(R,B) the green channel must sit before a pixel is backdrop.
# Low end of the ramp = fully subject, high end = fully backdrop; between them
# alpha slides, which is what gives a soft edge on motion blur and fine straps.
KEY_LO = 0.055
KEY_HI = 0.20
FEATHER = 1.1      # gaussian sigma on the matte, in output pixels
SHRINK = 0.6       # pull the matte in slightly; kills the last of the fringe


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def greenness(rgb):
    """Per-pixel 'how green is this', invariant to exposure.

    rgb is float 0..1. Returns 0 for anything neutral or warm — which is the
    whole product, black canvas and white ink alike — and rises toward 1 on the
    screen. Normalising by overall brightness is what makes a shadowed corner of
    the screen key the same as a hot one.
    """
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    other = np.maximum(r, b)
    denom = np.maximum(rgb.max(axis=2), 1e-4)
    return np.clip((g - other) / denom, 0.0, 1.0)


def despill(rgb, alpha):
    """Neutralise green cast on the pixels we are keeping.

    Clamping green to the stronger of red and blue is the standard move and is
    safe here precisely because the product contains no green: any pixel whose
    green exceeds both neighbours is contaminated by the screen, by definition.
    """
    out = rgb.copy()
    g = out[..., 1]
    cap = np.maximum(out[..., 0], out[..., 2])
    over = g > cap
    # only touch pixels we are actually keeping, and only as far as they are kept
    blend = (alpha > 0.01) & over
    g[blend] = cap[blend] + (g[blend] - cap[blend]) * (1.0 - alpha[blend]) * 0.25
    return out


def matte(rgb8):
    """RGB uint8 frame -> (rgb float 0..1 despilled, alpha float 0..1)."""
    rgb = rgb8.astype(np.float32) / 255.0
    gk = greenness(rgb)

    # alpha: 1 where not green, 0 where solidly green, ramped between
    alpha = 1.0 - np.clip((gk - KEY_LO) / (KEY_HI - KEY_LO), 0.0, 1.0)

    # Drop specks: isolated blobs of "subject" floating in the screen are
    # compression noise, not product.
    solid = alpha > 0.5
    lab, n = ndimage.label(solid)
    if n > 1:
        sizes = ndimage.sum(solid, lab, range(1, n + 1))
        keep = (int(np.argmax(sizes)) + 1)
        stray = solid & (lab != keep)
        # only clear stray blobs that are genuinely small
        small = np.zeros_like(solid)
        for i, s in enumerate(sizes, start=1):
            if i != keep and s < 0.0004 * solid.size:
                small |= (lab == i)
        alpha[small] = 0.0

    alpha = ndimage.gaussian_filter(alpha, sigma=FEATHER)
    if SHRINK:
        alpha = np.clip((alpha - SHRINK * 0.12) / (1.0 - SHRINK * 0.12), 0.0, 1.0)
    return despill(rgb, alpha), alpha


def frame_to_rgba(rgb8):
    rgb, a = matte(rgb8)
    out = np.dstack([np.clip(rgb * 255, 0, 255), np.clip(a * 255, 0, 255)])
    return out.astype(np.uint8)


# ---------------------------------------------------------------- self test
def self_test():
    """Composite a known matte onto green, key it back, measure the error.

    Ground truth comes from the existing frame sequence, which already carries
    an alpha channel. If the keyer cannot recover an alpha it was just handed,
    it has no business being pointed at a real shoot.
    """
    srcs = sorted(f for f in os.listdir('assets/frames') if f.endswith('.webp'))
    if not srcs:
        print('no assets/frames to test against'); return 1
    errs, spills = [], []
    for name in srcs[::12]:
        im = Image.open(os.path.join('assets/frames', name)).convert('RGBA')
        arr = np.asarray(im).astype(np.float32) / 255.0
        truth = arr[..., 3]
        # composite over pure green, the way a real shoot would arrive
        GREEN = np.array([0.05, 0.72, 0.18], np.float32)
        comp = arr[..., :3] * truth[..., None] + GREEN[None, None, :] * (1 - truth[..., None])
        rgb8 = np.clip(comp * 255, 0, 255).astype(np.uint8)

        _, got = matte(rgb8)
        errs.append(float(np.abs(got - truth).mean()))
        # green cast left on the pixels we kept
        kept = got > 0.6
        if kept.any():
            rgbk, _ = matte(rgb8)
            g = rgbk[..., 1][kept]
            cap = np.maximum(rgbk[..., 0], rgbk[..., 2])[kept]
            spills.append(float(np.mean(np.clip(g - cap, 0, None))))
    print(f'  frames tested     : {len(errs)}')
    print(f'  mean alpha error  : {np.mean(errs)*255:.2f} / 255')
    print(f'  residual green    : {np.mean(spills)*255:.2f} / 255  (0 = fully despilled)')
    ok = np.mean(errs) * 255 < 12
    print('  RESULT            :', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video', nargs='?')
    ap.add_argument('--out', default='assets/frames')
    ap.add_argument('--count', type=int, default=72)
    ap.add_argument('--size', type=int, default=800)
    ap.add_argument('--quality', type=int, default=72)
    ap.add_argument('--pad', type=float, default=0.04)
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args()

    if a.self_test:
        return self_test()
    if not a.video:
        ap.error('give a video, or --self-test')

    tmp = tempfile.mkdtemp(prefix='green_')
    try:
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', a.video,
             '-start_number', '0', f'{tmp}/%04d.png', '-y'])
        names = sorted(os.listdir(tmp))
        print(f'  {len(names)} frames extracted')

        # matte every frame once, keeping alpha for the crop maths
        alphas, rgbas = [], []
        for n in names:
            rgb8 = np.asarray(Image.open(os.path.join(tmp, n)).convert('RGB'))
            rgba = frame_to_rgba(rgb8)
            rgbas.append(rgba)
            alphas.append(rgba[..., 3])

        # angle linearisation, same reasoning as the original pipeline: the
        # silhouette is widest at front and back, narrowest at the two side
        # profiles, so the width curve locates the quarter turns and the frames
        # get resampled uniform in ANGLE rather than in time.
        widths = []
        for al in alphas:
            cols = np.where(al.max(axis=0) > 40)[0]
            widths.append(cols.max() - cols.min() + 1 if cols.size else 0)
        w = np.array(widths, float)
        k = 9
        ws = np.convolve(np.pad(w, (k // 2, k // 2), mode='edge'), np.ones(k) / k, 'valid')[:len(w)]
        n = len(ws); q = n // 4
        a90 = int(np.argmin(ws[max(1, q // 2):q + q // 2]) + max(1, q // 2))
        a270 = int(np.argmin(ws[3 * q - q // 2:min(n - 1, 3 * q + q // 2)]) + 3 * q - q // 2)
        a180 = int(np.argmax(ws[a90:a270]) + a90)
        anchors = [(0, 0.0), (a90, 90.0), (a180, 180.0), (a270, 270.0), (n - 1, 360.0)]
        idx = [p[0] for p in anchors]
        mono = all(idx[i] < idx[i + 1] for i in range(len(idx) - 1))
        ang = (np.interp(np.arange(n), idx, [p[1] for p in anchors]) if mono
               else np.linspace(0, 360, n))
        print(f'  angle anchors {anchors} monotonic={mono}')

        want = np.linspace(0, 360, a.count, endpoint=False)
        pick = [int(np.argmin(np.abs(ang - t))) for t in want]

        # one shared crop so the product never jitters between frames
        boxes = []
        for i in pick:
            ys, xs = np.where(alphas[i] > 40)
            if ys.size:
                boxes.append([xs.min(), ys.min(), xs.max(), ys.max()])
        bx = np.array(boxes)
        x0, y0, x1, y1 = bx[:, 0].min(), bx[:, 1].min(), bx[:, 2].max(), bx[:, 3].max()
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        half = max(x1 - x0, y1 - y0) / 2 * (1 + a.pad)
        crop = (int(cx - half), int(cy - half), int(cx + half), int(cy + half))
        print(f'  shared crop {crop}')

        os.makedirs(a.out, exist_ok=True)
        for f in os.listdir(a.out):
            os.remove(os.path.join(a.out, f))
        total = 0
        for k2, i in enumerate(pick):
            im = Image.fromarray(rgbas[i], 'RGBA').crop(crop)
            im = im.resize((a.size, a.size), Image.LANCZOS)
            p = os.path.join(a.out, f'orbit_{k2:03d}.webp')
            im.save(p, 'WEBP', quality=a.quality, method=6)
            total += os.path.getsize(p)
        # The manifest travels with the frames rather than being hardcoded in
        # the player: re-running this with a different --count or --size must
        # not silently desync the page from the assets on disk.
        with open(os.path.join(a.out, 'manifest.json'), 'w') as fh:
            json.dump({
                'count': a.count,
                'size': a.size,
                'pattern': 'orbit_%03d.webp',
                'source': os.path.basename(a.video),
                'degreesPerFrame': round(360.0 / a.count, 4),
                'matte': 'chroma-key',
            }, fh, indent=1)

        print(f'  wrote {a.count} frames, {total/1024:.0f} KB total, '
              f'{total/a.count/1024:.1f} KB/frame')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
