import type { ExportImageInput, LayerSettings, NetworkTarget, Orientation, ProjectSettings } from './types';

export interface ImagePlayableExportInput {
  image: ExportImageInput;
  layer: LayerSettings;
  storeUrl: string;
  network: NetworkTarget;
  useClickTag: boolean;
  handDataUrl?: string;
  orientation?: Orientation;
  previewMode?: boolean;
}

export interface HtmlPatchInput {
  html: string;
  layer: LayerSettings;
  storeUrl: string;
  network: NetworkTarget;
  useClickTag: boolean;
  replaceLinks: boolean;
  ctaSelector: string;
  handDataUrl?: string;
  previewMode?: boolean;
}

export function createDefaultProjectSettings(): ProjectSettings {
  return {
    name: 'Playable batch',
    prompt:
      'Create four high-converting mobile playable ad creative variants similar to the reference image. Keep product intent, readable mobile composition, and a clean CTA-safe lower area.',
    storeUrl: 'https://apps.apple.com/us/app/icardiac-heart-rate-health/id6468660073',
    network: 'applovin',
    orientation: 'portrait',
    aiProvider: 'gemini-flash',
    useClickTag: true,
    replaceLinks: true,
    ctaSelector: "button,[role='button'],.cta,.btn",
    syncAllVariants: true,
  };
}

export function generateImagePlayableHtml({
  image,
  layer,
  storeUrl,
  network,
  useClickTag,
  handDataUrl,
  orientation = 'portrait',
  previewMode = false,
}: ImagePlayableExportInput) {
  const imageRatio = orientation === 'landscape' ? 16 / 9 : 9 / 16;
  const frameWidthVh = roundCssNumber(imageRatio * 100);
  const frameHeightVw = roundCssNumber(100 / imageRatio);
  const handMarkup =
    layer.injectHand && handDataUrl
      ? `<img class="ps-hand motion-${escapeHtml(layer.handMotion)}" src="${handDataUrl}" alt="">`
      : '';
  const scanMarkup =
    layer.injectScan && layer.scanStyle !== 'none'
      ? `<div class="ps-scan scan-${escapeHtml(layer.scanStyle)}" aria-hidden="true"></div>`
      : '';
  const ctaMarkup = layer.showCta
    ? `<button class="ps-cta btn-${escapeHtml(layer.buttonAnimation)}" type="button">${escapeHtml(layer.ctaText)}</button>`
    : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>${escapeHtml(stripExtension(image.name))}</title>
  <style>
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#05070b;font-family:Arial,Helvetica,sans-serif;-webkit-user-select:none;user-select:none}
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    .ps-scene{position:fixed;inset:0;overflow:hidden;background:#05070b;touch-action:manipulation}
    .ps-frame{--target-x:${clamp(layer.handX, 0, 100)}%;--target-y:${clamp(layer.handY, 0, 100)}%;--scan-x:${clamp(layer.scanX, 0, 100)}%;--scan-y:${clamp(layer.scanY, 0, 100)}%;--cta-x:${clamp(layer.ctaX, 0, 100)}%;--cta-y:${clamp(layer.ctaY, 0, 100)}%;--hand-size:${clamp(layer.handSize, 32, 260)}px;--scan-size:${clamp(layer.scanSize, 48, 360)}px;--scan-speed:${clamp(layer.scanSpeed, 400, 5000)}ms;--cta-width:${clamp(layer.ctaWidth, 44, 92)}%;position:absolute;left:50%;top:50%;width:min(100vw,${frameWidthVh}vh);height:min(100vh,${frameHeightVw}vw);transform:translate(-50%,-50%);overflow:hidden;background:#10131a}
    .ps-creative{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;background:#05070b}
    .ps-hand{position:absolute;left:var(--target-x);top:var(--target-y);width:var(--hand-size);z-index:6;pointer-events:none;filter:drop-shadow(0 9px 14px rgba(0,0,0,.32));transform:translate(-50%,-50%)}
    .ps-scan{position:absolute;left:var(--scan-x);top:var(--scan-y);width:var(--scan-size);height:var(--scan-size);z-index:5;pointer-events:none;transform:translate(-50%,-50%)}
    .scan-sweep{overflow:hidden;border:2px solid rgba(255,255,255,.78);border-radius:16px;background:rgba(31,182,255,.08);box-shadow:0 0 24px rgba(0,194,255,.34)}
    .scan-sweep:after{content:"";position:absolute;top:-20%;bottom:-20%;width:5px;left:-16%;background:linear-gradient(180deg,transparent,#fff,transparent);box-shadow:0 0 18px #00d5ff;animation:psSweep var(--scan-speed) linear infinite}
    .scan-ring{border:4px solid rgba(255,255,255,.92);border-radius:999px;box-shadow:0 0 0 0 rgba(0,213,255,.48),0 0 30px rgba(0,213,255,.34);animation:psRing var(--scan-speed) ease-out infinite}
    .scan-spotlight{border-radius:999px;background:radial-gradient(circle,rgba(255,255,255,.18) 0,rgba(0,213,255,.20) 45%,rgba(0,0,0,0) 70%);box-shadow:0 0 0 9999px rgba(0,0,0,.27),0 0 34px rgba(255,255,255,.45);animation:psSpot var(--scan-speed) ease-in-out infinite}
    .scan-border{border:3px solid rgba(255,255,255,.95);border-radius:10px;box-shadow:0 0 24px rgba(42,245,152,.45)}
    .scan-border:before,.scan-border:after{content:"";position:absolute;background:#2af598;box-shadow:0 0 14px #2af598}
    .scan-border:before{left:0;top:0;width:38%;height:4px;animation:psBorderH var(--scan-speed) linear infinite}
    .scan-border:after{right:0;top:0;width:4px;height:38%;animation:psBorderV var(--scan-speed) linear infinite}
    .scan-spark{border-radius:999px;background:rgba(255,243,196,.26);box-shadow:0 0 0 0 rgba(245,158,11,.58),0 0 28px rgba(245,158,11,.52);animation:psSpark var(--scan-speed) ease-out infinite}
    .ps-cta{position:absolute;left:var(--cta-x);top:var(--cta-y);z-index:8;width:var(--cta-width);max-width:88%;min-height:54px;padding:0 22px;border:0;border-radius:10px;background:linear-gradient(180deg,#ff8a1f,#f45100);color:#fff;font-size:19px;font-weight:900;letter-spacing:0;text-align:center;box-shadow:0 12px 24px rgba(0,0,0,.30);transform:translate(-50%,-50%);cursor:pointer}
    .btn-pulse{animation:psCtaPulse 1.08s ease-in-out infinite}.btn-bounce{animation:psCtaBounce .95s ease-in-out infinite}.btn-shake{animation:psCtaShake .48s ease-in-out infinite}.btn-breath{animation:psCtaBreath 1.15s ease-in-out infinite}.btn-shine{overflow:hidden;background:#f45100}.btn-shine:after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 0%,rgba(255,255,255,.58) 45%,transparent 70%);transform:translateX(-120%);animation:psCtaShine 1.25s linear infinite}
    .motion-tap{animation:psHandTap 1.05s ease-in-out infinite}.motion-doubleTap{animation:psHandDoubleTap 1.18s ease-in-out infinite}.motion-press{animation:psHandPress 1.05s ease-in-out infinite}.motion-bounce{animation:psHandBounce 1s ease-in-out infinite}.motion-swipeX{animation:psHandSwipeX 1.15s ease-in-out infinite}.motion-swipeY{animation:psHandSwipeY 1.15s ease-in-out infinite}.motion-drag{animation:psHandDrag 1.35s ease-in-out infinite}.motion-shake{animation:psHandShake .62s ease-in-out infinite}.motion-wave{animation:psHandWave 1.08s ease-in-out infinite}
    @keyframes psSweep{0%{left:-16%}100%{left:116%}}@keyframes psRing{0%{transform:translate(-50%,-50%) scale(.72);opacity:1;box-shadow:0 0 0 0 rgba(0,213,255,.52)}100%{transform:translate(-50%,-50%) scale(1.18);opacity:.08;box-shadow:0 0 0 24px rgba(0,213,255,0)}}@keyframes psSpot{0%,100%{transform:translate(-50%,-50%) scale(.92);opacity:.88}50%{transform:translate(-50%,-50%) scale(1.08);opacity:1}}@keyframes psBorderH{0%{left:0}50%{left:62%}100%{left:0}}@keyframes psBorderV{0%{top:0}50%{top:62%}100%{top:0}}@keyframes psSpark{0%{transform:translate(-50%,-50%) scale(.55);opacity:1;box-shadow:0 0 0 0 rgba(245,158,11,.56)}100%{transform:translate(-50%,-50%) scale(1.35);opacity:0;box-shadow:0 0 0 26px rgba(245,158,11,0)}}
    @keyframes psHandTap{0%,100%{transform:translate(-50%,-50%) scale(1)}45%{transform:translate(-50%,-50%) scale(.82)}}@keyframes psHandDoubleTap{0%,100%{transform:translate(-50%,-50%) scale(1)}22%,58%{transform:translate(-50%,-50%) scale(.82)}35%,72%{transform:translate(-50%,-50%) scale(1.03)}}@keyframes psHandPress{0%,100%{transform:translate(-50%,-50%) scale(1)}55%{transform:translate(-50%,-50%) scale(.72);filter:drop-shadow(0 4px 7px rgba(0,0,0,.36))}}@keyframes psHandBounce{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-18px)}}@keyframes psHandSwipeX{0%,100%{transform:translate(-74%,-50%)}50%{transform:translate(-28%,-50%)}}@keyframes psHandSwipeY{0%,100%{transform:translate(-50%,-74%)}50%{transform:translate(-50%,-28%)}}@keyframes psHandDrag{0%,100%{transform:translate(-72%,-58%) scale(.96)}50%{transform:translate(-28%,-42%) scale(.9)}}@keyframes psHandShake{0%,100%{transform:translate(-50%,-50%) rotate(0)}25%{transform:translate(-50%,-50%) rotate(-8deg)}75%{transform:translate(-50%,-50%) rotate(8deg)}}@keyframes psHandWave{0%,100%{transform:translate(-50%,-50%) rotate(-9deg)}50%{transform:translate(-50%,-50%) rotate(12deg)}}
    @keyframes psCtaPulse{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.06)}}@keyframes psCtaBounce{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-8px)}}@keyframes psCtaShake{0%,100%{transform:translate(-50%,-50%)}25%{transform:translate(calc(-50% - 5px),-50%)}75%{transform:translate(calc(-50% + 5px),-50%)}}@keyframes psCtaBreath{0%,100%{filter:brightness(1)}50%{filter:brightness(1.18)}}@keyframes psCtaShine{0%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
  </style>
</head>
<body>
  <main class="ps-scene">
    <div class="ps-frame" role="button" aria-label="Open store">
      <img class="ps-creative" src="${image.dataUrl}" alt="">
      ${scanMarkup}
      ${handMarkup}
      ${ctaMarkup}
    </div>
  </main>
  <script>
  (function(){
    window.clickTag = window.clickTag || "";
    var storeUrl = ${JSON.stringify(storeUrl)};
    var useClickTag = ${JSON.stringify(useClickTag)};
    var network = ${JSON.stringify(network)};
    var previewMode = ${JSON.stringify(previewMode)};
    function openUrl(url){
      var target = url || storeUrl || "";
      if (useClickTag && window.clickTag) target = window.clickTag;
      if (previewMode) { console.log("openUrl", target); return; }
      try { if (typeof mraid !== "undefined" && mraid.open) { mraid.open(target); return; } } catch(e) {}
      try { if (network === "mintegral" && window.install) { window.install(); return; } } catch(e) {}
      if (target) window.location.assign(target);
    }
    window.openUrl = openUrl;
    document.querySelector(".ps-frame").addEventListener("click", function(){ openUrl(); });
    var cta = document.querySelector(".ps-cta");
    if (cta) cta.addEventListener("click", function(event){ event.stopPropagation(); openUrl(); });
  })();
  </script>
</body>
</html>`;
}

export function patchPlayableHtml({
  html,
  layer,
  storeUrl,
  network,
  useClickTag,
  replaceLinks,
  ctaSelector,
  handDataUrl,
  previewMode = false,
}: HtmlPatchInput) {
  let out = stripPreviousInjection(html);

  if (replaceLinks && storeUrl) {
    out = out.replace(/https?:\/\/(?:apps\.apple\.com|play\.google\.com|itunes\.apple\.com)[^'"<)\s]+/g, storeUrl);
    out = out.replace(
      /window\.openUrl\s*&&\s*window\.openUrl\((['"])(.*?)\1\)/g,
      `window.openUrl && window.openUrl(${JSON.stringify(storeUrl)})`,
    );
  }

  if (layer.ctaText) out = replaceCommonCtaText(out, layer.ctaText);

  out = ensureOpenUrlRuntime(out, storeUrl, network, useClickTag);

  if (layer.buttonAnimation !== 'none') out = injectButtonAnimation(out, layer.buttonAnimation, ctaSelector);
  if (layer.showCta) out = injectCtaPosition(out, layer, ctaSelector);
  if (layer.injectScan && layer.scanStyle !== 'none') out = injectScan(out, layer);
  if (layer.injectHand && handDataUrl) out = injectHand(out, layer, handDataUrl);

  if (previewMode) {
    out = out
      .replace(/mraid\.open\(([^)]*)\)/g, 'console.log("mraid.open", $1)')
      .replace(/window\.location\.assign\(([^)]*)\)/g, 'console.log("location.assign", $1)')
      .replace(/window\.open\(([^)]*)\)/g, 'console.log("window.open", $1)');
  }

  return out;
}

function stripPreviousInjection(html: string) {
  return html
    .replace(/<script id="ps-store-runtime">[\s\S]*?<\/script>\s*/g, '')
    .replace(/<style id="ps-button-anim-style">[\s\S]*?<\/style>\s*/g, '')
    .replace(/<script id="ps-button-anim-script">[\s\S]*?<\/script>\s*/g, '')
    .replace(/<style id="ps-cta-position-style">[\s\S]*?<\/style>\s*/g, '')
    .replace(/<script id="ps-cta-position-script">[\s\S]*?<\/script>\s*/g, '')
    .replace(/<style id="ps-scan-style">[\s\S]*?<\/style>\s*/g, '')
    .replace(/<div id="ps-scan-effect"[\s\S]*?<\/div>\s*/g, '')
    .replace(/<style id="ps-hand-style">[\s\S]*?<\/style>\s*/g, '')
    .replace(/<img id="ps-hand-click"[\s\S]*?>\s*/g, '');
}

function ensureOpenUrlRuntime(html: string, storeUrl: string, network: NetworkTarget, useClickTag: boolean) {
  const runtime = `
<script id="ps-store-runtime">
(function(){
  window.clickTag = window.clickTag || "";
  window.psStoreUrl = ${JSON.stringify(storeUrl || '')};
  window.psUseClickTag = ${JSON.stringify(useClickTag)};
  window.psNetwork = ${JSON.stringify(network)};
  window.openUrl = window.openUrl || function(url){
    var target = url || window.psStoreUrl || "";
    if (window.psUseClickTag && window.clickTag) target = window.clickTag;
    try { if (typeof mraid !== "undefined" && mraid.open) { mraid.open(target); return; } } catch(e) {}
    try { if (window.psNetwork === "mintegral" && window.install) { window.install(); return; } } catch(e) {}
    if (target) window.location.assign(target);
  };
})();
</script>`;
  return insertBeforeBody(html, runtime);
}

function injectButtonAnimation(html: string, preset: LayerSettings['buttonAnimation'], selector: string) {
  const safeSelector = selector.trim() || 'button';
  const css = `
<style id="ps-button-anim-style">
@keyframes psPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
@keyframes psBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes psShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
@keyframes psBreath{0%,100%{filter:brightness(1)}50%{filter:brightness(1.18)}}
@keyframes psShine{0%{background-position:-180px 0}100%{background-position:260px 0}}
.ps-btn-anim-pulse{animation:psPulse 1.1s infinite ease-in-out!important}
.ps-btn-anim-bounce{animation:psBounce .9s infinite ease-in-out!important}
.ps-btn-anim-shake{animation:psShake .45s infinite ease-in-out!important}
.ps-btn-anim-breath{animation:psBreath 1.2s infinite ease-in-out!important}
.ps-btn-anim-shine{background-image:linear-gradient(110deg,transparent 0%,rgba(255,255,255,.55) 45%,transparent 70%)!important;background-size:220px 100%!important;animation:psShine 1.35s infinite linear!important}
</style>
<script id="ps-button-anim-script">
(function(){
  var selector = ${JSON.stringify(safeSelector)};
  var cls = "ps-btn-anim-${preset}";
  function apply(){
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.add(cls);
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
})();
</script>`;
  return insertBeforeBody(html, css);
}

function injectCtaPosition(html: string, layer: LayerSettings, selector: string) {
  const safeSelector = selector.trim() || 'button';
  const code = `
<style id="ps-cta-position-style">
.ps-cta-positioned{position:fixed!important;left:${clamp(layer.ctaX, 0, 100)}vw!important;top:${clamp(layer.ctaY, 0, 100)}vh!important;right:auto!important;bottom:auto!important;z-index:2147482999!important;transform:translate(-50%,-50%)!important}
.ps-cta-positioned.ps-btn-anim-pulse{animation:psPulsePos 1.1s infinite ease-in-out!important}
.ps-cta-positioned.ps-btn-anim-bounce{animation:psBouncePos .9s infinite ease-in-out!important}
.ps-cta-positioned.ps-btn-anim-shake{animation:psShakePos .45s infinite ease-in-out!important}
@keyframes psPulsePos{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.07)}}
@keyframes psBouncePos{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-8px)}}
@keyframes psShakePos{0%,100%{transform:translate(-50%,-50%)}25%{transform:translate(calc(-50% - 4px),-50%)}75%{transform:translate(calc(-50% + 4px),-50%)}}
</style>
<script id="ps-cta-position-script">
(function(){
  var selector = ${JSON.stringify(safeSelector)};
  function apply(){
    var node = document.querySelector(selector);
    if (!node) return;
    node.classList.add("ps-cta-positioned");
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
})();
</script>`;
  return insertBeforeBody(html, code);
}

function injectScan(html: string, layer: LayerSettings) {
  const code = `
<style id="ps-scan-style">
@keyframes psScanSweep{0%{left:-16%}100%{left:116%}}
@keyframes psScanRing{0%{transform:translate(-50%,-50%) scale(.72);opacity:1;box-shadow:0 0 0 0 rgba(0,213,255,.52)}100%{transform:translate(-50%,-50%) scale(1.18);opacity:.08;box-shadow:0 0 0 24px rgba(0,213,255,0)}}
@keyframes psScanSpot{0%,100%{transform:translate(-50%,-50%) scale(.92);opacity:.88}50%{transform:translate(-50%,-50%) scale(1.08);opacity:1}}
@keyframes psScanBorderH{0%{left:0}50%{left:62%}100%{left:0}}
@keyframes psScanBorderV{0%{top:0}50%{top:62%}100%{top:0}}
@keyframes psScanSpark{0%{transform:translate(-50%,-50%) scale(.55);opacity:1;box-shadow:0 0 0 0 rgba(245,158,11,.56)}100%{transform:translate(-50%,-50%) scale(1.35);opacity:0;box-shadow:0 0 0 26px rgba(245,158,11,0)}}
#ps-scan-effect{position:fixed;left:${clamp(layer.scanX, 0, 100)}vw;top:${clamp(layer.scanY, 0, 100)}vh;width:${clamp(layer.scanSize, 48, 360)}px;height:${clamp(layer.scanSize, 48, 360)}px;z-index:2147482998;pointer-events:none;transform:translate(-50%,-50%)}
#ps-scan-effect.scan-sweep{overflow:hidden;border:2px solid rgba(255,255,255,.78);border-radius:16px;background:rgba(31,182,255,.08);box-shadow:0 0 24px rgba(0,194,255,.34)}
#ps-scan-effect.scan-sweep:after{content:"";position:absolute;top:-20%;bottom:-20%;width:5px;left:-16%;background:linear-gradient(180deg,transparent,#fff,transparent);box-shadow:0 0 18px #00d5ff;animation:psScanSweep ${clamp(layer.scanSpeed, 400, 5000)}ms linear infinite}
#ps-scan-effect.scan-ring{border:4px solid rgba(255,255,255,.92);border-radius:999px;box-shadow:0 0 0 0 rgba(0,213,255,.48),0 0 30px rgba(0,213,255,.34);animation:psScanRing ${clamp(layer.scanSpeed, 400, 5000)}ms ease-out infinite}
#ps-scan-effect.scan-spotlight{border-radius:999px;background:radial-gradient(circle,rgba(255,255,255,.18) 0,rgba(0,213,255,.20) 45%,rgba(0,0,0,0) 70%);box-shadow:0 0 0 9999px rgba(0,0,0,.27),0 0 34px rgba(255,255,255,.45);animation:psScanSpot ${clamp(layer.scanSpeed, 400, 5000)}ms ease-in-out infinite}
#ps-scan-effect.scan-border{border:3px solid rgba(255,255,255,.95);border-radius:10px;box-shadow:0 0 24px rgba(42,245,152,.45)}
#ps-scan-effect.scan-border:before,#ps-scan-effect.scan-border:after{content:"";position:absolute;background:#2af598;box-shadow:0 0 14px #2af598}
#ps-scan-effect.scan-border:before{left:0;top:0;width:38%;height:4px;animation:psScanBorderH ${clamp(layer.scanSpeed, 400, 5000)}ms linear infinite}
#ps-scan-effect.scan-border:after{right:0;top:0;width:4px;height:38%;animation:psScanBorderV ${clamp(layer.scanSpeed, 400, 5000)}ms linear infinite}
#ps-scan-effect.scan-spark{border-radius:999px;background:rgba(255,243,196,.26);box-shadow:0 0 0 0 rgba(245,158,11,.58),0 0 28px rgba(245,158,11,.52);animation:psScanSpark ${clamp(layer.scanSpeed, 400, 5000)}ms ease-out infinite}
</style>
<div id="ps-scan-effect" class="scan-${escapeHtml(layer.scanStyle)}"></div>`;
  return insertBeforeBody(html, code);
}

function injectHand(html: string, layer: LayerSettings, handDataUrl: string) {
  const code = `
<style id="ps-hand-style">
@keyframes psHandTap{0%,100%{transform:translate(-50%,-50%) scale(1)}45%{transform:translate(-50%,-50%) scale(.82)}}
@keyframes psHandDoubleTap{0%,100%{transform:translate(-50%,-50%) scale(1)}22%,58%{transform:translate(-50%,-50%) scale(.82)}35%,72%{transform:translate(-50%,-50%) scale(1.03)}}
@keyframes psHandPress{0%,100%{transform:translate(-50%,-50%) scale(1)}55%{transform:translate(-50%,-50%) scale(.72)}}
@keyframes psHandBounce{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-18px)}}
@keyframes psHandSwipeX{0%,100%{transform:translate(-74%,-50%)}50%{transform:translate(-28%,-50%)}}
@keyframes psHandSwipeY{0%,100%{transform:translate(-50%,-74%)}50%{transform:translate(-50%,-28%)}}
@keyframes psHandDrag{0%,100%{transform:translate(-72%,-58%) scale(.96)}50%{transform:translate(-28%,-42%) scale(.9)}}
@keyframes psHandShake{0%,100%{transform:translate(-50%,-50%) rotate(0)}25%{transform:translate(-50%,-50%) rotate(-8deg)}75%{transform:translate(-50%,-50%) rotate(8deg)}}
@keyframes psHandWave{0%,100%{transform:translate(-50%,-50%) rotate(-9deg)}50%{transform:translate(-50%,-50%) rotate(12deg)}}
#ps-hand-click{position:fixed;left:${clamp(layer.handX, 0, 100)}vw;top:${clamp(layer.handY, 0, 100)}vh;width:${clamp(layer.handSize, 32, 260)}px;z-index:2147483000;pointer-events:none;filter:drop-shadow(0 8px 14px rgba(0,0,0,.28));animation:psHand${animName(layer.handMotion)} 1.1s infinite ease-in-out}
</style>
<img id="ps-hand-click" src="${handDataUrl}" alt="">`;
  return insertBeforeBody(html, code);
}

function insertBeforeBody(html: string, code: string) {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${code}\n</body>`);
  return `${html}\n${code}`;
}

function replaceCommonCtaText(html: string, text: string) {
  return html.replace(
    />(\s*)(INSTALL FREE|INSTALL NOW|PLAY NOW|START NOW|GET STARTED|CONTINUE|DOWNLOAD|TRY NOW)(\s*)</gi,
    `>$1${escapeHtml(text)}$3<`,
  );
}

function animName(anim: LayerSettings['handMotion']) {
  return {
    tap: 'Tap',
    doubleTap: 'DoubleTap',
    press: 'Press',
    bounce: 'Bounce',
    swipeX: 'SwipeX',
    swipeY: 'SwipeY',
    drag: 'Drag',
    shake: 'Shake',
    wave: 'Wave',
  }[anim];
}

export function safeFileName(value: string) {
  return (
    value
      .replace(/\.[^.]+$/, '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || 'playable'
  );
}

function stripExtension(value: string) {
  return value.replace(/\.[^.]+$/, '');
}

function escapeHtml(value: string | number) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] || char;
  });
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundCssNumber(value: number) {
  return Math.round(value * 1000) / 1000;
}
