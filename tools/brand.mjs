import { launch, ctx, DESKTOP, STEALTH } from './pw.mjs';
import fs from 'node:fs';
const urls = ['https://www.hiphopdiaperbag.com/','https://www.hiphopdiaperbag.com/product-page/hip-hop-diaper-bag'];
const b = await launch(['--disable-blink-features=AutomationControlled']);
const all = {};
for (const url of urls) {
  const c = await ctx(b, DESKTOP); await c.addInitScript(STEALTH);
  const p = await c.newPage();
  try {
    const r = await p.goto(url, {waitUntil:'load', timeout:90000});
    await p.waitForTimeout(7000);
    await p.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)); await p.waitForTimeout(4000);
    await p.evaluate(()=>window.scrollTo(0,0)); await p.waitForTimeout(1500);
    const imgs=[...new Set(await p.evaluate(()=>[...document.querySelectorAll('img')]
      .flatMap(i=>[i.currentSrc,i.src].concat(i.srcset?i.srcset.split(',').map(s=>s.trim().split(' ')[0]):[]))
      .filter(s=>s&&s.startsWith('http')&&!/\.svg/.test(s))))];
    const txt=(await p.evaluate(()=>document.body.innerText)).replace(/\n{2,}/g,'\n');
    all[url]={status:r&&r.status(),title:await p.title(),imgs,txt:txt.slice(0,6000)};
    await p.screenshot({path:'refs/brand-'+(url.includes('product')?'product':'home')+'.png', fullPage:true});
  } catch(e){ all[url]={err:String(e).split('\n')[0].slice(0,200)}; }
  await c.close();
}
fs.writeFileSync('refs/brand.json', JSON.stringify(all,null,1));
for (const [u,v] of Object.entries(all)) {
  console.log('\n#####',u, v.status||v.err, '|', v.title);
  console.log('IMGS:', (v.imgs||[]).length); console.log((v.imgs||[]).slice(0,30).join('\n'));
  console.log('TEXT:\n'+(v.txt||'').slice(0,3000));
}
await b.close();
