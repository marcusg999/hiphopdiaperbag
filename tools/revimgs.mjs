import { launch, ctx, DESKTOP, STEALTH } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';

// Customer "reviews with images" thumbnails seen on the listing — fetch at full res.
const ids = ['71UrhJpB+hL', '810tZYH6RcL', '713KcOTnbKL', '81ZIWfgD9jL', '71RkMgjlPhL', '71xxcbm1ycL', '81vXeq7RkYL'];

const b = await launch(['--disable-blink-features=AutomationControlled']);
const c = await ctx(b, DESKTOP); await c.addInitScript(STEALTH);
const p = await c.newPage();
const out = [];
for (const id of ids) {
  const url = `https://m.media-amazon.com/images/I/${id}.jpg`;
  const file = path.join('assets/src', `amzrev-${id}.jpg`);
  try {
    const r = await p.request.get(url, { headers: { referer: 'https://www.amazon.com/' }, timeout: 60000 });
    if (!r.ok()) { console.log('FAIL', r.status(), url); continue; }
    const buf = await r.body(); fs.writeFileSync(file, buf);
    let w = 0, h = 0;
    for (let i = 2; i < buf.length - 9;) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    out.push({ id, file, w, h, bytes: buf.length });
    console.log(`OK ${w}x${h} ${(buf.length / 1024 | 0)}KB ${file}`);
  } catch (e) { console.log('ERR', id, String(e).slice(0, 80)); }
}
await b.close();
