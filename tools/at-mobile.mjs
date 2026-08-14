// node tools/at-mobile.mjs
import { launch, ctx, MOBILE, STEALTH } from './pw.mjs';
import fs from 'node:fs';

const URL = 'https://activetheory.net/work';
const SCRATCH = '/tmp/claude-0/-home-user-hiphopdiaperbag/f981e600-f7ea-5e4c-b235-5c536612c00d/scratchpad';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const b = await launch(['--disable-blink-features=AutomationControlled']);
const c = await b.newContext({ ...MOBILE, userAgent: IOS_UA, locale: 'en-US' });
await c.addInitScript(STEALTH);
const p = await c.newPage();
const t0 = Date.now();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
try {
  await p.waitForFunction(() => document.querySelector('.GLA11y .WorkPage a'), null, { timeout: 90000 });
} catch (e) { console.log('no a11y links:', String(e).slice(0, 80)); }
const ready = Date.now() - t0;
console.log('sceneReady(ms)', ready, 'title:', await p.title());
await p.waitForTimeout(9000);

const W = 390, H = 844;
const shot = n => p.screenshot({ path: `refs/bar-mobile-${n}.png` });

await shot('01-hero');

// touch drag mid-interaction
await p.touchscreen.tap(W / 2, H * 0.5).catch(() => {});
await p.waitForTimeout(1200);
await shot('02-touch');

const info = await p.evaluate(() => {
  const el = document.querySelector('.FXScroll');
  const cv = document.querySelector('.Container canvas');
  return {
    fx: el ? { max: el.scrollHeight - el.clientHeight, sh: el.scrollHeight } : null,
    spacers: [...document.querySelectorAll('.scrollElement')].map(s => s.style.height),
    canvas: cv ? { w: cv.width, h: cv.height, css: cv.style.width + 'x' + cv.style.height } : null,
    dpr: devicePixelRatio,
    bodyCls: document.documentElement.className + '|' + document.body.className,
    chat: !!document.querySelector('.ChatDOM'),
  };
});
console.log('MOBILE INFO', JSON.stringify(info));

const scrollTo = async y => { await p.evaluate(v => { const e = document.querySelector('.FXScroll'); if (e) e.scrollTop = v; }, y); };
const max = info.fx ? info.fx.max : 0;
const stops = [0.06, 0.15, 0.30, 0.48, 0.66, 0.85];
for (let i = 0; i < stops.length; i++) {
  await scrollTo(Math.round(max * stops[i]));
  await p.waitForTimeout(2600);
  await shot(`s${i + 1}-${String(Math.round(stops[i] * 100)).padStart(2, '0')}pc`);
  console.log('mobile shot', i + 1);
}

// mobile fps
await scrollTo(Math.round(max * 0.12));
await p.waitForTimeout(1800);
const fps = await p.evaluate(async () => {
  const el = document.querySelector('.FXScroll');
  const start = performance.now(); const d = []; let last = start; let y = el ? el.scrollTop : 0;
  return await new Promise(res => {
    function tick(now) {
      d.push(now - last); last = now;
      if (el) { y += 8; el.scrollTop = y; }
      if (now - start < 5000) requestAnimationFrame(tick);
      else { const s = d.slice(3).sort((a, b) => a - b); res({ avgFps: +(d.length / ((now - start) / 1000)).toFixed(1), medianMs: +s[s.length >> 1].toFixed(2), p95Ms: +s[Math.floor(s.length * .95)].toFixed(2), long: s.filter(x => x > 33.4).length }); }
    }
    requestAnimationFrame(tick);
  });
});
console.log('MOBILE FPS', JSON.stringify(fps));

const type = await p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('#Stage *')) {
    const has = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!has) continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    out.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 30), txt: el.textContent.trim().slice(0, 30), ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight, ls: cs.letterSpacing, color: cs.color, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
  }
  return out;
});
fs.writeFileSync(SCRATCH + '/at-type-mobile.json', JSON.stringify(type, null, 1));
console.log('MOBILE TYPE', JSON.stringify(type).slice(0, 1800));
fs.writeFileSync(SCRATCH + '/at-mobile-perf.json', JSON.stringify({ ready, fps, info }, null, 1));

const perf = await p.evaluate(() => {
  const rs = performance.getEntriesByType('resource');
  return { n: rs.length, transfer: rs.reduce((a, r) => a + r.transferSize, 0), decoded: rs.reduce((a, r) => a + r.decodedBodySize, 0), byType: rs.reduce((a, r) => { a[r.initiatorType] = (a[r.initiatorType] || 0) + r.transferSize; return a; }, {}) };
});
console.log('MOBILE PERF', JSON.stringify(perf));
await b.close();
console.log('DONE');
