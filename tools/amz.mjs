import { launch, ctx, DESKTOP, STEALTH } from './pw.mjs';
import fs from 'node:fs';

const URL = 'https://www.amazon.com/backpack-physics-resistant-Insulated-dispenser/dp/B07NV2X766';
const b = await launch(['--disable-blink-features=AutomationControlled']);
const c = await ctx(b, DESKTOP); await c.addInitScript(STEALTH);
const p = await c.newPage();
const r = await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await p.waitForTimeout(6000);
// scroll to force lazy content (reviews, aplus)
for (let y = 0; y < 14000; y += 1200) { await p.evaluate(v => window.scrollTo(0, v), y); await p.waitForTimeout(600); }
await p.waitForTimeout(4000);

const T = s => (s || '').replace(/\s+/g, ' ').trim();

const out = await p.evaluate(() => {
  const T = s => (s || '').replace(/\s+/g, ' ').trim();
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const txt = s => T(q(s)?.innerText);

  // hi-res image gallery from the embedded ImageBlockATF json
  const hires = [];
  for (const sc of qa('script')) {
    const t = sc.textContent || '';
    if (t.includes('colorImages') || t.includes('hiRes')) {
      for (const m of t.matchAll(/"hiRes":"(https:[^"]+)"/g)) hires.push(m[1].replace(/\\u002F/g, '/'));
      for (const m of t.matchAll(/"large":"(https:[^"]+)"/g)) hires.push(m[1].replace(/\\u002F/g, '/'));
    }
  }

  // A+ / aplus module images
  const aplus = qa('#aplus img, #aplus3p_feature_div img, .aplus-module img')
    .map(i => i.getAttribute('data-src') || i.src).filter(Boolean);

  const bullets = qa('#feature-bullets li span.a-list-item, #feature-bullets li').map(e => T(e.innerText)).filter(Boolean);

  const detailRows = {};
  qa('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, .prodDetTable tr')
    .forEach(tr => { const th = tr.querySelector('th'), td = tr.querySelector('td'); if (th && td) detailRows[T(th.innerText)] = T(td.innerText); });
  qa('#detailBullets_feature_div li').forEach(li => {
    const k = li.querySelector('.a-text-bold'); if (!k) return;
    const full = T(li.innerText); const key = T(k.innerText).replace(/[::‏‎\s]+$/, '');
    detailRows[key] = T(full.slice(T(k.innerText).length));
  });

  const reviews = qa('[data-hook="review"], .review').map(r => ({
    title: T(r.querySelector('[data-hook="review-title"]')?.innerText),
    stars: T(r.querySelector('[data-hook="review-star-rating"] .a-icon-alt, .a-icon-alt')?.innerText),
    date: T(r.querySelector('[data-hook="review-date"]')?.innerText),
    author: T(r.querySelector('.a-profile-name')?.innerText),
    verified: !!r.querySelector('[data-hook="avp-badge"]'),
    helpful: T(r.querySelector('[data-hook="helpful-vote-statement"]')?.innerText),
    body: T(r.querySelector('[data-hook="review-body"]')?.innerText),
  })).filter(r => r.body);

  // "customer says" AI summary + top review snippets in the lite widget
  const liteReviews = qa('#cm-cr-dp-review-list [data-hook="review"], .cr-lite-review, [id^="customer_review"]').map(e => T(e.innerText));

  return {
    url: location.href,
    title: txt('#productTitle'),
    byline: txt('#bylineInfo'),
    brand: txt('#bylineInfo') || txt('.po-brand .a-span9'),
    price: txt('.a-price .a-offscreen') || txt('#corePrice_feature_div') || txt('#price'),
    priceAll: [...new Set(qa('.a-price .a-offscreen').map(e => T(e.textContent)))],
    rating: txt('#acrPopover') || txt('[data-hook="rating-out-of-text"]') || txt('.a-icon-alt'),
    reviewCount: txt('#acrCustomerReviewText'),
    availability: txt('#availability'),
    bullets,
    description: txt('#productDescription'),
    aplusText: txt('#aplus') || txt('#aplus3p_feature_div'),
    detailRows,
    overview: Object.fromEntries(qa('#productOverview_feature_div tr').map(tr => [T(tr.children[0]?.innerText), T(tr.children[1]?.innerText)])),
    colorOptions: qa('#variation_color_name li, #inline-twister-expander-content-color_name li').map(e => T(e.getAttribute('title') || e.innerText)),
    aiSummary: txt('[data-hook="cr-product-insights-cards"]') || txt('#product-summary') || txt('.product-insights'),
    reviews,
    liteReviews,
    hires: [...new Set(hires)],
    aplus: [...new Set(aplus)],
    bodyText: T(document.body.innerText).slice(0, 60000),
  };
});

fs.writeFileSync('refs/amz.json', JSON.stringify(out, null, 1));
console.log('STATUS', r.status());
console.log('TITLE:', out.title);
console.log('PRICE:', out.price, out.priceAll);
console.log('RATING:', out.rating, '|', out.reviewCount);
console.log('BULLETS:', out.bullets.length);
out.bullets.forEach((x, i) => console.log(' -', i, x));
console.log('DESC:', out.description);
console.log('DETAILS:', JSON.stringify(out.detailRows, null, 1));
console.log('OVERVIEW:', JSON.stringify(out.overview));
console.log('COLORS:', out.colorOptions);
console.log('REVIEWS:', out.reviews.length, 'LITE:', out.liteReviews.length);
console.log('HIRES:', out.hires.length);
out.hires.forEach(u => console.log('  IMG', u));

await p.screenshot({ path: 'refs/amz-full.png', fullPage: false });
await b.close();
