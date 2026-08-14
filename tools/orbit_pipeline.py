#!/usr/bin/env python3
"""
VITRINE — 360 orbit pipeline.

Takes a Higgsfield turntable render and produces the frame sequence the hero
scrubs through. Four things happen here, and each of them matters:

  1. STABILITY SCORE   Pick whichever take drifts and wobbles least.
  2. MATTE             Cut the bag off the studio backdrop with a flood fill
                       seeded from the frame border. A plain luma key is wrong
                       here: the graffiti print is bright white, so a luma key
                       eats the tags. Border connectivity doesn't, because the
                       white tags are enclosed by black canvas.
  3. ANGLE LINEARISE   The render eases in and out and runs faster through the
                       back half. A hand dragging at constant speed must turn
                       the bag at constant speed, so frames are resampled to be
                       uniform in ANGLE, not in time. Angle is recovered from
                       the silhouette width, which is maximal at front/back and
                       minimal at the two side profiles.
  4. ENCODE            Square-cropped, trimmed, WebP.

Usage: python3 tools/orbit_pipeline.py <in.mp4> [<in2.mp4> ...] --out assets/frames
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

LEAK_SEAL = 3         # backdrop erosion that seals fill-leak channels
SEE_THROUGH_FRAC = 9.99   # DISABLED, see note below. Was 0.011.
                      # The strap gap and the graffiti tags are BOTH enclosed
                      # islands of near-backdrop colour, and neither area nor
                      # brightness separates them: measured, the white ink sits
                      # at luminance 209 against a 214 backdrop, and the front
                      # panel's largest tag blobs (6.2% of frame) are bigger
                      # than the side strap gap (1.5%). Thresholding either way
                      # punches a hole straight through the print. Fixing this
                      # properly means re-rendering the turntable against a
                      # colour the print does not contain, not post-processing.
                      # OLD:  # an enclosed backdrop-coloured region larger than this
                      # share of the frame is a gap you are meant to see the page
                      # through, not a graffiti tag. Empirical: across the turn the
                      # tags top out near 1.0% and the real gaps between the straps
                      # and the body start at 1.28%. Brightness cannot make this
                      # call — the white ink measures luminance 209 against a 214
                      # backdrop, so any luma key punches holes through the print.
HOLE_AREA_FRAC = 0.0025  # above this share of the frame, a bridged region is
                      # real see-through negative space, not a notch to fill
CLOSE_ITERS = 10      # bridge radius for the matte
ERODE_ITERS = 6       # pull the matte back inside the true edge
                      # Both tuned by eye on frames 0/66/113. The erosion is the
                      # one that matters: closing alone balloons the mask into the
                      # concavities and drags in a ring of lit backdrop, which
                      # reads as a white halo once the product sits on the void.
PROBE_W = 96          # working size for silhouette analysis
BG_TOL = 60           # how far from the border colour still counts as backdrop.
                      # Generous on purpose: the soft contact shadow the render
                      # paints on the backdrop must be swallowed too, and a high
                      # tolerance is safe here because the fill is seeded from the
                      # border — the bright white tags are enclosed by black
                      # canvas, so connectivity protects them no matter the tol.


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def extract(video, outdir, width=None):
    os.makedirs(outdir, exist_ok=True)
    vf = f"scale={width}:-1" if width else "null"
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", video,
         "-vf", vf, "-start_number", "0", f"{outdir}/%04d.png", "-y"])
    return sorted(os.listdir(outdir))


def silhouette(rgb, opening=0):
    """Boolean mask of the subject: everything NOT reachable from the border
    through backdrop-coloured pixels. Scanline flood fill, no recursion."""
    h, w, _ = rgb.shape
    # Backdrop reference = median of the four border strips.
    border = np.concatenate([
        rgb[0:3].reshape(-1, 3), rgb[h - 3:h].reshape(-1, 3),
        rgb[:, 0:3].reshape(-1, 3), rgb[:, w - 3:w].reshape(-1, 3)])
    ref = np.median(border, axis=0)
    near = (np.abs(rgb.astype(np.int16) - ref).max(axis=2) <= BG_TOL)

    # Open the BACKDROP before labelling it. At three-quarter angles the print's
    # white tags reach the silhouette edge and touch the backdrop through a
    # channel one or two pixels wide. The fill pours through that channel and
    # hollows out the middle of the bag, and because the hollow stays connected
    # to the outside, fill_holes cannot repair it afterwards. Eroding the
    # backdrop by a couple of pixels severs those channels before they can leak,
    # which is the only place this can be fixed.
    if opening:
        near = ndimage.binary_opening(near, np.ones((3, 3)), iterations=LEAK_SEAL)

    # Label the backdrop-coloured regions and keep only those touching the
    # border. Anything enclosed by the subject (the white tags, the pale
    # interior of the wide-open top) is a hole, not backdrop, and survives.
    lab, n = ndimage.label(near)
    if n == 0:
        return np.ones((h, w), bool)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge = edge[edge != 0]
    bg = np.isin(lab, edge)

    # Backdrop that is enclosed by the product is normally kept — that is what
    # protects the white tags, which are islands of near-backdrop colour ringed
    # by black canvas. But the gap between a shoulder strap and the body is also
    # enclosed in 2D, and that one really is a hole. Size tells them apart.
    enclosed = near & ~bg
    elab, en = ndimage.label(enclosed)
    if en:
        eareas = ndimage.sum(enclosed, elab, range(1, en + 1))
        elimit = SEE_THROUGH_FRAC * h * w
        for i, a in enumerate(eareas, start=1):
            if a > elimit:
                bg |= (elab == i)

    subj = ~bg

    # Sever thin attachments before picking the main blob. The render paints a
    # soft contact shadow on the backdrop; it is joined to the bag by a few
    # pixels, so a plain largest-component pick keeps it and the product ends up
    # sitting in a white smear. An opening breaks that bridge first.
    if opening:
        subj = ndimage.binary_opening(subj, np.ones((3, 3)), iterations=opening)

    slab, sn = ndimage.label(subj)
    if sn > 1:
        sizes = ndimage.sum(subj, slab, range(1, sn + 1))
        subj = slab == (int(np.argmax(sizes)) + 1)

    # Close the comb the tolerance chews into edges where the bag's own black
    # meets the light backdrop through an antialiased boundary, then restore the
    # couple of pixels the opening cost us.
    if opening:
        # A wide closing, then fill. The white graffiti tags that run right to
        # the silhouette edge are the same value as the backdrop and touch it,
        # so the fill bites notches into the outline and the product reads as a
        # bad cutout. Bridging at this radius removes the comb.
        before = subj.copy()
        subj = ndimage.binary_fill_holes(subj)
        subj = ndimage.binary_closing(subj, np.ones((3, 3)), iterations=CLOSE_ITERS)
        subj = ndimage.binary_fill_holes(subj)

        # Give back the real negative space. That closing cannot tell the
        # difference between a notch a few pixels wide chewed out of the
        # outline, and the genuine gap you see through between the shoulder
        # straps and the body of the bag — it bridges both, and the fill then
        # makes them solid white. So look at everything the morphology just
        # claimed from the backdrop and keep only the small claims: a notch is
        # tiny, a see-through gap is not. Anything larger than the threshold is
        # a hole you are meant to see the page through.
        claimed = subj & ~before
        clab, cn = ndimage.label(claimed)
        if cn:
            areas = ndimage.sum(claimed, clab, range(1, cn + 1))
            limit = HOLE_AREA_FRAC * rgb.shape[0] * rgb.shape[1]
            for i, a in enumerate(areas, start=1):
                if a > limit:
                    subj[clab == i] = False

        subj = ndimage.binary_erosion(subj, np.ones((3, 3)), iterations=ERODE_ITERS)
    return subj


def bbox(mask):
    ys, xs = np.where(mask)
    if len(ys) == 0:
        return None
    return xs.min(), ys.min(), xs.max(), ys.max()


def analyse(frames_dir, names):
    """Per-frame silhouette geometry at small size."""
    rows = []
    for n in names:
        im = Image.open(os.path.join(frames_dir, n)).convert("RGB")
        im = im.resize((PROBE_W, PROBE_W), Image.BILINEAR)
        m = silhouette(np.asarray(im))
        b = bbox(m)
        if b is None:
            rows.append(None)
            continue
        x0, y0, x1, y1 = b
        rows.append({
            "w": int(x1 - x0 + 1), "h": int(y1 - y0 + 1),
            "cx": float((x0 + x1) / 2), "cy": float((y0 + y1) / 2),
            "area": int(m.sum()),
        })
    return rows


def stability(rows):
    """Lower is better. Penalises centre drift and scale wobble."""
    good = [r for r in rows if r]
    if len(good) < 10:
        return 1e9, {}
    cx = np.array([r["cx"] for r in good])
    cy = np.array([r["cy"] for r in good])
    hh = np.array([r["h"] for r in good])
    stats = {
        "cx_std": float(cx.std()), "cy_std": float(cy.std()),
        "h_std": float(hh.std()), "h_mean": float(hh.mean()),
        "area_cv": float(np.std([r["area"] for r in good]) / np.mean([r["area"] for r in good])),
    }
    score = stats["cx_std"] * 2 + stats["cy_std"] * 2 + stats["h_std"] * 1.5
    return score, stats


def angle_curve(rows):
    """Recover a monotonic 0..360 angle per frame.

    Silhouette width has period 180 degrees: widest at front and back, narrowest
    at the two side profiles. We find the width minima to locate the 90 and 270
    degree crossings, then interpolate linearly between the anchors. That fixes
    the ease-in/ease-out and the fast back half without needing to trust the
    render's timing at all.
    """
    w = np.array([r["w"] if r else np.nan for r in rows], float)
    # fill gaps, then smooth
    idx = np.arange(len(w))
    ok = ~np.isnan(w)
    w = np.interp(idx, idx[ok], w[ok])
    k = 9
    kern = np.ones(k) / k
    ws = np.convolve(np.pad(w, (k // 2, k // 2), mode="edge"), kern, mode="valid")[:len(w)]

    n = len(ws)
    # two interior minima expected, near 1/4 and 3/4 of the turn
    q = n // 4
    a90 = int(np.argmin(ws[max(1, q - q // 2): q + q // 2]) + max(1, q - q // 2))
    a270 = int(np.argmin(ws[3 * q - q // 2: min(n - 1, 3 * q + q // 2)]) + 3 * q - q // 2)
    # 180 sits at the width maximum between them
    a180 = int(np.argmax(ws[a90:a270]) + a90)
    anchors = [(0, 0.0), (a90, 90.0), (a180, 180.0), (a270, 270.0), (n - 1, 360.0)]
    # enforce strict monotonicity of frame indices
    fi = [a[0] for a in anchors]
    if not all(fi[i] < fi[i + 1] for i in range(len(fi) - 1)):
        return np.linspace(0, 360, n), anchors, False
    ang = np.interp(idx, [a[0] for a in anchors], [a[1] for a in anchors])
    return ang, anchors, True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    ap.add_argument("--out", default="assets/frames")
    ap.add_argument("--count", type=int, default=72)
    ap.add_argument("--size", type=int, default=720)
    ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--pad", type=float, default=0.04, help="margin around the bag")
    args = ap.parse_args()

    tmp = tempfile.mkdtemp(prefix="orbit_")
    takes = []
    try:
        for v in args.videos:
            d = os.path.join(tmp, os.path.basename(v).replace(".", "_"))
            names = extract(v, d, width=480)
            rows = analyse(d, names)
            score, stats = stability(rows)
            takes.append({"video": v, "dir": d, "names": names, "rows": rows,
                          "score": score, "stats": stats})
            print(f"  {os.path.basename(v):16s} frames={len(names):4d} "
                  f"stability={score:7.3f}  {json.dumps({k: round(x, 3) for k, x in stats.items()})}")

        best = min(takes, key=lambda t: t["score"])
        print(f"\n  -> selected {os.path.basename(best['video'])}")

        ang, anchors, ok = angle_curve(best["rows"])
        print(f"  angle anchors (frame -> deg): {anchors}   monotonic={ok}")

        # Uniform angular sampling. Drop the final frame: it duplicates frame 0.
        want = np.linspace(0, 360, args.count, endpoint=False)
        pick = [int(np.argmin(np.abs(ang - a))) for a in want]
        print(f"  picked {len(set(pick))} distinct source frames of {len(best['names'])}")

        # Re-extract the chosen frames at full resolution.
        full = os.path.join(tmp, "full")
        fnames = extract(best["video"], full)

        # One shared crop box across all frames so the bag doesn't jitter.
        boxes = []
        for i in pick:
            im = Image.open(os.path.join(full, fnames[i])).convert("RGB")
            small = im.resize((PROBE_W, PROBE_W), Image.BILINEAR)
            b = bbox(silhouette(np.asarray(small)))
            if b:
                sx = im.width / PROBE_W
                boxes.append([b[0] * sx, b[1] * sx, b[2] * sx, b[3] * sx])
        bx = np.array(boxes)
        x0, y0, x1, y1 = bx[:, 0].min(), bx[:, 1].min(), bx[:, 2].max(), bx[:, 3].max()
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        half = max(x1 - x0, y1 - y0) / 2 * (1 + args.pad)
        crop = (int(cx - half), int(cy - half), int(cx + half), int(cy + half))
        print(f"  shared crop {crop}  ({crop[2]-crop[0]}px square)")

        os.makedirs(args.out, exist_ok=True)
        for f in os.listdir(args.out):
            os.remove(os.path.join(args.out, f))

        total = 0
        for k, i in enumerate(pick):
            im = Image.open(os.path.join(full, fnames[i])).convert("RGB")
            m = silhouette(np.asarray(im), opening=2)
            # feather the matte in mask space so the edge is a real
            # gradient rather than a resampled hard cut
            af = ndimage.gaussian_filter(m.astype(np.float32) * 255.0, sigma=1.3)
            alpha = Image.fromarray(np.clip(af, 0, 255).astype(np.uint8), "L")
            rgba = im.convert("RGBA")
            rgba.putalpha(alpha)
            rgba = rgba.crop(crop).resize((args.size, args.size), Image.LANCZOS)
            p = os.path.join(args.out, f"orbit_{k:03d}.webp")
            rgba.save(p, "WEBP", quality=args.quality, method=6)
            total += os.path.getsize(p)

        print(f"\n  wrote {args.count} frames -> {args.out}")
        print(f"  total {total/1024:.0f} KB, mean {total/args.count/1024:.1f} KB/frame")
        with open(os.path.join(args.out, "manifest.json"), "w") as fh:
            json.dump({"count": args.count, "size": args.size,
                       "pattern": "orbit_%03d.webp",
                       "source": os.path.basename(best["video"]),
                       "degreesPerFrame": 360 / args.count}, fh, indent=1)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
