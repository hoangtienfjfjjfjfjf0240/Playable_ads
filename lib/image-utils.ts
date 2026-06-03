import type { Hotspot } from './types';

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Cannot read file.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Cannot read file.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file);
  });
}

export function getImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('Cannot load image dimensions.'));
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.src = src;
  });
}

export async function detectImageHotspot(src: string): Promise<Hotspot> {
  const image = await loadImage(src);
  const width = 180;
  const height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return defaultHotspot('canvas unavailable');

  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const luminance = new Float32Array(width * height);
  let mean = 0;

  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    const luma = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;
    luminance[p] = luma;
    mean += luma;
  }

  mean /= luminance.length;
  const candidates: Array<{ x: number; y: number; score: number }> = [];

  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const p = y * width + x;
      const i = p * 4;
      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max - min;
      const luma = luminance[p];
      const contrast =
        (Math.abs(luma - luminance[p - 1]) +
          Math.abs(luma - luminance[p + 1]) +
          Math.abs(luma - luminance[p - width]) +
          Math.abs(luma - luminance[p + width])) /
        4;
      const xRatio = x / width;
      const yRatio = y / height;
      const lowerBoost = 0.78 + Math.pow(Math.min(yRatio, 0.78), 1.3) * 0.44;
      const interactionBandBoost = yRatio > 0.32 && yRatio < 0.8 ? 1.26 : 0.82;
      const centerBoost = 1 - Math.min(0.3, Math.abs(xRatio - 0.5) * 0.58);
      const ctaBoost = yRatio > 0.48 && yRatio < 0.8 && saturation > 0.24 ? 0.2 : 0;
      const readableBoost = luma > 0.06 && luma < 0.94 ? 1 : 0.45;
      const blackBarPenalty = luma < 0.04 && saturation < 0.05 ? 0.08 : 1;
      const outerEdgePenalty = yRatio < 0.1 || yRatio > 0.88 ? 0.28 : 1;
      const ctaAreaPenalty = yRatio > 0.82 ? 0.48 : 1;
      const score =
        (contrast * 1.65 + saturation * 0.78 + Math.abs(luma - mean) * 0.68 + ctaBoost) *
        lowerBoost *
        interactionBandBoost *
        centerBoost *
        readableBoost *
        blackBarPenalty *
        outerEdgePenalty *
        ctaAreaPenalty;

      if (score > 0.038) candidates.push({ x, y, score });
    }
  }

  if (!candidates.length) return defaultHotspot('low contrast');

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, 110);
  const anchor = top[0];
  const radius = Math.max(width, height) * 0.2;
  let sx = 0;
  let sy = 0;
  let sw = 0;

  for (const candidate of top) {
    const distance = Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y);
    const proximity = Math.max(0.2, 1 - distance / radius);
    const weight = candidate.score * proximity;
    sx += candidate.x * weight;
    sy += candidate.y * weight;
    sw += weight;
  }

  return {
    x: clamp(sw ? (sx / sw / width) * 100 : 50, 10, 90),
    y: clamp(sw ? (sy / sw / height) * 100 : 72, 14, 88),
    confidence: clamp(anchor.score * 2.2, 0.32, 0.94),
    reason: 'contrast/saturation hotspot',
  };
}

export async function loadAssetAsDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load asset ${url}`);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Cannot convert asset.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('Cannot load image.'));
    image.onload = () => resolve(image);
    image.src = src;
  });
}

function defaultHotspot(reason: string): Hotspot {
  return { x: 50, y: 72, confidence: 0.28, reason };
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
