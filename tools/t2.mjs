import { chromium } from 'playwright';
const CHROME='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PROXY=process.env.HTTPS_PROXY;
const variants = [
  ['launch-proxy-noargs', {executablePath:CHROME,args:['--no-sandbox','--disable-dev-shm-usage'],proxy:{server:PROXY}}],
  ['arg-proxy-server',    {executablePath:CHROME,args:['--no-sandbox','--disable-dev-shm-usage',`--proxy-server=${PROXY}`,'--proxy-bypass-list=<-loopback>']}],
  ['no-proxy-at-all',     {executablePath:CHROME,args:['--no-sandbox','--disable-dev-shm-usage']}],
];
for (const [name,opt] of variants) {
  let b;
  try {
    b = await chromium.launch(opt);
    const c = await b.newContext({ignoreHTTPSErrors:false});
    const p = await c.newPage();
    const r = await p.goto('https://example.com',{waitUntil:'domcontentloaded',timeout:30000});
    console.log(name,'OK',r&&r.status(),(await p.title()).slice(0,40));
  } catch(e){ console.log(name,'ERR',String(e).split('\n')[0].slice(0,140)); }
  finally { if(b) await b.close(); }
}
