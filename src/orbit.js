/**
 * VITRINE — the orbit.
 *
 * A 72-frame turntable of the real product, sliced from a Higgsfield render and
 * linearised so that equal drag produces equal rotation. Everything that can
 * turn the bag — pointer, touch, scroll, a hand in front of the webcam — comes
 * through setAngle/addAngle/release, so the physics live in exactly one place.
 *
 * Frames are drawn to a canvas rather than swapped as <img> because a canvas
 * costs no layout and lets us hold a stable draw size while the sequence is
 * still streaming in.
 */

const TAU = Math.PI * 2;

export function createOrbit(canvas, opts = {}) {
  const count = opts.count || 72;
  const pattern = opts.pattern || 'assets/frames/orbit_%03d.webp';
  const src = (i) => pattern.replace('%03d', String(i).padStart(3, '0'));

  const frames = new Array(count).fill(null);
  const loaded = new Array(count).fill(false);
  let ready = 0;

  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });

  // ---- state -------------------------------------------------------------
  let angle = 0;            // free rotation: idle drift, drag and inertia
  let scrollAngle = 0;      // scroll's own contribution, kept separate
  let velocity = 0;         // degrees per frame
  let dragging = false;
  let drawnIndex = -1;
  let raf = 0;
  let running = false;
  let dpr = 1;
  let cssW = 0, cssH = 0;

  const FRICTION = 0.94;    // inertia decay once released
  // Degrees per SECOND, not per frame. A full revolution in 22s. The old value
  // was per-frame and took 109 seconds at 60fps — and far longer on anything
  // slower, because a per-frame drift silently becomes a function of the
  // device's frame rate. Driving it from elapsed time makes the turntable turn
  // at the same speed on a phone as on a workstation.
  const IDLE_DPS = opts.idleDegreesPerSecond ?? (360 / 22);
  let idleAllowed = true;

  const listeners = { change: [] };
  const emit = (n, v) => listeners[n] && listeners[n].forEach((f) => f(v));
  const on = (n, f) => { (listeners[n] ||= []).push(f); };

  // ---- loading -----------------------------------------------------------
  function loadFrame(i) {
    return new Promise((res) => {
      if (loaded[i]) return res();
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { frames[i] = img; loaded[i] = true; ready++; res(); };
      img.onerror = () => res();
      img.src = src(i);
    });
  }

  function pump(list) {
    const CONC = 6;
    let cursor = 0;
    return Promise.all(Array.from({ length: CONC }, async () => {
      while (cursor < list.length) {
        await loadFrame(list[cursor++]);
        emit('change', { ready, count });
      }
    }));
  }

  /** Load frame 0 first so something is on screen, then fan out over the rest
   *  in an interleaved order — every 8th, then every 4th, and so on — so the
   *  turntable becomes coarsely scrubbable long before it is complete.
   *
   *  That order is right but doing all of it during boot was not. Seventy-two
   *  800px frames is roughly 180MB of bitmap decode, and running it inline cost
   *  1.7s of blocked main thread in the window the browser needed to paint the
   *  headline. So the sequence is split at its own natural seam: the coarse
   *  ring — every eighth frame, nine views at 40° apart — is enough for a drag
   *  or a scroll to turn the bag, and it is the only part that boots. The
   *  in-betweens fill in on idle, and their real deadline is not first paint
   *  but the moment someone drags far enough to see a step, which is much
   *  later. Until then nearest() falls back to the closest loaded view, so a
   *  half-loaded turntable is coarse rather than broken. */
  async function load() {
    await loadFrame(0);
    draw(true);
    emit('change', { ready, count });

    const order = [];
    for (let step = count >> 1; step >= 1; step >>= 1) {
      for (let i = step; i < count; i += step) if (!order.includes(i)) order.push(i);
    }
    const COARSE = 8;
    await pump(order.filter((i) => i % COARSE === 0));

    const rest = () => pump(order.filter((i) => i % COARSE !== 0));
    if (typeof requestIdleCallback === 'function') requestIdleCallback(rest, { timeout: 2500 });
    else setTimeout(rest, 300);
  }

  // ---- drawing -----------------------------------------------------------
  function nearestLoaded(i) {
    if (loaded[i]) return i;
    for (let d = 1; d < count; d++) {
      const a = (i - d + count * 2) % count;
      const b = (i + d) % count;
      if (loaded[a]) return a;
      if (loaded[b]) return b;
    }
    return -1;
  }

  function totalAngle() { return angle + scrollAngle; }

  function indexFor(deg) {
    // The render turns clockwise; dragging right should turn the bag right.
    const t = ((deg % 360) + 360) % 360;
    return Math.round(t / 360 * count) % count;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = r.width; cssH = r.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    drawnIndex = -1;
    draw(true);
  }

  function draw(force) {
    const want = indexFor(totalAngle());
    if (!force && want === drawnIndex) return;
    const i = nearestLoaded(want);
    if (i < 0) return;
    const img = frames[i];
    if (!img) return;
    drawnIndex = want;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    // contain
    const s = Math.min(cssW / img.width, cssH / img.height);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, (cssW - w) / 2, (cssH - h) / 2, w, h);
  }

  // ---- loop --------------------------------------------------------------
  let lastT = 0;
  function tick(now) {
    if (!running) return;
    // Clamp the delta so a backgrounded tab or a long stall does not resume
    // with the bag having spun through a random angle.
    const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
    lastT = now;
    if (!dragging) {
      if (Math.abs(velocity) > 0.004) {
        angle += velocity;
        velocity *= FRICTION;
      } else {
        velocity = 0;
        if (idleAllowed) angle += IDLE_DPS * dt;
      }
    }
    draw(false);
    raf = requestAnimationFrame(tick);
  }

  // ---- api ---------------------------------------------------------------
  const api = {
    load,
    start() { if (!running) { running = true; lastT = 0; raf = requestAnimationFrame(tick); } },
    stop() { running = false; cancelAnimationFrame(raf); },
    destroy() { api.stop(); frames.length = 0; },
    resize,

    grab() { dragging = true; velocity = 0; },
    /** deg: how far to turn right now. Called by pointer, touch and hand alike. */
    addAngle(deg) { angle += deg; velocity = deg; draw(false); },
    /** Scroll's contribution, held apart from the free rotation so the two add
     *  up instead of overwriting each other. Setting this used to clobber the
     *  idle drift back to an absolute value on every scroll event, which is why
     *  the bag could never complete a turn on its own. */
    setScrollAngle(deg) { scrollAngle = deg; draw(false); },
    setAngle(deg) { angle = deg; scrollAngle = 0; draw(false); },
    release(throwVelocity) {
      dragging = false;
      if (typeof throwVelocity === 'number') velocity = throwVelocity;
    },
    setIdle(v) { idleAllowed = !!v; },

    get angle() { return ((totalAngle() % 360) + 360) % 360; },
    get index() { return indexFor(totalAngle()); },
    get progress() { return ready / count; },
    get isDragging() { return dragging; },
    on,
  };

  return api;
}

/**
 * Pointer + touch driver. Kept separate from the orbit itself so the hand
 * tracker can drive the same object without either knowing about the other.
 */
export function attachPointerControl(el, orbit, opts = {}) {
  const perPx = opts.degreesPerPixel || 0.55;
  let last = 0, id = null, moved = 0;

  const down = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    id = e.pointerId; last = e.clientX; moved = 0;
    orbit.grab();
    el.setPointerCapture?.(id);
    el.classList.add('is-grabbing');
  };
  const move = (e) => {
    if (id === null || e.pointerId !== id) return;
    const dx = e.clientX - last;
    last = e.clientX;
    moved += Math.abs(dx);
    orbit.addAngle(dx * perPx);
  };
  const up = (e) => {
    if (id === null || (e && e.pointerId !== id)) return;
    el.releasePointerCapture?.(id);
    id = null;
    orbit.release();
    el.classList.remove('is-grabbing');
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);

  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('lostpointercapture', up);
  };
}
