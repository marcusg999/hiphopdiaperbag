# The two audits

The contract set two external gates. Both have now been run. This is the record,
including the one that did not pass.

---

## 1. Blind comparison against activetheory.net/work

**Result: ours, 9 sheets to 6. "Better — a clear step, not a rout."**

### How it was run

The point of a blind comparison is that it can be lost. Three things were done
to make that possible:

- **Matched capture.** `tools/match.mjs` shoots this page at the same viewport
  (1440×900 @2 and 390×844 @3), the same scroll depths (6/15/28/45/62/80/95%
  desktop, 6/15/30/48/66/85% mobile), the same settle time and the same pointer
  warm-up that `tools/at-*.mjs` used on the bar. A comparison decided by the
  capture rig is not a comparison.
- **Randomised sides.** 15 sheets were built, each pairing the two pages at one
  matched depth, with A/B assignment randomised *independently per sheet* — so
  the critic could not learn a position and coast. Key written to a file the
  critic was not given.
- **Fresh context.** The critic was a separate agent with no history of this
  build, no knowledge of which page was the target, and instructions to weight
  brand recognition at zero and to pick a side on every sheet.

### What it found

The tally understates one thing and overstates another, and both matter more
than the score.

Active Theory makes far better **images** — the material, light and particle
work is several tiers above anything here. If the brief were "who can render,"
it wins outright.

But across 15 captures it has essentially **one layout**: a nav pill, a
"WHAT ARE YOU LOOKING FOR?" list and an "ASK ME ANYTHING…" field pinned to
identical coordinates on every desktop and mobile frame regardless of what is
behind them. Four of its fifteen frames are 70–95% empty; one has hard
overlapping text; its display face is an outlined stencil that is unreadable in
most frames it appears in. In the critic's words, it "never composes; it swaps a
background and leaves the furniture where it was."

This page won on **structure** — a working type scale, a numbered section
system, one disciplined accent, and frames that build — and won *despite* its
own defects, not in the absence of them.

### What it cost us

The critic named our single biggest gap: **the fixed top bar overprinting live
copy on six of fifteen frames.** Verified directly against our own captures —
at 6% scroll it printed straight through the lede and made two lines
unreadable. Fixed (`styles/base.css`, `src/main.js`): the bar now tucks while
reading downward and returns on scroll-up, which keeps the difference-blend
effect that a background would have killed.

It also called the spec list "broken rather than a reveal" — the same defect
Lighthouse independently caught as a contrast failure. Fixed; see below.

---

## 2. Lighthouse

Run against the built page under Lighthouse 13.4.1, mobile emulation, simulated
throttling.

| Category | Score | Bar |
|---|---|---|
| Performance | **56** (median of 3; runs spread 51–58) | ≥90 — **not met** |
| Accessibility | **100** | — |
| Best Practices | **100** | — |
| SEO | **100** | — |

### Performance: what moved

Starting point was **50**. CLS was already 0, so the entire gap was main-thread
blocking — TBT 2,180ms, with `field.js` accounting for 3,917ms of scripting
including one unbroken **1,943ms** task.

Two fixes, both real rather than benchmark games:

1. **The ambience waits for a paint.** The shader field, mote field and custom
   cursor were built inline during boot, inside the window the browser needed to
   paint the headline. None of them is content. They now wait for a *committed*
   paint (two rAFs) and then for the main thread to go quiet.
2. **The orbit loads in two phases.** 72 × 800px frames is ~180MB of bitmap
   decode. The coarse ring — every 8th frame, nine views 40° apart — is enough
   to turn the bag and is the only part that boots; the in-betweens fill on
   idle, and `nearest()` already degrades a half-loaded turntable to coarse
   rather than broken.

Result: 50 → 56, TBT 2,180 → ~1,500ms, Speed Index 3.1s → 2.1s.

### Performance: why it is still short, honestly

Isolation test — a diagnostic build identical in every respect except that the
shader field, mote field and cursor are not created:

| Build | Perf | TBT |
|---|---|---|
| Shipped | 55 | ~1,730ms |
| Ambience removed | **65** | ~680ms |

So the motion signature costs roughly **10 points**, and the remaining ~680ms
plus an LCP of 4.6s is the orbit frame decode. Getting to 90 means removing the
WebGL field, the particle field, or the turntable — which is to say, removing
the three techniques the contract locks in and the thing the blind comparison
credited as this page's advantage. **That is a trade to decide deliberately, not
a number to quietly chase.**

One caveat, stated as a caveat because it is unverified here: this container has
no GPU, so WebGL runs through SwiftShader and every shader frame is rasterised
on the CPU main thread — exactly what TBT measures. On a real phone that work
goes to the GPU. The real-device score is very likely higher than 56, but this
environment cannot prove it, and the number above is reported as measured.

### Accessibility: 96 → 100

The spec list's `<dt>` labels were painted `--rule-lit`, a *hairline* colour, at
**1.6:1** against the void where AA asks 4.5:1. A 1px stroke and a 10px
uppercase label do not share a contrast floor. Now `--crete-dim` at 4.81:1,
with the values lifted to `--dust` (11.49:1) so the quiet-label / loud-value
hierarchy the list depends on stays intact.

---

## Reproducing

```sh
python3 -m http.server 8080

# matched captures of this page
node tools/match.mjs

# lighthouse, against a browser launched with this container's working flags
chrome --headless=new --remote-debugging-port=9222 --no-sandbox \
       --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
npx lighthouse http://127.0.0.1:8080/index.html --port=9222
```

Lighthouse's own chrome-launcher hangs in this container (`Network.setUserAgent
Override` timeout); attaching to an already-running browser on `--port` is the
way around it. Single runs swing by up to 7 points here — take a median of
three.
