// node tools/shoot.mjs <url> <prefix> [waitMs] [scrolls] [stealth:1|0]
import { launch, ctx, DESKTOP, MOBILE, STEALTH } from './pw.mjs';
import fs from 'node:fs';
const [url, prefix, waitMs='9000', scrolls='0', stealth='1'] = process.argv.slice(2);
fs.mkdirSync('refs',{recursive:true});
const b = await launch(['--disable-blink-features=AutomationControlled']);
for (const [name, dev] of [['desktop', DESKTOP], ['mobile', MOBILE]]) {
  const c = await ctx(b, dev);
  if (stealth === '1') await c.addInitScript(STEALTH);
  const p = await c.newPage();
  try {
    await p.goto(url, { waitUntil:'load', timeout:90000 });
    await p.waitForTimeout(+waitMs);
    await p.screenshot({ path:`refs/${prefix}-${name}.png` });
    for (let i=0;i<+scrolls;i++){
      await p.mouse.move(dev.viewport.width/2, dev.viewport.height/2);
      await p.mouse.wheel(0, dev.viewport.height*0.95);
      await p.waitForTimeout(2200);
      await p.screenshot({ path:`refs/${prefix}-${name}-s${i+1}.png` });
    }
    console.log(`OK ${prefix}-${name} ::`, (await p.title()).slice(0,60));
  } catch(e){ console.log(`ERR ${prefix}-${name}`, String(e).split('\n')[0].slice(0,140)); }
  await c.close();
}
await b.close();
