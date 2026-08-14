import { launch, ctx } from './pw.mjs';
const targets = [
  ['ebay','https://www.ebay.com/itm/167366677850'],
  ['etsy2','https://www.etsy.com/listing/4504765328/'],
  ['fb','https://www.facebook.com/hiphopdiaperbag/'],
];
const b = await launch();
for (const [name,url] of targets) {
  const c = await ctx(b, { viewport:{width:1440,height:1000} });
  const p = await c.newPage();
  try {
    const r = await p.goto(url, {waitUntil:'domcontentloaded', timeout:60000});
    await p.waitForTimeout(5000);
    const imgs = [...new Set(await p.evaluate(()=>[...document.querySelectorAll('img')].map(i=>i.currentSrc||i.src||'').filter(s=>s.startsWith('http')&&!s.includes('.svg'))))];
    const txt = (await p.evaluate(()=>document.body.innerText)).replace(/\n{2,}/g,'\n').slice(0,2500);
    console.log(`\n##### ${name} status=${r&&r.status()}\nIMGS(${imgs.length}):\n`+imgs.slice(0,25).join('\n')+`\nTEXT:\n${txt}`);
  } catch(e){ console.log(`\n##### ${name} ERR ${String(e).slice(0,160)}`); }
  await c.close();
}
await b.close();
