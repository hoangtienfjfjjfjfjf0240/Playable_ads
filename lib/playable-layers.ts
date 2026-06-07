import crypto from 'node:crypto';

export const APPLOVIN_MAX_BYTES = 5 * 1024 * 1024;

const DATA_URI_RE =
  /data:([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,([a-z0-9+/=\r\n]+)/gi;
const EXTERNAL_REF_RE = /(?:src|href)\s*=\s*["']https?:\/\//gi;

export type PlayableLayerRole =
  | 'background'
  | 'product'
  | 'ui'
  | 'text-logo'
  | 'cta'
  | 'tutorial'
  | 'effect'
  | 'audio'
  | 'video'
  | 'atlas'
  | 'font'
  | 'unknown';

export type PlayableLayerEditability = 'direct' | 'atlas-sheet' | 'whole-media' | 'code-bound';

export interface PlayableLayerAsset {
  id: string;
  hash: string;
  name: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  kinds: string[];
  occurrences: number;
  role: PlayableLayerRole;
  editability: PlayableLayerEditability;
  dataUrl: string;
}

export interface PlayableAudit {
  bytes: number;
  sizeMiB: number;
  under5MiB: boolean;
  externalRefCount: number;
  embeddedAssetCount: number;
  engines: string[];
  hasClickTag: boolean;
  hasMraidOpen: boolean;
  appLovinReady: boolean;
}

type CollectedAsset = PlayableLayerAsset & {
  originals: Set<string>;
  contexts: string[];
};

export function analyzePlayableHtml(html: string) {
  const collected = collectDataAssets(html);
  return {
    assets: collected.map(stripInternalAssetFields),
    audit: auditPlayableHtml(html, collected.length),
  };
}

export function packPlayableHtml(
  html: string,
  replacements: Array<{ hash: string; dataUrl: string }>,
  remake?: { imageDataUrl: string; animation: 'tap' | 'scan' | 'swipe' | 'pulse' | 'none' } | null,
) {
  const replacementMap = new Map(replacements.map((item) => [item.hash, item.dataUrl]));
  const assets = collectDataAssets(html);
  let packed = html;
  const warnings: string[] = [];

  for (const asset of assets) {
    const replacement = replacementMap.get(asset.hash);
    if (!replacement) continue;
    if (!/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[^,]*)?;base64,/i.test(replacement)) {
      warnings.push(`${asset.name}: replacement is not a base64 data URL`);
      continue;
    }
    for (const original of asset.originals) packed = packed.split(original).join(replacement);
  }

  if (remake?.imageDataUrl) {
    packed = injectAiRemakeLayer(packed, remake.imageDataUrl, remake.animation);
  }

  return { html: packed, audit: auditPlayableHtml(packed), warnings };
}

export function auditPlayableHtml(html: string, embeddedAssetCount?: number): PlayableAudit {
  const bytes = Buffer.byteLength(html);
  const externalRefCount = [...html.matchAll(EXTERNAL_REF_RE)].length;
  const count = embeddedAssetCount ?? collectDataAssets(html).length;
  return {
    bytes,
    sizeMiB: Number((bytes / 1024 / 1024).toFixed(3)),
    under5MiB: bytes <= APPLOVIN_MAX_BYTES,
    externalRefCount,
    embeddedAssetCount: count,
    engines: detectEngines(html),
    hasClickTag: /window\.clickTag|\bclickTag\b/.test(html),
    hasMraidOpen: /mraid\.open\s*\(/.test(html),
    appLovinReady: bytes <= APPLOVIN_MAX_BYTES && externalRefCount === 0,
  };
}

function injectAiRemakeLayer(
  html: string,
  imageDataUrl: string,
  animation: 'tap' | 'scan' | 'swipe' | 'pulse' | 'none',
) {
  const layer = `<style id="playable-ai-remake-style">
#playable-ai-remake-layer{position:fixed;inset:0;z-index:2147482500;overflow:hidden;background:#fff;pointer-events:none}
#playable-ai-remake-layer img{width:100%;height:100%;display:block;object-fit:cover}
#playable-ai-remake-layer .remake-fx{position:absolute;left:50%;top:55%;transform:translate(-50%,-50%);pointer-events:none}
#playable-ai-remake-layer[data-animation="tap"] .remake-fx{width:92px;height:92px;border-radius:50%;border:4px solid rgba(37,99,235,.85);animation:remakeTap 1.05s ease-in-out infinite}
#playable-ai-remake-layer[data-animation="tap"] .remake-fx:after{content:"";position:absolute;left:42px;top:30px;width:54px;height:72px;border-radius:28px 28px 18px 18px;background:#fff;border:4px solid #111;box-shadow:0 8px 20px rgba(0,0,0,.18);transform:rotate(-35deg)}
#playable-ai-remake-layer[data-animation="scan"] .remake-fx{width:42%;height:34%;border:2px solid rgba(16,185,129,.86);border-radius:14px;box-shadow:0 0 0 9999px rgba(15,23,42,.05)}
#playable-ai-remake-layer[data-animation="scan"] .remake-fx:after{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,transparent,#22c55e,transparent);box-shadow:0 0 18px #22c55e;animation:remakeScan 1.35s ease-in-out infinite}
#playable-ai-remake-layer[data-animation="swipe"] .remake-fx{width:44%;height:6px;border-radius:999px;background:#2563eb;animation:remakeSwipe 1.2s ease-in-out infinite}
#playable-ai-remake-layer[data-animation="swipe"] .remake-fx:after{content:"";position:absolute;right:-7px;top:-8px;width:22px;height:22px;border-top:6px solid #2563eb;border-right:6px solid #2563eb;transform:rotate(45deg)}
#playable-ai-remake-layer[data-animation="pulse"] .remake-fx{top:82%;width:48%;height:12%;border-radius:18px;border:4px solid rgba(37,99,235,.9);animation:remakePulse 1s ease-in-out infinite}
@keyframes remakeTap{0%,100%{transform:translate(-50%,-50%) scale(.9);opacity:.7}50%{transform:translate(-50%,-50%) scale(1.12);opacity:1}}
@keyframes remakeScan{0%{top:0}100%{top:calc(100% - 4px)}}
@keyframes remakeSwipe{0%,100%{transform:translate(-75%,-50%);opacity:.65}50%{transform:translate(-25%,-50%);opacity:1}}
@keyframes remakePulse{0%,100%{transform:translate(-50%,-50%) scale(.96);opacity:.75}50%{transform:translate(-50%,-50%) scale(1.08);opacity:1}}
</style>
<div id="playable-ai-remake-layer" data-animation="${animation}">
  <img src="${imageDataUrl}" alt="">
  ${animation === 'none' ? '' : '<div class="remake-fx"></div>'}
</div>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${layer}</body>`) : `${html}${layer}`;
}

export async function resolvePlayableDocument(html: string) {
  if (!/<script\b[^>]*id\s*=\s*["']ad-context["']/i.test(html)) {
    return { html, convertedFromWrapper: false };
  }

  const contextMatch = html.match(
    /<script\b(?=[^>]*id\s*=\s*["']ad-context["'])(?=[^>]*type\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!contextMatch) throw new Error('Không đọc được AppLovin ad-context trong wrapper.');
  const context = JSON.parse(contextMatch[1]) as {
    playable?: { url?: string };
    open?: { redirectUrl?: string };
  };
  const playableUrl = context.playable?.url;
  if (!playableUrl) throw new Error('AppLovin wrapper không có playable.url.');

  const response = await fetch(playableUrl);
  if (!response.ok) throw new Error(`Không tải được playable gốc: HTTP ${response.status}.`);
  const source = await response.text();
  const rendered = extractRenderedHtml(source);
  const normalized = normalizeResolvedHtml(rendered, context.open?.redirectUrl || '');
  return { html: normalized, convertedFromWrapper: true };
}

function collectDataAssets(html: string): CollectedAsset[] {
  const byHash = new Map<string, CollectedAsset>();
  DATA_URI_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = DATA_URI_RE.exec(html))) {
    const original = match[0];
    const declaredMime = match[1].toLowerCase();
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const mime = detectMime(buffer, declaredMime);
    const context = html.slice(Math.max(0, match.index - 420), match.index + 120);
    const kind = classifyContext(context, mime);
    const existing = byHash.get(hash);

    if (existing) {
      existing.occurrences += 1;
      existing.originals.add(original);
      existing.contexts.push(context);
      if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
      continue;
    }

    const dimensions = imageDimensions(buffer, mime);
    const role = inferRole(context, mime, kind, dimensions.width, dimensions.height);
    byHash.set(hash, {
      id: `asset-${hash.slice(0, 12)}`,
      hash,
      name: inferName(context, role, byHash.size + 1),
      mime,
      bytes: buffer.length,
      width: dimensions.width ?? null,
      height: dimensions.height ?? null,
      kinds: [kind],
      occurrences: 1,
      role,
      editability: inferEditability(mime, kind),
      dataUrl: original,
      originals: new Set([original]),
      contexts: [context],
    });
  }

  return [...byHash.values()];
}

function stripInternalAssetFields(asset: CollectedAsset): PlayableLayerAsset {
  const { originals: _originals, contexts: _contexts, ...publicAsset } = asset;
  return publicAsset;
}

function detectEngines(html: string) {
  const checks: Array<[string, RegExp]> = [
    ['Phaser', /\bPhaser\b/i],
    ['Pixi', /\bPIXI\b/i],
    ['CreateJS', /\bcreatejs\b/i],
    ['Three.js', /\bTHREE\b/],
    ['Unity', /UnityLoader|createUnityInstance/i],
    ['Canvas', /<canvas\b|getContext\(["']2d["']\)/i],
    ['Video', /<video\b|data:video\//i],
  ];
  return checks.filter(([, regex]) => regex.test(html)).map(([name]) => name);
}

function classifyContext(context: string, mime: string) {
  const lower = context.toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.includes('font') || mime.includes('woff')) return 'font';
  if (/<img[^>]+src\s*=\s*["'][^"']*$/i.test(context)) return 'dom-image';
  if (/url\(\s*["']?[^"')]*$/i.test(context)) return 'css-background';
  if (/atlas|spritesheet|sprite[\s_-]*sheet/i.test(lower)) return 'sprite-atlas';
  if (mime.startsWith('image/')) return 'script-image';
  return 'embedded-binary';
}

function inferRole(
  context: string,
  mime: string,
  kind: string,
  width?: number,
  height?: number,
): PlayableLayerRole {
  const lower = context.toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.includes('font') || mime.includes('woff')) return 'font';
  if (kind === 'sprite-atlas') return 'atlas';
  if (/(?:cta|button|install|download|play[_\s-]*now)/i.test(lower)) return 'cta';
  if (/(?:hand|finger|pointer|tutorial|tap|swipe|cursor)/i.test(lower)) return 'tutorial';
  if (/(?:logo|wordmark|brand|title|headline|font)/i.test(lower)) return 'text-logo';
  if (/(?:particle|spark|explosion|effect|glow|scan|shine|burst)/i.test(lower)) return 'effect';
  if (/(?:panel|modal|card|popup|hud|toolbar|badge|icon|ui[_\s-])/i.test(lower)) return 'ui';
  if (/(?:character|product|meal|food|object|avatar|item|plate)/i.test(lower)) return 'product';
  if (
    /(?:background|backdrop|scene|wallpaper|\bbg[_\s-])/i.test(lower) ||
    (width && height && width >= 600 && height >= 600)
  ) {
    return 'background';
  }
  return 'unknown';
}

function inferEditability(mime: string, kind: string): PlayableLayerEditability {
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'whole-media';
  if (kind === 'sprite-atlas') return 'atlas-sheet';
  if (kind === 'embedded-binary' || kind === 'font') return 'code-bound';
  return 'direct';
}

function inferName(context: string, role: PlayableLayerRole, index: number) {
  const candidates = [
    ...context.matchAll(
      /(?:key|name|id|asset|texture|image|src)\s*[:=]\s*["']([a-z0-9][a-z0-9_.\-/]{2,64})["']/gi,
    ),
  ];
  const candidate = candidates.at(-1)?.[1]
    ?.split('/')
    .at(-1)
    ?.replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (candidate && !candidate.startsWith('data:')) return candidate;
  return `${roleLabel(role)} ${index}`;
}

function roleLabel(role: PlayableLayerRole) {
  const labels: Record<PlayableLayerRole, string> = {
    background: 'Background',
    product: 'Product',
    ui: 'UI',
    'text-logo': 'Text or logo',
    cta: 'CTA',
    tutorial: 'Tutorial',
    effect: 'Effect',
    audio: 'Audio',
    video: 'Video',
    atlas: 'Atlas',
    font: 'Font',
    unknown: 'Asset',
  };
  return labels[role];
}

function detectMime(buffer: Buffer, fallback: string) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  if (buffer.subarray(0, 4).toString('hex') === '774f4646') return 'font/woff';
  if (buffer.subarray(0, 4).toString('hex') === '774f4632') return 'font/woff2';
  return fallback;
}

function imageDimensions(buffer: Buffer, mime: string): { width?: number; height?: number } {
  try {
    if (mime === 'image/png' && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mime === 'image/gif' && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (mime === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        const size = buffer.readUInt16BE(offset + 2);
        if (
          [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
            marker,
          )
        ) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
          };
        }
        offset += 2 + size;
      }
    }
    if (mime === 'image/webp' && buffer.length >= 30 && buffer.subarray(12, 16).toString('ascii') === 'VP8X') {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
  } catch {
    return {};
  }
  return {};
}

function extractRenderedHtml(source: string) {
  const marker = 'al_renderHtml(';
  const start = source.indexOf(marker);
  const end = source.lastIndexOf(');');
  if (start < 0 || end <= start) throw new Error('Wrapper không chứa al_renderHtml payload.');
  const payload = JSON.parse(source.slice(start + marker.length, end)) as { html?: string };
  if (!payload.html) throw new Error('al_renderHtml payload không chứa HTML.');
  return payload.html;
}

function normalizeResolvedHtml(html: string, storeUrl: string) {
  const shim = `<script>
(function(){
  window.clickTag=window.clickTag||${JSON.stringify(storeUrl)};
  if(!window.mraid){
    window.mraid={__previewShim:true,getState:function(){return"default";},addEventListener:function(n,cb){if(n==="ready")setTimeout(cb,0);},removeEventListener:function(){},open:function(url){var target=url||window.clickTag;if(target)location.assign(target);},close:function(){},useCustomClose:function(){},isViewable:function(){return true;}};
  }
})();
</script>`;
  let normalized = html.trim();
  if (!/^<!doctype html>/i.test(normalized)) normalized = `<!doctype html>\n${normalized}`;
  if (/<head[^>]*>/i.test(normalized)) {
    normalized = normalized.replace(/<head([^>]*)>/i, `<head$1>${shim}`);
  } else {
    normalized = normalized.replace(/<html([^>]*)>/i, `<html$1><head>${shim}</head>`);
  }
  return normalized;
}
