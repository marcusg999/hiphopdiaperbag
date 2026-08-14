import { launch, ctx, DESKTOP, STEALTH } from './pw.mjs';
import fs from 'node:fs';

const targets = [
  ['cdx', 'https://web.archive.org/cdx/search/cdx?url=hiphopdiaperbag.com*&fl=timestamp,original,statuscode&collapse=urlkey&limit=400'],
  ['home', 'https://web.archive.org/web/2023/https://www.hiphopdiaperbag.com/'],
  ['story', 'https://web.archive.org/web/2023/https://www.hiphopdiaperbag.com/our-story'],
  ['faq', 'https://web.archive.org/web/2023/https://www.hiphopdiaperbag.com/faq'],
  ['prod', 'https://web.archive.org/web/2023/https://www.hiphopdiaperbag.com/product-page/hip-hop-diaper-bag'],
];

const b = await launch(['--disable-blink-features=AutomationControlled']);
const all = {};
for (const [k, url] of targets) {
  const c = await ctx(b, DESKTOP); await c.addInitScript(STEALTH);
  const p = await c.newPage();
  try {
    const r = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await p.waitForTimeout(7000);
    for (let y = 0; y < 6000; y += 1000) { await p.evaluate(v => window.scrollTo(0, v), y); await p.waitForTimeout(500); }
    const d = await p.evaluate(() => {
      const T = s => (s || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      const imgs = [...new Set([...document.querySelectorAll('img')]
        .flatMap(i => [i.currentSrc, i.src, i.getAttribute('data-src')])
        .filter(s => s && s.startsWith('http') && !/\.svg|sprite|wayback|archive\.org\/(images|_static)/i.test(s)))];
      return { title: document.title, url: location.href, text: T(document.body.innerText).slice(0, 40000), imgs };
    });
    all[k] = { status: r && r.status(), ...d };
    console.log('\n########', k, r && r.status(), d.title);
    console.log(d.text.slice(0, 7000));
    console.log('--IMGS--'); d.imgs.slice(0, 40).forEach(u => console.log('  ', u));
  } catch (e) { console.log('\n####', k, 'ERR', String(e).split('\n')[0].slice(0, 160)); all[k] = { err: String(e).slice(0, 200) }; }
  await c.close();
}
fs.writeFileSync('refs/wayback.json', JSON.stringify(all, null, 1));
await b.close();
