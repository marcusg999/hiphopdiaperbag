/**
 * Matched capture for the blind critique.
 *
 * The point of this file is that it captures OUR page under exactly the
 * conditions refs/bar-*.png captured activetheory.net: same viewport, same
 * deviceScaleFactor, same scroll percentages, same settle time, same pointer
 * warm-up. A critique is only worth anything if the two sides differ in the
 * page and in nothing else — a wider viewport or a shorter settle would let
 * the comparison be won by the capture rig rather than by the design.
 */
import { launch, ctx, DESKTOP, MOBILE, STEALTH } from './pw.mjs';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:8080/index.html';
const local = !/^https/.test(URL);

// the exact scroll depths the bar was shot at
const DEPTHS = {
  desktop: [['s1', 0.06], ['s2', 0.15], ['s3', 0.28], ['s4', 0.45],
            ['s5', 0.62], ['s6', 0.80], ['s7', 0.95]],
  mobile:  [['s1', 0.06], ['s2', 0.15], ['s3', 0.30], ['s4', 0.48],
            ['s5', 0.66], ['s6', 0.85]],
};

fs.mkdirSync('refs', { recursive: true });
const b = await launch(['--disable-blink-features=AutomationControlled'], { local });

for (const [name, dev] of [['desktop', DESKTOP], ['mobile', MOBILE]]) {
  const c = await ctx(b, dev);
  await c.addInitScript(STEALTH);
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'load', timeout: 90000 });
  await p.waitForFunction(() => window.__vitrine && window.__vitrine.orbit.progress >= 1,
                          null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(6000);

  const W = dev.viewport.width, H = dev.viewport.height;
  // pointer warm-up: the field, cursor and motes are all pointer-driven, and a
  // cold page shows none of that. The bar was shot warm; so is this.
  for (let i = 0; i <= 22; i++) {
    await p.mouse.move(W * 0.14 + i * (W * 0.03), H * 0.78 - i * (H * 0.022), { steps: 2 });
    await p.waitForTimeout(28);
  }
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `refs/ours-${name}-01-hero.png` });

  for (const [tag, frac] of DEPTHS[name]) {
    await p.evaluate((f) => window.scrollTo({
      top: (document.body.scrollHeight - innerHeight) * f, behavior: 'instant',
    }), frac);
    await p.waitForTimeout(2200);
    await p.screenshot({ path: `refs/ours-${name}-${tag}-${Math.round(frac * 100)}pc.png` });
  }
  console.log(name, 'captured', DEPTHS[name].length + 1, 'frames');
  await c.close();
}
await b.close();
