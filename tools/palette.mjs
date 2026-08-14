// node tools/palette.mjs <png...>  -> dominant colours + luminance split. Pure-node PNG decode.
import fs from 'node:fs';
import zlib from 'node:zlib';

function decodePNG(path) {
  const b = fs.readFileSync(path);
  let off = 8, w = 0, h = 0, bd = 0, ct = 0, idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bd !== 8) throw new Error('bitDepth ' + bd);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const bb = prev ? prev[x] : 0;
      const c = (prev && x >= ch) ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += bb;
      else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4) { const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c); }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

for (const f of process.argv.slice(2)) {
  const im = decodePNG(f);
  const step = Math.max(1, Math.round(im.w / 480)); // sample grid
  const bins = new Map();
  let n = 0, lumSum = 0, dark = 0, mid = 0, bright = 0;
  const hueBins = new Array(12).fill(0);
  let satSum = 0;
  for (let y = 0; y < im.h; y += step) for (let x = 0; x < im.w; x += step) {
    const i = (y * im.w + x) * im.ch;
    const r = im.data[i], g = im.data[i + 1], b = im.data[i + 2];
    n++;
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumSum += L;
    if (L < 20) dark++; else if (L < 110) mid++; else bright++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const s = mx ? (mx - mn) / mx : 0; satSum += s;
    if (mx - mn > 18) {
      let hu;
      if (mx === r) hu = ((g - b) / (mx - mn) + 6) % 6;
      else if (mx === g) hu = (b - r) / (mx - mn) + 2;
      else hu = (r - g) / (mx - mn) + 4;
      hueBins[Math.floor(hu * 2) % 12]++;
    }
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = bins.get(k) || [0, 0, 0, 0];
    e[0]++; e[1] += r; e[2] += g; e[3] += b; bins.set(k, e);
  }
  const sorted = [...bins.values()].sort((a, b) => b[0] - a[0]);
  const top = sorted.slice(0, 8).map(e => ({ hex: hex(e[1] / e[0], e[2] / e[0], e[3] / e[0]), pct: +(100 * e[0] / n).toFixed(1) }));
  // brightest 0.1% -> the highlight/accent colour
  const bright01 = [...bins.values()].map(e => ({ L: 0.2126 * e[1] / e[0] + 0.7152 * e[2] / e[0] + 0.0722 * e[3] / e[0], hex: hex(e[1] / e[0], e[2] / e[0], e[3] / e[0]), c: e[0] })).sort((a, b) => b.L - a.L).filter(x => x.c > 2).slice(0, 4);
  console.log('\n== ' + f.split('/').pop() + `  (${im.w}x${im.h}, ${n} samples, ${bins.size} distinct 15-bit colours)`);
  console.log('  meanLum ' + (lumSum / n).toFixed(1) + '  meanSat ' + (satSum / n).toFixed(2) +
    '  | L<20 ' + (100 * dark / n).toFixed(1) + '%  L20-110 ' + (100 * mid / n).toFixed(1) + '%  L>110 ' + (100 * bright / n).toFixed(1) + '%');
  console.log('  dominant: ' + top.map(t => `${t.hex} ${t.pct}%`).join('  '));
  console.log('  brightest: ' + bright01.map(t => t.hex).join(' '));
  // cumulative: how many colours to cover 80%
  let acc = 0, k80 = 0;
  for (const e of sorted) { acc += e[0]; k80++; if (acc / n > 0.8) break; }
  console.log('  colours to cover 80% of pixels: ' + k80);
}
