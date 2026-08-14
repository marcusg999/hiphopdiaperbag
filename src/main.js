/**
 * VITRINE — orchestration.
 *
 * Three committed techniques, woven rather than bolted on:
 *   1. magnetic / warping cursor + pointer-reactive shader
 *   2. scroll choreography — pinned spec sequence, staged reveals, scrubbed orbit
 *   3. a living particle field in the light cone
 *
 * One pointer state feeds all three, and one RAF drives the page-level work,
 * so the modules never each run their own listener storm.
 */

import { createField } from './field.js';
import { createParticles } from './particles.js';
import { createCursor } from './cursor.js';
import { createOrbit, attachPointerControl } from './orbit.js';
import { createHandControl } from './hands.js';
import { applyContent } from './content.js';

/* Content layer first. index.html ships the real copy as static markup, so this
   is a patch over it, not a dependency of it — if content.json is missing or
   malformed the page simply keeps the copy it was born with. Awaited before the
   reveal observers attach so text never changes under a finished animation. */
await applyContent().catch(() => ({ ok: false }));

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------------------------------------------------------------- pointer */
const pointer = { x: 0.5, y: 0.4, has: false };
addEventListener('pointermove', (e) => {
  pointer.x = e.clientX / innerWidth;
  pointer.y = e.clientY / innerHeight;
  pointer.has = true;
}, { passive: true });

/* ---------------------------------------------------------------- field */
let field = null, motes = null;
try {
  field = createField($('#field'), { reducedMotion: reduced });
  field.start();
} catch (e) { /* the page must survive a dead shader */ }

try {
  motes = createParticles($('#motes'), { reducedMotion: reduced });
  motes.start();
} catch (e) { /* ditto */ }

/* ---------------------------------------------------------------- cursor */
let cursor = null;
if (fine && !reduced) {
  try {
    cursor = createCursor();
    cursor.start();
    document.body.classList.add('has-cursor');
  } catch (e) { /* no cursor is better than a broken one */ }
}

/* ---------------------------------------------------------------- orbit */
const orbitCanvas = $('#orbit');
const stage = $('#stage');
const hint = $('#hint');

const orbit = createOrbit(orbitCanvas, {
  count: 72,
  pattern: 'assets/frames/orbit_%03d.webp',
  idleSpin: reduced ? 0 : 0.055,
});
orbit.resize();
orbit.start();
orbit.load();
attachPointerControl(stage, orbit, { degreesPerPixel: 0.55 });

let hasTouched = false;
const noteTouch = () => {
  if (hasTouched) return;
  hasTouched = true;
  hint && hint.classList.add('is-hidden');
};
stage.addEventListener('pointerdown', noteTouch, { passive: true });

/* ---------------------------------------------------------------- hands */
const handBtn = $('#handbtn');
const handState = $('#handstate');
const cam = $('#cam');

const MSG = {
  requesting: 'Asking for the camera…',
  loading: 'Loading the tracker…',
  tracking: 'Close your fist to grab it',
  grabbed: 'Got it — move your hand',
  released: 'Let go',
  lost: 'Hand left the frame',
  denied: 'Camera blocked. Drag it instead.',
  failed: 'Tracker failed to load. Drag it instead.',
  off: '',
};

const hands = createHandControl({
  orbit,
  video: cam,
  degreesPerWidth: 900,
  onState(s) {
    if (handState) handState.textContent = MSG[s] ?? '';
    const live = s === 'tracking' || s === 'grabbed' || s === 'released' || s === 'lost';
    handBtn.classList.toggle('is-live', live);
    cam.classList.toggle('is-live', live);
    if (live) {
      noteTouch();
      handBtn.querySelector('.lbl').textContent = 'Stop the camera';
    } else if (s === 'off') {
      handBtn.querySelector('.lbl').textContent = 'Turn it with your hand';
    }
  },
});

if (!hands.supported) {
  handBtn.hidden = true;
} else {
  handBtn.addEventListener('click', async () => {
    if (hands.running) { hands.stop(); return; }
    handBtn.disabled = true;
    await hands.start();
    handBtn.disabled = false;
  });
}

/* ---------------------------------------------------------------- reveals */
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('is-in');
    io.unobserve(e.target);
  }
}, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });

$$('[data-reveal]').forEach((el) => io.observe(el));

/* kinetic headlines: weight and width animate in, staggered per word */
const kio = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    $$('.w', e.target).forEach((w, i) => w.style.setProperty('--d', `${i * 55}ms`));
    e.target.classList.add('is-in');
    kio.unobserve(e.target);
  }
}, { threshold: 0.25 });
$$('[data-kinetic]').forEach((el) => kio.observe(el));

/* ---------------------------------------------------------------- scroll choreography */
const specItems = $$('[data-spec]');
const specCount = $('#speccount');
const heroSection = $('#vitrine');

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;

    // the spec list lights up one line at a time as it crosses the eye line
    const eye = innerHeight * 0.5;
    let active = -1;
    for (let i = 0; i < specItems.length; i++) {
      const r = specItems[i].getBoundingClientRect();
      const on = r.top < eye && r.bottom > innerHeight * 0.12;
      specItems[i].classList.toggle('is-on', on);
      if (on) active = i;
    }
    if (specCount && active >= 0) {
      specCount.textContent = String(active + 1).padStart(2, '0');
    }

    // scrubbing out of the hero turns the bag backwards — the scroll and the
    // hand drive the same object, which is the point of the pinned sequence
    if (!orbit.isDragging && !hands.running) {
      const hr = heroSection.getBoundingClientRect();
      const past = Math.min(Math.max(-hr.top / innerHeight, 0), 1.6);
      orbit.setAngle(past * -260);
    }

    // the field dims as the page leaves the vitrine
    if (field) {
      const t = Math.min(Math.max(scrollY / innerHeight, 0), 1);
      field.setIntensity(1 - t * 0.55);
    }
  });
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------------------------------------------------------------- shared RAF */
let pf = 0;
(function pump() {
  if (field) field.setPointer(pointer.x, pointer.y);
  if (motes) {
    motes.setPointer(pointer.x, pointer.y);
    // the cone tracks the vitrine so the dust reveals the beam over the product
    const r = stage.getBoundingClientRect();
    if (r.width) {
      motes.setCone((r.left + r.width / 2) / innerWidth,
                    (r.top + r.height * 0.3) / innerHeight, 0.34);
    }
  }
  pf = requestAnimationFrame(pump);
})();

/* ---------------------------------------------------------------- resize */
let rt = 0;
addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => { orbit.resize(); cursor && cursor.refresh(); }, 120);
}, { passive: true });

/* Pause everything expensive when the tab is hidden. */
addEventListener('visibilitychange', () => {
  if (document.hidden) { orbit.stop(); field && field.stop(); motes && motes.stop(); }
  else { orbit.start(); field && field.start(); motes && motes.start(); }
});

/* Expose a little state for the audit harness to read. */
window.__vitrine = { orbit, field, motes, hands, cursor };

/* ---------------------------------------------------------------- the drop
   Their campaign card, made answerable. "Pass" is not a dead end — it swaps in
   a line and leaves the buy route open, because a notification you can only
   say yes to is an ad, not an interaction. */
const dropPass = $('#droppass');
const dropPassed = $('#droppassed');
if (dropPass && dropPassed) {
  dropPass.addEventListener('click', () => {
    dropPassed.hidden = false;
    dropPass.disabled = true;
    dropPass.textContent = 'Passed';
  });
}
