// node tools/at-mobile2.mjs — clean mobile scroll journey, no taps
import { launch, MOBILE, STEALTH } from './pw.mjs';
import fs from 'node:fs';
const URL = 'https://activetheory.net/work';
const SCRATCH = '/tmp/claude-0/-home-user-hiphopdiaperbag/f981e600-f7ea-5e4c-b235-5c536612c00d/scratchpad';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const b = await launch(['--disable-blink-features=AutomationControlled']);
const c = await b.newContext({ ...MOBILE, userAgent: IOS_UA, locale: 'en-US' });
await c.addInitScript(STEALTH);
const p = await c.newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForFunction(() => document.querySelector('.GLA11y .WorkPage a'), null, { timeout: 90000 });
await p.waitForTimeout(13000);
const shot = n => p.screenshot({ path: `refs/bar-mobile-${n}.png` });

let buf = null;
for (let i = 0; i < 10; i++) { await p.waitForTimeout(1400); buf = await p.screenshot(); console.log('hero try', i, buf.length); if (buf.length > 900000) break; }
fs.writeFileSync('refs/bar-mobile-01-hero.png', buf);

// type metrics BEFORE any interaction
const type = await p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('#Stage *')) {
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    out.push({ cls: (el.className || '').toString().slice(0, 24), txt: el.textContent.trim().slice(0, 28), fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight, ls: cs.letterSpacing, color: cs.color, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
  }
  const w = document.querySelector('.ChatDOM .wrapper');
  const ta = document.querySelector('.ChatDOM textarea');
  const cw = w && getComputedStyle(w), ct = ta && getComputedStyle(ta);
  return { out, wrapper: cw && { mix: cw.mixBlendMode, rect: [...['x', 'y', 'width', 'height'].map(k => Math.round(w.getBoundingClientRect()[k]))] }, input: ct && { border: ct.border, radius: ct.borderRadius, bg: ct.backgroundColor, fs: ct.fontSize, rect: [...['x', 'y', 'width', 'height'].map(k => Math.round(ta.getBoundingClientRect()[k]))] } };
});
fs.writeFileSync(SCRATCH + '/at-type-mobile.json', JSON.stringify(type, null, 1));
console.log('MOBILE TYPE', JSON.stringify(type).slice(0, 2200));

const max = await p.evaluate(() => { const e = document.querySelector('.FXScroll'); return e.scrollHeight - e.clientHeight; });
console.log('maxScroll', max);
const stops = [0.05, 0.14, 0.30, 0.50, 0.70, 0.90];
for (let i = 0; i < stops.length; i++) {
  await p.evaluate(v => { document.querySelector('.FXScroll').scrollTop = v; }, Math.round(max * stops[i]));
  await p.waitForTimeout(3000);
  await shot(`s${i + 1}-${String(Math.round(stops[i] * 100)).padStart(2, '0')}pc`);
  console.log('shot', i + 1, stops[i]);
}
// mobile fps
await p.evaluate(v => { document.querySelector('.FXScroll').scrollTop = v; }, Math.round(max * 0.1));
await p.waitForTimeout(1500);
const fps = await p.evaluate(async () => {
  const el = document.querySelector('.FXScroll'); const st = performance.now(); const d = []; let last = st, y = el.scrollTop;
  return await new Promise(r => { function t(n) { d.push(n - last); last = n; y += 6; el.scrollTop = y; if (n - st < 5000) requestAnimationFrame(t); else { const s = d.slice(3).sort((a, b) => a - b); r({ avgFps: +(d.length / ((n - st) / 1000)).toFixed(2), medianMs: +s[s.length >> 1].toFixed(1) }); } } requestAnimationFrame(t); });
});
console.log('MOBILE FPS', JSON.stringify(fps));
const perf = await p.evaluate(() => { const rs = performance.getEntriesByType('resource'); return { n: rs.length, transferMB: +(rs.reduce((a, r) => a + r.transferSize, 0) / 1048576).toFixed(2), decodedMB: +(rs.reduce((a, r) => a + r.decodedBodySize, 0) / 1048576).toFixed(2), media: rs.filter(r => /mp4/.test(r.name)).map(r => [r.name.split('/').pop(), +(r.transferSize / 1048576).toFixed(2)]) }; });
console.log('MOBILE PERF', JSON.stringify(perf));
fs.writeFileSync(SCRATCH + '/at-mobile-perf.json', JSON.stringify({ fps, perf, max }, null, 1));
await b.close();
console.log('DONE');
