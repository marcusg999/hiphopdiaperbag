// node tools/at-hero.mjs  — retry until a non-black hero frame is captured
import { launch, ctx, DESKTOP, STEALTH } from './pw.mjs';
import fs from 'node:fs';

const URL = 'https://activetheory.net/work';
const b = await launch(['--disable-blink-features=AutomationControlled']);
const c = await ctx(b, DESKTOP);
await c.addInitScript(STEALTH);
const p = await c.newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForFunction(() => document.querySelector('.GLA11y .WorkPage a'), null, { timeout: 90000 });
console.log('title:', await p.title());
await p.waitForTimeout(14000);

// nudge the pointer so the scene stays alive, then retry until the frame has content
let buf = null;
for (let i = 0; i < 14; i++) {
  await p.mouse.move(720 + Math.sin(i) * 300, 450 + Math.cos(i) * 200, { steps: 4 });
  await p.waitForTimeout(1500);
  buf = await p.screenshot();
  console.log('attempt', i, 'bytes', buf.length);
  if (buf.length > 900000) break;
}
fs.writeFileSync('refs/bar-desktop-01-hero.png', buf);

// a second, wider-framed hero once the carousel advances
await p.waitForTimeout(6000);
await p.mouse.move(400, 300, { steps: 20 });
await p.waitForTimeout(1200);
await p.mouse.move(1100, 620, { steps: 30 });
await p.waitForTimeout(1600);
const b2 = await p.screenshot();
if (b2.length > 900000) fs.writeFileSync('refs/bar-desktop-04-heroalt.png', b2);
console.log('alt bytes', b2.length);

// --- nav pill / chat UI computed styles, precisely ---
const ui = await p.evaluate(() => {
  const g = (sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return { sel, txt: el.textContent.trim().slice(0, 40), ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight, ls: cs.letterSpacing, lh: cs.lineHeight, color: cs.color, bg: cs.backgroundColor, border: cs.border, radius: cs.borderRadius, pad: cs.padding, rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], op: cs.opacity, tt: cs.textTransform };
  };
  return {
    chatP: g('.ChatDOM .messages p'),
    chatA: g('.ChatDOM .messages a'),
    input: g('.ChatDOM textarea.input'),
    wrapper: g('.ChatDOM .wrapper'),
    msgs: g('.ChatDOM .messages'),
    allChatCSS: (() => { let t = ''; for (const s of document.styleSheets) { try { for (const r of s.cssRules) if (/ChatDOM|Cookie|MusicPlayer|closeButton/.test(r.cssText)) t += r.cssText + '\n'; } catch {} } return t; })(),
  };
});
fs.writeFileSync('/tmp/claude-0/-home-user-hiphopdiaperbag/f981e600-f7ea-5e4c-b235-5c536612c00d/scratchpad/at-ui.json', JSON.stringify(ui, null, 1));
console.log(JSON.stringify({ ...ui, allChatCSS: undefined }, null, 1));
console.log('--- CSS ---\n' + ui.allChatCSS.slice(0, 4000));
await b.close();
console.log('DONE');
