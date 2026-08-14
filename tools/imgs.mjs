import { launch, ctx, DESKTOP, STEALTH } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'assets/src';
fs.mkdirSync(OUT, { recursive: true });

const amz = JSON.parse(fs.readFileSync('refs/amz.json', 'utf8'));
// full-res: strip every Amazon rendition suffix (._AC_SL1500_, ._AC_, ._SX679_ ...)
const fullres = u => u.replace(/\._[A-Z0-9_,+-]+_?\.jpg$/i, '.jpg').replace(/\.__?\.jpg$/i, '.jpg');

const targets = [];
for (const u of amz.hires) targets.push(['amz', fullres(u)]);

// Successful Black Parenting article images (confirmed in the article body)
for (const n of ['unnamed-3', 'IMG_0547', 'IMG_0546', 'unnamed-1']) {
  targets.push(['sbp', `https://successfulblackparenting.com/wp-content/uploads/2019/12/${n}.jpg`]);
}
// Buy Black Main Street listing images
targets.push(['bbms', 'https://www.buyblackmainstreet.com/wp-content/uploads/2021/11/242667301_815239689149198_1799608464009008904_n.jpg']);
targets.push(['bbms', 'https://www.buyblackmainstreet.com/wp-content/uploads/2021/11/255539502_545915959830856_3358330694787639813_n.jpg']);

const seen = new Set();
const b = await launch(['--disable-blink-features=AutomationControlled']);
const c = await ctx(b, DESKTOP); await c.addInitScript(STEALTH);
const p = await c.newPage();
const results = [];

for (const [src, url] of targets) {
  const id = decodeURIComponent(path.basename(url).replace(/\.jpg$/i, ''));
  const key = src + '|' + id;
  if (seen.has(key)) continue; seen.add(key);
  const file = path.join(OUT, `${src}-${id}.jpg`);
  try {
    const r = await p.request.get(url, { headers: { referer: 'https://www.amazon.com/', 'user-agent': (await p.evaluate(() => navigator.userAgent)) }, timeout: 60000 });
    if (!r.ok()) { console.log('FAIL', r.status(), url); results.push({ src, url, status: r.status() }); continue; }
    const buf = await r.body();
    fs.writeFileSync(file, buf);
    // read JPEG dimensions from SOFn marker
    let w = 0, h = 0;
    for (let i = 2; i < buf.length - 9;) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    results.push({ src, url, file, bytes: buf.length, w, h });
    console.log(`OK ${w}x${h} ${(buf.length / 1024 | 0)}KB  ${file}`);
  } catch (e) { console.log('ERR', url, String(e).slice(0, 90)); results.push({ src, url, err: String(e).slice(0, 120) }); }
}
fs.writeFileSync('refs/images.json', JSON.stringify(results, null, 1));
await b.close();
