import type {
  ExportImageInput,
  ImageFit,
  LayerSettings,
  LayerTarget,
  NetworkTarget,
  Orientation,
  ProjectSettings,
  StorePlatform,
  StoreRoutingMode,
} from './types';
import { getHandAnchorOffset } from './hand-assets';
import { getVisualAsset } from './visual-assets';

const previewFontStack = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export interface StoreRuntimeConfig {
  mode: StoreRoutingMode;
  singleUrl: string;
  fallbackUrl: string;
  appStoreUrl: string;
  googlePlayUrl: string;
  storePlatform: StorePlatform;
}

export interface ImagePlayableExportInput {
  image: ExportImageInput;
  layer: LayerSettings;
  store: StoreRuntimeConfig;
  network: NetworkTarget;
  useClickTag: boolean;
  handDataUrl?: string;
  orientation?: Orientation;
  imageFit?: ImageFit;
  previewMode?: boolean;
}

export interface HtmlPatchInput {
  html: string;
  layer: LayerSettings;
  store: StoreRuntimeConfig;
  network: NetworkTarget;
  useClickTag: boolean;
  replaceLinks: boolean;
  ctaSelector: string;
  handDataUrl?: string;
  previewMode?: boolean;
}

export const networkExportTargets: NetworkTarget[] = ['unity', 'applovin', 'google', 'mintegral', 'moloco'];

export const networkLabels: Record<NetworkTarget, string> = {
  unity: 'Unity',
  applovin: 'AppLovin',
  google: 'Google',
  mintegral: 'Mintegral',
  moloco: 'Moloco',
  mraid: 'Generic MRAID',
};

export const legacyDefaultProjectPrompt =
  'Create high-converting mobile playable ad background variants similar to the reference image. Remove all in-image text by default, including headlines, labels, and CTA copy from the reference. Only keep a short primary headline when the prompt explicitly asks for in-image text. Keep product intent, readable mobile composition, and a clean CTA-safe lower area. Keep important content away from the bottom safe zone instead of pushing it too low. Do not draw hand cursors, scan boxes, CTA buttons, or tap/click cue text into the image; runtime overlays will add tap, drag, swipe, text cue, click, and CTA animation.';

export const defaultProjectPrompt =
  'Create high-converting mobile playable ad background variants similar to the reference image. Keep product intent, readable mobile composition, and fill the full 9:16 canvas without empty lower padding or white margins. Remove all in-image text from generated variants by default, including text already visible in the reference image. Only keep one short primary headline when the prompt explicitly asks for in-image text. Respect the bottom safe zone: do not place important content too close to the lower edge, and keep the lower area simple enough for runtime CTA overlays without turning it into a blank strip. Do not draw hand cursors, scan boxes, CTA buttons, tap/click cue text, or other editor UI into the image; runtime overlays can add interaction later.';

export function createDefaultProjectSettings(): ProjectSettings {
  return {
    name: 'Playable batch',
    prompt: defaultProjectPrompt,
    locale: 'auto',
    brandAssetDataUrl: '',
    brandAssetName: '',
    storeUrl: '',
    appStoreUrl: '',
    googlePlayUrl: '',
    storePlatform: 'app-store',
    storeRoutingMode: 'single',
    network: 'applovin',
    orientation: 'portrait',
    imageFit: 'cover',
    aiProvider: 'gemini-flash',
    variantCount: 4,
    useAiAnalyze: false,
    useClickTag: true,
    replaceLinks: true,
    ctaSelector: "button,[role='button'],.cta,.btn",
    syncAllVariants: true,
  };
}

export function normalizeProjectSettings(settings?: Partial<ProjectSettings> | null): ProjectSettings {
  return {
    ...createDefaultProjectSettings(),
    ...(settings || {}),
  };
}

export function resolveProjectStoreUrl(settings: Pick<ProjectSettings, 'storeUrl' | 'appStoreUrl' | 'googlePlayUrl' | 'storePlatform'>) {
  if (settings.storePlatform === 'app-store') {
    return settings.appStoreUrl || settings.storeUrl || settings.googlePlayUrl || '';
  }
  if (settings.storePlatform === 'google-play') {
    return settings.googlePlayUrl || settings.storeUrl || settings.appStoreUrl || '';
  }
  return settings.storeUrl || settings.appStoreUrl || settings.googlePlayUrl || '';
}

export function resolveProjectStoreConfig(
  settings: Pick<ProjectSettings, 'storeUrl' | 'appStoreUrl' | 'googlePlayUrl' | 'storePlatform' | 'storeRoutingMode'>,
): StoreRuntimeConfig {
  const singleUrl = resolveProjectStoreUrl(settings);
  const mode = settings.storeRoutingMode === 'platform-auto' ? 'platform-auto' : 'single';
  return {
    mode,
    singleUrl,
    fallbackUrl:
      mode === 'platform-auto'
        ? settings.appStoreUrl || settings.googlePlayUrl || ''
        : singleUrl || settings.appStoreUrl || settings.googlePlayUrl || '',
    appStoreUrl: settings.appStoreUrl || '',
    googlePlayUrl: settings.googlePlayUrl || '',
    storePlatform: settings.storePlatform,
  };
}

export function getImageFrameLayout(
  layer: Partial<LayerSettings>,
  width: number | undefined,
  height: number | undefined,
  orientation: Orientation,
  imageFit: ImageFit,
) {
  const auto = imageFit === 'cover' ? { widthPercent: 100, heightPercent: 100 } : getContainedArtboard(width, height, orientation);
  return {
    x: clamp(layer.imageX ?? 50, 0, 100),
    y: clamp(layer.imageY ?? 50, 0, 100),
    widthPercent: roundCssNumber(clamp(layer.imageWidth && layer.imageWidth > 0 ? layer.imageWidth : auto.widthPercent, 12, 180)),
    heightPercent: roundCssNumber(clamp(layer.imageHeight && layer.imageHeight > 0 ? layer.imageHeight : auto.heightPercent, 12, 180)),
    rotation: roundCssNumber(clamp(layer.imageRotation || 0, -180, 180)),
  };
}

export function generateImagePlayableHtml({
  image,
  layer,
  store,
  network,
  useClickTag,
  handDataUrl,
  orientation = 'portrait',
  imageFit = 'cover',
  previewMode = false,
}: ImagePlayableExportInput) {
  layer = withCtaCompanions(layer);
  const handAnchorOffset = getHandAnchorOffset(layer.handId, layer.handSize);
  const scanAnchorOffset = {
    x: handAnchorOffset.x + layer.scanOffsetX,
    y: handAnchorOffset.y + layer.scanOffsetY,
  };
  const includeBackdrop = network !== 'applovin';
  const scanFollowsFinger = shouldAnchorScanToFinger(layer);
  const scanLeft = scanFollowsFinger ? 'calc(var(--target-x) + var(--hand-anchor-x))' : 'var(--scan-x)';
  const scanTop = scanFollowsFinger ? 'calc(var(--target-y) + var(--hand-anchor-y))' : 'var(--scan-y)';
  const scanIterations = layer.scanLoop === 'once' ? '1' : 'infinite';
  const scanDirection = layer.scanLoop === 'pingpong' ? 'alternate' : 'normal';
  const scanColor = normalizeHexColor(layer.scanColor, '#7c3cff');
  const scanRgb = hexToRgbTriplet(scanColor);
  const ctaColorFrom = normalizeHexColor(layer.ctaColorFrom, '#ff9a2f');
  const ctaColorTo = normalizeHexColor(layer.ctaColorTo, '#f45100');
  const ctaTextColor = normalizeHexColor(layer.ctaTextColor, '#ffffff');
  const ctaShadowRgb = hexToRgbTriplet(layer.ctaShadowColor, '#f45100');
  const cueColor = normalizeHexColor(layer.cueColor, '#ffffff');
  const cueBgRgb = hexToRgbTriplet(layer.cueBgColor, '#111827');
  const cueShadowRgb = hexToRgbTriplet(layer.cueShadowColor, '#000000');
  const frameAspect = orientation === 'landscape' ? 16 / 9 : 9 / 16;
  const frameWidthVh = roundCssNumber(frameAspect * 100);
  const frameHeightVw = roundCssNumber(100 / frameAspect);
  const artboard = getImageFrameLayout(layer, image.width, image.height, orientation, imageFit);
  const networkHeadMarkup = getNetworkHeadMarkup(network);
  const handMarkup =
    layer.injectHand && handDataUrl
      ? `<img class="ps-hand motion-${escapeHtml(layer.handMotion)}" style="z-index:${getLayerZ(layer, 'hand')}" src="${handDataUrl}" alt="">`
      : '';
  const scanMarkup =
    layer.injectScan && layer.scanStyle !== 'none'
      ? `<div class="ps-scan scan-${escapeHtml(layer.scanStyle)}" style="z-index:${getLayerZ(layer, 'scan')}" aria-hidden="true"></div>`
      : '';
  const assetMarkup = layer.injectAsset ? renderAssetMarkup(layer) : '';
  const ctaMarkup = layer.showCta
    ? `<button class="ps-cta btn-${escapeHtml(layer.buttonAnimation)}" style="z-index:${getLayerZ(layer, 'cta')}" type="button">${escapeHtml(layer.ctaText)}</button>`
    : '';
  const cueMarkup = layer.showCue
    ? `<div class="ps-cue cue-${escapeHtml(layer.cueAnimation)}" style="z-index:${getLayerZ(layer, 'text')}">${escapeHtml(layer.cueText)}</div>`
    : '';
  const layerMarkup = getLayerOrder(layer)
    .map((target) => {
      if (target === 'scan') return scanMarkup;
      if (target === 'asset') return assetMarkup;
      if (target === 'hand') return handMarkup;
      if (target === 'text') return cueMarkup;
      return ctaMarkup;
    })
    .filter(Boolean)
    .join('\n      ');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta name="ad.size" content="width=100%,height=100%">
  <title>${escapeHtml(stripExtension(image.name))}</title>
  ${networkHeadMarkup}
  <style>
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#f1f4fb;font-family:${previewFontStack};-webkit-user-select:none;user-select:none}
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    .ps-scene{position:fixed;inset:0;overflow:hidden;background:#f1f4fb;touch-action:manipulation}
    .ps-frame{--target-x:${clamp(layer.handX, 0, 100)}%;--target-y:${clamp(layer.handY, 0, 100)}%;--scan-x:${clamp(layer.scanX, 0, 100)}%;--scan-y:${clamp(layer.scanY, 0, 100)}%;--asset-x:${clamp(layer.assetX, 0, 100)}%;--asset-y:${clamp(layer.assetY, 0, 100)}%;--cta-x:${clamp(layer.ctaX, 0, 100)}%;--cta-y:${clamp(layer.ctaY, 0, 100)}%;--cue-x:${clamp(layer.cueX, 0, 100)}%;--cue-y:${clamp(layer.cueY, 0, 100)}%;--hand-size:${clamp(layer.handSize, 32, 260)}px;--scan-size:${clamp(layer.scanSize, 48, 360)}px;--asset-size:${clamp(layer.assetSize, 48, 280)}px;--asset-speed:${clamp(layer.assetSpeed, 500, 5000)}ms;--scan-speed:${clamp(layer.scanSpeed, 400, 5000)}ms;--scan-delay:${clamp(layer.scanDelay, 0, 3000)}ms;--scan-iterations:${scanIterations};--scan-direction:${scanDirection};--scan-color:${scanColor};--scan-color-rgb:${scanRgb};--scan-scale-start:${clamp(layer.scanScaleStart, .2, 2)};--scan-scale-end:${clamp(layer.scanScaleEnd, .2, 3)};--scan-opacity-start:${clamp(layer.scanOpacityStart / 100, 0, 1)};--scan-opacity-end:${clamp(layer.scanOpacityEnd / 100, 0, 1)};--cta-width:${clamp(layer.ctaWidth, 44, 92)}%;--cta-from:${ctaColorFrom};--cta-to:${ctaColorTo};--cta-text:${ctaTextColor};--cta-shadow-rgb:${ctaShadowRgb};--cue-width:${clamp(layer.cueWidth, 28, 96)}%;--cue-size:${clamp(layer.cueSize, 12, 42)}px;--cue-color:${cueColor};--cue-bg-rgb:${cueBgRgb};--cue-shadow-rgb:${cueShadowRgb};--hand-anchor-x:${scanAnchorOffset.x}px;--hand-anchor-y:${scanAnchorOffset.y}px;--hand-rotation:${clamp(layer.handRotation || 0, -180, 180)}deg;--scan-rotation:${clamp(layer.scanRotation || 0, -180, 180)}deg;--asset-rotation:${clamp(layer.assetRotation || 0, -180, 180)}deg;--cta-rotation:${clamp(layer.ctaRotation || 0, -180, 180)}deg;--cue-rotation:${clamp(layer.cueRotation || 0, -180, 180)}deg;--artboard-x:${artboard.x}%;--artboard-y:${artboard.y}%;--artboard-w:${artboard.widthPercent}%;--artboard-h:${artboard.heightPercent}%;--artboard-rotation:${artboard.rotation}deg;position:absolute;left:50%;top:50%;width:min(100vw,${frameWidthVh}vh);height:min(100vh,${frameHeightVw}vw);transform:translate(-50%,-50%);overflow:hidden;background:#f1f4fb}
    .ps-backdrop{position:absolute;inset:-3%;width:106%;height:106%;object-fit:cover;filter:blur(18px) saturate(1.04);opacity:.34;transform:scale(1.02);display:block}
    .ps-artboard{position:absolute;left:var(--artboard-x);top:var(--artboard-y);width:var(--artboard-w);height:var(--artboard-h);transform:translate(-50%,-50%);rotate:var(--artboard-rotation);overflow:hidden;background:#f1f4fb}
    .ps-creative{position:absolute;inset:0;width:100%;height:100%;object-fit:${imageFit};display:block;background:#f1f4fb}
    .ps-hand{position:absolute;left:var(--target-x);top:var(--target-y);width:var(--hand-size);z-index:6;pointer-events:none;filter:drop-shadow(0 9px 14px rgba(0,0,0,.32));transform:translate(-50%,-50%);rotate:var(--hand-rotation)}
    .ps-scan{position:absolute;left:${scanLeft};top:${scanTop};width:var(--scan-size);height:var(--scan-size);z-index:5;pointer-events:none;transform:translate(-50%,-50%);rotate:var(--scan-rotation)}
    .ps-asset{position:absolute;left:var(--asset-x);top:var(--asset-y);width:var(--asset-size);height:var(--asset-size);display:grid;place-items:center;pointer-events:none;transform:translate(-50%,-50%);rotate:var(--asset-rotation)}
    .ps-asset .asset-preview{position:relative;width:100%;height:100%;display:grid;place-items:center;overflow:visible;border:0;border-radius:0;color:#e11d48;background:transparent;box-shadow:none}
    .ps-asset .asset-preview-custom-image{position:relative;width:100%;height:100%;display:grid;place-items:center}
    .ps-asset .asset-preview-custom-image img{display:block;max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain}
    .ps-asset .asset-preview b{font-size:clamp(14px,18%,28px);font-weight:900;line-height:1}.ps-asset .asset-preview small{font-size:10px;color:#626b7a;font-weight:800}.ps-asset .asset-preview-ecg,.ps-asset .asset-preview-scan-grid,.ps-asset .asset-preview-scan-crop-box,.ps-asset .asset-preview-scan-photo-frame{border-radius:12px}.asset-preview-ecg i{width:78%;height:54%;background:linear-gradient(135deg,transparent 0 20%,#e11d48 21% 24%,transparent 25% 36%,#e11d48 37% 40%,transparent 41% 54%,#e11d48 55% 58%,transparent 59%),linear-gradient(90deg,rgba(225,29,72,.18) 1px,transparent 1px);background-size:100% 100%,10px 10px}.asset-preview-heart-live-dot,.asset-preview-status-normal{display:inline-flex;gap:6px;padding:0 8px;width:auto;min-width:54px;color:#0f9f6e}.asset-preview-heart-live-dot i,.asset-preview-status-normal i{width:9px;height:9px;border-radius:999px;background:currentColor;box-shadow:0 0 0 5px rgba(15,159,110,.12)}.asset-preview-scan-reticle i,.asset-preview-scan-grid i,.asset-preview-scan-beam i{width:62%;height:62%;border:2px solid #28a5ff;border-radius:999px;box-shadow:0 0 0 7px rgba(37,99,235,.1),inset 0 0 0 1px rgba(37,99,235,.25)}.asset-preview-scan-frame-box i{width:72%;height:56%;border:1.5px solid #7c3cff;border-radius:8px;background:radial-gradient(circle at 0 0,#fff 0 2px,#7c3cff 2px 4px,transparent 5px),radial-gradient(circle at 100% 0,#fff 0 2px,#7c3cff 2px 4px,transparent 5px),radial-gradient(circle at 0 100%,#fff 0 2px,#7c3cff 2px 4px,transparent 5px),radial-gradient(circle at 100% 100%,#fff 0 2px,#7c3cff 2px 4px,transparent 5px),rgba(124,60,255,.05);box-shadow:0 0 8px rgba(124,60,255,.14),inset 0 0 6px rgba(124,60,255,.08)}.asset-preview-scan-grid i{border-radius:8px;background:linear-gradient(90deg,rgba(37,99,235,.18) 1px,transparent 1px),linear-gradient(180deg,rgba(37,99,235,.18) 1px,transparent 1px);background-size:8px 8px}.asset-preview-scan-beam i:after,.asset-preview-scan-vertical-beam i:after{content:"";position:absolute;top:18%;bottom:18%;left:48%;width:3px;background:#28a5ff;box-shadow:0 0 12px #28a5ff}.asset-preview-scan-food-card,.asset-preview-scan-calorie-chip{align-items:end;justify-items:end;padding:6px;color:#e11d48}.asset-preview-scan-food-card i,.asset-preview-scan-crop-box i,.asset-preview-scan-photo-frame i{position:absolute;left:12%;top:14%;width:58%;height:52%;border:2px solid rgba(255,255,255,.95);border-radius:8px;background:radial-gradient(circle at 34% 42%,#fde68a 0 13%,transparent 14%),radial-gradient(circle at 70% 52%,#86efac 0 14%,transparent 15%),linear-gradient(135deg,#fecaca,#bfdbfe);box-shadow:0 0 0 1px rgba(37,99,235,.26),0 0 18px rgba(37,99,235,.28)}.asset-preview-scan-food-card b,.asset-preview-scan-calorie-chip b{position:relative;z-index:1;padding:3px 5px;border-radius:7px;color:#e11d48;background:#fff;font-size:12px;box-shadow:0 1px 3px rgba(15,23,42,.14)}.asset-preview-scan-food-card small,.asset-preview-scan-calorie-chip small{position:absolute;right:8px;bottom:3px;z-index:1}.asset-preview-scan-corner-lock i{width:62%;height:48%;border-radius:8px;background:linear-gradient(#28a5ff,#28a5ff) left top/14px 3px no-repeat,linear-gradient(#28a5ff,#28a5ff) left top/3px 14px no-repeat,linear-gradient(#28a5ff,#28a5ff) right top/14px 3px no-repeat,linear-gradient(#28a5ff,#28a5ff) right top/3px 14px no-repeat,linear-gradient(#28a5ff,#28a5ff) left bottom/14px 3px no-repeat,linear-gradient(#28a5ff,#28a5ff) left bottom/3px 14px no-repeat,linear-gradient(#28a5ff,#28a5ff) right bottom/14px 3px no-repeat,linear-gradient(#28a5ff,#28a5ff) right bottom/3px 14px no-repeat}.asset-preview-scan-nutrition-arrow i{width:48%;height:48%;border-right:4px solid #ef4444;border-bottom:4px solid #ef4444;border-radius:0 0 18px 0;transform:rotate(8deg)}.asset-preview-scan-nutrition-arrow i:after{content:"";position:absolute;right:-8px;bottom:-7px;border-top:7px solid #ef4444;border-left:7px solid transparent;border-right:7px solid transparent;transform:rotate(-38deg)}.asset-preview-scan-barcode i{width:66%;height:48%;border-radius:6px;background:linear-gradient(90deg,#111827 0 3px,transparent 3px 6px,#111827 6px 8px,transparent 8px 12px,#111827 12px 16px,transparent 16px 19px,#111827 19px 22px,transparent 22px 26px,#111827 26px 28px,transparent 28px 33px,#111827 33px 38px,transparent 38px),#fff;box-shadow:inset 0 0 0 2px rgba(37,99,235,.24)}.asset-preview-scan-vertical-beam i{width:66%;height:52%;border:2px solid rgba(37,99,235,.35);border-radius:8px;background:rgba(219,234,254,.72)}.asset-preview-scan-radar-sweep i{width:62%;height:62%;border-radius:999px;background:conic-gradient(from 40deg,rgba(37,99,235,.05),rgba(37,99,235,.82),rgba(37,99,235,.05) 34%,transparent 35%);border:2px solid rgba(37,99,235,.44);box-shadow:inset 0 0 0 7px rgba(37,99,235,.08),0 0 18px rgba(37,99,235,.28)}.asset-motion-pulse{animation:psAssetPulse var(--asset-speed) ease-in-out infinite}.asset-motion-blink{animation:psAssetBlink var(--asset-speed) steps(2,end) infinite}.asset-motion-sweep .asset-preview:after{content:"";position:absolute;top:-18%;bottom:-18%;left:-20%;width:5px;background:linear-gradient(180deg,transparent,rgba(37,99,235,.82),transparent);box-shadow:0 0 18px rgba(37,99,235,.72);animation:psAssetSweep var(--asset-speed) linear infinite}.asset-motion-wave .asset-preview i{animation:psAssetWave var(--asset-speed) ease-in-out infinite}.asset-motion-count .asset-preview{animation:psAssetCount var(--asset-speed) ease-in-out infinite}
    .scan-ripple{border:3px solid rgba(125,221,255,.9);border-radius:999px;background:transparent;box-shadow:0 0 0 0 rgba(125,221,255,.42),0 0 22px rgba(125,221,255,.46);animation-name:psRipple;animation-duration:var(--scan-speed);animation-timing-function:ease-out;animation-delay:var(--scan-delay);animation-iteration-count:var(--scan-iterations);animation-direction:var(--scan-direction);animation-fill-mode:both;animation-play-state:${layer.scanAutoplay ? 'running' : 'paused'}}
    .scan-ripple:after{content:"";position:absolute;inset:-10px;border:2px solid rgba(125,221,255,.48);border-radius:inherit;animation-name:psRippleHalo;animation-duration:var(--scan-speed);animation-timing-function:ease-out;animation-delay:var(--scan-delay);animation-iteration-count:var(--scan-iterations);animation-direction:var(--scan-direction);animation-fill-mode:both}
    .scan-face{border:0;border-radius:12px;background:linear-gradient(#3b82f6,#3b82f6) left top/26% 3px no-repeat,linear-gradient(#3b82f6,#3b82f6) left top/3px 26% no-repeat,linear-gradient(#3b82f6,#3b82f6) right top/26% 3px no-repeat,linear-gradient(#3b82f6,#3b82f6) right top/3px 26% no-repeat,linear-gradient(#3b82f6,#3b82f6) left bottom/26% 3px no-repeat,linear-gradient(#3b82f6,#3b82f6) left bottom/3px 26% no-repeat,linear-gradient(#3b82f6,#3b82f6) right bottom/26% 3px no-repeat,linear-gradient(#3b82f6,#3b82f6) right bottom/3px 26% no-repeat;box-shadow:none;animation:psFaceScan var(--scan-speed) ease-in-out infinite}
    .scan-face:after{content:"";position:absolute;left:16%;right:16%;top:50%;height:2px;background:linear-gradient(90deg,transparent,rgba(59,130,246,.9),transparent);box-shadow:0 0 12px rgba(59,130,246,.6);animation:psFaceLine var(--scan-speed) ease-in-out infinite}
    .scan-sweep{overflow:hidden;border:2px solid rgba(255,255,255,.78);border-radius:16px;background:rgba(31,182,255,.08);box-shadow:0 0 24px rgba(0,194,255,.34)}
    .scan-sweep:after{content:"";position:absolute;top:-20%;bottom:-20%;width:5px;left:-16%;background:linear-gradient(180deg,transparent,#fff,transparent);box-shadow:0 0 18px #00d5ff;animation:psSweep var(--scan-speed) linear infinite}
    .scan-ring{border:4px solid rgba(255,255,255,.92);border-radius:999px;box-shadow:0 0 0 0 rgba(0,213,255,.48),0 0 30px rgba(0,213,255,.34);animation:psRing var(--scan-speed) ease-out infinite}
    .scan-spotlight{border-radius:999px;background:radial-gradient(circle,rgba(255,255,255,.18) 0,rgba(0,213,255,.20) 45%,rgba(0,0,0,0) 70%);box-shadow:0 0 0 9999px rgba(0,0,0,.27),0 0 34px rgba(255,255,255,.45);animation:psSpot var(--scan-speed) ease-in-out infinite}
    .scan-border{overflow:hidden;border:2px solid rgba(var(--scan-color-rgb),.9);border-radius:12px;background:linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) left top/28% 3px no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) left top/3px 28% no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) right top/28% 3px no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) right top/3px 28% no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) left bottom/28% 3px no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) left bottom/3px 28% no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) right bottom/28% 3px no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) right bottom/3px 28% no-repeat,rgba(var(--scan-color-rgb),.08);box-shadow:0 0 24px rgba(var(--scan-color-rgb),.42),inset 0 0 18px rgba(var(--scan-color-rgb),.16)}
    .scan-border:before{content:"";position:absolute;left:8%;right:8%;top:-16%;height:18%;border-radius:999px;background:linear-gradient(180deg,transparent,rgba(255,255,255,.95),rgba(var(--scan-color-rgb),.78),transparent);box-shadow:0 0 22px rgba(var(--scan-color-rgb),.85);animation:psBorderBeam var(--scan-speed) ease-in-out var(--scan-delay) var(--scan-iterations) var(--scan-direction) both;animation-play-state:${layer.scanAutoplay ? 'running' : 'paused'}}
    .scan-border:after{content:"";position:absolute;inset:8%;border:1px solid rgba(255,255,255,.44);border-radius:8px;box-shadow:inset 0 0 18px rgba(var(--scan-color-rgb),.22)}
    .scan-frame{overflow:hidden;border:2px solid rgba(var(--scan-color-rgb),.82);border-radius:10px;background:radial-gradient(circle at 0 0,#fff 0 2px,rgba(var(--scan-color-rgb),.96) 2px 4px,transparent 5px),radial-gradient(circle at 100% 0,#fff 0 2px,rgba(var(--scan-color-rgb),.96) 2px 4px,transparent 5px),radial-gradient(circle at 0 100%,#fff 0 2px,rgba(var(--scan-color-rgb),.96) 2px 4px,transparent 5px),radial-gradient(circle at 100% 100%,#fff 0 2px,rgba(var(--scan-color-rgb),.96) 2px 4px,transparent 5px),rgba(var(--scan-color-rgb),.04);box-shadow:0 0 0 1px rgba(255,255,255,.58),0 0 12px rgba(var(--scan-color-rgb),.2),inset 0 0 8px rgba(var(--scan-color-rgb),.08)}
    .scan-frame:before{content:"";position:absolute;left:8%;right:8%;top:-24%;height:16%;border-radius:999px;background:linear-gradient(180deg,transparent,rgba(255,255,255,.84),rgba(var(--scan-color-rgb),.36),transparent);box-shadow:0 0 10px rgba(var(--scan-color-rgb),.3);animation:psFrameBeam var(--scan-speed) ease-in-out var(--scan-delay) var(--scan-iterations) var(--scan-direction) both;animation-play-state:${layer.scanAutoplay ? 'running' : 'paused'}}
    .scan-frame:after{content:"";position:absolute;inset:12px;border:1px solid rgba(255,255,255,.36);border-radius:6px;box-shadow:inset 0 0 8px rgba(var(--scan-color-rgb),.12)}
    .scan-spark{border-radius:999px;background:rgba(255,243,196,.26);box-shadow:0 0 0 0 rgba(245,158,11,.58),0 0 28px rgba(245,158,11,.52);animation:psSpark var(--scan-speed) ease-out infinite}
    .ps-cta{position:absolute;left:var(--cta-x);top:var(--cta-y);z-index:8;width:var(--cta-width);max-width:88%;min-height:54px;padding:0 22px;border:0;border-radius:10px;background:linear-gradient(180deg,var(--cta-from),var(--cta-to));color:var(--cta-text);font-family:inherit;font-size:19px;font-weight:900;letter-spacing:0;text-align:center;text-shadow:0 1px 1px rgba(0,0,0,.22);box-shadow:inset 0 1px 0 rgba(255,255,255,.46),inset 0 -5px 0 rgba(0,0,0,.14),0 12px 24px rgba(var(--cta-shadow-rgb),.34);transform:translate(-50%,-50%);rotate:var(--cta-rotation);cursor:pointer}
    .btn-pulse{animation:psCtaPulse 1.08s ease-in-out infinite}.btn-bounce{animation:psCtaBounce .95s ease-in-out infinite}.btn-shake{animation:psCtaShake .48s ease-in-out infinite}.btn-breath{animation:psCtaBreath 1.15s ease-in-out infinite}.btn-shine{overflow:hidden;background:linear-gradient(180deg,var(--cta-from),var(--cta-to))}.btn-shine:after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 0%,rgba(255,255,255,.58) 45%,transparent 70%);transform:translateX(-120%);animation:psCtaShine 1.25s linear infinite}
    .ps-cue{position:absolute;left:var(--cue-x);top:var(--cue-y);width:var(--cue-width);min-height:34px;display:inline-flex;align-items:center;justify-content:center;padding:.38em .76em;border:1px solid rgba(255,255,255,.32);border-radius:999px;color:var(--cue-color);background:rgba(var(--cue-bg-rgb),.76);box-shadow:0 10px 22px rgba(var(--cue-shadow-rgb),.24),inset 0 1px 0 rgba(255,255,255,.26);font-family:inherit;font-size:var(--cue-size);font-weight:900;line-height:1.1;letter-spacing:.01em;text-align:center;text-shadow:0 2px 4px rgba(var(--cue-shadow-rgb),.42);transform:translate(-50%,-50%);rotate:var(--cue-rotation);pointer-events:none;white-space:nowrap}.cue-pulse{animation:psCuePulse 1.05s ease-in-out infinite}.cue-bounce{animation:psCueBounce .98s ease-in-out infinite}.cue-shake{animation:psCueShake .62s ease-in-out infinite}.cue-breath{animation:psCueBreath 1.25s ease-in-out infinite}.cue-float{animation:psCueFloat 1.35s ease-in-out infinite}.cue-blink{animation:psCueBlink 1s steps(2,end) infinite}.cue-typewriter{overflow:hidden;animation:psCueTypewriter 1.45s steps(18,end) infinite alternate}
    .motion-tap{animation:psHandTap 1.05s ease-in-out infinite}.motion-doubleTap{animation:psHandDoubleTap 1.18s ease-in-out infinite}.motion-press{animation:psHandPress 1.05s ease-in-out infinite}.motion-bounce{animation:psHandBounce 1s ease-in-out infinite}.motion-swipeX{animation:psHandSwipeX 1.15s ease-in-out infinite}.motion-swipeY{animation:psHandSwipeY 1.15s ease-in-out infinite}.motion-drag{animation:psHandDrag 1.35s ease-in-out infinite}.motion-shake{animation:psHandShake .62s ease-in-out infinite}.motion-wave{animation:psHandWave 1.08s ease-in-out infinite}
    @keyframes psSweep{0%{left:-16%}100%{left:116%}}@keyframes psRipple{0%{opacity:var(--scan-opacity-start);transform:translate(-50%,-50%) scale(var(--scan-scale-start));box-shadow:0 0 0 0 rgba(125,221,255,.42),0 0 18px rgba(125,221,255,.42)}72%{box-shadow:0 0 0 18px rgba(125,221,255,0),0 0 28px rgba(125,221,255,.5)}100%{opacity:var(--scan-opacity-end);transform:translate(-50%,-50%) scale(var(--scan-scale-end));box-shadow:0 0 0 24px rgba(125,221,255,0),0 0 18px rgba(125,221,255,.2)}}@keyframes psRippleHalo{0%{transform:scale(var(--scan-scale-start));opacity:var(--scan-opacity-start)}100%{transform:scale(var(--scan-scale-end));opacity:var(--scan-opacity-end)}}@keyframes psFaceScan{0%,100%{transform:translate(-50%,-50%) scale(.98);opacity:.88}50%{transform:translate(-50%,-50%) scale(1.04);opacity:1}}@keyframes psFaceLine{0%{top:18%;opacity:.18}50%{opacity:1}100%{top:82%;opacity:.18}}@keyframes psRing{0%{transform:translate(-50%,-50%) scale(.72);opacity:1;box-shadow:0 0 0 0 rgba(0,213,255,.52)}100%{transform:translate(-50%,-50%) scale(1.18);opacity:.08;box-shadow:0 0 0 24px rgba(0,213,255,0)}}@keyframes psSpot{0%,100%{transform:translate(-50%,-50%) scale(.92);opacity:.88}50%{transform:translate(-50%,-50%) scale(1.08);opacity:1}}@keyframes psBorderBeam{0%{top:-18%;opacity:.2}50%{opacity:1}100%{top:100%;opacity:.2}}@keyframes psFrameBeam{0%{top:-24%;opacity:.18}50%{opacity:.96}100%{top:102%;opacity:.18}}@keyframes psSpark{0%{transform:translate(-50%,-50%) scale(.55);opacity:1;box-shadow:0 0 0 0 rgba(245,158,11,.56)}100%{transform:translate(-50%,-50%) scale(1.35);opacity:0;box-shadow:0 0 0 26px rgba(245,158,11,0)}}
    @keyframes psAssetPulse{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.08)}}@keyframes psAssetBlink{0%,100%{opacity:1}50%{opacity:.46}}@keyframes psAssetSweep{0%{left:-20%}100%{left:118%}}@keyframes psAssetWave{0%,100%{transform:translateX(-7%)}50%{transform:translateX(7%)}}@keyframes psAssetCount{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
    @keyframes psHandTap{0%,100%{transform:translate(-50%,-50%) scale(1)}45%{transform:translate(-50%,-50%) scale(.82)}}@keyframes psHandDoubleTap{0%,100%{transform:translate(-50%,-50%) scale(1)}22%,58%{transform:translate(-50%,-50%) scale(.82)}35%,72%{transform:translate(-50%,-50%) scale(1.03)}}@keyframes psHandPress{0%,100%{transform:translate(-50%,-50%) scale(1)}55%{transform:translate(-50%,-50%) scale(.72);filter:drop-shadow(0 4px 7px rgba(0,0,0,.36))}}@keyframes psHandBounce{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-18px)}}@keyframes psHandSwipeX{0%,100%{transform:translate(-74%,-50%)}50%{transform:translate(-28%,-50%)}}@keyframes psHandSwipeY{0%,100%{transform:translate(-50%,-74%)}50%{transform:translate(-50%,-28%)}}@keyframes psHandDrag{0%,100%{transform:translate(-72%,-58%) scale(.96)}50%{transform:translate(-28%,-42%) scale(.9)}}@keyframes psHandShake{0%,100%{transform:translate(-50%,-50%) rotate(0)}25%{transform:translate(-50%,-50%) rotate(-8deg)}75%{transform:translate(-50%,-50%) rotate(8deg)}}@keyframes psHandWave{0%,100%{transform:translate(-50%,-50%) rotate(-9deg)}50%{transform:translate(-50%,-50%) rotate(12deg)}}
    @keyframes psCuePulse{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.06)}}@keyframes psCueBounce{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-8px)}}@keyframes psCueShake{0%,100%{transform:translate(-50%,-50%)}25%{transform:translate(calc(-50% - 5px),-50%)}75%{transform:translate(calc(-50% + 5px),-50%)}}@keyframes psCueBreath{0%,100%{filter:brightness(1)}50%{filter:brightness(1.22)}}@keyframes psCueFloat{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-10px)}}@keyframes psCueBlink{0%,100%{opacity:1}50%{opacity:.36}}@keyframes psCueTypewriter{0%{max-width:4ch}100%{max-width:100%}}
    @keyframes psCtaPulse{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.06)}}@keyframes psCtaBounce{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-8px)}}@keyframes psCtaShake{0%,100%{transform:translate(-50%,-50%)}25%{transform:translate(calc(-50% - 5px),-50%)}75%{transform:translate(calc(-50% + 5px),-50%)}}@keyframes psCtaBreath{0%,100%{filter:brightness(1)}50%{filter:brightness(1.18)}}@keyframes psCtaShine{0%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
  </style>
</head>
<body>
  <main class="ps-scene">
    <div class="ps-frame" role="button" aria-label="Open store">
      ${includeBackdrop ? `<img class="ps-backdrop" src="${image.dataUrl}" alt="">` : ''}
      <div class="ps-artboard">
        <img class="ps-creative" src="${image.dataUrl}" alt="">
      </div>
      ${layerMarkup}
    </div>
  </main>
  <script>
  (function(){
    ${buildStoreRuntimeBody(store, network, useClickTag, previewMode, false)}
    var frame = document.querySelector(".ps-frame");
    var cta = document.querySelector(".ps-cta");
    if (cta) cta.addEventListener("click", function(event){ event.stopPropagation(); window.openUrl(); });
    else if (frame) frame.addEventListener("click", function(){ window.openUrl(); });
  })();
  </script>
</body>
</html>`;
}

export function patchPlayableHtml({
  html,
  layer,
  store,
  network,
  useClickTag,
  replaceLinks,
  ctaSelector,
  handDataUrl,
  previewMode = false,
}: HtmlPatchInput) {
  layer = withCtaCompanions(layer);
  let out = stripPreviousInjection(html);

  if (replaceLinks) {
    out = replaceStoreLinks(out, store);
  }
  out = rewriteStoreNavigationCalls(out, store);

  if (layer.ctaText) out = replaceCommonCtaText(out, layer.ctaText);

  out = ensureNetworkHead(out, network);
  out = ensureOpenUrlRuntime(out, store, network, useClickTag, previewMode);

  if (layer.buttonAnimation !== 'none') out = injectButtonAnimation(out, layer.buttonAnimation, ctaSelector);
  if (layer.showCta) out = injectCtaPosition(out, layer, ctaSelector);
  if (layer.showCue) out = injectTextCue(out, layer);
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
    .replace(/<script id="ps-google-exitapi"[\s\S]*?<\/script>\s*/g, '')
    .replace(/<style id="ps-button-anim-style">[\s\S]*?<\/style>\s*/g, '')
    .replace(/<script id="ps-button-anim-script">[\s\S]*?<\/script>\s*/g, '')
    .replace(/<style id="ps-cta-position-style">[\s\S]*?<\/style>\s*/g, '')
    .replace(/<script id="ps-cta-position-script">[\s\S]*?<\/script>\s*/g, '')
    .replace(/<style id="ps-scan-style">[\s\S]*?<\/style>\s*/g, '')
    .replace(/<div id="ps-scan-effect"[\s\S]*?<\/div>\s*/g, '')
    .replace(/<style id="ps-text-cue-style">[\s\S]*?<\/style>\s*/g, '')
    .replace(/<div id="ps-text-cue"[\s\S]*?<\/div>\s*/g, '')
    .replace(/<style id="ps-hand-style">[\s\S]*?<\/style>\s*/g, '')
    .replace(/<img id="ps-hand-click"[\s\S]*?>\s*/g, '');
}

const STORE_URL_PATTERN = String.raw`(?:https?:\/\/(?:apps\.apple\.com|itunes\.apple\.com|play\.google\.com)[^'"<)\s]+|market:\/\/[^'"<)\s]+)`;

function replaceStoreLinks(html: string, store: StoreRuntimeConfig) {
  if (store.mode === 'platform-auto') {
    const iosUrl = store.appStoreUrl || store.singleUrl || store.googlePlayUrl || '';
    const androidUrl = store.googlePlayUrl || store.singleUrl || store.appStoreUrl || '';
    let out = html;
    if (iosUrl) out = out.replace(/https?:\/\/(?:apps\.apple\.com|itunes\.apple\.com)[^'"<)\s]+/g, iosUrl);
    if (androidUrl) out = out.replace(/(?:https?:\/\/play\.google\.com|market:\/\/)[^'"<)\s]+/g, androidUrl);
    return out
      .replace(/window\.openUrl\s*&&\s*window\.openUrl\((['"])(.*?)\1\)/g, 'window.openUrl && window.openUrl()')
      .replace(/window\.openUrl\((['"])(.*?)\1\)/g, 'window.openUrl()');
  }

  if (!store.singleUrl) return html;
  return html
    .replace(/https?:\/\/(?:apps\.apple\.com|play\.google\.com|itunes\.apple\.com)[^'"<)\s]+/g, store.singleUrl)
    .replace(
      /window\.openUrl\s*&&\s*window\.openUrl\((['"])(.*?)\1\)/g,
      `window.openUrl && window.openUrl(${JSON.stringify(store.singleUrl)})`,
    )
    .replace(/window\.openUrl\((['"])(.*?)\1\)/g, `window.openUrl(${JSON.stringify(store.singleUrl)})`);
}

function rewriteStoreNavigationCalls(html: string, store: StoreRuntimeConfig) {
  const replacement =
    store.mode === 'platform-auto'
      ? 'window.openUrl()'
      : store.singleUrl
        ? `window.openUrl(${JSON.stringify(store.singleUrl)})`
        : 'window.openUrl()';
  const patterns = [
    new RegExp(String.raw`mraid\.open\((['"])${STORE_URL_PATTERN}\1\)`, 'g'),
    new RegExp(String.raw`window\.location\.assign\((['"])${STORE_URL_PATTERN}\1\)`, 'g'),
    new RegExp(String.raw`location\.assign\((['"])${STORE_URL_PATTERN}\1\)`, 'g'),
    new RegExp(String.raw`window\.open\((['"])${STORE_URL_PATTERN}\1(?:\s*,[^)]*)?\)`, 'g'),
    new RegExp(String.raw`window\.location\.href\s*=\s*(['"])${STORE_URL_PATTERN}\1`, 'g'),
    new RegExp(String.raw`location\.href\s*=\s*(['"])${STORE_URL_PATTERN}\1`, 'g'),
  ];
  return patterns.reduce((out, pattern) => out.replace(pattern, replacement), html);
}

function buildStoreRuntimeBody(
  store: StoreRuntimeConfig,
  network: NetworkTarget,
  useClickTag: boolean,
  previewMode: boolean,
  preserveExistingOpenUrl: boolean,
) {
  return `
    window.clickTag = window.clickTag || "";
    window.psStore = ${JSON.stringify(store)};
    window.psUseClickTag = ${JSON.stringify(useClickTag)};
    window.psNetwork = ${JSON.stringify(network)};
    window.psPreviewMode = ${JSON.stringify(previewMode)};
    window.psDetectPlatform = window.psDetectPlatform || function(){
      var ua = String((navigator && (navigator.userAgent || navigator.vendor)) || "").toLowerCase();
      if (/android/.test(ua)) return "android";
      if (/iphone|ipad|ipod|ios/.test(ua)) return "ios";
      return "other";
    };
    window.psIsStoreUrl = window.psIsStoreUrl || function(url){
      return /(?:apps\\.apple\\.com|itunes\\.apple\\.com|play\\.google\\.com|market:\\/\\/)/i.test(String(url || ""));
    };
    window.psResolveStoreUrl = function(url){
      var directUrl = typeof url === "string" ? url : "";
      var config = window.psStore || {};
      var fallbackUrl = config.fallbackUrl || config.singleUrl || config.appStoreUrl || config.googlePlayUrl || "";
      var platform = window.psDetectPlatform();
      var platformUrl = fallbackUrl;
      if (platform === "ios") platformUrl = config.appStoreUrl || fallbackUrl || config.googlePlayUrl || "";
      else if (platform === "android") platformUrl = config.googlePlayUrl || fallbackUrl || config.appStoreUrl || "";
      if (window.psUseClickTag && window.clickTag) return window.clickTag;
      if (config.mode === "platform-auto") {
        if (directUrl && !window.psIsStoreUrl(directUrl)) return directUrl;
        return platformUrl || directUrl || "";
      }
      return directUrl || config.singleUrl || platformUrl || "";
    };
    ${preserveExistingOpenUrl ? 'window.openUrl = window.openUrl || function(url){' : 'window.openUrl = function(url){'}
      var target = window.psResolveStoreUrl(url);
      if (window.psPreviewMode) { console.log("openUrl", target); return; }
      try { if (window.psNetwork === "google" && typeof ExitApi !== "undefined" && ExitApi.exit) { ExitApi.exit(); return; } } catch(e) {}
      try { if (window.psNetwork === "mintegral") { if (window.install) window.install(); if (window.gameEnd) window.gameEnd(); return; } } catch(e) {}
      try { if (window.psNetwork === "moloco" && window.FbPlayableAd && window.FbPlayableAd.onCTAClick) { window.FbPlayableAd.onCTAClick(); return; } } catch(e) {}
      try { if (typeof mraid !== "undefined" && mraid.open) { mraid.open(target); return; } } catch(e) {}
      if (target) window.location.assign(target);
    };
    window.psBindStoreAnchors = function(root){
      var scope = root && root.querySelectorAll ? root : document;
      var nodes = scope.querySelectorAll ? scope.querySelectorAll("a[href], area[href]") : [];
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!node || node.getAttribute("data-ps-store-bound") === "1") continue;
        var href = node.getAttribute("href") || "";
        if (!window.psIsStoreUrl(href)) continue;
        node.setAttribute("data-ps-store-bound", "1");
        node.addEventListener("click", function(event){
          event.preventDefault();
          event.stopPropagation();
          var targetHref = this && this.getAttribute ? (this.getAttribute("href") || "") : "";
          window.openUrl(targetHref);
        });
      }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function(){ window.psBindStoreAnchors(document); });
    else window.psBindStoreAnchors(document);
    window.download = window.openUrl;
  `;
}

function ensureOpenUrlRuntime(
  html: string,
  store: StoreRuntimeConfig,
  network: NetworkTarget,
  useClickTag: boolean,
  previewMode: boolean,
) {
  const runtime = `
<script id="ps-store-runtime">
(function(){
  ${buildStoreRuntimeBody(store, network, useClickTag, previewMode, true)}
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
  const ctaColorFrom = normalizeHexColor(layer.ctaColorFrom, '#ff9a2f');
  const ctaColorTo = normalizeHexColor(layer.ctaColorTo, '#f45100');
  const ctaTextColor = normalizeHexColor(layer.ctaTextColor, '#ffffff');
  const ctaShadowRgb = hexToRgbTriplet(layer.ctaShadowColor, '#f45100');
  const code = `
<style id="ps-cta-position-style">
.ps-cta-positioned{position:fixed!important;left:${clamp(layer.ctaX, 0, 100)}vw!important;top:${clamp(layer.ctaY, 0, 100)}vh!important;right:auto!important;bottom:auto!important;width:${clamp(layer.ctaWidth, 44, 92)}vw!important;max-width:88vw!important;min-height:54px!important;padding:0 22px!important;border:0!important;border-radius:10px!important;background:linear-gradient(180deg,${ctaColorFrom},${ctaColorTo})!important;color:${ctaTextColor}!important;font-weight:900!important;text-align:center!important;text-shadow:0 1px 1px rgba(0,0,0,.22)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.46),inset 0 -5px 0 rgba(0,0,0,.14),0 12px 24px rgba(${ctaShadowRgb},.34)!important;z-index:2147482999!important;transform:translate(-50%,-50%)!important;rotate:${clamp(layer.ctaRotation || 0, -180, 180)}deg!important}
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
  const handAnchorOffset = getHandAnchorOffset(layer.handId, layer.handSize);
  const anchorOffset = {
    x: handAnchorOffset.x + layer.scanOffsetX,
    y: handAnchorOffset.y + layer.scanOffsetY,
  };
  const scanLeft = shouldAnchorScanToFinger(layer) ? `calc(${clamp(layer.handX, 0, 100)}vw + ${anchorOffset.x}px)` : `${clamp(layer.scanX, 0, 100)}vw`;
  const scanTop = shouldAnchorScanToFinger(layer) ? `calc(${clamp(layer.handY, 0, 100)}vh + ${anchorOffset.y}px)` : `${clamp(layer.scanY, 0, 100)}vh`;
  const scanIterations = layer.scanLoop === 'once' ? '1' : 'infinite';
  const scanDirection = layer.scanLoop === 'pingpong' ? 'alternate' : 'normal';
  const scanColor = normalizeHexColor(layer.scanColor, '#7c3cff');
  const scanRgb = hexToRgbTriplet(scanColor);
  const code = `
<style id="ps-scan-style">
@keyframes psScanRipple{0%{opacity:${clamp(layer.scanOpacityStart / 100, 0, 1)};transform:translate(-50%,-50%) scale(${clamp(layer.scanScaleStart, .2, 2)});box-shadow:0 0 0 0 rgba(125,221,255,.42),0 0 18px rgba(125,221,255,.42)}72%{box-shadow:0 0 0 18px rgba(125,221,255,0),0 0 28px rgba(125,221,255,.5)}100%{opacity:${clamp(layer.scanOpacityEnd / 100, 0, 1)};transform:translate(-50%,-50%) scale(${clamp(layer.scanScaleEnd, .2, 3)});box-shadow:0 0 0 24px rgba(125,221,255,0),0 0 18px rgba(125,221,255,.2)}}
@keyframes psScanRippleHalo{0%{transform:scale(${clamp(layer.scanScaleStart, .2, 2)});opacity:${clamp(layer.scanOpacityStart / 100, 0, 1)}}100%{transform:scale(${clamp(layer.scanScaleEnd, .2, 3)});opacity:${clamp(layer.scanOpacityEnd / 100, 0, 1)}}}
@keyframes psScanFace{0%,100%{transform:translate(-50%,-50%) scale(.98);opacity:.88}50%{transform:translate(-50%,-50%) scale(1.04);opacity:1}}
@keyframes psScanFaceLine{0%{top:18%;opacity:.18}50%{opacity:1}100%{top:82%;opacity:.18}}
@keyframes psScanSweep{0%{left:-16%}100%{left:116%}}
@keyframes psScanRing{0%{transform:translate(-50%,-50%) scale(.72);opacity:1;box-shadow:0 0 0 0 rgba(0,213,255,.52)}100%{transform:translate(-50%,-50%) scale(1.18);opacity:.08;box-shadow:0 0 0 24px rgba(0,213,255,0)}}
@keyframes psScanSpot{0%,100%{transform:translate(-50%,-50%) scale(.92);opacity:.88}50%{transform:translate(-50%,-50%) scale(1.08);opacity:1}}
@keyframes psScanBorderBeam{0%{top:-18%;opacity:.2}50%{opacity:1}100%{top:100%;opacity:.2}}
@keyframes psScanFrameBeam{0%{top:-24%;opacity:.18}50%{opacity:.96}100%{top:102%;opacity:.18}}
@keyframes psScanSpark{0%{transform:translate(-50%,-50%) scale(.55);opacity:1;box-shadow:0 0 0 0 rgba(245,158,11,.56)}100%{transform:translate(-50%,-50%) scale(1.35);opacity:0;box-shadow:0 0 0 26px rgba(245,158,11,0)}}
#ps-scan-effect{--scan-color:${scanColor};--scan-color-rgb:${scanRgb};position:fixed;left:${scanLeft};top:${scanTop};width:${clamp(layer.scanSize, 48, 360)}px;height:${clamp(layer.scanSize, 48, 360)}px;z-index:2147482998;pointer-events:none;transform:translate(-50%,-50%);rotate:${clamp(layer.scanRotation || 0, -180, 180)}deg}
#ps-scan-effect.scan-ripple{border:3px solid rgba(125,221,255,.9);border-radius:999px;background:transparent;box-shadow:0 0 0 0 rgba(125,221,255,.42),0 0 22px rgba(125,221,255,.46);animation:psScanRipple ${clamp(layer.scanSpeed, 400, 5000)}ms ease-out ${clamp(layer.scanDelay, 0, 3000)}ms ${scanIterations} ${scanDirection} both;animation-play-state:${layer.scanAutoplay ? 'running' : 'paused'}}
#ps-scan-effect.scan-ripple:after{content:"";position:absolute;inset:-10px;border:2px solid rgba(125,221,255,.48);border-radius:inherit;animation:psScanRippleHalo ${clamp(layer.scanSpeed, 400, 5000)}ms ease-out ${clamp(layer.scanDelay, 0, 3000)}ms ${scanIterations} ${scanDirection} both}
#ps-scan-effect.scan-face{border:0;border-radius:12px;background:linear-gradient(#3b82f6,#3b82f6) left top/26% 3px no-repeat,linear-gradient(#3b82f6,#3b82f6) left top/3px 26% no-repeat,linear-gradient(#3b82f6,#3b82f6) right top/26% 3px no-repeat,linear-gradient(#3b82f6,#3b82f6) right top/3px 26% no-repeat,linear-gradient(#3b82f6,#3b82f6) left bottom/26% 3px no-repeat,linear-gradient(#3b82f6,#3b82f6) left bottom/3px 26% no-repeat,linear-gradient(#3b82f6,#3b82f6) right bottom/26% 3px no-repeat,linear-gradient(#3b82f6,#3b82f6) right bottom/3px 26% no-repeat;box-shadow:none;animation:psScanFace ${clamp(layer.scanSpeed, 400, 5000)}ms ease-in-out infinite}
#ps-scan-effect.scan-face:after{content:"";position:absolute;left:16%;right:16%;top:50%;height:2px;background:linear-gradient(90deg,transparent,rgba(59,130,246,.9),transparent);box-shadow:0 0 12px rgba(59,130,246,.6);animation:psScanFaceLine ${clamp(layer.scanSpeed, 400, 5000)}ms ease-in-out infinite}
#ps-scan-effect.scan-sweep{overflow:hidden;border:2px solid rgba(255,255,255,.78);border-radius:16px;background:rgba(31,182,255,.08);box-shadow:0 0 24px rgba(0,194,255,.34)}
#ps-scan-effect.scan-sweep:after{content:"";position:absolute;top:-20%;bottom:-20%;width:5px;left:-16%;background:linear-gradient(180deg,transparent,#fff,transparent);box-shadow:0 0 18px #00d5ff;animation:psScanSweep ${clamp(layer.scanSpeed, 400, 5000)}ms linear infinite}
#ps-scan-effect.scan-ring{border:4px solid rgba(255,255,255,.92);border-radius:999px;box-shadow:0 0 0 0 rgba(0,213,255,.48),0 0 30px rgba(0,213,255,.34);animation:psScanRing ${clamp(layer.scanSpeed, 400, 5000)}ms ease-out infinite}
#ps-scan-effect.scan-spotlight{border-radius:999px;background:radial-gradient(circle,rgba(255,255,255,.18) 0,rgba(0,213,255,.20) 45%,rgba(0,0,0,0) 70%);box-shadow:0 0 0 9999px rgba(0,0,0,.27),0 0 34px rgba(255,255,255,.45);animation:psScanSpot ${clamp(layer.scanSpeed, 400, 5000)}ms ease-in-out infinite}
#ps-scan-effect.scan-border{overflow:hidden;border:2px solid rgba(var(--scan-color-rgb),.9);border-radius:12px;background:linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) left top/28% 3px no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) left top/3px 28% no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) right top/28% 3px no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) right top/3px 28% no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) left bottom/28% 3px no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) left bottom/3px 28% no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) right bottom/28% 3px no-repeat,linear-gradient(rgba(var(--scan-color-rgb),.95),rgba(var(--scan-color-rgb),.95)) right bottom/3px 28% no-repeat,rgba(var(--scan-color-rgb),.08);box-shadow:0 0 24px rgba(var(--scan-color-rgb),.42),inset 0 0 18px rgba(var(--scan-color-rgb),.16)}
#ps-scan-effect.scan-border:before{content:"";position:absolute;left:8%;right:8%;top:-16%;height:18%;border-radius:999px;background:linear-gradient(180deg,transparent,rgba(255,255,255,.95),rgba(var(--scan-color-rgb),.78),transparent);box-shadow:0 0 22px rgba(var(--scan-color-rgb),.85);animation:psScanBorderBeam ${clamp(layer.scanSpeed, 400, 5000)}ms ease-in-out ${clamp(layer.scanDelay, 0, 3000)}ms ${scanIterations} ${scanDirection} both;animation-play-state:${layer.scanAutoplay ? 'running' : 'paused'}}
#ps-scan-effect.scan-border:after{content:"";position:absolute;inset:8%;border:1px solid rgba(255,255,255,.44);border-radius:8px;box-shadow:inset 0 0 18px rgba(var(--scan-color-rgb),.22)}
#ps-scan-effect.scan-frame{overflow:hidden;border:2px solid rgba(var(--scan-color-rgb),.82);border-radius:10px;background:radial-gradient(circle at 0 0,#fff 0 2px,rgba(var(--scan-color-rgb),.96) 2px 4px,transparent 5px),radial-gradient(circle at 100% 0,#fff 0 2px,rgba(var(--scan-color-rgb),.96) 2px 4px,transparent 5px),radial-gradient(circle at 0 100%,#fff 0 2px,rgba(var(--scan-color-rgb),.96) 2px 4px,transparent 5px),radial-gradient(circle at 100% 100%,#fff 0 2px,rgba(var(--scan-color-rgb),.96) 2px 4px,transparent 5px),rgba(var(--scan-color-rgb),.04);box-shadow:0 0 0 1px rgba(255,255,255,.58),0 0 12px rgba(var(--scan-color-rgb),.2),inset 0 0 8px rgba(var(--scan-color-rgb),.08)}
#ps-scan-effect.scan-frame:before{content:"";position:absolute;left:8%;right:8%;top:-24%;height:16%;border-radius:999px;background:linear-gradient(180deg,transparent,rgba(255,255,255,.84),rgba(var(--scan-color-rgb),.36),transparent);box-shadow:0 0 10px rgba(var(--scan-color-rgb),.3);animation:psScanFrameBeam ${clamp(layer.scanSpeed, 400, 5000)}ms ease-in-out ${clamp(layer.scanDelay, 0, 3000)}ms ${scanIterations} ${scanDirection} both;animation-play-state:${layer.scanAutoplay ? 'running' : 'paused'}}
#ps-scan-effect.scan-frame:after{content:"";position:absolute;inset:12px;border:1px solid rgba(255,255,255,.36);border-radius:6px;box-shadow:inset 0 0 8px rgba(var(--scan-color-rgb),.12)}
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
#ps-hand-click{position:fixed;left:${clamp(layer.handX, 0, 100)}vw;top:${clamp(layer.handY, 0, 100)}vh;width:${clamp(layer.handSize, 32, 260)}px;z-index:2147483000;pointer-events:none;filter:drop-shadow(0 8px 14px rgba(0,0,0,.28));rotate:${clamp(layer.handRotation || 0, -180, 180)}deg;animation:psHand${animName(layer.handMotion)} 1.1s infinite ease-in-out}
</style>
<img id="ps-hand-click" src="${handDataUrl}" alt="">`;
  return insertBeforeBody(html, code);
}

function injectTextCue(html: string, layer: LayerSettings) {
  const cueColor = normalizeHexColor(layer.cueColor, '#ffffff');
  const cueBgRgb = hexToRgbTriplet(layer.cueBgColor, '#111827');
  const cueShadowRgb = hexToRgbTriplet(layer.cueShadowColor, '#000000');
  const code = `
<style id="ps-text-cue-style">
@keyframes psCuePulse{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.06)}}
@keyframes psCueBounce{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-8px)}}
@keyframes psCueShake{0%,100%{transform:translate(-50%,-50%)}25%{transform:translate(calc(-50% - 5px),-50%)}75%{transform:translate(calc(-50% + 5px),-50%)}}
@keyframes psCueBreath{0%,100%{filter:brightness(1)}50%{filter:brightness(1.22)}}
@keyframes psCueFloat{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-10px)}}
@keyframes psCueBlink{0%,100%{opacity:1}50%{opacity:.36}}
@keyframes psCueTypewriter{0%{max-width:4ch}100%{max-width:100%}}
#ps-text-cue{position:fixed;left:${clamp(layer.cueX, 0, 100)}vw;top:${clamp(layer.cueY, 0, 100)}vh;width:${clamp(layer.cueWidth, 28, 96)}vw;min-height:34px;display:inline-flex;align-items:center;justify-content:center;padding:.38em .76em;border:1px solid rgba(255,255,255,.32);border-radius:999px;color:${cueColor};background:rgba(${cueBgRgb},.76);box-shadow:0 10px 22px rgba(${cueShadowRgb},.24),inset 0 1px 0 rgba(255,255,255,.26);font-family:${previewFontStack};font-size:${clamp(layer.cueSize, 12, 42)}px;font-weight:900;line-height:1.1;letter-spacing:.01em;text-align:center;text-shadow:0 2px 4px rgba(${cueShadowRgb},.42);z-index:2147482997;transform:translate(-50%,-50%);rotate:${clamp(layer.cueRotation || 0, -180, 180)}deg;pointer-events:none;white-space:nowrap}
#ps-text-cue.cue-pulse{animation:psCuePulse 1.05s ease-in-out infinite}
#ps-text-cue.cue-bounce{animation:psCueBounce .98s ease-in-out infinite}
#ps-text-cue.cue-shake{animation:psCueShake .62s ease-in-out infinite}
#ps-text-cue.cue-breath{animation:psCueBreath 1.25s ease-in-out infinite}
#ps-text-cue.cue-float{animation:psCueFloat 1.35s ease-in-out infinite}
#ps-text-cue.cue-blink{animation:psCueBlink 1s steps(2,end) infinite}
#ps-text-cue.cue-typewriter{overflow:hidden;animation:psCueTypewriter 1.45s steps(18,end) infinite alternate}
</style>
<div id="ps-text-cue" class="cue-${escapeHtml(layer.cueAnimation)}">${escapeHtml(layer.cueText)}</div>`;
  return insertBeforeBody(html, code);
}

function getNetworkHeadMarkup(network: NetworkTarget) {
  if (network === 'google') {
    return '<script id="ps-google-exitapi" type="text/javascript" src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>';
  }
  return '';
}

function ensureNetworkHead(html: string, network: NetworkTarget) {
  const code = getNetworkHeadMarkup(network);
  if (!code || /exitapi\.js/i.test(html)) return html;
  return insertBeforeHeadEnd(html, code);
}

function getContainedArtboard(width: number | undefined, height: number | undefined, orientation: Orientation) {
  const frameAspect = orientation === 'landscape' ? 16 / 9 : 9 / 16;
  const imageAspect = width && height && width > 0 && height > 0 ? width / height : frameAspect;
  if (imageAspect > frameAspect) {
    return { widthPercent: 100, heightPercent: roundCssNumber((frameAspect / imageAspect) * 100) };
  }
  return { widthPercent: roundCssNumber((imageAspect / frameAspect) * 100), heightPercent: 100 };
}

function insertBeforeHeadEnd(html: string, code: string) {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${code}\n</head>`);
  return `${code}\n${html}`;
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

function getLayerOrder(layer: LayerSettings): LayerTarget[] {
  const hasExplicitOrder = Array.isArray(layer.layerOrder);
  const raw = hasExplicitOrder ? layer.layerOrder : ['cta', 'hand'];
  const valid = raw.filter((target): target is LayerTarget => target === 'scan' || target === 'asset' || target === 'hand' || target === 'cta' || target === 'text');
  const next = valid.filter((target, index) => valid.indexOf(target) === index);
  if (layer.injectScan && layer.scanStyle !== 'none' && !next.includes('scan')) next.push('scan');
  if (layer.injectAsset && !next.includes('asset')) next.push('asset');
  if (layer.showCue && !next.includes('text')) next.push('text');
  if (layer.showCta && !next.includes('cta')) next.push('cta');
  if (layer.injectHand && !next.includes('hand')) next.push('hand');
  return keepHandAboveCta(keepCtaAboveScan(next));
}

function getLayerZ(layer: LayerSettings, target: LayerTarget) {
  return 5 + Math.max(0, getLayerOrder(layer).indexOf(target));
}

function shouldAnchorScanToFinger(layer: LayerSettings) {
  return layer.ctaScanGrouped && layer.injectHand && layer.injectScan;
}

function withCtaCompanions(layer: LayerSettings): LayerSettings {
  const next = {
    ...layer,
    ctaScanGrouped: Boolean(layer.ctaScanGrouped),
  };

  if (next.ctaScanGrouped && next.injectHand && next.injectScan) {
    next.scanX = next.handX;
    next.scanY = next.handY;
  }

  next.layerOrder = getLayerOrder(next);
  return next;
}

function keepHandAboveCta(order: LayerTarget[]) {
  const handIndex = order.indexOf('hand');
  const ctaIndex = order.indexOf('cta');
  if (handIndex < 0 || ctaIndex < 0 || handIndex > ctaIndex) return order;
  const next: LayerTarget[] = order.filter((target) => target !== 'hand');
  const nextCtaIndex = next.indexOf('cta');
  next.splice(nextCtaIndex + 1, 0, 'hand');
  return next;
}

function keepCtaAboveScan(order: LayerTarget[]) {
  const scanIndex = order.indexOf('scan');
  if (scanIndex < 0) return order;
  const interactiveIndexes = [order.indexOf('cta'), order.indexOf('hand')].filter((index) => index >= 0);
  if (!interactiveIndexes.length) return order;
  const firstInteractiveIndex = Math.min(...interactiveIndexes);
  if (scanIndex < firstInteractiveIndex) return order;
  const next: LayerTarget[] = order.filter((target) => target !== 'scan');
  next.splice(firstInteractiveIndex, 0, 'scan');
  return next;
}

function renderAssetMarkup(layer: LayerSettings) {
  if (layer.customAssetDataUrl) {
    return `<div class="ps-asset" style="z-index:${getLayerZ(layer, 'asset')}"><span class="asset-preview asset-preview-custom-image"><img src="${escapeHtml(layer.customAssetDataUrl)}" alt="${escapeHtml(layer.customAssetName || 'Brand asset')}"></span></div>`;
  }

  const asset = getVisualAsset(layer.assetId);
  return `<div class="ps-asset asset-motion-${escapeHtml(asset.motion)}" style="z-index:${getLayerZ(layer, 'asset')}">${renderVisualAssetMarkup(layer.assetId)}</div>`;
}

function renderVisualAssetMarkup(assetId: string) {
  const asset = getVisualAsset(assetId);
  const value = escapeHtml(asset.value || '');

  if (asset.category === 'counter') {
    const suffix = asset.id === 'counter-bpm' ? 'BPM' : asset.id === 'counter-countdown' ? 'tap' : 'score';
    return `<span class="asset-preview asset-preview-${escapeHtml(asset.id)}"><b>${value || '86'}</b><small>${suffix}</small></span>`;
  }

  if (asset.id === 'ecg-wave-line') {
    return '<span class="asset-preview asset-preview-ecg"><i></i></span>';
  }

  if (asset.id === 'heart-live-dot' || asset.id === 'status-normal') {
    return `<span class="asset-preview asset-preview-${escapeHtml(asset.id)}"><i></i><b>${value || 'Live'}</b></span>`;
  }

  if (asset.category === 'scan') {
    if (asset.id === 'scan-food-card' || asset.id === 'scan-calorie-chip') {
      return `<span class="asset-preview asset-preview-${escapeHtml(asset.id)}"><i></i><b>${value || '690'}</b><small>kcal</small></span>`;
    }
    return `<span class="asset-preview asset-preview-${escapeHtml(asset.id)}"><i></i></span>`;
  }

  return `<span class="asset-preview asset-preview-${escapeHtml(asset.id)}"><b>&#9829; ${value || '86'}</b></span>`;
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

function normalizeHexColor(value?: string, fallback = '#7c3cff') {
  if (value && /^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim();
  if (value && /^#[0-9a-f]{3}$/i.test(value.trim())) {
    const [, r, g, b] = value.trim();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

function hexToRgbTriplet(value?: string, fallback = '#7c3cff') {
  const color = normalizeHexColor(value, fallback).slice(1);
  const r = parseInt(color.slice(0, 2), 16);
  const g = parseInt(color.slice(2, 4), 16);
  const b = parseInt(color.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}
