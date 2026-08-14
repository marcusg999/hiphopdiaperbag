import { launch, ctx, DESKTOP } from './pw.mjs';
const b = await launch(['--disable-blink-features=AutomationControlled']);
const c = await ctx(b, { ...DESKTOP, deviceScaleFactor:2,
  userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
await c.addInitScript(() => {
  Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
  Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>10});
  Object.defineProperty(navigator,'deviceMemory',{get:()=>8});
  Object.defineProperty(navigator,'platform',{get:()=>'MacIntel'});
  window.chrome = { runtime:{} };
  const spoof = (proto) => {
    if (!proto) return;
    const gp = proto.getParameter;
    proto.getParameter = function(p){
      if (p === 37445) return 'Apple';                       // UNMASKED_VENDOR
      if (p === 37446) return 'Apple M2 Pro';                // UNMASKED_RENDERER
      if (p === 7936)  return 'WebKit';                      // VENDOR
      if (p === 7937)  return 'WebKit WebGL';                // RENDERER
      return gp.apply(this, arguments);
    };
  };
  spoof(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  spoof(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
});
const p = await c.newPage();
await p.goto('https://activetheory.net/work',{waitUntil:'load',timeout:90000});
await p.waitForTimeout(10000);
console.log('title:', await p.title());
console.log('body:', JSON.stringify((await p.evaluate(()=>document.body.innerText)).slice(0,500)));
await p.screenshot({path:'refs/at-test.png'});
await b.close();
