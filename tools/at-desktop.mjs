// node tools/at-desktop.mjs
import { launch, ctx, DESKTOP, STEALTH } from './pw.mjs';
import fs from 'node:fs';

const URL = 'https://activetheory.net/work';
const SCRATCH = '/tmp/claude-0/-home-user-hiphopdiaperbag/f981e600-f7ea-5e4c-b235-5c536612c00d/scratchpad';
const b = await launch(['--disable-blink-features=AutomationControlled']);
const c = await ctx(b, DESKTOP);
await c.addInitScript(STEALTH);
const p = await c.newPage();
const t0 = Date.now();
const marks = {};
p.on('response', r => { if (/app\.\d+\.js/.test(r.url())) marks.appJs = Date.now() - t0; });

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
// wait until work titles are in the a11y DOM = scene ready
await p.waitForFunction(() => document.querySelector('.GLA11y .WorkPage a'), null, { timeout: 90000 });
marks.sceneReady = Date.now() - t0;
console.log('sceneReady(ms)', marks.sceneReady);
await p.waitForTimeout(9000);

const W = 1440, H = 900;
const shot = (n) => p.screenshot({ path: `refs/bar-desktop-${n}.png` });

// ---------- 1. hero ----------
await p.mouse.move(W / 2, H / 2);
await p.waitForTimeout(1500);
await shot('01-hero');

// ---------- 2. pointer sweep mid-interaction ----------
for (let i = 0; i <= 26; i++) {
  await p.mouse.move(140 + i * 46, 700 - i * 19, { steps: 2 });
  await p.waitForTimeout(28);
}
await shot('02-pointer');

// ---------- 3. hover a work tile (centre card) ----------
await p.mouse.move(W * 0.66, H * 0.55, { steps: 20 });
await p.waitForTimeout(900);
await p.mouse.move(W * 0.655, H * 0.545, { steps: 6 });
await p.waitForTimeout(1400);
await shot('03-tilehover');

// ---------- scroll driver on .FXScroll ----------
const scrollTo = async (px) => {
  await p.evaluate((y) => {
    const el = document.querySelector('.FXScroll');
    el.scrollTo({ top: y, behavior: 'instant' });
  }, px);
};
const maxScroll = await p.evaluate(() => {
  const el = document.querySelector('.FXScroll');
  return { max: el.scrollHeight - el.clientHeight, sh: el.scrollHeight, spacers: [...document.querySelectorAll('.scrollElement')].map(s => ({ h: s.style.height, top: s.style.top })) };
});
console.log('SCROLL', JSON.stringify(maxScroll));

const stops = [0.06, 0.15, 0.28, 0.45, 0.62, 0.80, 0.95];
for (let i = 0; i < stops.length; i++) {
  // wheel in increments so their lerp/velocity logic engages, then settle
  const target = Math.round(maxScroll.max * stops[i]);
  await scrollTo(target);
  await p.waitForTimeout(2600);
  await p.mouse.move(W * 0.5 + (i % 2 ? 180 : -180), H * 0.5 + (i % 3 ? -90 : 90), { steps: 8 });
  await p.waitForTimeout(900);
  await shot(`s${i + 1}-${String(Math.round(stops[i] * 100)).padStart(2, '0')}pc`);
  console.log('shot', i + 1, 'at', target);
}

// ---------- FPS sampling while scrolling ----------
await scrollTo(Math.round(maxScroll.max * 0.10));
await p.waitForTimeout(2000);
const fps = await p.evaluate(async () => {
  const el = document.querySelector('.FXScroll');
  const start = performance.now();
  const deltas = [];
  let last = start, y = el.scrollTop;
  return await new Promise(res => {
    function tick(now) {
      deltas.push(now - last); last = now;
      y += 9; el.scrollTop = y;
      window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 720 + Math.sin(now / 300) * 500,
        clientY: 450 + Math.cos(now / 420) * 300, bubbles: true
      }));
      if (now - start < 5000) requestAnimationFrame(tick);
      else {
        const d = deltas.slice(3).sort((a, b) => a - b);
        const pc = q => d[Math.floor(d.length * q)];
        res({
          frames: deltas.length,
          seconds: (now - start) / 1000,
          avgFps: +(deltas.length / ((now - start) / 1000)).toFixed(1),
          medianMs: +pc(0.5).toFixed(2),
          p95Ms: +pc(0.95).toFixed(2),
          worstMs: +d[d.length - 1].toFixed(2),
          longFrames_over33ms: d.filter(x => x > 33.4).length,
        });
      }
    }
    requestAnimationFrame(tick);
  });
});
console.log('FPS', JSON.stringify(fps));

// idle fps (no scroll, no pointer)
const fpsIdle = await p.evaluate(async () => {
  const start = performance.now(); const deltas = []; let last = start;
  return await new Promise(res => {
    function tick(now) {
      deltas.push(now - last); last = now;
      if (now - start < 3000) requestAnimationFrame(tick);
      else res({ avgFps: +(deltas.length / ((now - start) / 1000)).toFixed(1) });
    }
    requestAnimationFrame(tick);
  });
});
console.log('FPS_IDLE', JSON.stringify(fpsIdle));

// ---------- typography / DOM computed styles ----------
const type = await p.evaluate(() => {
  const out = [];
  const walk = document.querySelectorAll('#Stage *');
  for (const el of walk) {
    const txt = (el.childNodes.length && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) ? el.textContent.trim().slice(0, 40) : '';
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!txt && cs.fontSize === '16px' && !r.width) continue;
    out.push({
      tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), txt,
      ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight, ls: cs.letterSpacing,
      lh: cs.lineHeight, tt: cs.textTransform, color: cs.color, bg: cs.backgroundColor,
      op: cs.opacity, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      z: cs.zIndex, pos: cs.position, border: cs.border, radius: cs.borderRadius,
      transition: cs.transition.slice(0, 90), filter: cs.filter, mix: cs.mixBlendMode,
      shadow: cs.textShadow + ' | ' + cs.boxShadow,
    });
  }
  return out;
});
fs.writeFileSync(SCRATCH + '/at-type.json', JSON.stringify(type, null, 1));
console.log('TYPE NODES', type.length);

// ---------- root vars, canvas info, WebGL caps ----------
const meta = await p.evaluate(() => {
  const cv = document.querySelector('.Container canvas');
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  const ss = [...document.styleSheets].map(s => { try { return [...s.cssRules].length; } catch { return -1; } });
  let cssText = '';
  for (const s of document.styleSheets) { try { for (const r of s.cssRules) cssText += r.cssText + '\n'; } catch {} }
  return {
    dpr: devicePixelRatio,
    canvas: { attrW: cv.width, attrH: cv.height, cssW: cv.style.width, cssH: cv.style.height, ptr: cv.style.pointerEvents },
    glVersion: gl ? gl.getParameter(gl.VERSION) : null,
    maxTex: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : null,
    exts: gl ? gl.getSupportedExtensions().filter(e => /compress|float|aniso|draw_buffers|multi/i.test(e)) : [],
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
    sheets: ss,
    cssLen: cssText.length,
    fonts: [...document.fonts].map(f => f.family + ' ' + f.weight + ' ' + f.status),
    rootVars: getComputedStyle(document.documentElement).getPropertyValue('--baropacity'),
    htmlStyle: document.documentElement.getAttribute('style'),
    scrollbar: (cssText.match(/::-webkit-scrollbar[^}]*}/g) || []).join(' '),
    lenis: !!(window.Lenis || window.lenis || document.querySelector('[class*=lenis]')),
    gsap: !!window.gsap, three: !!window.THREE,
    globals: Object.keys(window).filter(k => /^[A-Z]/.test(k) && !/^(HTML|SVG|CSS|Web|XML|URL|RTC|Audio|Media|Idle|Perf|Node|Range|Event|Error|Array|Object|Uint|Int|Float|Big|Data|Promise|Proxy|Reflect|Map|Set|Weak|JSON|Math|Date|RegExp|String|Number|Boolean|Symbol|Function|Atomics|Shared|Text|Trusted|Visual|Wake|Worker|Screen|Storage|Sub|Speech|Service|Selection|Resize|Report|Remote|Push|Pointer|Plugin|Permission|Path|Page|Over|Notification|Navig|Mutation|Lock|Key|Intersection|Image|History|Headers|Gamepad|Form|File|DOM|Custom|Crypto|Credential|Console|Comment|Clipboard|Client|Cache|Blob|Battery|Barcode|Background|Attr|Animation|Abort|Broadcast|Byte|Channel|Char|Close|Compression|Content|Cookie|Count|Decompression|Delay|Device|Document|Drag|Dynamic|Element|Encoded|Focus|Font|Fragment|Gain|Geolocation|Hash|Hid|IDB|Ink|Input|Install|Iterator|Launch|Layout|Line|Location|Magnetometer|Merchant|Message|Mime|Mouse|Name|Network|Offscreen|Option|Orientation|Oscillator|Panner|Payment|Periodic|Picture|Popup|Presentation|Process|Progress|Radio|Read|Request|Response|Sanitizer|Scheduler|Script|Scroll|Security|Sensor|Serial|Shadow|Slot|Source|Speech|Stereo|Storage|Stream|Style|Task|Time|Toggle|Touch|Track|Transform|Transition|Tree|USB|User|Validity|Video|View|Wave|Wheel|Window|Worklet|Writable|Write|XPath|XSLT)/.test(k)).slice(0, 60),
  };
});
fs.writeFileSync(SCRATCH + '/at-meta.json', JSON.stringify(meta, null, 1));
console.log('META', JSON.stringify({ ...meta, globals: meta.globals, cssLen: meta.cssLen }, null, 1).slice(0, 2600));

fs.writeFileSync(SCRATCH + '/at-perf.json', JSON.stringify({ marks, fps, fpsIdle, maxScroll }, null, 1));

// nav timing + resource weights (transferSize is real)
const perf = await p.evaluate(() => {
  const rs = performance.getEntriesByType('resource').map(r => ({ n: r.name, t: r.initiatorType, ts: r.transferSize, ds: r.decodedBodySize, dur: Math.round(r.duration), start: Math.round(r.startTime) }));
  const nav = performance.getEntriesByType('navigation')[0];
  return { rs, nav: nav && { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), ttfb: Math.round(nav.responseStart) }, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime };
});
fs.writeFileSync(SCRATCH + '/at-res.json', JSON.stringify(perf, null, 1));
console.log('RES ENTRIES', perf.rs.length, 'nav', JSON.stringify(perf.nav), 'fcp', perf.fcp);

await b.close();
console.log('DONE');
