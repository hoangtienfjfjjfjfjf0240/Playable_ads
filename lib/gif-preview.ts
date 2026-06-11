import { getImageFrameLayout, safeFileName } from './export-engine';
import { getHandAnchorOffset, getHandAsset } from './hand-assets';
import { defaultLayerSettings } from './presets';
import { getVisualAsset } from './visual-assets';
import type { ImageFit, LayerSettings, Orientation, PlayableVariant } from './types';

const PREVIEW_DIMENSIONS: Record<Orientation, { width: number; height: number }> = {
  portrait: { width: 360, height: 640 },
  landscape: { width: 640, height: 360 },
};

type GifExportOptions = {
  orientation: Orientation;
  imageFit: ImageFit;
  loop?: number;
};

type LoadedGifAssets = {
  baseImage: HTMLImageElement;
  handImage: HTMLImageElement | null;
  customAssetImage: HTMLImageElement | null;
};

type LayerTransform = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
};

export async function buildVariantPreviewGif(variant: PlayableVariant, options: GifExportOptions) {
  const layer = normalizeLayerSettings(variant.settings);
  const viewport = PREVIEW_DIMENSIONS[options.orientation];
  const durationMs = getPreviewDuration(layer);
  const targetFrameDelay = 1000 / 30;
  const frameCount = Math.max(24, Math.min(120, Math.round(durationMs / targetFrameDelay)));
  const frameDelays = buildThirtyFpsGifDelays(frameCount);
  const assets = await loadGifAssets(layer, variant.dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Cannot create GIF preview context.');

  const frames: string[] = [];
  let elapsedMs = 0;
  for (let index = 0; index < frameCount; index += 1) {
    renderVariantFrame(context, variant, layer, assets, options, viewport, elapsedMs);
    frames.push(canvas.toDataURL('image/png'));
    elapsedMs += frameDelays[index] || 0;
  }

  const response = await fetch('/api/export/gif', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      frames,
      delay: frameDelays,
      loop: options.loop ?? 0,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload?.error === 'string' ? payload.error : `GIF export failed (${response.status})`);
  }

  return response.blob();
}

function buildThirtyFpsGifDelays(frameCount: number) {
  const pattern = [30, 30, 40];
  return Array.from({ length: frameCount }, (_, index) => pattern[index % pattern.length]);
}

export function getVariantPreviewGifName(variantName: string) {
  return `${safeFileName(variantName)}_preview.gif`;
}

async function loadGifAssets(layer: LayerSettings, baseImageDataUrl: string): Promise<LoadedGifAssets> {
  const [baseImage, handImage, customAssetImage] = await Promise.all([
    loadImage(baseImageDataUrl),
    layer.injectHand ? loadImage(getHandAsset(layer.handId).src).catch(() => null) : Promise.resolve(null),
    layer.injectAsset && layer.customAssetDataUrl ? loadImage(layer.customAssetDataUrl).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    baseImage,
    handImage,
    customAssetImage,
  };
}

function renderVariantFrame(
  context: CanvasRenderingContext2D,
  variant: PlayableVariant,
  layer: LayerSettings,
  assets: LoadedGifAssets,
  options: GifExportOptions,
  viewport: { width: number; height: number },
  timeMs: number,
) {
  context.clearRect(0, 0, viewport.width, viewport.height);
  context.fillStyle = '#fff4e8';
  context.fillRect(0, 0, viewport.width, viewport.height);

  const imageFrame = getImageFrameLayout(layer, variant.width, variant.height, options.orientation, options.imageFit);
  drawBaseImage(context, assets.baseImage, viewport, imageFrame, options.imageFit);

  for (const target of getLayerOrder(layer)) {
    if (!isLayerVisible(layer, target)) continue;
    if (target === 'hand' && assets.handImage) drawHandLayer(context, layer, assets.handImage, viewport, timeMs);
    if (target === 'scan') drawScanLayer(context, layer, viewport, timeMs);
    if (target === 'asset') drawAssetLayer(context, layer, assets.customAssetImage, viewport, timeMs);
    if (target === 'cta') drawCtaLayer(context, layer, viewport, timeMs);
    if (target === 'text') drawCueLayer(context, layer, viewport, timeMs);
  }
}

function drawBaseImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  viewport: { width: number; height: number },
  imageFrame: ReturnType<typeof getImageFrameLayout>,
  imageFit: ImageFit,
) {
  const boxWidth = (imageFrame.widthPercent / 100) * viewport.width;
  const boxHeight = (imageFrame.heightPercent / 100) * viewport.height;
  const centerX = (imageFrame.x / 100) * viewport.width;
  const centerY = (imageFrame.y / 100) * viewport.height;

  context.save();
  context.translate(centerX, centerY);
  context.rotate((imageFrame.rotation * Math.PI) / 180);
  context.beginPath();
  context.rect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
  context.clip();

  const sourceWidth = Math.max(1, image.naturalWidth || image.width);
  const sourceHeight = Math.max(1, image.naturalHeight || image.height);
  const scale =
    imageFit === 'cover' ? Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight) : Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;

  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}

function drawHandLayer(
  context: CanvasRenderingContext2D,
  layer: LayerSettings,
  handImage: HTMLImageElement,
  viewport: { width: number; height: number },
  timeMs: number,
) {
  const transform = getHandTransform(layer, timeMs);
  const centerX = ((layer.handX + transform.x) / 100) * viewport.width;
  const centerY = ((layer.handY + transform.y) / 100) * viewport.height;
  const width = layer.handSize * transform.scaleX;
  const sourceWidth = Math.max(1, handImage.naturalWidth || handImage.width);
  const sourceHeight = Math.max(1, handImage.naturalHeight || handImage.height);
  const aspect = sourceHeight / sourceWidth;
  const height = width * aspect;

  context.save();
  context.globalAlpha = transform.opacity;
  context.translate(centerX, centerY);
  context.rotate(((layer.handRotation + transform.rotation) * Math.PI) / 180);
  context.drawImage(handImage, -width / 2, -height / 2, width, height);
  context.restore();
}

function drawScanLayer(
  context: CanvasRenderingContext2D,
  layer: LayerSettings,
  viewport: { width: number; height: number },
  timeMs: number,
) {
  const progress = resolveAnimatedProgress(timeMs, layer.scanSpeed, layer.scanDelay, layer.scanLoop, layer.scanAutoplay);
  const scale = lerp(layer.scanScaleStart, layer.scanScaleEnd, progress);
  const opacity = lerp(layer.scanOpacityStart / 100, layer.scanOpacityEnd / 100, progress);
  const size = layer.scanSize * scale;
  const position = getScanCenter(layer, viewport);
  const color = normalizeHexColor(layer.scanColor, '#7c3cff');
  const colorRgb = hexToRgb(color);

  context.save();
  context.globalAlpha = clamp(opacity, 0.08, 1);
  context.translate(position.x, position.y);
  context.rotate((layer.scanRotation * Math.PI) / 180);

  if (layer.scanStyle === 'face' || layer.scanStyle === 'border' || layer.scanStyle === 'frame' || layer.scanStyle === 'sweep') {
    const radius = layer.scanStyle === 'face' ? 16 : 12;
    const width = layer.scanStyle === 'face' ? size * 0.92 : size;
    const height = layer.scanStyle === 'face' ? size * 1.08 : size;
    if (layer.scanStyle === 'sweep') {
      context.fillStyle = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.08)`;
      roundedRect(context, -width / 2, -height / 2, width, height, radius);
      context.fill();
      context.strokeStyle = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.7)`;
      context.lineWidth = 2;
      roundedRect(context, -width / 2, -height / 2, width, height, radius);
      context.stroke();
      const beamX = -width / 2 + width * progress;
      const beam = context.createLinearGradient(beamX - 8, 0, beamX + 8, 0);
      beam.addColorStop(0, 'rgba(255,255,255,0)');
      beam.addColorStop(0.5, `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.95)`);
      beam.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = beam;
      context.fillRect(beamX - 8, -height / 2, 16, height);
    } else if (layer.scanStyle === 'face') {
      drawCornerScan(context, width, height, color);
      context.strokeStyle = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.95)`;
      context.lineWidth = 3;
      context.beginPath();
      const lineY = -height / 2 + height * progress;
      context.moveTo(-width * 0.32, lineY);
      context.lineTo(width * 0.32, lineY);
      context.stroke();
    } else {
      context.strokeStyle = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.92)`;
      context.lineWidth = layer.scanStyle === 'frame' ? 2 : 3;
      roundedRect(context, -width / 2, -height / 2, width, height, radius);
      context.stroke();
      const beamY = -height / 2 + height * progress;
      context.strokeStyle = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.72)`;
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(-width * 0.32, beamY);
      context.lineTo(width * 0.32, beamY);
      context.stroke();
      if (layer.scanStyle === 'frame') {
        drawFrameCorners(context, width, height, color);
      }
    }
  } else if (layer.scanStyle === 'ripple' || layer.scanStyle === 'ring' || layer.scanStyle === 'spark' || layer.scanStyle === 'spotlight') {
    const radius = size / 2;
    if (layer.scanStyle === 'spotlight') {
      const glow = context.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius);
      glow.addColorStop(0, `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.24)`);
      glow.addColorStop(0.6, `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.12)`);
      glow.addColorStop(1, `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0)`);
      context.fillStyle = glow;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();
    } else {
      context.strokeStyle = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, ${layer.scanStyle === 'spark' ? 1 : 0.9})`;
      context.lineWidth = layer.scanStyle === 'spark' ? 6 : 4;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.stroke();
      if (layer.scanStyle === 'spark') {
        context.beginPath();
        context.moveTo(-radius * 0.7, 0);
        context.lineTo(radius * 0.7, 0);
        context.moveTo(0, -radius * 0.7);
        context.lineTo(0, radius * 0.7);
        context.stroke();
      }
    }
  }

  context.restore();
}

function drawAssetLayer(
  context: CanvasRenderingContext2D,
  layer: LayerSettings,
  customAssetImage: HTMLImageElement | null,
  viewport: { width: number; height: number },
  timeMs: number,
) {
  if (customAssetImage) {
    drawCustomAssetLayer(context, layer, customAssetImage, viewport);
    return;
  }

  const asset = getVisualAsset(layer.assetId);
  const progress = resolveMotionProgress(timeMs, layer.assetSpeed);
  const pulseScale = asset.motion === 'pulse' ? lerp(0.94, 1.08, pingPong(progress)) : 1;
  const alpha = asset.motion === 'blink' ? (progress > 0.5 ? 0.35 : 1) : 1;
  const centerX = (layer.assetX / 100) * viewport.width;
  const centerY = (layer.assetY / 100) * viewport.height;
  const size = layer.assetSize * pulseScale;

  context.save();
  context.globalAlpha = alpha;
  context.translate(centerX, centerY);
  context.rotate((layer.assetRotation * Math.PI) / 180);

  if (asset.id === 'ecg-wave-line') {
    context.strokeStyle = '#ef4444';
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(-size * 0.45, 0);
    context.lineTo(-size * 0.2, 0);
    context.lineTo(-size * 0.12, -size * 0.1);
    context.lineTo(0, size * 0.16);
    context.lineTo(size * 0.1, -size * 0.18);
    context.lineTo(size * 0.22, 0);
    context.lineTo(size * 0.45, 0);
    context.stroke();
  } else if (asset.id === 'heart-live-dot' || asset.id === 'status-normal') {
    drawInfoChip(context, {
      width: size * 0.9,
      height: size * 0.32,
      fill: '#ffffff',
      stroke: '#dbe7f5',
      text: asset.value || (asset.id === 'status-normal' ? 'Normal' : 'Live'),
      textColor: asset.id === 'status-normal' ? '#0f9f6e' : '#0f9f6e',
      dotColor: '#0f9f6e',
    });
  } else if (asset.category === 'counter') {
    const counterValue = resolveCounterValue(asset.value || '86', asset.id, progress);
    drawInfoChip(context, {
      width: size,
      height: size * 0.46,
      fill: '#ffffff',
      stroke: '#dbe7f5',
      text: counterValue,
      textColor: '#111827',
      sublabel: asset.id === 'counter-bpm' ? 'BPM' : asset.id === 'counter-countdown' ? 'tap' : 'score',
      sublabelColor: '#6b7280',
    });
  } else {
    drawScanAsset(context, asset.id, size, pingPong(progress));
  }

  context.restore();
}

function drawCustomAssetLayer(
  context: CanvasRenderingContext2D,
  layer: LayerSettings,
  image: HTMLImageElement,
  viewport: { width: number; height: number },
) {
  const centerX = (layer.assetX / 100) * viewport.width;
  const centerY = (layer.assetY / 100) * viewport.height;
  const sourceWidth = Math.max(1, image.naturalWidth || image.width);
  const sourceHeight = Math.max(1, image.naturalHeight || image.height);
  const maxSize = Math.max(24, layer.assetSize);
  const scale = Math.min(maxSize / sourceWidth, maxSize / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  context.save();
  context.translate(centerX, centerY);
  context.rotate((layer.assetRotation * Math.PI) / 180);
  context.drawImage(image, -width / 2, -height / 2, width, height);
  context.restore();
}

function drawCtaLayer(
  context: CanvasRenderingContext2D,
  layer: LayerSettings,
  viewport: { width: number; height: number },
  timeMs: number,
) {
  const progress = resolveMotionProgress(timeMs, 1080);
  const centerX = (layer.ctaX / 100) * viewport.width;
  const centerY = (layer.ctaY / 100) * viewport.height;
  const width = (clamp(layer.ctaWidth, 12, 100) / 100) * viewport.width;
  const height = 42;
  const motion = getCtaTransform(layer.buttonAnimation, progress);
  const gradient = context.createLinearGradient(0, -height / 2, 0, height / 2);
  gradient.addColorStop(0, normalizeHexColor(layer.ctaColorFrom, '#ff9a2f'));
  gradient.addColorStop(1, normalizeHexColor(layer.ctaColorTo, '#f45100'));

  context.save();
  context.globalAlpha = motion.opacity;
  context.translate(centerX, centerY + motion.y);
  context.rotate(((layer.ctaRotation + motion.rotation) * Math.PI) / 180);
  context.scale(motion.scaleX, motion.scaleY);
  context.shadowColor = `rgba(${hexToRgb(normalizeHexColor(layer.ctaShadowColor, '#f45100')).r}, ${hexToRgb(normalizeHexColor(layer.ctaShadowColor, '#f45100')).g}, ${hexToRgb(normalizeHexColor(layer.ctaShadowColor, '#f45100')).b}, 0.34)`;
  context.shadowBlur = 24;
  context.shadowOffsetY = 12;
  context.fillStyle = gradient;
  roundedRect(context, -width / 2, -height / 2, width, height, 8);
  context.fill();
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.fillStyle = 'rgba(255,255,255,0.2)';
  roundedRect(context, -width / 2, -height / 2, width, height * 0.45, 8);
  context.fill();
  if (layer.buttonAnimation === 'shine') {
    const shineX = -width + width * 2 * progress;
    const shine = context.createLinearGradient(shineX - 24, 0, shineX + 24, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0)');
    shine.addColorStop(0.5, 'rgba(255,255,255,0.65)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = shine;
    roundedRect(context, -width / 2, -height / 2, width, height, 10);
    context.fill();
  }

  context.fillStyle = normalizeHexColor(layer.ctaTextColor, '#ffffff');
  context.font = '900 17px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(truncateText(layer.ctaText || 'INSTALL NOW', 18), 0, 0, width - 28);
  context.restore();
}

function drawCueLayer(
  context: CanvasRenderingContext2D,
  layer: LayerSettings,
  viewport: { width: number; height: number },
  timeMs: number,
) {
  const progress = resolveMotionProgress(timeMs, 1250);
  const centerX = (layer.cueX / 100) * viewport.width;
  const centerY = (layer.cueY / 100) * viewport.height;
  const width = (clamp(layer.cueWidth, 12, 100) / 100) * viewport.width;
  const height = Math.max(34, layer.cueSize + 18);
  const motion = getCueTransform(layer.cueAnimation, progress);
  const background = normalizeHexColor(layer.cueBgColor, '#111827');
  const text = resolveCueText(layer.cueText, layer.cueAnimation, progress);

  context.save();
  context.globalAlpha = motion.opacity;
  context.translate(centerX, centerY + motion.y);
  context.rotate(((layer.cueRotation + motion.rotation) * Math.PI) / 180);
  context.scale(motion.scaleX, motion.scaleY);
  context.fillStyle = rgba(background, 0.86);
  roundedRect(context, -width / 2, -height / 2, width, height, height / 2);
  context.fill();
  context.fillStyle = normalizeHexColor(layer.cueColor, '#ffffff');
  context.font = `900 ${Math.max(14, layer.cueSize)}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(truncateText(text || 'Tap to continue', 28), 0, 0, width - 24);
  context.restore();
}

function getPreviewDuration(layer: LayerSettings) {
  return Math.max(
    980,
    layer.scanAutoplay && layer.injectScan ? layer.scanSpeed + layer.scanDelay : 0,
    layer.injectAsset ? layer.assetSpeed : 0,
    layer.showCue ? 1250 : 0,
    layer.showCta ? 1080 : 0,
    layer.injectHand ? 1180 : 0,
  );
}

function getHandTransform(layer: LayerSettings, timeMs: number): LayerTransform {
  const progress = resolveMotionProgress(timeMs, 1120);
  const swing = Math.sin(progress * Math.PI * 2);
  const pulse = Math.sin(progress * Math.PI);
  const doubleTapPulse = Math.sin(progress * Math.PI * 4);

  const base: LayerTransform = {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
  };

  switch (layer.handMotion) {
    case 'tap':
      return { ...base, y: pulse * 4, scaleX: 1 - pulse * 0.06, scaleY: 1 - pulse * 0.06 };
    case 'doubleTap':
      return { ...base, y: Math.max(0, doubleTapPulse) * 5, scaleX: 1 - Math.max(0, doubleTapPulse) * 0.06, scaleY: 1 - Math.max(0, doubleTapPulse) * 0.06 };
    case 'press':
      return { ...base, y: pulse * 7, scaleX: 1 - pulse * 0.08, scaleY: 1 - pulse * 0.08 };
    case 'bounce':
      return { ...base, y: Math.abs(swing) * -10 };
    case 'swipeX':
      return { ...base, x: lerp(-5, 5, progress) };
    case 'swipeY':
      return { ...base, y: lerp(6, -6, progress) };
    case 'drag':
      return { ...base, x: lerp(-6, 6, progress), y: lerp(4, -4, progress) };
    case 'shake':
      return { ...base, rotation: swing * 6 };
    case 'wave':
      return { ...base, rotation: swing * 10, x: swing * 1.5 };
    default:
      return base;
  }
}

function getCtaTransform(animation: LayerSettings['buttonAnimation'], progress: number): LayerTransform {
  const swing = Math.sin(progress * Math.PI * 2);
  const pulse = Math.sin(progress * Math.PI);

  const base: LayerTransform = {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
  };

  switch (animation) {
    case 'pulse':
      return { ...base, scaleX: 1 + pulse * 0.05, scaleY: 1 + pulse * 0.05 };
    case 'bounce':
      return { ...base, y: -Math.abs(swing) * 5 };
    case 'shake':
      return { ...base, rotation: swing * 3 };
    case 'breath':
      return { ...base, scaleX: 1 + pulse * 0.04, scaleY: 1 + pulse * 0.04, opacity: 0.86 + pulse * 0.14 };
    default:
      return base;
  }
}

function getCueTransform(animation: LayerSettings['cueAnimation'], progress: number): LayerTransform {
  const swing = Math.sin(progress * Math.PI * 2);
  const pulse = Math.sin(progress * Math.PI);

  const base: LayerTransform = {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
  };

  switch (animation) {
    case 'pulse':
      return { ...base, scaleX: 1 + pulse * 0.05, scaleY: 1 + pulse * 0.05 };
    case 'bounce':
      return { ...base, y: -Math.abs(swing) * 4 };
    case 'shake':
      return { ...base, rotation: swing * 3 };
    case 'breath':
      return { ...base, scaleX: 1 + pulse * 0.04, scaleY: 1 + pulse * 0.04, opacity: 0.8 + pulse * 0.2 };
    case 'float':
      return { ...base, y: swing * -5 };
    case 'blink':
      return { ...base, opacity: progress > 0.5 ? 0.3 : 1 };
    default:
      return base;
  }
}

function shouldAnchorScanToFinger(layer: LayerSettings) {
  return layer.ctaScanGrouped && layer.injectHand && layer.injectScan;
}

function getScanCenter(layer: LayerSettings, viewport: { width: number; height: number }) {
  if (!shouldAnchorScanToFinger(layer)) {
    return {
      x: (layer.scanX / 100) * viewport.width,
      y: (layer.scanY / 100) * viewport.height,
    };
  }

  const offset = getHandAnchorOffset(layer.handId, layer.handSize);
  return {
    x: (layer.handX / 100) * viewport.width + offset.x + layer.scanOffsetX,
    y: (layer.handY / 100) * viewport.height + offset.y + layer.scanOffsetY,
  };
}

function drawInfoChip(
  context: CanvasRenderingContext2D,
  options: {
    width: number;
    height: number;
    fill: string;
    stroke: string;
    text: string;
    textColor: string;
    dotColor?: string;
    sublabel?: string;
    sublabelColor?: string;
  },
) {
  roundedRect(context, -options.width / 2, -options.height / 2, options.width, options.height, options.height / 2);
  context.fillStyle = options.fill;
  context.fill();
  context.strokeStyle = options.stroke;
  context.lineWidth = 2;
  context.stroke();

  let textX = 0;
  if (options.dotColor) {
    context.fillStyle = options.dotColor;
    context.beginPath();
    context.arc(-options.width / 2 + options.height * 0.45, 0, options.height * 0.12, 0, Math.PI * 2);
    context.fill();
    textX = 10;
  }

  context.fillStyle = options.textColor;
  context.font = `900 ${Math.max(12, Math.round(options.height * 0.36))}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(truncateText(options.text, 16), textX, options.sublabel ? -4 : 0, options.width - 20);

  if (options.sublabel) {
    context.fillStyle = options.sublabelColor || '#6b7280';
    context.font = `800 ${Math.max(9, Math.round(options.height * 0.19))}px system-ui, sans-serif`;
    context.fillText(options.sublabel, textX, options.height * 0.18, options.width - 20);
  }
}

function drawScanAsset(context: CanvasRenderingContext2D, assetId: string, size: number, progress: number) {
  const orange = '#f97316';
  const blue = '#2563eb';
  const white = '#ffffff';

  switch (assetId) {
    case 'scan-frame-box':
      context.strokeStyle = orange;
      context.lineWidth = 2;
      roundedRect(context, -size * 0.34, -size * 0.26, size * 0.68, size * 0.52, 10);
      context.stroke();
      drawFrameCorners(context, size * 0.68, size * 0.52, orange);
      break;
    case 'scan-beam':
    case 'scan-vertical-beam': {
      const boxW = size * 0.72;
      const boxH = size * 0.52;
      context.strokeStyle = rgba(blue, 0.46);
      context.lineWidth = 2;
      roundedRect(context, -boxW / 2, -boxH / 2, boxW, boxH, 10);
      context.stroke();
      const beamX = -boxW / 2 + boxW * progress;
      context.strokeStyle = orange;
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(beamX, -boxH / 2 + 6);
      context.lineTo(beamX, boxH / 2 - 6);
      context.stroke();
      break;
    }
    case 'scan-reticle':
      context.strokeStyle = orange;
      context.lineWidth = 3;
      context.beginPath();
      context.arc(0, 0, size * 0.18, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(-size * 0.32, 0);
      context.lineTo(size * 0.32, 0);
      context.moveTo(0, -size * 0.32);
      context.lineTo(0, size * 0.32);
      context.stroke();
      break;
    case 'scan-grid': {
      const box = size * 0.62;
      context.strokeStyle = orange;
      context.lineWidth = 2;
      roundedRect(context, -box / 2, -box / 2, box, box, 10);
      context.stroke();
      context.strokeStyle = rgba(blue, 0.3);
      context.lineWidth = 1;
      for (let step = -2; step <= 2; step += 1) {
        context.beginPath();
        context.moveTo((-box / 2) + (box / 4) * (step + 2), -box / 2);
        context.lineTo((-box / 2) + (box / 4) * (step + 2), box / 2);
        context.stroke();
        context.beginPath();
        context.moveTo(-box / 2, (-box / 2) + (box / 4) * (step + 2));
        context.lineTo(box / 2, (-box / 2) + (box / 4) * (step + 2));
        context.stroke();
      }
      break;
    }
    case 'scan-radar-sweep':
      context.strokeStyle = rgba(blue, 0.55);
      context.lineWidth = 2;
      context.beginPath();
      context.arc(0, 0, size * 0.28, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = rgba(blue, 0.2);
      context.beginPath();
      context.moveTo(0, 0);
      context.arc(0, 0, size * 0.28, progress * Math.PI * 2, progress * Math.PI * 2 + Math.PI / 3);
      context.closePath();
      context.fill();
      break;
    case 'scan-crop-box':
    case 'scan-photo-frame': {
      const boxW = size * 0.72;
      const boxH = size * 0.5;
      context.fillStyle = rgba('#ffd7ae', 1);
      roundedRect(context, -boxW / 2, -boxH / 2, boxW, boxH, 10);
      context.fill();
      context.strokeStyle = white;
      context.lineWidth = 2;
      roundedRect(context, -boxW / 2, -boxH / 2, boxW, boxH, 10);
      context.stroke();
      break;
    }
    case 'scan-corner-lock':
      context.strokeStyle = orange;
      context.lineWidth = 3;
      drawCornerScan(context, size * 0.68, size * 0.5, orange);
      break;
    case 'scan-nutrition-arrow':
      context.strokeStyle = '#ef4444';
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(-size * 0.18, -size * 0.1);
      context.lineTo(size * 0.14, -size * 0.1);
      context.lineTo(size * 0.14, size * 0.16);
      context.stroke();
      context.beginPath();
      context.moveTo(size * 0.14, size * 0.16);
      context.lineTo(size * 0.04, size * 0.06);
      context.moveTo(size * 0.14, size * 0.16);
      context.lineTo(size * 0.24, size * 0.06);
      context.stroke();
      break;
    case 'scan-barcode': {
      const boxW = size * 0.7;
      const boxH = size * 0.46;
      context.fillStyle = white;
      roundedRect(context, -boxW / 2, -boxH / 2, boxW, boxH, 8);
      context.fill();
      context.fillStyle = '#111827';
      const barWidths = [4, 2, 5, 3, 2, 5, 3, 6, 2];
      let currentX = -boxW * 0.34;
      for (const barWidth of barWidths) {
        context.fillRect(currentX, -boxH * 0.32, barWidth, boxH * 0.64);
        currentX += barWidth + 4;
      }
      break;
    }
    case 'scan-food-card':
    case 'scan-calorie-chip':
      drawInfoChip(context, {
        width: size * 0.84,
        height: size * 0.42,
        fill: '#ffffff',
        stroke: '#ffd7ae',
        text: assetId === 'scan-calorie-chip' ? `${Math.round(lerp(420, 690, progress))}` : '690',
        textColor: '#ef4444',
        sublabel: 'kcal',
        sublabelColor: '#6b7280',
      });
      break;
    default:
      drawInfoChip(context, {
        width: size * 0.78,
        height: size * 0.38,
        fill: '#ffffff',
        stroke: '#ffd7ae',
        text: getVisualAsset(assetId).value || getVisualAsset(assetId).label,
        textColor: '#111827',
      });
      break;
  }
}

function getLayerOrder(layer: LayerSettings) {
  const ordered = Array.isArray(layer.layerOrder) ? layer.layerOrder.filter((item) => item !== 'image') : defaultLayerSettings.layerOrder;
  const unique = Array.from(new Set(ordered));
  return unique.filter((target) => target === 'hand' || target === 'scan' || target === 'asset' || target === 'cta' || target === 'text');
}

function isLayerVisible(layer: LayerSettings, target: 'hand' | 'scan' | 'asset' | 'cta' | 'text') {
  if (target === 'hand') return layer.injectHand;
  if (target === 'scan') return layer.injectScan && layer.scanStyle !== 'none';
  if (target === 'asset') return layer.injectAsset;
  if (target === 'text') return layer.showCue;
  return layer.showCta;
}

function normalizeLayerSettings(settings: Partial<LayerSettings>): LayerSettings {
  return {
    ...defaultLayerSettings,
    ...settings,
    layerOrder: Array.isArray(settings.layerOrder) ? settings.layerOrder : defaultLayerSettings.layerOrder,
  };
}

function resolveAnimatedProgress(
  timeMs: number,
  speedMs: number,
  delayMs = 0,
  loop: LayerSettings['scanLoop'] = 'loop',
  autoplay = true,
) {
  if (!autoplay) return 0;
  if (timeMs <= delayMs) return 0;
  const duration = Math.max(240, speedMs);
  const elapsed = (timeMs - delayMs) / duration;
  if (loop === 'once') return clamp(elapsed, 0, 1);
  const iteration = Math.floor(elapsed);
  const cycle = elapsed - iteration;
  if (loop === 'pingpong' && iteration % 2 === 1) return 1 - cycle;
  return cycle;
}

function resolveMotionProgress(timeMs: number, speedMs: number) {
  const duration = Math.max(320, speedMs);
  return (timeMs % duration) / duration;
}

function resolveCounterValue(rawValue: string, assetId: string, progress: number) {
  if (assetId === 'counter-countdown') {
    const value = Math.max(1, 3 - Math.floor(progress * 3));
    return String(value);
  }

  const numeric = Number.parseFloat(rawValue.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numeric)) return rawValue;
  const value = Math.max(0, Math.round(numeric * progress));
  return rawValue.includes('%') ? `${value}%` : String(value);
}

function resolveCueText(text: string, animation: LayerSettings['cueAnimation'], progress: number) {
  if (animation !== 'typewriter') return text || 'Tap to continue';
  const source = text || 'Tap to continue';
  const chars = Math.max(1, Math.round(source.length * clamp(progress, 0.2, 1)));
  return source.slice(0, chars);
}

function drawCornerScan(context: CanvasRenderingContext2D, width: number, height: number, color: string) {
  const left = -width / 2;
  const top = -height / 2;
  const right = width / 2;
  const bottom = height / 2;
  const lengthX = width * 0.24;
  const lengthY = height * 0.24;

  context.strokeStyle = color;
  context.lineWidth = 3;

  context.beginPath();
  context.moveTo(left, top + lengthY);
  context.lineTo(left, top);
  context.lineTo(left + lengthX, top);
  context.moveTo(right - lengthX, top);
  context.lineTo(right, top);
  context.lineTo(right, top + lengthY);
  context.moveTo(left, bottom - lengthY);
  context.lineTo(left, bottom);
  context.lineTo(left + lengthX, bottom);
  context.moveTo(right - lengthX, bottom);
  context.lineTo(right, bottom);
  context.lineTo(right, bottom - lengthY);
  context.stroke();
}

function drawFrameCorners(context: CanvasRenderingContext2D, width: number, height: number, color: string) {
  const corner = 6;
  context.fillStyle = color;
  for (const x of [-width / 2, width / 2 - corner]) {
    for (const y of [-height / 2, height / 2 - corner]) {
      context.fillRect(x, y, corner, corner);
    }
  }
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function truncateText(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * clamp(progress, 0, 1);
}

function pingPong(progress: number) {
  return progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
}

function normalizeHexColor(value?: string, fallback = '#7c3cff') {
  if (value && /^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim();
  if (value && /^#[0-9a-f]{3}$/i.test(value.trim())) {
    const [, r, g, b] = value.trim();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

function hexToRgb(value: string) {
  const color = normalizeHexColor(value).slice(1);
  return {
    r: Number.parseInt(color.slice(0, 2), 16),
    g: Number.parseInt(color.slice(2, 4), 16),
    b: Number.parseInt(color.slice(4, 6), 16),
  };
}

function rgba(hex: string, alpha: number) {
  const color = hexToRgb(hex);
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Cannot load image asset: ${src}`));
    image.src = src;
  });
}
