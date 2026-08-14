import { launch, ctx, DESKTOP, STEALTH } from './pw.mjs';
import fs from 'node:fs';
const b = await launch(['--disable-blink-features=AutomationControlled']);
const c = await ctx(b, DESKTOP);
await c.addInitScript(STEALTH);
const p = await c.newPage();
const out = {};
try {
  const r = await p.goto('https://www.etsy.com/listing/4504765328/hip-hop-diaper-bag', {waitUntil:'domcontentloaded', timeout:90000});
  out.status = r && r.status();
  await p.waitForTimeout(8000);
  out.title = await p.title();
  // click through the thumbnail carousel to force-load all full-res images
  out.imgs = [...new Set(await p.evaluate(()=>[...document.querySelectorAll('img')]
      .flatMap(i=>[i.currentSrc,i.src,i.dataset.srcDelay,i.dataset.srcZoomImage,i.srcset&&i.srcset.split(',').pop().trim().split(' ')[0]])
      .filter(s=>s&&s.includes('etsystatic'))))];
  out.text = (await p.evaluate(()=>document.body.innerText)).replace(/\n{2,}/g,'\n').slice(0,7000);
  await p.screenshot({path:'refs/etsy.png'});
  fs.writeFileSync('refs/etsy.json', JSON.stringify(out,null,1));
} catch(e){ out.err = String(e).split('\n')[0].slice(0,250); }
console.log(JSON.stringify({status:out.status,title:out.title,err:out.err,n:(out.imgs||[]).length},null,1));
console.log((out.imgs||[]).slice(0,30).join('\n'));
console.log('---TEXT---\n'+(out.text||'').slice(0,3500));
await b.close();
