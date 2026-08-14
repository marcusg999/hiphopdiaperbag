/*
 * field.js — VITRINE motion signature
 * ---------------------------------------------------------------------------
 * One slow WebGL2 fragment-shader field: raw poured concrete raked by a single
 * slow-moving gallery light. Sits behind every pixel of page content, never
 * fights foreground type, never visibly repeats.
 *
 * Zero dependencies. Vanilla ES module. Never throws.
 *
 *   import { createField } from './src/field.js';
 *   const field = createField(canvas, { intensity: 1, reducedMotion: false });
 *   field.start();
 *   field.setPointer(x, y);   // normalised 0..1, y down
 *   field.setIntensity(0.4);  // scrolled sections dim the field
 *   field.scale;              // current render scale (1 / 0.75 / 0.5)
 *
 * Non-repetition strategy: the noise domain is never translated without bound.
 * It is driven by (a) a very slow continuous rotation and (b) a sum of sines
 * whose frequency ratios are irrational, which is quasi-periodic — it never
 * returns to a previous state, and the coordinates stay small enough that the
 * hash stays precise no matter how long the tab is open.
 */

const DPR_CAP = 1.5;
const SCALE_LADDER = [1.0, 0.75, 0.5];
const SLOW_FRAME_MS = 20; // > 20ms sustained -> step down the ladder
const LADDER_WINDOW_MS = 1000;
const POINTER_LERP = 0.03; // heavy smoothing: felt, never twitchy
const POINTER_IDLE_MS = 6000; // after this, the light resumes its own drift

const NOOP = Object.freeze({
  start() {},
  stop() {},
  destroy() {},
  setPointer() {},
  setIntensity() {},
  get scale() {
    return 0;
  },
});

const VERT = `#version 300 es
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2  uRes;    // drawing-buffer size, px
uniform float uTime;   // seconds, continuous
uniform vec2  uPtr;    // smoothed pointer, 0..1, y down
uniform float uInt;    // intensity 0..1

// ---- the palette. nothing else gets a colour. --------------------------
const vec3 C_VOID  = vec3(0.03922, 0.03922, 0.04314); // #0A0A0B
const vec3 C_SLAB  = vec3(0.08627, 0.08627, 0.10196); // #16161A
const vec3 C_CRETE = vec3(0.55686, 0.54510, 0.51765); // #8E8B84
const vec3 C_DUST  = vec3(0.78824, 0.77255, 0.73725); // #C9C5BC
const vec3 C_PAPER = vec3(0.95686, 0.94902, 0.92941); // #F4F2ED
const vec3 C_HAZ   = vec3(1.00000, 0.29020, 0.00000); // #FF4A00

// ---- value noise. one sin(vec4) hashes all four corners at once. -------
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0;
  vec4 v = fract(sin(vec4(n, n + 1.0, n + 57.0, n + 58.0)) * 43758.5453123);
  return mix(mix(v.x, v.y, f.x), mix(v.z, v.w, f.x), f.y);
}

// ---- worley F1, 4 cells. jitter is clamped to the middle half of each
//      cell, which makes the 2x2 neighbourhood provably sufficient.
//      All four cells are hashed in two vectorised sin(vec4) calls.
float aggregate(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 o = step(vec2(0.5), f) * 2.0 - 1.0;          // which 2x2 quadrant
  vec4 gx = vec4(0.0, o.x, 0.0, o.x);
  vec4 gy = vec4(0.0, 0.0, o.y, o.y);
  vec4 n  = (i.x + gx) * 127.1 + (i.y + gy) * 311.7;
  vec4 rx = fract(sin(n) * 43758.5453);
  vec4 ry = fract(sin(n + 1.7) * 22578.1459);
  vec4 dx = gx + 0.25 + 0.5 * rx - f.x;
  vec4 dy = gy + 0.25 + 0.5 * ry - f.y;
  vec4 d2 = dx * dx + dy * dy;
  return sqrt(min(min(d2.x, d2.y), min(d2.z, d2.w)));
}

vec2 rot(vec2 p, float a){
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// walk the palette as a polyline: every pixel in the field is literally on
// the line between two contract colours, so no off-palette hue can appear.
vec3 ramp(float t){
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(C_VOID,  C_SLAB,  smoothstep(0.00, 0.18, t));
  c = mix(c, C_CRETE, smoothstep(0.18, 0.62, t));
  c = mix(c, C_DUST,  smoothstep(0.62, 0.84, t));
  c = mix(c, C_PAPER, smoothstep(0.84, 1.00, t));
  return c;
}

void main(){
  vec2 res = uRes;
  float asp = res.x / max(res.y, 1.0);
  vec2 st = gl_FragCoord.xy / res;                 // 0..1, y up
  vec2 q  = (gl_FragCoord.xy - 0.5 * res) / res.y; // centred, y up

  float t = uTime;

  // pointer into q-space (uPtr is y-down)
  vec2 ptr = vec2((uPtr.x - 0.5) * asp, 0.5 - uPtr.y);

  // ---- the light source: a spot hung high and to the left of frame.
  //      Quasi-periodic drift — irrational frequency ratios, never loops.
  vec2 lp = vec2(-0.34 + 0.085 * sin(t * 0.0611) + 0.041 * sin(t * 0.1571 + 1.7),
                  0.92 + 0.055 * sin(t * 0.0431 + 0.9));

  vec2 dl   = q - lp;
  float dst = length(dl);
  vec2 ld   = -dl / max(dst, 1e-4);                // unit vector toward light

  // cone axis: base sweep, then warped toward the pointer. This is the
  // pointer-reactive commitment — heavy JS smoothing keeps it hypnotic.
  vec2 toP  = ptr - lp;
  float axP = atan(toP.x, -toP.y);
  float axB = -0.30 + 0.115 * sin(t * 0.0233 + 0.4) + 0.055 * sin(t * 0.0757 + 2.6);
  float axis = mix(axB, axP, 0.62);

  float ang = atan(dl.x, -dl.y) - axis;
  float cone = exp(-(ang * ang) / 0.115);
  float fall = 1.0 / (1.0 + 2.05 * dst * dst);
  float light = cone * fall;
  light *= smoothstep(0.02, 0.30, dst);            // no hot point at the source

  // ---- the concrete. bounded domain: slow rotation + bounded sine drift.
  vec2 p = rot(q * 3.35, t * 0.0011);
  p += vec2(0.42 * sin(t * 0.0137) + 0.19 * sin(t * 0.0349 + 2.2),
            0.33 * sin(t * 0.0181 + 1.1) + 0.16 * sin(t * 0.0281 + 0.3));

  // a whisper of pointer displacement in the slab itself
  vec2 dp = q - ptr;
  float grip = exp(-dot(dp, dp) * 5.5);
  p += dp * grip * 0.16;

  float n0 = vn(p * 0.92);                          // broad trowel mottle
  p += (n0 - 0.5) * vec2(0.46, -0.31);              // domain warp: poured, not printed
  float n1 = vn(p * 2.37 + 11.3);                   // mid grain

  // fine octave sampled twice — once at p, once a hair toward the light.
  // The difference is a directional relief term: the raking-light payoff.
  float e = 0.034;
  float fa = vn(p * 5.61 + 41.7);
  float fb = vn(p * 5.61 + 41.7 + ld * e * 5.61);
  float n2 = (fa + fb) * 0.5;
  float relief = (fa - fb);

  float mat = n0 * 0.50 + n1 * 0.32 + n2 * 0.18;

  // aggregate: pebbles in the pour, only legible where the light rakes them
  float agg = aggregate(p * 13.7);
  float peb = smoothstep(0.05, 0.42, agg);          // 0 at pebble centres

  // ---- assemble luminance. Deliberately tiny range: most of the frame
  //      lives between VOID and SLAB.
  float shadowLum = 0.040 + 0.062 * mat;
  float litLum    = light * (0.155 + 0.115 * mat + 0.075 * (peb - 0.5));
  float reliefLum = light * relief * 1.05;

  float lum = shadowLum + litLum + reliefLum;

  // vignette — the unlit gallery closing in
  vec2 v = st - vec2(0.42, 0.52);
  lum *= 1.0 - 0.62 * dot(v, v) * 1.9;

  lum *= mix(0.14, 1.0, clamp(uInt, 0.0, 1.0));

  vec3 col = ramp(lum);

  // the filament's warmth, only in the very core of the cone. Extreme restraint.
  col = mix(col, C_HAZ, smoothstep(0.215, 0.315, lum) * 0.075);

  // ---- grain + dither. Non-negotiable at these luminances: without it the
  //      cone bands into visible steps on an 8-bit display.
  float g = fract(sin(dot(gl_FragCoord.xy + fract(t * 60.0) * 311.0,
                          vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  col += g * (0.0055 + 0.0125 * light);

  fragColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('field: shader compile failed\n' + log);
  }
  return sh;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ intensity?: number, reducedMotion?: boolean }} [opts]
 */
export function createField(canvas, opts = {}) {
  try {
    if (!canvas || typeof canvas.getContext !== 'function') return NOOP;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      desynchronized: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) return NOOP; // leave the element alone; the CSS fallback shows

    const prog = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('field: link failed\n' + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.useProgram(prog);

    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uPtr = gl.getUniformLocation(prog, 'uPtr');
    const uInt = gl.getUniformLocation(prog, 'uInt');

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // ---- state ----------------------------------------------------------
    const mqReduce =
      typeof matchMedia === 'function'
        ? matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    let reduced = !!opts.reducedMotion || !!(mqReduce && mqReduce.matches);
    let intensity = typeof opts.intensity === 'number' ? opts.intensity : 1;

    let scaleIdx = 0;
    let raf = 0;
    let running = false; // start() intent
    let onScreen = true;
    let pageVisible = typeof document === 'undefined' || !document.hidden;
    let dead = false;

    let time = 0; // accumulated seconds; frozen while paused
    let last = 0;

    let ptrTX = 0.5, ptrTY = 0.42; // target
    let ptrX = 0.5, ptrY = 0.42; // smoothed
    let ptrStamp = -Infinity;

    let bufW = 0, bufH = 0;

    // frame-time ladder
    let winStart = 0, winFrames = 0, winMs = 0, warm = 0;

    function sizeTo() {
      const dpr = Math.min(
        typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
        DPR_CAP
      );
      const r = canvas.getBoundingClientRect();
      const cw = r.width || canvas.clientWidth || 1;
      const ch = r.height || canvas.clientHeight || 1;
      const s = SCALE_LADDER[scaleIdx];
      const w = Math.max(1, Math.round(cw * dpr * s));
      const h = Math.max(1, Math.round(ch * dpr * s));
      if (w === bufW && h === bufH) return false;
      bufW = w;
      bufH = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      return true;
    }

    function stepDown() {
      if (scaleIdx >= SCALE_LADDER.length - 1) return;
      scaleIdx++;
      sizeTo();
    }

    function draw() {
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform2f(uRes, bufW, bufH);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uPtr, ptrX, ptrY);
      gl.uniform1f(uInt, Math.max(0, Math.min(1, intensity)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function advancePointer(nowMs) {
      // pointerless (or idle) device: the cone drifts on its own, on a
      // quasi-periodic path so it never retraces itself.
      if (nowMs - ptrStamp > POINTER_IDLE_MS) {
        const t = time;
        ptrTX = 0.5 + 0.30 * Math.sin(t * 0.0731) + 0.12 * Math.sin(t * 0.1913 + 1.3);
        ptrTY = 0.44 + 0.20 * Math.sin(t * 0.0517 + 2.1) + 0.09 * Math.sin(t * 0.1237 + 0.6);
      }
      ptrX += (ptrTX - ptrX) * POINTER_LERP;
      ptrY += (ptrTY - ptrY) * POINTER_LERP;
    }

    function frame(now) {
      raf = 0;
      if (dead) return;

      const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
      const frameMs = last ? now - last : 16;
      last = now;
      time += dt;

      advancePointer(now);
      sizeTo();
      draw();

      // ---- quality ladder: measure, don't guess -------------------------
      if (warm < 30) {
        warm++;
        winStart = now;
        winFrames = 0;
        winMs = 0;
      } else {
        winFrames++;
        winMs += frameMs;
        if (now - winStart >= LADDER_WINDOW_MS) {
          if (winFrames > 4 && winMs / winFrames > SLOW_FRAME_MS) stepDown();
          winStart = now;
          winFrames = 0;
          winMs = 0;
        }
      }

      if (shouldRun()) raf = requestAnimationFrame(frame);
    }

    function shouldRun() {
      return running && onScreen && pageVisible && !reduced && !dead;
    }

    function kick() {
      if (raf || dead) return;
      if (shouldRun()) {
        last = 0;
        raf = requestAnimationFrame(frame);
      } else if (running && reduced) {
        // one static frame, then stop
        sizeTo();
        advancePointer(performance.now());
        draw();
      }
    }

    function halt() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }

    // ---- observers ------------------------------------------------------
    let io = null;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) onScreen = en.isIntersecting;
          if (shouldRun()) kick();
          else halt();
        },
        { threshold: 0 }
      );
      io.observe(canvas);
    }

    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => {
        if (dead) return;
        if (sizeTo() && !shouldRun() && running) draw();
      });
      ro.observe(canvas);
    }

    const onVis = () => {
      pageVisible = !document.hidden;
      if (shouldRun()) kick();
      else halt();
    };
    const onWinResize = () => {
      if (dead) return;
      if (sizeTo() && !shouldRun() && running) draw();
    };
    const onReduceChange = (e) => {
      reduced = !!opts.reducedMotion || !!e.matches;
      if (reduced) {
        halt();
        if (running) kick();
      } else if (running) {
        kick();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVis, { passive: true });
    }
    if (typeof addEventListener === 'function') {
      addEventListener('resize', onWinResize, { passive: true });
    }
    if (mqReduce) {
      if (mqReduce.addEventListener) mqReduce.addEventListener('change', onReduceChange);
      else if (mqReduce.addListener) mqReduce.addListener(onReduceChange);
    }

    const onLost = (e) => {
      e.preventDefault();
      halt();
    };
    canvas.addEventListener('webglcontextlost', onLost, false);

    sizeTo();

    // ---- public interface ----------------------------------------------
    return {
      start() {
        if (dead) return;
        running = true;
        kick();
      },
      stop() {
        running = false;
        halt();
      },
      destroy() {
        if (dead) return;
        dead = true;
        running = false;
        halt();
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onVis);
        }
        if (typeof removeEventListener === 'function') {
          removeEventListener('resize', onWinResize);
        }
        if (mqReduce) {
          if (mqReduce.removeEventListener) mqReduce.removeEventListener('change', onReduceChange);
          else if (mqReduce.removeListener) mqReduce.removeListener(onReduceChange);
        }
        canvas.removeEventListener('webglcontextlost', onLost);
        try {
          gl.deleteProgram(prog);
          gl.deleteVertexArray(vao);
          const ext = gl.getExtension('WEBGL_lose_context');
          if (ext) ext.loseContext();
        } catch (_) {
          /* teardown is best-effort */
        }
      },
      setPointer(x, y) {
        if (typeof x !== 'number' || typeof y !== 'number') return;
        if (!isFinite(x) || !isFinite(y)) return;
        ptrTX = Math.max(0, Math.min(1, x));
        ptrTY = Math.max(0, Math.min(1, y));
        ptrStamp = performance.now();
        if (reduced && running) {
          // reduced motion still honours a deliberate pointer move, once
          ptrX = ptrTX;
          ptrY = ptrTY;
          draw();
        }
      },
      setIntensity(v) {
        if (typeof v !== 'number' || !isFinite(v)) return;
        intensity = Math.max(0, Math.min(1, v));
        if (reduced && running) draw();
      },
      get scale() {
        return SCALE_LADDER[scaleIdx];
      },
    };
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[field] disabled:', err && err.message ? err.message : err);
    }
    return NOOP;
  }
}

export default createField;
