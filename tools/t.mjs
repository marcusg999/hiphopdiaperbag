import { launch, ctx } from './pw.mjs';
const b = await launch();
const c = await ctx(b,{viewport:{width:1440,height:900}});
const p = await c.newPage();
for (const u of ['https://activetheory.net/work','https://example.com']) {
  try { const r = await p.goto(u,{waitUntil:'domcontentloaded',timeout:45000}); console.log(u, r&&r.status(), (await p.title()).slice(0,60)); }
  catch(e){ console.log(u,'ERR',String(e).slice(0,120)); }
}
await b.close();
