// node tools/at-probe.mjs
import { launch, ctx, DESKTOP, STEALTH } from './pw.mjs';
import fs from 'node:fs';

const URL = 'https://activetheory.net/work';
const b = await launch(['--disable-blink-features=AutomationControlled']);
const c = await ctx(b, DESKTOP);
await c.addInitScript(STEALTH);
const p = await c.newPage();

const reqs = [];
p.on('response', async (r) => {
  try {
    const h = r.headers();
    reqs.push({
      url: r.url(),
      status: r.status(),
      type: h['content-type'] || '',
      len: +(h['content-length'] || 0),
      rt: r.request().resourceType(),
    });
  } catch {}
});
const consoleMsgs = [];
p.on('console', m => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 200)));
p.on('pageerror', e => consoleMsgs.push('PAGEERROR: ' + String(e).slice(0, 200)));

const t0 = Date.now();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
console.log('DOMCONTENTLOADED at', Date.now() - t0);

// poll every 1s for 30s
for (let i = 0; i < 30; i++) {
  await p.waitForTimeout(1000);
  const s = await p.evaluate(() => {
    const cvs = [...document.querySelectorAll('canvas')].map(c => ({ w: c.width, h: c.height, cls: c.className, style: c.getAttribute('style')?.slice(0,80) }));
    return {
      title: document.title,
      bodyTextLen: document.body ? document.body.innerText.length : -1,
      firstText: document.body ? document.body.innerText.replace(/\s+/g,' ').slice(0, 300) : '',
      canvases: cvs,
      nodes: document.querySelectorAll('*').length,
      videos: [...document.querySelectorAll('video')].map(v=>({src:v.currentSrc||v.src, w:v.videoWidth, h:v.videoHeight, ready:v.readyState})),
      imgs: document.querySelectorAll('img').length,
      scrollH: document.documentElement.scrollHeight,
    };
  });
  console.log(`t=${((Date.now()-t0)/1000).toFixed(1)}s`, JSON.stringify(s).slice(0, 900));
  if (s.canvases.length && s.bodyTextLen > 40 && i > 12) break;
}

fs.mkdirSync('refs', { recursive: true });
await p.screenshot({ path: 'refs/_probe.png' });

// dump HTML
const html = await p.content();
fs.writeFileSync('/tmp/claude-0/-home-user-hiphopdiaperbag/f981e600-f7ea-5e4c-b235-5c536612c00d/scratchpad/at-dom.html', html);
console.log('HTML LEN', html.length);
fs.writeFileSync('/tmp/claude-0/-home-user-hiphopdiaperbag/f981e600-f7ea-5e4c-b235-5c536612c00d/scratchpad/at-net.json', JSON.stringify(reqs, null, 1));
console.log('REQS', reqs.length);
console.log('CONSOLE', consoleMsgs.slice(0, 25).join('\n'));
await b.close();
