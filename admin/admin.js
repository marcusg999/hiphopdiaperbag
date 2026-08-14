/**
 * VITRINE — back office.
 *
 * No build step, no dependencies, no backend. It reads ../content.json, renders
 * a form over it, and gives you three exits: preview on the real page, download
 * the new JSON, or (optionally) commit it to GitHub from this browser.
 *
 * Nothing here writes to the page's own source. The landing page keeps working
 * whether or not this editor has ever been opened.
 */

const SRC = '../content.json';
const PAGE = '../index.html';
const PREVIEW_KEY = 'vitrine:preview';
const TOKEN_KEY = 'vitrine:gh-token';

const REPO = 'marcusg999/hiphopdiaperbag';
const BRANCH = 'main';

const MAX_DIM = 2000;      // longest edge, px
const WEBP_QUALITY = 0.82;
const SIZE_WARN = 500 * 1024;

/* ------------------------------------------------------------------ state */

let original = null;   // as loaded from disk
let doc = null;        // working copy
const images = new Map(); // json path -> { blob, url, bytes, sourceName, type }

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ------------------------------------------------------------------ paths */

const isIndex = (s) => /^\d+$/.test(s);

function getPath(obj, path) {
  let cur = obj;
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

function setPath(obj, path, value) {
  const segs = path.split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) cur = cur[segs[i]];
  cur[segs[segs.length - 1]] = value;
}

const clone = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------------ labels */

function humanize(key) {
  if (key == null) return '';
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
const singular = (s) => s.replace(/ies$/, 'y').replace(/s$/, '');

/** A label a human can read, given the path segments. The section name is
    already the heading above, so segment 0 is dropped. */
function labelFor(segs) {
  const n = segs.length;
  const last = segs[n - 1];
  const prev = segs[n - 2];
  if (isIndex(last)) return `${singular(humanize(prev))} ${Number(last) + 1}`;

  const base = LABEL_ALIASES[last] || humanize(last);
  if (n <= 2) return base;
  if (isIndex(prev)) {
    return `${singular(humanize(segs[n - 3]))} ${Number(prev) + 1} — ${base.toLowerCase()}`;
  }
  const mids = humanize(segs.slice(1, n - 1).filter((s) => !isIndex(s)).join(' '));
  if (!mids) return base;
  if (mids.toLowerCase().endsWith(base.toLowerCase())) return mids;
  return `${mids} — ${base.toLowerCase()}`;
}

const SECTION_NAMES = {
  seo: 'SEO',
  topbar: 'Top bar',
  wallLabel: 'Wall label',
  pullQuote: 'Pull quote',
  featureStrip: 'Feature strip',
  spec: 'Spec column',
  drop: 'The drop card',
  cta: 'The buy block',
  instagram: 'Instagram',
};

const LABEL_ALIASES = {
  src: 'Image',
  alt: 'Alt text',
  url: 'Link',
  caption: 'Caption',
};

const SECTION_NOTES = {
  seo: 'Browser tab and search-result text. Not visible on the page itself.',
  topbar: 'The line across the very top of the page.',
  hero: 'The first screen: eyebrow, the three-line headline, the paragraph under it.',
  wallLabel: 'The museum wall label beside the bag.',
  pullQuote: 'The magazine quote and the gallery photograph.',
  featureStrip: 'The row of numbers under the quote.',
  spec: 'The pinned column: heading, photo, and the fifteen-pocket list.',
  evidence: 'The four review figures — photo, quote, who said it.',
  drop: 'The notification card — the one you can dismiss.',
  founder: 'Why it exists, in the founder\'s words.',
  instagram: 'The feed strip: handle, six tiles, follow link.',
  cta: 'The buy block at the bottom.',
  footer: 'The last line on the page.',
};

/* ------------------------------------------------------------------ images */

const isImagePath = (v) =>
  typeof v === 'string' && /^assets\/.+\.(webp|png|jpe?g|avif|gif)$/i.test(v);

const assetURL = (p) => (/^(https?:)?\/\//.test(p) ? p : `../${p}`);
const basename = (p) => String(p).split('/').pop();

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** FileReader -> Image -> canvas downscale -> WebP blob. */
function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('could not read that file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('that file is not an image the browser can open'));
      img.onload = () => {
        const w0 = img.naturalWidth || img.width;
        const h0 = img.naturalHeight || img.height;
        if (!w0 || !h0) return reject(new Error('image has no dimensions'));
        const scale = Math.min(1, MAX_DIM / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        // Some iOS Safari versions ignore the requested webp type and hand
        // back a PNG instead, which for a 2000px photo is several megabytes.
        // Detect that and re-encode as JPEG, which every browser supports and
        // which lands around a tenth of the size.
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('the browser refused to encode that image'));
          if (blob.type === 'image/webp') {
            return resolve({ blob, width: w, height: h, from: [w0, h0] });
          }
          canvas.toBlob((jpg) => {
            const out = (jpg && jpg.type === 'image/jpeg' && jpg.size < blob.size) ? jpg : blob;
            resolve({ blob: out, width: w, height: h, from: [w0, h0] });
          }, 'image/jpeg', WEBP_QUALITY);
        }, 'image/webp', WEBP_QUALITY);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------------ dirty */

function isDirty() {
  return images.size > 0 || JSON.stringify(doc) !== JSON.stringify(original);
}

function refreshState() {
  const bar = $('#bar');
  const dirty = isDirty();
  bar.classList.toggle('is-dirty', dirty);
  const bits = [`content.json v${doc && doc.version != null ? doc.version : '?'}`];
  bits.push(dirty ? 'unsaved changes' : 'no changes');
  if (images.size) bits.push(`${images.size} image${images.size > 1 ? 's' : ''} queued`);
  $('#statetext').textContent = bits.join('  /  ');

  const note = $('#export-imgs');
  if (!images.size) {
    note.textContent = 'No images changed, so there is nothing else to copy across.';
  } else {
    const names = [...images.keys()].map((p) => basename(getPath(doc, p))).join(', ');
    note.textContent =
      `${images.size} image${images.size > 1 ? 's' : ''} to copy: ${names}. ` +
      'Download them, then drop them into the project\'s assets/img/ folder, ' +
      'overwriting the files of the same name.';
  }
}

/* ------------------------------------------------------------------ fields */

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

function markChanged(wrap, path) {
  const changed = JSON.stringify(getPath(doc, path)) !== JSON.stringify(getPath(original, path))
    || images.has(path);
  wrap.classList.toggle('is-changed', changed);
}

function textField(path, segs, value) {
  const wrap = el('div', 'field');
  wrap.dataset.path = path;

  const meta = el('div', 'field__meta');
  const label = el('label', 'field__label', labelFor(segs));
  const id = `f-${path.replace(/\./g, '-')}`;
  label.setAttribute('for', id);
  meta.append(label, el('code', 'field__path', path));

  const body = el('div');
  const long = typeof value === 'string' && (value.length > 68 || value.includes('\n'));
  const input = long ? el('textarea') : el('input');
  input.id = id;
  if (!long) input.type = 'text';
  input.value = String(value);
  input.spellcheck = true;

  const numeric = typeof value === 'number';
  input.addEventListener('input', () => {
    setPath(doc, path, numeric ? (Number(input.value) || 0) : input.value);
    if (long) autoGrow(input);
    markChanged(wrap, path);
    refreshState();
  });

  body.append(input);
  if (long) requestAnimationFrame(() => autoGrow(input));
  wrap.append(meta, body);
  return wrap;
}

function imageField(path, segs, value) {
  const wrap = el('div', 'field');
  wrap.dataset.path = path;

  const meta = el('div', 'field__meta');
  meta.append(el('label', 'field__label', labelFor(segs)), el('code', 'field__path', path));

  const body = el('div', 'imgfield');
  const thumb = el('img', 'thumb');
  thumb.alt = '';
  thumb.loading = 'lazy';
  thumb.src = assetURL(value);

  const side = el('div', 'imgfield__body');
  const pathInput = el('input');
  pathInput.type = 'text';
  pathInput.value = value;
  pathInput.addEventListener('input', () => {
    setPath(doc, path, pathInput.value);
    if (!images.has(path)) thumb.src = assetURL(pathInput.value);
    markChanged(wrap, path);
    refreshState();
  });

  const file = el('input');
  file.type = 'file';
  file.accept = 'image/*';
  const pick = el('button', 'tiny', 'Replace image');
  pick.type = 'button';
  pick.addEventListener('click', () => file.click());

  const size = el('span', 'filesize', '');
  const clear = el('button', 'tiny', 'Undo image');
  clear.type = 'button';
  clear.hidden = true;

  const row = el('div', 'imgfield__row');
  row.append(pick, clear, size, file);

  const hint = el('p', 'hint', `Downscaled to ${MAX_DIM}px on the longest edge and re-encoded as WebP.`);

  clear.addEventListener('click', () => {
    const entry = images.get(path);
    if (entry) URL.revokeObjectURL(entry.url);
    images.delete(path);
    setPath(doc, path, getPath(original, path));
    pathInput.value = getPath(doc, path);
    thumb.src = assetURL(pathInput.value);
    size.textContent = '';
    size.classList.remove('over');
    clear.hidden = true;
    markChanged(wrap, path);
    refreshState();
  });

  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    size.textContent = 'encoding…';
    size.classList.remove('over');
    try {
      const out = await processImage(f);
      const entry = images.get(path);
      if (entry) URL.revokeObjectURL(entry.url);

      // Keep the target path, but the file is WebP now, so the extension follows.
      const target = String(getPath(doc, path)).replace(/\.[a-z0-9]+$/i, '.webp');
      setPath(doc, path, target);
      pathInput.value = target;

      const url = URL.createObjectURL(out.blob);
      images.set(path, { blob: out.blob, url, bytes: out.blob.size, sourceName: f.name, type: out.blob.type });
      thumb.src = url;

      const over = out.blob.size > SIZE_WARN;
      size.classList.toggle('over', over);
      size.textContent =
        `${out.width}×${out.height} · ${fmtBytes(out.blob.size)}` +
        (over ? ' · OVER 500 KB — use a smaller source' : '') +
        (out.blob.type !== 'image/webp' ? ` · warning: encoded as ${out.blob.type}` : '');
      clear.hidden = false;
      markChanged(wrap, path);
      refreshState();
      toast(over ? 'Image added — but it is heavy' : 'Image encoded');
    } catch (err) {
      size.classList.add('over');
      size.textContent = String(err.message || err);
    }
  });

  side.append(pathInput, row, hint);
  body.append(thumb, side);
  wrap.append(meta, body);
  return wrap;
}

/* ------------------------------------------------------------------ render */

function renderInto(container, node, segs) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => renderInto(container, v, segs.concat(String(i))));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) renderInto(container, v, segs.concat(k));
    return;
  }
  if (typeof node !== 'string' && typeof node !== 'number') return;
  const path = segs.join('.');
  container.append(isImagePath(node) ? imageField(path, segs, node) : textField(path, segs, node));
}

function buildForm() {
  const form = $('#form');
  const rail = $('#rail');
  const meta = $('#metafields');
  form.textContent = '';
  rail.textContent = '';
  meta.textContent = '';

  const keys = Object.keys(doc).filter((k) => k !== '_readme');
  let n = 0;

  for (const key of keys) {
    const value = doc[key];

    // top-level scalars (version) are document bookkeeping, not page copy
    if (value === null || typeof value !== 'object') {
      meta.append(textField(key, [key], value));
      continue;
    }

    const id = `sec-${key}`;
    const sec = el('section', 'sec');
    sec.id = id;

    n += 1;
    const head = el('div', 'sec__h');
    head.append(
      el('p', 'placard', String(n).padStart(2, '0')),
      el('h2', null, SECTION_NAMES[key] || humanize(key)),
    );
    sec.append(head);

    if (SECTION_NOTES[key]) {
      const note = el('p', 'hint', SECTION_NOTES[key]);
      note.style.margin = '-14px 0 22px';
      sec.append(note);
    }

    renderInto(sec, value, [key]);
    if (!sec.querySelector('.field')) continue;
    form.append(sec);

    const li = el('li');
    const a = el('a', null, SECTION_NAMES[key] || humanize(key));
    a.href = `#${id}`;
    const count = el('span', 'count', `  ${sec.querySelectorAll('.field').length}`);
    a.append(count);
    li.append(a);
    rail.append(li);
  }

  // the two static panels get rail entries too
  for (const [href, name] of [['#sec-export', 'Export'], ['#sec-publish', 'Publish']]) {
    const li = el('li');
    const a = el('a', null, name);
    a.href = href;
    li.append(a);
    rail.append(li);
  }

  // renumber the static panels so the sequence continues
  $('#sec-export').querySelector('.placard').textContent = String(n + 1).padStart(2, '0');
  $('#sec-publish').querySelector('.placard').textContent = String(n + 2).padStart(2, '0');
}

/* ------------------------------------------------------------------ toast */

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-up');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-up'), 2600);
}

function logLine(target, msg, cls) {
  const line = el('div', cls || null, msg);
  $(target).append(line);
  $(target).scrollTop = $(target).scrollHeight;
}

/* ------------------------------------------------------------------ exits */

function previewDoc() {
  // Swap in blob URLs so unsaved images show up on the page too. They stay
  // valid as long as this tab is open, which is exactly the preview's lifetime.
  const out = clone(doc);
  for (const [path, entry] of images) setPath(out, path, entry.url);
  return out;
}

function doPreview() {
  try {
    sessionStorage.setItem(PREVIEW_KEY, JSON.stringify(previewDoc()));
  } catch (err) {
    toast('Could not store the preview');
    return;
  }
  window.open(PAGE, '_blank', 'noopener=no');
  toast('Preview opened in a new tab');
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function serialize() {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function exportJSON() {
  download(new Blob([serialize()], { type: 'application/json' }), 'content.json');
  logLine('#export-log', '↓ content.json — replace the one next to index.html', 'ok');
  toast('content.json downloaded');
}

function exportImages() {
  if (!images.size) {
    logLine('#export-log', 'No images changed.', 'ok');
    return;
  }
  let i = 0;
  for (const [path, entry] of images) {
    const name = basename(getPath(doc, path));
    setTimeout(() => download(entry.blob, name), i * 350); // browsers throttle bursts
    logLine('#export-log', `↓ ${name} → put it in assets/img/  (${fmtBytes(entry.bytes)})`, 'ok');
    i += 1;
  }
  toast(`${images.size} image${images.size > 1 ? 's' : ''} downloading`);
}

/* ------------------------------------------------------------------ github */

function b64FromString(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64FromBlob(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('could not read the image back'));
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.readAsDataURL(blob);
  });
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function ghSha(path, token) {
  const url = `https://api.github.com/repos/${REPO}/contents/${encodeURI(path)}?ref=${BRANCH}`;
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (res.status === 404) return null;            // new file
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 403) {
      throw new Error(
        `403 on ${path} — ${body.message || res.statusText}. The token cannot read `
        + `this repo. Give it Contents: Read and write on ${REPO}.`);
    }
    throw new Error(`${res.status} on ${path} — ${body.message || res.statusText}`);
  }
  const json = await res.json();
  return json && json.sha ? json.sha : null;
}

async function ghPut(path, contentB64, message, token) {
  const sha = await ghSha(path, token);
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: contentB64,
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 403 || res.status === 404) {
    throw new Error(
      `${res.status} — ${body.message || res.statusText}. `
      + 'This is the token, not the file. A fine-grained token needs '
      + 'Repository access covering ' + REPO + ' AND Permissions → Repository '
      + 'permissions → Contents set to "Read and write". A classic token needs '
      + 'the full "repo" scope. Re-issue it, then paste the new one above.');
  }
  if (!res.ok) throw new Error(`${res.status} — ${body.message || res.statusText}`);
  return { sha, commit: body.commit && body.commit.sha ? body.commit.sha.slice(0, 7) : '—' };
}

async function publish() {
  const token = $('#gh-token').value.trim();
  if (!token) {
    logLine('#publish-log', 'No token pasted. Export above works without one.', 'bad');
    return;
  }
  localStorage.setItem(TOKEN_KEY, token);

  const btn = $('#btn-publish');
  btn.disabled = true;
  logLine('#publish-log', `→ ${REPO}@${BRANCH}`, 'ok');

  try {
    for (const [path, entry] of images) {
      const target = getPath(doc, path);
      logLine('#publish-log', `… ${target} (${fmtBytes(entry.bytes)})`);
      const res = await ghPut(target, await b64FromBlob(entry.blob),
        `Update ${basename(target)} from the back office`, token);
      logLine('#publish-log', `✓ ${target} ${res.sha ? 'updated' : 'created'} — commit ${res.commit}`, 'ok');
    }

    logLine('#publish-log', '… content.json');
    const res = await ghPut('content.json', b64FromString(serialize()),
      'Update content.json from the back office', token);
    logLine('#publish-log', `✓ content.json updated — commit ${res.commit}`, 'ok');
    logLine('#publish-log', 'Done. GitHub Pages usually rebuilds within a minute.', 'ok');

    // committed state is now the baseline
    for (const entry of images.values()) URL.revokeObjectURL(entry.url);
    images.clear();
    original = clone(doc);
    document.querySelectorAll('.field.is-changed').forEach((f) => f.classList.remove('is-changed'));
    refreshState();
    toast('Published');
  } catch (err) {
    logLine('#publish-log', `✗ ${String(err.message || err)}`, 'bad');
    toast('Publish failed — see the log');
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  try {
    const res = await fetch(SRC, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    original = await res.json();
    if (!original || typeof original !== 'object') throw new Error('not a JSON object');
  } catch (err) {
    $('#statetext').textContent = `Could not load content.json — ${String(err.message || err)}`;
    $('#form').append(el('p', 'hint',
      'Open this page through a web server (python3 -m http.server 8080) rather than as a file:// URL.'));
    return;
  }

  doc = clone(original);
  buildForm();
  refreshState();

  $('#btn-preview').addEventListener('click', doPreview);
  $('#btn-export').addEventListener('click', () => {
    exportJSON();
    if (images.size) exportImages();
    $('#sec-export').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#btn-export-json').addEventListener('click', exportJSON);
  $('#btn-export-images').addEventListener('click', exportImages);
  $('#btn-revert').addEventListener('click', () => {
    if (isDirty() && !confirm('Throw away every change since this page loaded?')) return;
    for (const entry of images.values()) URL.revokeObjectURL(entry.url);
    images.clear();
    doc = clone(original);
    buildForm();
    refreshState();
    toast('Reverted');
  });
  $('#btn-publish').addEventListener('click', publish);
  $('#btn-forget').addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    $('#gh-token').value = '';
    logLine('#publish-log', 'Token forgotten on this browser.', 'ok');
    toast('Token forgotten');
  });

  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) {
    $('#gh-token').value = saved;
    logLine('#publish-log', 'A token is remembered in this browser.', 'ok');
  }

  addEventListener('beforeunload', (e) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // Debug hook, mirroring window.__vitrine on the page itself.
  window.__admin = {
    get doc() { return doc; },
    get dirty() { return isDirty(); },
    images,
    setField(path, value) {
      const field = document.querySelector(`.field[data-path="${CSS.escape(path)}"]`);
      const input = field && field.querySelector('input[type="text"], textarea');
      if (!input) return false;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    preview: doPreview,
    previewDoc,
  };
}

boot();
