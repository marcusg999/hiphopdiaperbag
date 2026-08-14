/* ============================================================
   VITRINE — src/particles.js
   Concrete dust and atomised spray suspended in the gallery's light cone.

   Why Canvas 2D and not WebGL
   ---------------------------
   The hero already owns the GPU: a GLSL concrete-and-light field runs behind
   everything, permanently. Adding a second WebGL context means a second
   program, a second set of state changes, and — on the software rasteriser
   this is verified against — direct competition for the same fill budget.
   The field here is 150-400 motes. At that count the honest bottleneck is
   fill rate, not draw-call overhead, and Canvas 2D `drawImage` of a
   pre-rendered sprite is a straight blit the compositor is very good at.
   So: no per-particle radial gradients (those are the expensive mistake),
   no per-particle shadowBlur. Nine sprites are rasterised once at init
   (3 tints x 3 softness tiers) and every mote is one scaled blit with an
   alpha. Per frame: 1 clearRect + N drawImage. That is the whole budget.

   The beam is never drawn. It exists only because the dust inside it is lit
   and the dust outside it is not — which is how a real light cone in a dark
   room is visible at all.
   ============================================================ */

const NOOP = Object.freeze({
  start() {}, stop() {}, destroy() {},
  setPointer() {}, setCone() {}, setDensity() {},
  get count() { return 0; },
});

const DEFAULTS = {
  /* one mote per this many CSS px^2 of viewport, before density scaling */
  areaPerMote: 5200,
  minCount: 70,
  maxCount: 420,
  density: 1,

  /* light cone, normalised 0..1 of the viewport */
  cone: { x: 0.42, y: 0.52, r: 0.30 },

  /* motion, px/s and px/s^2 in CSS pixels */
  drift: { x: -5, y: 9 },      /* the room's slow air */
  turbulence: 26,
  damping: 0.72,               /* per second, exponential */
  maxSpeed: 90,

  /* pointer wake */
  pointerRadius: 170,
  pointerForce: 520,           /* px/s^2 at the very centre, before falloff */

  /* look */
  gain: 1,                     /* master brightness */
  ambient: 0.055,              /* how visible a mote is OUTSIDE the cone */
  sizeRange: [0.7, 4.6],       /* px radius, far -> near */
  sprayChance: 0.035,          /* fraction of motes tinted --hazard */
  tints: ['#C9C5BC', '#F4F2ED', '#FF4A00'],  /* --dust, --paper, --hazard */

  maxDpr: 1.75,
  /* adaptive quality */
  targetFrameMs: 20,
  recoverFrameMs: 12.5,
  minAdaptive: 0.35,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

/* Pre-render one soft dot. `soft` 0..1 widens the falloff, which is how the
   near-field motes get their out-of-focus blur without any filter cost. */
function makeSprite(hex, soft) {
  const S = 64, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const r = S / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  const core = 0.03 + soft * 0.30;
  grad.addColorStop(0, hex);
  grad.addColorStop(core, hex);
  /* a shaped falloff — two mid stops keep it from reading as a hard disc */
  grad.addColorStop(core + (1 - core) * 0.35, hexA(hex, 0.42 - soft * 0.16));
  grad.addColorStop(core + (1 - core) * 0.70, hexA(hex, 0.11 - soft * 0.05));
  grad.addColorStop(1, hexA(hex, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return c;
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1)})`;
}

export function createParticles(canvas, opts = {}) {
  if (typeof window === 'undefined' || !canvas || !canvas.getContext) return NOOP;
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) return NOOP;

  const o = { ...DEFAULTS, ...opts, cone: { ...DEFAULTS.cone, ...(opts.cone || {}) } };

  let reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}

  /* ---- sprites: 3 tints x 3 softness tiers, rasterised once ---- */
  const sprites = o.tints.map((t) => [0, 0.5, 1].map((s) => makeSprite(t, s)));

  /* ---- viewport ---- */
  let W = 1, H = 1, dpr = 1, area = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width || canvas.clientWidth || window.innerWidth));
    H = Math.max(1, Math.round(r.height || canvas.clientHeight || window.innerHeight));
    dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    area = W * H;
    retarget();
  }

  /* ---- population ---- */
  let motes = [];
  let want = 0;        /* how many of `motes` are currently simulated */
  let adaptive = 1;    /* frame-time quality scalar, 0.35..1 */
  let density = clamp(o.density, 0, 1);

  function baseCount() {
    let n = Math.round(area / o.areaPerMote);
    /* small screens carry proportionally fewer — the field must never be the
       reason a phone drops frames */
    if (W < 560) n = Math.round(n * 0.45);
    else if (W < 900) n = Math.round(n * 0.7);
    return clamp(n, o.minCount, o.maxCount);
  }
  function retarget() {
    const target = Math.round(baseCount() * density * adaptive);
    want = clamp(target, 24, o.maxCount);
    while (motes.length < want) motes.push(spawn(true));
    if (motes.length > want + 90) motes.length = want;
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  function spawn(anywhere) {
    /* depth: 0 far (small, sharp, slow), 1 near (large, soft, fast, dimmer) */
    const d = Math.pow(Math.random(), 1.6);
    const spray = Math.random() < o.sprayChance;
    return {
      x: anywhere ? rnd(-40, W + 40) : rnd(-40, W + 40),
      y: anywhere ? rnd(-40, H + 40) : rnd(-40, H + 40),
      vx: rnd(-6, 6), vy: rnd(-4, 6),
      d,
      /* size is depth-driven, with per-mote variance so it never grids */
      r: (o.sizeRange[0] + (o.sizeRange[1] - o.sizeRange[0]) * d) * rnd(0.72, 1.28),
      /* near-field motes are out of focus, so dimmer and softer */
      soft: d > 0.66 ? 2 : d > 0.3 ? 1 : 0,
      tint: spray ? 2 : Math.random() < 0.22 ? 1 : 0,
      a: rnd(0.35, 1) * (spray ? 0.7 : 1) * (1 - d * 0.42),
      /* phase offsets so the turbulence field never syncs up */
      p1: rnd(0, 1000), p2: rnd(0, 1000),
      tw: rnd(0.25, 0.9),     /* twinkle rate — dust tumbling in the beam */
      tp: rnd(0, 6.283),
    };
  }

  /* ---- inputs ---- */
  let mx = -9999, my = -9999, mvx = 0, mvy = 0, lastMx = -9999, lastMy = -9999;
  let coneX = o.cone.x, coneY = o.cone.y, coneR = o.cone.r;

  /* ---- loop state ---- */
  let running = false, destroyed = false, raf = 0, lastT = 0, time = 0;
  let visible = true, onScreen = true;
  let frameAvg = 16.7, frameN = 0, sinceAdapt = 0;

  /* ---- the cone -------------------------------------------------------
     A vertical beam, not a circle. The apex sits above the pool, the beam
     widens as it descends, and it dies out below the pool. Everything is in
     CSS px, recomputed per frame from the normalised cone so the caller can
     animate it freely. */
  let apexY = 0, poolX = 0, poolY = 0, Rpx = 0, span = 1;
  function coneFrame() {
    Rpx = coneR * Math.max(W, H);
    poolX = coneX * W;
    poolY = coneY * H;
    apexY = poolY - Rpx * 1.75;
    span = (poolY + Rpx * 0.85) - apexY;
  }
  function litness(x, y) {
    const t = (y - apexY) / span;                 /* 0 at apex, 1 at cone floor */
    if (t < -0.35 || t > 1.5) return 0;
    const halfW = Rpx * (0.13 + 0.92 * clamp(t, 0, 1.5));
    const axial = Math.abs(x - poolX) / halfW;
    /* soft edges: a hot core, a penumbra, then nothing */
    const radial = 1 - smoothstep(0.42, 1.05, axial);
    const vert = smoothstep(-0.3, 0.08, t) * (1 - smoothstep(0.86, 1.4, t));
    /* the pool of light on the plinth is the brightest part of the beam */
    const pool = 1 - smoothstep(0, Rpx * 0.75, Math.hypot(x - poolX, y - poolY));
    return clamp(radial * vert * (0.78 + 0.55 * pool), 0, 1.25);
  }

  /* ---- physics ---- */
  function step(dt) {
    time += dt;
    const damp = Math.exp(-o.damping * dt);
    const pr = o.pointerRadius;
    const pr2 = pr * pr;
    const hasPointer = mx > -9000;

    for (let i = 0; i < want; i++) {
      const m = motes[i];
      /* parallax: near motes are carried faster by the same air */
      const par = 0.45 + m.d * 1.15;

      /* turbulence — a cheap divergence-light sine field. Two octaves is
         enough to stop any visible drift lane forming. */
      const tf = o.turbulence * par;
      const ax =
        Math.sin(m.y * 0.0062 + time * 0.21 + m.p1) * tf +
        Math.sin(m.y * 0.0181 - time * 0.47 + m.p2) * tf * 0.35;
      const ay =
        Math.cos(m.x * 0.0055 - time * 0.17 + m.p2) * tf * 0.8 +
        Math.cos(m.x * 0.0164 + time * 0.39 + m.p1) * tf * 0.28;

      m.vx += (ax + o.drift.x * par) * dt;
      m.vy += (ay + o.drift.y * par) * dt;

      /* pointer wake: a soft push away, then damping settles it. Deliberately
         weak and wide — dust does not explode, it gets nudged aside. */
      if (hasPointer) {
        const dx = m.x - mx, dy = m.y - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < pr2) {
          const d = Math.sqrt(d2) || 0.001;
          const f = 1 - d / pr;
          const soft = f * f * f;             /* cubic: almost nothing at the rim */
          const k = (o.pointerForce * soft * par) / d;
          m.vx += dx * k * dt;
          m.vy += dy * k * dt;
          /* the pointer drags a little air with it */
          m.vx += mvx * soft * 0.16 * dt * par;
          m.vy += mvy * soft * 0.16 * dt * par;
        }
      }

      m.vx *= damp; m.vy *= damp;
      const sp = Math.hypot(m.vx, m.vy);
      if (sp > o.maxSpeed) { const s = o.maxSpeed / sp; m.vx *= s; m.vy *= s; }

      m.x += m.vx * dt;
      m.y += m.vy * dt;

      /* wrap with a margin so nothing pops at the edge */
      if (m.x < -60) m.x = W + 55; else if (m.x > W + 60) m.x = -55;
      if (m.y < -60) m.y = H + 55; else if (m.y > H + 60) m.y = -55;
    }
  }

  function render() {
    coneFrame();
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < want; i++) {
      const m = motes[i];
      const lit = litness(m.x, m.y);
      /* slow tumble — a facet catching the beam. Only meaningful when lit. */
      const tw = 0.78 + 0.22 * Math.sin(time * m.tw + m.tp);
      const alpha = clamp((o.ambient + lit * tw) * m.a * o.gain, 0, 1);
      if (alpha < 0.006) continue;

      /* motes swell slightly in the beam — scattering, not scale animation */
      const r = m.r * (1 + lit * 0.35);
      const s = r * 4;                       /* sprite covers ~4r of falloff */
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprites[m.tint][m.soft], m.x - s * 0.5, m.y - s * 0.5, s, s);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function adapt(ms) {
    frameAvg += (ms - frameAvg) * 0.06;
    if (++frameN < 45) return;
    sinceAdapt += ms;
    if (sinceAdapt < 500) return;
    sinceAdapt = 0;
    const before = adaptive;
    if (frameAvg > o.targetFrameMs && adaptive > o.minAdaptive) {
      adaptive = Math.max(o.minAdaptive, adaptive - 0.12);
    } else if (frameAvg < o.recoverFrameMs && adaptive < 1) {
      adaptive = Math.min(1, adaptive + 0.06);
    }
    if (adaptive !== before) retarget();
  }

  function frame(t) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!lastT) lastT = t;
    let dt = (t - lastT) / 1000;
    const ms = t - lastT;
    lastT = t;
    if (!(dt > 0)) return;
    if (dt > 0.05) dt = 0.05;         /* never let a stall fling the field */

    /* pointer velocity, smoothed */
    if (lastMx > -9000 && mx > -9000) {
      const k = 1 - Math.exp(-dt * 12);
      mvx += (((mx - lastMx) / dt) - mvx) * k;
      mvy += (((my - lastMy) / dt) - mvy) * k;
    }
    lastMx = mx; lastMy = my;

    step(dt);
    render();
    adapt(ms);
  }

  function staticFrame() {
    coneFrame();
    /* settle the field a little so it isn't a raw uniform scatter */
    for (let i = 0; i < 40; i++) step(1 / 30);
    render();
  }

  /* ---- observers ---- */
  let ro = null, io = null;
  function onVisibility() { visible = !document.hidden; sync(); }
  function sync() {
    const go = running && visible && onScreen && !reduced;
    if (go && !raf) { lastT = 0; raf = requestAnimationFrame(frame); }
    if (!go && raf) { cancelAnimationFrame(raf); raf = 0; lastT = 0; }
  }

  function attach() {
    document.addEventListener('visibilitychange', onVisibility);
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => { resize(); if (reduced) staticFrame(); });
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', resize, { passive: true });
    }
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((es) => {
        onScreen = es.some((e) => e.isIntersecting);
        sync();
      }, { threshold: 0 });
      io.observe(canvas);
    }
  }
  function detach() {
    document.removeEventListener('visibilitychange', onVisibility);
    if (ro) { ro.disconnect(); ro = null; } else window.removeEventListener('resize', resize);
    if (io) { io.disconnect(); io = null; }
  }

  resize();
  attach();

  return {
    start() {
      if (destroyed || running) return;
      running = true;
      if (reduced) { retarget(); staticFrame(); return; }
      retarget();
      sync();
    },
    stop() {
      if (!running) return;
      running = false;
      sync();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      detach();
      motes = [];
      want = 0;
      try { ctx.clearRect(0, 0, W, H); } catch {}
    },
    setPointer(x, y) {
      if (destroyed) return;
      if (!Number.isFinite(x) || !Number.isFinite(y)) { mx = my = -9999; return; }
      mx = x; my = y;
    },
    setCone(x, y, radius) {
      if (destroyed) return;
      if (Number.isFinite(x)) coneX = x;
      if (Number.isFinite(y)) coneY = y;
      if (Number.isFinite(radius) && radius > 0) coneR = radius;
      if (reduced && running) staticFrame();
    },
    setDensity(v) {
      if (destroyed || !Number.isFinite(v)) return;
      density = clamp(v, 0, 1);
      retarget();
      if (reduced && running) staticFrame();
    },
    get count() { return want; },
    get frameMs() { return frameAvg; },
  };
}

export default createParticles;
