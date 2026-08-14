import { launch, ctx } from './pw.mjs';
const b = await launch();
const c = await ctx(b, { viewport:{width:1440,height:900} });
const p = await c.newPage();
const out = {};
try {
  const r = await p.goto('https://www.etsy.com/listing/4504765328/hip-hop-diaper-bag', {waitUntil:'domcontentloaded', timeout:90000});
  out.status = r && r.status();
  await p.waitForTimeout(7000);
  out.title = await p.title();
  out.imgs = [...new Set(await p.evaluate(() => [...document.querySelectorAll('img')].map(i=>i.currentSrc||i.src||'').filter(s=>s.includes('etsystatic'))))];
  out.text = (await p.evaluate(()=>document.body.innerText)).slice(0,5000);
  await p.screenshot({path:'refs/etsy.png', fullPage:false});
} catch(e){ out.err = String(e).slice(0,300); }
console.log(JSON.stringify(out,null,1).slice(0,9000));
await b.close();
