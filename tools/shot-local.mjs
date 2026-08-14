import { launch, ctx, DESKTOP, MOBILE, STEALTH } from './pw.mjs';
import fs from 'node:fs';

const tag = process.argv[2] || 'v1';
const scrolls = Number(process.argv[3] ?? 4);
const url = process.argv[4] || 'http://127.0.0.1:8080/index.html';

fs.mkdirSync('shots', { recursive: true });
const b = await launch(['--disable-blink-features=AutomationControlled'], { local: true });
const errs = [];

for (const [name, dev] of [['desktop', DESKTOP], ['mobile', MOBILE]]) {
  const c = await ctx(b, dev);
  await c.addInitScript(STEALTH);
  const p = await c.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errs.push(`[${name}] ${m.text().slice(0, 220)}`); });
  p.on('pageerror', (e) => errs.push(`[${name}] PAGEERROR ${String(e).slice(0, 260)}`));
  try {
    await p.goto(url, { waitUntil: 'load', timeout: 60000 });
    await p.waitForTimeout(4500);
    await p.mouse.move(dev.viewport.width * 0.62, dev.viewport.height * 0.45, { steps: 20 });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `shots/${tag}-${name}-0.png` });
    for (let i = 1; i <= scrolls; i++) {
      await p.evaluate((h) => window.scrollBy(0, h * 0.92), dev.viewport.height);
      await p.waitForTimeout(1700);
      await p.screenshot({ path: `shots/${tag}-${name}-${i}.png` });
    }
    const diag = await p.evaluate(() => ({
      init: !!window.__vitrine,
      frames: window.__vitrine ? Math.round(window.__vitrine.orbit.progress * 100) + '%' : null,
      fieldScale: window.__vitrine && window.__vitrine.field ? window.__vitrine.field.scale : null,
      docH: Math.round(document.body.scrollHeight),
      fonts: document.fonts ? document.fonts.status : 'n/a',
    }));
    console.log(name, JSON.stringify(diag));
  } catch (e) {
    console.log(name, 'ERR', String(e).split('\n')[0].slice(0, 200));
  }
  await c.close();
}

console.log(errs.length ? 'CONSOLE ERRORS:\n' + errs.slice(0, 16).join('\n') : 'no console errors');
await b.close();
