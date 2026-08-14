/**
 * VITRINE — live Instagram mirror.
 *
 * WHY THIS IS SHAPED LIKE THIS
 *
 * A purely static site cannot talk to Instagram directly. The old Basic Display
 * API is gone, and the current Instagram Graph API needs a long-lived access
 * token that must be refreshed every ~60 days. That token cannot live in this
 * file: the repository is public, so anything shipped to the browser is
 * published. There is no client-side-only way to mirror a private-ish feed, and
 * any tutorial that says otherwise is telling you to leak a credential.
 *
 * So this module reads from ONE endpoint that holds the token on your behalf,
 * and it does not care which kind you use:
 *
 *   1. A hosted widget service with a JSON endpoint — Behold, SnapWidget,
 *      LightWidget and similar. You connect Instagram once on their site, they
 *      refresh the token, you paste the JSON URL here. No server to run.
 *   2. Your own proxy — a Cloudflare Worker or Netlify function holding the
 *      token as a secret and returning the Graph API response. More work, no
 *      third party in the path.
 *
 * Until an endpoint is configured, the curated tiles already in index.html are
 * what shows. That is deliberate and matches how the rest of this page works:
 * the markup is the truth, and the network is an enhancement that is allowed to
 * fail. A feed that 404s, rate-limits or returns junk must never blank the
 * section — an empty grid on a shop page is worse than a slightly stale one.
 */

const SHAPES = [
  // Behold: { posts: [{ mediaUrl, permalink, caption, ... }] }
  (j) => (Array.isArray(j?.posts) ? j.posts.map((p) => ({
    src: p.mediaUrl || p.thumbnailUrl, href: p.permalink, alt: p.caption,
  })) : null),
  // Graph API proper: { data: [{ media_url, permalink, caption, media_type }] }
  (j) => (Array.isArray(j?.data) ? j.data.map((p) => ({
    src: p.media_type === 'VIDEO' ? (p.thumbnail_url || p.media_url) : p.media_url,
    href: p.permalink, alt: p.caption,
  })) : null),
  // A plain array of posts, whatever the key naming
  (j) => (Array.isArray(j) ? j.map((p) => ({
    src: p.media_url || p.mediaUrl || p.image || p.thumbnail,
    href: p.permalink || p.link || p.url, alt: p.caption || p.title,
  })) : null),
];

function normalise(json) {
  for (const shape of SHAPES) {
    const out = shape(json);
    if (out && out.length && out.every((p) => p.src)) return out;
  }
  return null;
}

/** First sentence of a caption, so alt text is a description and not an essay. */
function toAlt(caption, i) {
  const s = String(caption || '').replace(/\s+/g, ' ').trim();
  if (!s) return `Instagram post ${i + 1}`;
  const cut = s.split(/(?<=[.!?])\s/)[0];
  return (cut.length > 120 ? `${cut.slice(0, 117)}…` : cut);
}

/** Read the feed config straight from content.json (honouring an unsaved
 *  admin preview), rather than depending on what applyContent happens to
 *  return. One less coupling between two modules that need not know about
 *  each other. */
async function readConfig() {
  try {
    const preview = sessionStorage.getItem('vitrine:preview');
    if (preview) {
      const j = JSON.parse(preview);
      if (j?.instagram?.liveFeed) return j.instagram.liveFeed;
    }
  } catch { /* fall through to the file */ }
  try {
    const res = await fetch('content.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json())?.instagram?.liveFeed || null;
  } catch { return null; }
}

export async function mountGramFeed(opts = {}) {
  const grid = document.querySelector('.gram__grid');
  if (!grid) return { ok: false, reason: 'no-grid' };
  const cfg = opts.config || await readConfig() || {};
  if (!cfg.enabled || !cfg.endpoint) return { ok: false, reason: 'not-configured' };

  let posts = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 6000);
    const res = await fetch(cfg.endpoint, { signal: ctrl.signal, mode: 'cors' });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    posts = normalise(await res.json());
  } catch (err) {
    // Keep the curated tiles. Never blank the grid.
    return { ok: false, reason: String(err && err.message || err) };
  }
  if (!posts) return { ok: false, reason: 'unrecognised-shape' };

  const slots = [...grid.children];
  const take = Math.min(posts.length, opts.limit ?? cfg.limit ?? slots.length);

  for (let i = 0; i < take; i++) {
    const slot = slots[i];
    const post = posts[i];
    if (!slot || !post?.src) continue;
    const a = slot.querySelector('a');
    const img = slot.querySelector('img');
    if (!a || !img) continue;

    // Swap only once the replacement has actually decoded, so a slow or broken
    // image never leaves a hole where a real tile used to be.
    const next = new Image();
    next.decoding = 'async';
    next.onload = () => {
      img.src = post.src;
      img.alt = toAlt(post.alt, i);
      if (post.href) a.href = post.href;
      slot.dataset.live = 'true';
    };
    next.src = post.src;
  }

  grid.dataset.feed = 'live';
  return { ok: true, count: take };
}
