/**
 * VITRINE — content layer.
 *
 * Static HTML first, JSON second. `index.html` ships the real, final copy as
 * ordinary markup: that is what a crawler indexes, what a printer prints, and
 * what a visitor sees if `content.json` 404s, is malformed, or is blocked. This
 * module is a *patch* applied over that markup, never the source of it. Nothing
 * here ever empties an element it cannot fill, so the failure mode is "the page
 * keeps the copy it was born with" — no flash, no blank slots, no layout jump.
 * That is the non-obvious decision: the JSON is an editing convenience for the
 * owner, not a runtime dependency of the page.
 *
 * Two ways to bind a value to the DOM:
 *   1. `data-content="hero.lede"` on the element (plus optional
 *      `data-content-attr="href|alt|src|text"`). Authoritative — wins always.
 *   2. The BINDINGS table below, which maps content paths to selectors that
 *      already exist in `index.html`. This is what lets the whole thing work
 *      without touching a single line of the page markup.
 *
 * Safety: values are written with `textContent` / `setAttribute`. `innerHTML`
 * is never used anywhere in this file. A three-tag allowlist (`<em>`, `<b>`,
 * `<br>`) is honoured by tokenising the string and building those elements by
 * hand — any other tag stays literal text on the page.
 */

export const PREVIEW_KEY = 'vitrine:preview';

/* ------------------------------------------------------------------ bindings
   path            — dotted path into content.json (numbers index arrays)
   sel             — CSS selector, first match wins
   all             — apply to every match instead of the first
   attr            — attribute to write; omit for text
   sep             — split the value on "/" and rebuild the .sep divider spans
   words           — rebuild the element's <span class="w"> kinetic words
   template        — literal string with {dotted.paths} interpolated
   A binding whose selector matches nothing is skipped in silence: sections get
   rearranged, and a missing hook must never be an error.                     */
const BINDINGS = [
  { path: 'seo.pageTitle', sel: 'title' },
  { path: 'seo.metaDescription', sel: 'meta[name="description"]', attr: 'content' },

  /* ---- topbar */
  { path: 'topbar.makerLine', sel: '.topbar .placard:not(.link)', sep: true },
  { path: 'topbar.etsyLinkLabel', sel: '.topbar a.link', attr: 'text' },
  { path: 'topbar.etsyLinkUrl', sel: '.topbar a.link', attr: 'href' },

  /* ---- hero */
  { path: 'hero.eyebrow', sel: '.placard--eyebrow', sep: true },
  { path: 'hero.headline.line1', sel: '.hero__type h1 > .line:nth-child(1)', words: true },
  { path: 'hero.headline.line2', sel: '.hero__type h1 > .line:nth-child(2)', words: true },
  { path: 'hero.headline.line3', sel: '.hero__type h1 > .line:nth-child(3)', words: true },
  { path: 'hero.lede', sel: '.hero__type .lede' },
  { sel: '.buy--hero .buy__l', template: '{hero.buyButton.label}' },
  { path: 'hero.buyButton.price', sel: '.buy--hero .buy__p' },
  { path: 'hero.buyButton.priceWas', sel: '.buy--hero .buy__was' },
  { path: 'hero.buyButton.url', sel: 'a.buy--hero', attr: 'href' },
  { path: 'hero.buyNote', sel: '.hero__cta-note', sep: true },
  { path: 'hero.dragHint', sel: '#hint' },
  { path: 'hero.handButtonLabel', sel: '#handbtn .lbl' },
  { path: 'hero.orbitAltText', sel: '#orbit', attr: 'aria-label' },
  { path: 'hero.scrollCue', sel: '.scrollcue' },

  /* ---- museum wall label */
  { path: 'wallLabel.title', sel: '.label__t' },
  { path: 'wallLabel.rows.0.term', sel: '.label__dl dt:nth-of-type(1)' },
  { path: 'wallLabel.rows.0.value', sel: '.label__dl dd:nth-of-type(1)' },
  { path: 'wallLabel.rows.1.term', sel: '.label__dl dt:nth-of-type(2)' },
  { path: 'wallLabel.rows.1.value', sel: '.label__dl dd:nth-of-type(2)' },
  { path: 'wallLabel.rows.2.term', sel: '.label__dl dt:nth-of-type(3)' },
  { path: 'wallLabel.rows.2.value', sel: '.label__dl dd:nth-of-type(3)' },
  { path: 'wallLabel.rows.3.term', sel: '.label__dl dt:nth-of-type(4)' },
  { path: 'wallLabel.rows.3.value', sel: '.label__dl dd:nth-of-type(4)' },
  { path: 'wallLabel.rows.4.term', sel: '.label__dl dt:nth-of-type(5)' },
  { path: 'wallLabel.rows.4.value', sel: '.label__dl dd:nth-of-type(5)' },
  { path: 'wallLabel.rows.5.term', sel: '.label__dl dt:nth-of-type(6)' },
  { path: 'wallLabel.rows.5.value', sel: '.label__dl dd:nth-of-type(6)' },

  /* ---- pull quote */
  { path: 'pullQuote.quote', sel: '.pull > p' },
  { path: 'pullQuote.attribution', sel: '.pull cite', sep: true },
  { path: 'pullQuote.image.src', sel: '.argument__fig img', attr: 'src' },
  { path: 'pullQuote.image.alt', sel: '.argument__fig img', attr: 'alt' },
  { path: 'pullQuote.image.caption', sel: '.argument__fig figcaption', sep: true },

  /* ---- feature strip */
  { path: 'featureStrip.items.0.figure', sel: '.strip__list li:nth-child(1) b' },
  { path: 'featureStrip.items.0.label', sel: '.strip__list li:nth-child(1) span' },
  { path: 'featureStrip.items.1.figure', sel: '.strip__list li:nth-child(2) b' },
  { path: 'featureStrip.items.1.label', sel: '.strip__list li:nth-child(2) span' },
  { path: 'featureStrip.items.2.figure', sel: '.strip__list li:nth-child(3) b' },
  { path: 'featureStrip.items.2.label', sel: '.strip__list li:nth-child(3) span' },
  { path: 'featureStrip.items.3.figure', sel: '.strip__list li:nth-child(4) b' },
  { path: 'featureStrip.items.3.label', sel: '.strip__list li:nth-child(4) span' },
  { path: 'featureStrip.items.4.figure', sel: '.strip__list li:nth-child(5) b' },
  { path: 'featureStrip.items.4.label', sel: '.strip__list li:nth-child(5) span' },

  /* ---- spec column */
  { path: 'spec.eyebrow', sel: '.spec__sticky > .placard', sep: true },
  { path: 'spec.headline.line1', sel: '.spec__sticky h2 > .line:nth-child(1)', words: true },
  { path: 'spec.headline.line2', sel: '.spec__sticky h2 > .line:nth-child(2)', words: true },
  { path: 'spec.image.src', sel: '.spec__img img', attr: 'src' },
  { path: 'spec.image.alt', sel: '.spec__img img', attr: 'alt' },
  { path: 'spec.items.0', sel: '#speclist li:nth-child(1)' },
  { path: 'spec.items.1', sel: '#speclist li:nth-child(2)' },
  { path: 'spec.items.2', sel: '#speclist li:nth-child(3)' },
  { path: 'spec.items.3', sel: '#speclist li:nth-child(4)' },
  { path: 'spec.items.4', sel: '#speclist li:nth-child(5)' },
  { path: 'spec.items.5', sel: '#speclist li:nth-child(6)' },
  { path: 'spec.items.6', sel: '#speclist li:nth-child(7)' },
  { path: 'spec.items.7', sel: '#speclist li:nth-child(8)' },
  { path: 'spec.items.8', sel: '#speclist li:nth-child(9)' },
  { path: 'spec.items.9', sel: '#speclist li:nth-child(10)' },

  /* ---- evidence figures */
  { path: 'evidence.rain.image.src', sel: '.ev--rain img', attr: 'src' },
  { path: 'evidence.rain.image.alt', sel: '.ev--rain img', attr: 'alt' },
  { path: 'evidence.rain.quote', sel: '.ev--rain blockquote p' },
  { path: 'evidence.rain.attribution', sel: '.ev--rain cite', sep: true },
  { path: 'evidence.usb.image.src', sel: '.ev--usb img', attr: 'src' },
  { path: 'evidence.usb.image.alt', sel: '.ev--usb img', attr: 'alt' },
  { path: 'evidence.usb.quote', sel: '.ev--usb blockquote p' },
  { path: 'evidence.usb.attribution', sel: '.ev--usb cite', sep: true },
  { path: 'evidence.crown.image.src', sel: '.ev--crown img', attr: 'src' },
  { path: 'evidence.crown.image.alt', sel: '.ev--crown img', attr: 'alt' },
  { path: 'evidence.crown.quote', sel: '.ev--crown blockquote p' },
  { path: 'evidence.crown.attribution', sel: '.ev--crown cite', sep: true },
  { path: 'evidence.sand.image.src', sel: '.ev--sand img', attr: 'src' },
  { path: 'evidence.sand.image.alt', sel: '.ev--sand img', attr: 'alt' },
  { path: 'evidence.sand.quote', sel: '.ev--sand blockquote p' },
  { path: 'evidence.sand.attribution', sel: '.ev--sand cite', sep: true },

  /* ---- the drop card */
  { path: 'drop.eyebrow', sel: '.drop__meta', sep: true },
  { path: 'drop.title', sel: '.drop__title' },
  { path: 'drop.body', sel: '.drop__body' },
  { path: 'drop.passButtonLabel', sel: '#droppass' },
  { path: 'drop.buyButtonLabel', sel: '#dropcop', attr: 'text' },
  { path: 'drop.buyButtonUrl', sel: '#dropcop', attr: 'href' },
  { path: 'drop.passedMessage', sel: '#droppassed' },
  { path: 'drop.aside', sel: '.drop__aside' },

  /* ---- founder */
  { path: 'founder.eyebrow', sel: '.why > .placard' },
  { path: 'founder.paragraph1', sel: '.why__q p:nth-of-type(1)' },
  { path: 'founder.paragraph2', sel: '.why__q p:nth-of-type(2)' },
  { path: 'founder.attribution', sel: '.why__q cite', sep: true },
  { path: 'founder.hashtag', sel: '.why__tag' },

  /* ---- CTA */
  { path: 'cta.eyebrow', sel: '.cta__inner > p.placard:first-child', sep: true },
  { path: 'cta.headline.line1', sel: '.cta__inner h2 > .line:nth-child(1)', words: true },
  { path: 'cta.headline.line2', sel: '.cta__inner h2 > .line:nth-child(2)', words: true },
  { sel: '.cta .buy__l', template: '{cta.button.label} — {cta.button.price}' },
  { path: 'cta.button.priceWas', sel: '.cta .buy__was' },
  { path: 'cta.button.url', sel: '.cta a.buy', attr: 'href' },
  { path: 'cta.note', sel: '.cta__note', sep: true },
  { path: 'cta.image.src', sel: '.cta__img', attr: 'src' },
  { path: 'cta.image.alt', sel: '.cta__img', attr: 'alt' },

  /* ---- instagram */
  { path: 'instagram.eyebrow', sel: '.gram__head > .placard:first-child' },
  { path: 'instagram.handle', sel: '.gram__handle', attr: 'text' },
  { path: 'instagram.profileUrl', sel: '.gram__handle', attr: 'href' },
  { path: 'instagram.subline', sel: '.gram__sub', sep: true },
  { path: 'instagram.followLabel', sel: '.gram__follow', attr: 'text' },
  { path: 'instagram.profileUrl', sel: '.gram__follow', attr: 'href' },
  { path: 'instagram.profileUrl', sel: '.gram__grid a', attr: 'href', all: true },
  { path: 'instagram.tiles.0.src', sel: '.gram__grid li:nth-child(1) img', attr: 'src' },
  { path: 'instagram.tiles.0.alt', sel: '.gram__grid li:nth-child(1) img', attr: 'alt' },
  { path: 'instagram.tiles.1.src', sel: '.gram__grid li:nth-child(2) img', attr: 'src' },
  { path: 'instagram.tiles.1.alt', sel: '.gram__grid li:nth-child(2) img', attr: 'alt' },
  { path: 'instagram.tiles.2.src', sel: '.gram__grid li:nth-child(3) img', attr: 'src' },
  { path: 'instagram.tiles.2.alt', sel: '.gram__grid li:nth-child(3) img', attr: 'alt' },
  { path: 'instagram.tiles.3.src', sel: '.gram__grid li:nth-child(4) img', attr: 'src' },
  { path: 'instagram.tiles.3.alt', sel: '.gram__grid li:nth-child(4) img', attr: 'alt' },
  { path: 'instagram.tiles.4.src', sel: '.gram__grid li:nth-child(5) img', attr: 'src' },
  { path: 'instagram.tiles.4.alt', sel: '.gram__grid li:nth-child(5) img', attr: 'alt' },
  { path: 'instagram.tiles.5.src', sel: '.gram__grid li:nth-child(6) img', attr: 'src' },
  { path: 'instagram.tiles.5.alt', sel: '.gram__grid li:nth-child(6) img', attr: 'alt' },

  /* ---- footer */
  { path: 'footer.line', sel: '.foot .placard:not(.link)', sep: true },
  { path: 'footer.etsyLinkLabel', sel: '.foot a.link', attr: 'text' },
  { path: 'footer.etsyLinkUrl', sel: '.foot a.link', attr: 'href' },
];

/* ------------------------------------------------------------------ helpers */

const isObj = (v) => v !== null && typeof v === 'object';

/** Resolve "a.b.0.c" against the document. Returns undefined, never throws. */
export function resolvePath(data, path) {
  if (typeof path !== 'string' || !path) return undefined;
  let cur = data;
  for (const key of path.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Only strings and finite numbers are writable. Everything else is ignored. */
function scalar(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/* The entire markup allowlist. Anything else stays literal text. */
const TAG_RE = /<(\/?)(em|b|br)\s*\/?>/gi;

/** Tokenise an allowlisted string into real nodes. No innerHTML, ever. */
function inlineFragment(str, doc) {
  const frag = doc.createDocumentFragment();
  if (!TAG_RE.test(str)) {
    TAG_RE.lastIndex = 0;
    frag.appendChild(doc.createTextNode(str));
    return frag;
  }
  TAG_RE.lastIndex = 0;
  const stack = [frag];
  const top = () => stack[stack.length - 1];
  let last = 0;
  let m;
  while ((m = TAG_RE.exec(str)) !== null) {
    if (m.index > last) top().appendChild(doc.createTextNode(str.slice(last, m.index)));
    last = TAG_RE.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'br') {
      if (!closing) top().appendChild(doc.createElement('br'));
    } else if (closing) {
      if (stack.length > 1) stack.pop();
    } else {
      const el = doc.createElement(tag);
      top().appendChild(el);
      stack.push(el);
    }
  }
  if (last < str.length) top().appendChild(doc.createTextNode(str.slice(last)));
  return frag;
}

/** "A / B" → A <span class="sep">/</span> B, rebuilt as nodes. */
function sepFragment(str, doc) {
  const parts = str.split(/\s*\/\s*/);
  const frag = doc.createDocumentFragment();
  parts.forEach((part, i) => {
    if (i > 0) {
      frag.appendChild(doc.createTextNode(' '));
      const sep = doc.createElement('span');
      sep.className = 'sep';
      sep.textContent = '/';
      frag.appendChild(sep);
      frag.appendChild(doc.createTextNode(' '));
    }
    frag.appendChild(inlineFragment(part, doc));
  });
  return frag;
}

/** Rebuild the kinetic <span class="w"> words of one headline line. */
function wordsFragment(str, doc) {
  const frag = doc.createDocumentFragment();
  const words = str.split(/\s+/).filter(Boolean);
  words.forEach((word, i) => {
    if (i > 0) frag.appendChild(doc.createTextNode(' '));
    const w = doc.createElement('span');
    w.className = 'w';
    w.textContent = word;
    frag.appendChild(w);
  });
  return frag;
}

/** Write text into an element without ever handing it a markup string. */
function writeText(el, value, opts) {
  const doc = el.ownerDocument || document;
  let frag;
  if (opts.words) frag = wordsFragment(value, doc);
  else if (opts.sep) frag = sepFragment(value, doc);
  else frag = inlineFragment(value, doc);
  while (el.firstChild) el.removeChild(el.firstChild);
  el.appendChild(frag);
}

/** Which attribute does this element want, if the binding did not say? */
function inferAttr(el, explicit) {
  if (explicit) return explicit === 'text' ? null : explicit;
  const tag = el.tagName;
  if (tag === 'IMG' || tag === 'SOURCE' || tag === 'VIDEO') return 'src';
  if (tag === 'A') return 'href';
  if (tag === 'META') return 'content';
  return null; // text node
}

function interpolate(template, data) {
  let missing = false;
  const out = template.replace(/\{([\w.]+)\}/g, (_, path) => {
    const v = scalar(resolvePath(data, path));
    if (v === null) { missing = true; return ''; }
    return v;
  });
  return missing ? null : out;
}

/** Apply one binding to one element. Returns 1 if something was written. */
function applyOne(el, binding, data) {
  const value = binding.template
    ? interpolate(binding.template, data)
    : scalar(resolvePath(data, binding.path));
  if (value === null || value === undefined) return 0;

  const attr = inferAttr(el, binding.attr);
  if (attr) {
    if (el.getAttribute(attr) === value) return 0;
    el.setAttribute(attr, value);
    return 1;
  }
  writeText(el, value, binding);
  return 1;
}

/* ------------------------------------------------------------------ loading */

function readPreview() {
  try {
    const raw = globalThis.sessionStorage && sessionStorage.getItem(PREVIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isObj(parsed) ? parsed : null;
  } catch (err) {
    return null; // a poisoned preview must not take the page down
  }
}

async function fetchDoc(src) {
  const res = await fetch(src, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`content.json ${res.status}`);
  const parsed = await res.json();
  if (!isObj(parsed)) throw new Error('content.json is not an object');
  return parsed;
}

/* ------------------------------------------------------------------ public */

/**
 * Patch the page with content.json (or the admin's unsaved preview).
 *
 * @param {object}  [opts]
 * @param {string}  [opts.src]        URL of the JSON, default ../content.json
 *                                    resolved against this module.
 * @param {Document|Element} [opts.root]  where to look for hooks, default document.
 * @param {boolean} [opts.preview]    honour sessionStorage['vitrine:preview'].
 * @param {object}  [opts.data]       apply this object instead of fetching.
 * @returns {Promise<{ok:boolean, applied:number, error?:string}>}
 */
export async function applyContent(opts = {}) {
  const {
    src = new URL('../content.json', import.meta.url).href,
    root = typeof document !== 'undefined' ? document : null,
    preview = true,
    data: given = null,
  } = opts;

  if (!root || typeof root.querySelectorAll !== 'function') {
    return { ok: false, applied: 0, error: 'no DOM to apply to' };
  }

  let data = null;
  let source = 'json';
  try {
    if (given && isObj(given)) { data = given; source = 'given'; }
    if (!data && preview) {
      const p = readPreview();
      if (p) { data = p; source = 'preview'; }
    }
    if (!data) data = await fetchDoc(src);
  } catch (err) {
    // The static HTML is already correct. Leaving it alone is the right answer.
    return { ok: false, applied: 0, error: String((err && err.message) || err) };
  }

  let applied = 0;
  const claimed = new Set();

  // 1. explicit hooks in the markup win.
  let declared = [];
  try { declared = Array.from(root.querySelectorAll('[data-content]')); } catch (err) { /* noop */ }
  for (const el of declared) {
    try {
      const binding = {
        path: el.getAttribute('data-content'),
        attr: el.getAttribute('data-content-attr') || undefined,
        sep: el.hasAttribute('data-content-sep'),
        words: el.hasAttribute('data-content-words'),
      };
      applied += applyOne(el, binding, data);
      claimed.add(el.getAttribute('data-content'));
    } catch (err) { /* one bad hook must not stop the rest */ }
  }

  // 2. the selector table fills in everything the markup did not claim.
  for (const binding of BINDINGS) {
    if (binding.path && claimed.has(binding.path)) continue;
    try {
      const els = binding.all
        ? Array.from(root.querySelectorAll(binding.sel))
        : [root.querySelector(binding.sel)].filter(Boolean);
      for (const el of els) {
        if (el.hasAttribute && el.hasAttribute('data-content')) continue;
        applied += applyOne(el, binding, data);
      }
    } catch (err) { /* a stale selector is not an error */ }
  }

  try {
    root.documentElement && root.documentElement.setAttribute('data-content-source', source);
  } catch (err) { /* noop */ }

  return { ok: true, applied };
}

export default applyContent;
