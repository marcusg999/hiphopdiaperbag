/* ============================================================
   VITRINE — src/cursor.js
   The magnetic / warping cursor. A "handle with care" hairline ring
   that lags the pointer on a near-critically-damped spring, warps with
   velocity, and is attracted to — and deformed by — [data-magnet] targets.

   Rendering notes
   ---------------
   The mark is an inline SVG overlay rather than divs, for one reason:
   `vector-effect: non-scaling-stroke`. The ring has to change size by a
   factor of ~2.5 between rest and a magnet snap, and it has to stay a
   true 1px hairline at every one of those sizes. A bordered div scaled
   by transform gets a fat border; an SVG circle scaled by transform does
   not. Everything in the loop is therefore a transform/opacity write on
   four small nodes — no layout writes, no layout reads.

   Geometry chain, outermost first:
     g.pos    translate(x, y)                 spring position
     g.warp   rotate(theta) scale(sx, sy) skewX(k)   velocity + magnet warp
     circle   r = BASE, non-scaling-stroke    the ring itself
   Rotation carries the ellipse's long axis onto the axis of travel (or of
   magnetic approach), so the ring genuinely elongates along its direction
   of motion instead of merely getting bigger.

   Contract: palette is --crete at rest, --hazard on a magnet. Nothing else.
   ============================================================ */

const NS = 'http://www.w3.org/2000/svg';

const NOOP = Object.freeze({
  start() {},
  stop() {},
  destroy() {},
  setPointer() {},
  refresh() {},
  get enabled() { return false; },
});

const DEFAULTS = {
  /* Spring. omega is the natural frequency in rad/s, zeta the damping ratio.
     omega 21 / zeta 0.98 settles in ~180ms with no visible overshoot: the ring
     is unmistakably behind the pointer during a flick, and unmistakably exact
     the instant you stop. Lower omega reads floaty; higher reads glued-on. */
  omega: 21,
  zeta: 0.98,

  ringRadius: 13,          /* SVG units == px at scale 1 */
  restScale: 1,
  magnetScale: 2.35,       /* ring size when fully snapped to a magnet */
  textScale: 0.42,
  pressScale: 0.74,

  magnetRadius: 90,        /* default; per-element override via data-magnet-radius */
  magnetPull: 1,           /* global multiplier on the magnetic offset */

  /* Velocity warp. speedFull is the speed (px/s) at which the stretch maxes. */
  speedFull: 2200,
  maxStretch: 0.52,        /* long axis grows by up to +52% */
  shear: 18,               /* deg of skew at full stretch */

  colorRest: '#8E8B84',    /* --crete */
  colorActive: '#FF4A00',  /* --hazard */

  zIndex: 2147483000,
  hideNativeCursor: true,
  textSelector:
    'p,h1,h2,h3,h4,h5,h6,li,span,em,strong,small,blockquote,code,pre,label,td,th,dd,dt,figcaption,input,textarea,[data-cursor="text"]',
  magnetSelector: '[data-magnet]',
  root: null,              /* defaults to document.body */
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

export function createCursor(opts = {}) {
  /* ---- capability gates ------------------------------------------------ */
  if (typeof window === 'undefined' || typeof document === 'undefined') return NOOP;

  let mqFine, mqMotion;
  try {
    mqFine = window.matchMedia('(pointer: fine)');
    mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    return NOOP;
  }
  /* Coarse pointer (touch) or reduced motion: this technique is not offered.
     No DOM is created, no native cursor is hidden, the API is inert. */
  if (!mqFine.matches || mqMotion.matches) return NOOP;

  const o = { ...DEFAULTS, ...opts };
  const root = o.root || document.body;
  if (!root) return NOOP;

  /* ---- DOM ------------------------------------------------------------- */
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset.vitrineCursor = '';
  Object.assign(svg.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: String(o.zIndex),
    overflow: 'visible',
    opacity: '0',
    transition: 'opacity 260ms cubic-bezier(0.16,1,0.3,1)',
  });

  const gPos = document.createElementNS(NS, 'g');
  const gWarp = document.createElementNS(NS, 'g');

  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('r', String(o.ringRadius));
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', o.colorRest);
  ring.setAttribute('stroke-width', '1');
  ring.setAttribute('vector-effect', 'non-scaling-stroke');

  /* The text caret. Cross-faded against the ring rather than morphing it,
     so both stay pure transform writes. */
  const bar = document.createElementNS(NS, 'line');
  bar.setAttribute('x1', '0'); bar.setAttribute('y1', '-13');
  bar.setAttribute('x2', '0'); bar.setAttribute('y2', '13');
  bar.setAttribute('stroke', o.colorRest);
  bar.setAttribute('stroke-width', '1');
  bar.setAttribute('vector-effect', 'non-scaling-stroke');
  bar.setAttribute('opacity', '0');

  /* Registration ticks — four hairlines outside the ring that bloom only
     while a magnet has hold of the cursor. The gallery "handle with care"
     bracket. They live inside gWarp so they lean with the deformation. */
  const ticks = document.createElementNS(NS, 'g');
  ticks.setAttribute('opacity', '0');
  ticks.setAttribute('stroke', o.colorActive);
  ticks.setAttribute('stroke-width', '1');
  const R = o.ringRadius;
  for (let i = 0; i < 4; i++) {
    const t = document.createElementNS(NS, 'line');
    const a = (Math.PI / 2) * i - Math.PI / 4;
    const ca = Math.cos(a), sa = Math.sin(a);
    t.setAttribute('x1', (ca * (R + 5)).toFixed(2));
    t.setAttribute('y1', (sa * (R + 5)).toFixed(2));
    t.setAttribute('x2', (ca * (R + 10)).toFixed(2));
    t.setAttribute('y2', (sa * (R + 10)).toFixed(2));
    t.setAttribute('vector-effect', 'non-scaling-stroke');
    ticks.appendChild(t);
  }

  /* The precision dot sits on the *true* pointer, unlagged, outside gPos.
     It is what turns the ring's lag from "laggy" into "deliberate": the
     exact hit point is always shown, the ring is the gesture around it. */
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('r', '1.4');
  dot.setAttribute('fill', o.colorRest);

  gWarp.appendChild(ring);
  gWarp.appendChild(ticks);
  gPos.appendChild(gWarp);
  gPos.appendChild(bar);
  svg.appendChild(gPos);
  svg.appendChild(dot);

  /* ---- state ----------------------------------------------------------- */
  let running = false, destroyed = false, mounted = false;
  let raf = 0, lastT = 0, acc = 0;

  /* raw pointer (target), spring position, spring velocity */
  let px = window.innerWidth * 0.5, py = window.innerHeight * 0.5;
  let sx = px, sy = py, vx = 0, vy = 0;
  let seenPointer = false;

  /* smoothed pointer velocity, used for the warp */
  let pvx = 0, pvy = 0, lastPx = px, lastPy = py;

  /* eased state scalars */
  let magnetAmt = 0;    /* 0..1 how strongly a magnet holds us */
  let textAmt = 0;      /* 0..1 over text */
  let pressAmt = 0;     /* 0..1 mousedown */
  let stretchAmt = 0;   /* 0..1 velocity elongation */
  let angle = 0;        /* current warp axis, radians, unwrapped */
  let colorState = 0;   /* 0 crete, 1 hazard */

  let magnets = [];
  let rectsDirty = true;
  let hoverMagnet = null;   /* magnet the pointer is literally over */
  let overText = false;
  let pressed = false;

  /* ---- magnet bookkeeping ---------------------------------------------- */
  function collect() {
    let list;
    try {
      list = document.querySelectorAll(o.magnetSelector);
    } catch { list = []; }
    magnets = [];
    for (const el of list) {
      const r = parseFloat(el.getAttribute('data-magnet-radius'));
      const s = parseFloat(el.getAttribute('data-magnet-strength'));
      magnets.push({
        el,
        radius: Number.isFinite(r) && r > 0 ? r : o.magnetRadius,
        strength: Number.isFinite(s) ? s : 1,
        x: 0, y: 0, hw: 0, hh: 0, ok: false,
      });
    }
    rectsDirty = true;
  }

  function measure() {
    for (let i = 0; i < magnets.length; i++) {
      const m = magnets[i];
      const b = m.el.getBoundingClientRect();
      m.ok = b.width > 0 && b.height > 0;
      m.x = b.left + b.width * 0.5;
      m.y = b.top + b.height * 0.5;
      m.hw = b.width * 0.5;
      m.hh = b.height * 0.5;
    }
    rectsDirty = false;
  }

  /* ---- events ---------------------------------------------------------- */
  const isTextTarget = (t) => {
    if (!t || t.nodeType !== 1) return false;
    if (t.closest(o.magnetSelector)) return false;
    const dc = t.closest('[data-cursor]');
    if (dc) {
      const v = dc.getAttribute('data-cursor');
      if (v === 'text') return true;
      if (v === 'none' || v === 'ring') return false;
    }
    if (!t.matches(o.textSelector)) return false;
    /* a container that happens to match but holds no direct text isn't text */
    for (const n of t.childNodes) {
      if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    }
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA';
  };

  function onMove(e) {
    px = e.clientX; py = e.clientY;
    if (!seenPointer) { sx = px; sy = py; lastPx = px; lastPy = py; seenPointer = true; }
    show();
    const t = e.target;
    hoverMagnet = t && t.nodeType === 1 ? t.closest(o.magnetSelector) : null;
    overText = !hoverMagnet && isTextTarget(t);
  }
  function onDown() { pressed = true; }
  function onUp() { pressed = false; }
  function onLeave(e) { if (!e.relatedTarget && !e.toElement) hide(); }
  function onEnter() { show(); }
  function onResize() { rectsDirty = true; }
  function onScroll() { rectsDirty = true; }
  function onVisibility() { if (document.hidden) pause(); else resume(); }
  function onFineChange() { if (!mqFine.matches || mqMotion.matches) destroy(); }

  let hidden = false;
  function show() { if (hidden || svg.style.opacity !== '1') { hidden = false; svg.style.opacity = '1'; } }
  function hide() { hidden = true; svg.style.opacity = '0'; }

  /* ---- the loop -------------------------------------------------------- */
  const FIXED = 1 / 120;   /* fixed physics step: identical feel at 60 or 144Hz */

  function step(dt) {
    /* pointer velocity (px/s), smoothed — this drives the warp */
    const idt = 1 / dt;
    const rawVx = (px - lastPx) * idt;
    const rawVy = (py - lastPy) * idt;
    lastPx = px; lastPy = py;
    const vk = 1 - Math.exp(-dt * 16);
    pvx += (rawVx - pvx) * vk;
    pvy += (rawVy - pvy) * vk;

    /* ---- magnetism: find the strongest claim on the pointer ---- */
    let bestPull = 0, bestM = null;
    for (let i = 0; i < magnets.length; i++) {
      const m = magnets[i];
      if (!m.ok) continue;
      /* distance from the pointer to the element's *box*, 0 when inside */
      const dx = Math.abs(px - m.x) - m.hw;
      const dy = Math.abs(py - m.y) - m.hh;
      const ox = dx > 0 ? dx : 0, oy = dy > 0 ? dy : 0;
      const d = Math.sqrt(ox * ox + oy * oy);
      if (d > m.radius) continue;
      /* 1 inside the box, easing to 0 at the radius edge */
      const pull = smoothstep(m.radius, 0, d) * m.strength;
      if (pull > bestPull) { bestPull = pull; bestM = m; }
    }
    if (hoverMagnet) {
      /* literally over the element: full claim regardless of box maths */
      const m = magnets.find((q) => q.el === hoverMagnet);
      if (m && m.ok) { bestM = m; bestPull = Math.max(bestPull, 1) * m.strength; }
    }
    bestPull = clamp(bestPull, 0, 1);

    /* target the spring chases: pointer, dragged toward the magnet centre */
    let tx = px, ty = py, axisX = 0, axisY = 0, axisLen = 0;
    if (bestM && bestPull > 0) {
      /* cubic ease so a near-miss barely leans and a hover snaps hard */
      const k = bestPull * bestPull * (3 - 2 * bestPull) * o.magnetPull;
      tx = px + (bestM.x - px) * k;
      ty = py + (bestM.y - py) * k;
      axisX = bestM.x - px; axisY = bestM.y - py;
      axisLen = Math.hypot(axisX, axisY);
    }

    /* ---- spring: semi-implicit Euler, near-critical damping ---- */
    const k = o.omega * o.omega;
    const c = 2 * o.zeta * o.omega;
    vx += (-k * (sx - tx) - c * vx) * dt;
    vy += (-k * (sy - ty) - c * vy) * dt;
    sx += vx * dt;
    sy += vy * dt;

    /* ---- eased state scalars ---- */
    const ease = (cur, tgt, rate) => cur + (tgt - cur) * (1 - Math.exp(-dt * rate));
    magnetAmt = ease(magnetAmt, bestPull, 14);
    textAmt = ease(textAmt, overText ? 1 : 0, 18);
    pressAmt = ease(pressAmt, pressed ? 1 : 0, 26);
    colorState = ease(colorState, bestPull > 0.06 ? 1 : 0, 16);

    /* ---- warp ----
       Two sources of elongation, taken as the stronger of the two:
       (a) travel — the ring lengthens along its direction of motion,
       (b) approach — while being drawn onto a magnet it leans along the
           approach axis, peaking mid-flight and resolving into a clean
           circle once it has actually landed. sin(pi*pull) does that. */
    const speed = Math.hypot(pvx, pvy);
    const travel = clamp(speed / o.speedFull, 0, 1);
    const lean = Math.sin(Math.PI * clamp(bestPull, 0, 1)) * 0.62;
    const target = clamp(Math.max(travel, lean), 0, 1);
    /* asymmetric ease: snaps into a stretch, relaxes out of it slowly */
    stretchAmt = ease(stretchAmt, target, target > stretchAmt ? 30 : 9);

    /* axis of the deformation: magnet approach wins while it is meaningful,
       otherwise direction of travel */
    let ax = pvx, ay = pvy;
    if (lean > travel * 0.6 && axisLen > 1) { ax = axisX; ay = axisY; }
    if (Math.hypot(ax, ay) > 6) {
      const want = Math.atan2(ay, ax);
      /* unwrap so the ellipse never spins the long way round */
      let d = want - angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      angle = ease(angle, angle + d, 22);
    }
  }

  /* transform strings are rebuilt from a scratch buffer, never read back */
  let lastPosStr = '', lastWarpStr = '', lastDotStr = '';

  function draw() {
    const s = stretchAmt * o.maxStretch;
    /* long axis grows, short axis pinches — roughly area-preserving, which
       is what makes it read as a deforming physical object rather than a
       scale animation */
    let ex = 1 + s;
    let ey = 1 - s * 0.62;

    /* size: rest -> magnet -> text -> press, multiplied together */
    const size =
      (o.restScale + (o.magnetScale - o.restScale) * magnetAmt) *
      (1 - (1 - o.textScale) * textAmt) *
      (1 - (1 - o.pressScale) * pressAmt);

    ex *= size;
    ey *= size;

    const deg = (angle * 180) / Math.PI;
    const skew = -s * o.shear;

    const posStr = `translate(${sx.toFixed(2)} ${sy.toFixed(2)})`;
    if (posStr !== lastPosStr) { gPos.setAttribute('transform', posStr); lastPosStr = posStr; }

    const warpStr =
      `rotate(${deg.toFixed(2)}) scale(${ex.toFixed(4)} ${ey.toFixed(4)}) skewX(${skew.toFixed(2)})`;
    if (warpStr !== lastWarpStr) { gWarp.setAttribute('transform', warpStr); lastWarpStr = warpStr; }

    /* ring <-> caret cross-fade */
    const ringOp = (1 - textAmt) * (1 - textAmt);
    ring.setAttribute('opacity', ringOp.toFixed(3));
    if (textAmt > 0.002) {
      bar.setAttribute('opacity', (textAmt * textAmt).toFixed(3));
      /* the caret is a thin vertical bar: no warp, only a press squeeze */
      bar.setAttribute(
        'transform',
        `scale(${(1 - 0.22 * pressAmt).toFixed(3)} ${(0.92 + 0.08 * (1 - pressAmt)).toFixed(3)})`
      );
    } else if (bar.getAttribute('opacity') !== '0') {
      bar.setAttribute('opacity', '0');
    }

    /* colour: --crete -> --hazard, and the registration ticks bloom */
    const col = colorState > 0.5 ? o.colorActive : o.colorRest;
    if (ring.getAttribute('stroke') !== col) {
      ring.setAttribute('stroke', col);
      bar.setAttribute('stroke', col);
      dot.setAttribute('fill', col);
    }
    ring.setAttribute('stroke-opacity', (0.62 + 0.38 * colorState).toFixed(3));
    ticks.setAttribute('opacity', (magnetAmt * magnetAmt * 0.85).toFixed(3));

    /* precision dot rides the true pointer, swelling under press */
    const dr = 1.4 + 1.5 * pressAmt;
    const dotStr = `translate(${px.toFixed(2)} ${py.toFixed(2)})`;
    if (dotStr !== lastDotStr) { dot.setAttribute('transform', dotStr); lastDotStr = dotStr; }
    dot.setAttribute('r', dr.toFixed(2));
    dot.setAttribute('opacity', (0.35 + 0.45 * (1 - textAmt)).toFixed(3));
  }

  function frame(t) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!lastT) lastT = t;
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;          /* a tab wake-up must not fling the spring */

    if (rectsDirty) measure();        /* the only layout read, and only when dirty */

    acc += dt;
    let guard = 0;
    while (acc >= FIXED && guard++ < 12) { step(FIXED); acc -= FIXED; }
    draw();
  }

  /* ---- lifecycle ------------------------------------------------------- */
  let prevCursor = '';
  function mount() {
    if (mounted) return;
    root.appendChild(svg);
    if (o.hideNativeCursor) {
      prevCursor = document.documentElement.style.cursor;
      document.documentElement.style.cursor = 'none';
    }
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    document.addEventListener('pointerleave', onLeave, { passive: true });
    document.addEventListener('pointerenter', onEnter, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    document.addEventListener('visibilitychange', onVisibility);
    if (mqFine.addEventListener) {
      mqFine.addEventListener('change', onFineChange);
      mqMotion.addEventListener('change', onFineChange);
    }
    mounted = true;
  }

  function unmount() {
    if (!mounted) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    document.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('pointerenter', onEnter);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll, { capture: true });
    document.removeEventListener('visibilitychange', onVisibility);
    if (mqFine.removeEventListener) {
      mqFine.removeEventListener('change', onFineChange);
      mqMotion.removeEventListener('change', onFineChange);
    }
    if (o.hideNativeCursor) document.documentElement.style.cursor = prevCursor;
    if (svg.parentNode) svg.parentNode.removeChild(svg);
    mounted = false;
  }

  function pause() { if (raf) cancelAnimationFrame(raf); raf = 0; lastT = 0; }
  function resume() { if (running && !raf) { lastT = 0; raf = requestAnimationFrame(frame); } }

  const api = {
    start() {
      if (destroyed || running) return;
      running = true;
      mount();
      collect();
      lastT = 0; acc = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      if (!running) return;
      running = false;
      pause();
      hide();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      running = false;
      pause();
      unmount();
      magnets = [];
    },
    setPointer(x, y) {
      if (destroyed) return;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      px = x; py = y;
      if (!seenPointer) { sx = x; sy = y; lastPx = x; lastPy = y; seenPointer = true; }
      show();
    },
    refresh() {
      if (destroyed) return;
      collect();
    },
    get enabled() { return !destroyed; },
  };

  return api;
}

export default createCursor;
