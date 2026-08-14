import { launch, ctx, DESKTOP, STEALTH } from './pw.mjs';
import fs from 'node:fs';
const urls = [
 ['bbms','https://www.buyblackmainstreet.com/listing/hip-hop-diaper-bag/'],
 ['amz','https://www.amazon.com/backpack-physics-resistant-Insulated-dispenser/dp/B07NV2X766'],
 ['sbp','https://successfulblackparenting.com/2024/05/15/the-diaper-bag-made-with-the-hip-hop-culture-in-mind/'],
];
const b = await launch(['--disable-blink-features=AutomationControlled']);
const all={};
for (const [k,url] of urls) {
  const c = await ctx(b, DESKTOP); await c.addInitScript(STEALTH);
  const p = await c.newPage();
  try {
    const r = await p.goto(url,{waitUntil:'domcontentloaded',timeout:70000});
    await p.waitForTimeout(6000);
    await p.evaluate(()=>window.scrollTo(0,2000)); await p.waitForTimeout(3000);
    const imgs=[...new Set(await p.evaluate(()=>[...document.querySelectorAll('img')]
      .flatMap(i=>[i.currentSrc,i.src].concat(i.srcset?i.srcset.split(',').map(s=>s.trim().split(' ')[0]):[]))
      .filter(s=>s&&s.startsWith('http')&&!/\.svg|sprite|logo|icon/i.test(s))))];
    const dims = await p.evaluate(()=>[...document.querySelectorAll('img')].map(i=>({s:i.currentSrc||i.src,w:i.naturalWidth,h:i.naturalHeight})).filter(o=>o.w>350));
    all[k]={status:r&&r.status(),title:await p.title(),imgs,big:dims};
    console.log('\n####',k,r&&r.status(),(await p.title()).slice(0,60));
    console.log(dims.slice(0,14).map(o=>`${o.w}x${o.h} ${o.s}`).join('\n'));
  } catch(e){ console.log('\n####',k,'ERR',String(e).split('\n')[0].slice(0,150)); }
  await c.close();
}
fs.writeFileSync('refs/hunt2.json',JSON.stringify(all,null,1));
await b.close();
