// node tools/region.mjs <png> <x> <y> <w> <h> [mode]
// mode: 'avg' (default) | 'rows' (bright-row profile, for cap-height) | 'cols'
// coords are in DEVICE pixels of the png.
import fs from 'node:fs';
import zlib from 'node:zlib';

function decodePNG(path) {
  const b = fs.readFileSync(path);
  let off = 8, w = 0, h = 0, bd = 0, ct = 0; const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off), type = b.toString('ascii', off + 4, off + 8);
    const d = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++], line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, bb = prev ? prev[x] : 0, c = (prev && x >= ch) ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += bb; else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4) { const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c); }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}
const px = (im, x, y) => { const i = (y * im.w + x) * im.ch; return [im.data[i], im.data[i + 1], im.data[i + 2]]; };
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const relLum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };

const [file, X, Y, W, H, mode = 'avg', THR = '150'] = process.argv.slice(2);
const T = +THR;
const im = decodePNG(file);
const x0 = +X, y0 = +Y, w = +W, h = +H;

if (mode === 'rows' || mode === 'cols') {
  const N = mode === 'rows' ? h : w;
  const prof = [];
  for (let i = 0; i < N; i++) {
    let mx = 0, cnt = 0;
    const M = mode === 'rows' ? w : h;
    for (let j = 0; j < M; j++) {
      const p = mode === 'rows' ? px(im, x0 + j, y0 + i) : px(im, x0 + i, y0 + j);
      const L = lum(p); if (L > mx) mx = L; if (L > T) cnt++;
    }
    prof.push({ i, mx: Math.round(mx), cnt });
  }
  const on = prof.filter(p => p.cnt >= 2);
  console.log(mode, 'bright extent:', on.length ? `${on[0].i} .. ${on[on.length - 1].i}  (span ${on[on.length - 1].i - on[0].i + 1}px device / ${((on[on.length - 1].i - on[0].i + 1) / 2).toFixed(1)}px css)` : 'none');
  console.log(prof.map(p => (p.cnt >= 2 ? '#' : p.mx > 90 ? '+' : '.')).join(''));
} else {
  let sr = 0, sg = 0, sb = 0, n = 0, mnL = 999, mxL = -1, mnP = null, mxP = null;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const p = px(im, x, y); sr += p[0]; sg += p[1]; sb += p[2]; n++;
    const L = lum(p); if (L < mnL) { mnL = L; mnP = p; } if (L > mxL) { mxL = L; mxP = p; }
  }
  const avg = [sr / n, sg / n, sb / n];
  console.log(file.split('/').pop(), `[${x0},${y0} ${w}x${h}]`);
  console.log('  mean', hex(avg), 'L=' + lum(avg).toFixed(1));
  console.log('  darkest', hex(mnP), 'L=' + mnL.toFixed(1), '| brightest', hex(mxP), 'L=' + mxL.toFixed(1));
  const cr = (a, b) => { const l1 = Math.max(relLum(a), relLum(b)), l2 = Math.min(relLum(a), relLum(b)); return ((l1 + .05) / (l2 + .05)).toFixed(2); };
  console.log('  contrast(brightest vs mean bg):', cr(mxP, avg) + ':1');
}
