import { chromium } from 'playwright';
export const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
// The egress proxy resets jumbo post-quantum TLS1.3 ClientHellos from chromium.
// Capping at tls1.2 + disabling PQ/ECH shrinks the hello to ~440B and it goes through.
export const NET_ARGS = [
  '--no-sandbox', '--disable-dev-shm-usage',
  '--disable-features=PostQuantumKyber,EncryptedClientHello,UseMLKEM',
  '--ssl-version-max=tls1.2',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--enable-webgl', '--enable-gpu-rasterization', '--ignore-gpu-blocklist',
];
export async function launch(extraArgs = [], opts = {}) {
  return chromium.launch({
    executablePath: CHROME,
    args: [...NET_ARGS, ...extraArgs],
    proxy: { server: process.env.HTTPS_PROXY || 'http://127.0.0.1:36275' },
    ...opts,
  });
}
export const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
export const MOBILE  = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
export async function ctx(b, o = {}) {
  return b.newContext({ userAgent: UA, locale: 'en-US', ...o });
}

export const STEALTH = () => {
  Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
  Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>10});
  Object.defineProperty(navigator,'deviceMemory',{get:()=>8});
  window.chrome = { runtime:{} };
  const spoof = (proto) => {
    if (!proto) return;
    const gp = proto.getParameter;
    proto.getParameter = function(p){
      if (p === 37445) return 'Apple';
      if (p === 37446) return 'Apple M2 Pro';
      if (p === 7936)  return 'WebKit';
      if (p === 7937)  return 'WebKit WebGL';
      return gp.apply(this, arguments);
    };
  };
  spoof(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  spoof(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
};
