'use client';

import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  AlertCircle,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  Grid2X2,
  Hand,
  Hash,
  HeartPulse,
  History,
  ImagePlus,
  Link2,
  Lock,
  Loader2,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Play,
  RefreshCw,
  Save,
  ScanLine,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Unlink2,
  Unlock,
  WandSparkles,
  X,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import type { DragEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type JSZip from 'jszip';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  createDefaultProjectSettings,
  defaultProjectPrompt,
  generateImagePlayableHtml,
  getImageFrameLayout,
  legacyDefaultProjectPrompt,
  normalizeProjectSettings,
  resolveProjectStoreConfig,
  networkExportTargets,
  networkLabels,
  patchPlayableHtml,
  safeFileName,
} from '../lib/export-engine';
import { buildVariantPreviewGif, getVariantPreviewGifName } from '../lib/gif-preview';
import { buttonAssets, getButtonAsset } from '../lib/button-assets';
import { applyContentLocaleToPrompt, contentLocaleOptions } from '../lib/content-locales';
import { getHandAnchorOffset, getHandAsset, handAssets } from '../lib/hand-assets';
import { detectImageHotspot, getImageDimensions, loadAssetAsDataUrl, readFileAsDataUrl, readFileAsText } from '../lib/image-utils';
import {
  DEFAULT_VARIANT_COUNT,
  MAX_VARIANT_COUNT,
  heuristicPlanFromHotspot,
  hotspotFromPlayablePlan,
  layerFromPlayablePlan,
  normalizeVariantCount,
  playableIntentLabels,
} from '../lib/playable-plan';
import { buttonPresets, defaultLayerSettings, handMotionPresets, recipePresets, scanPresets, textCuePresets } from '../lib/presets';
import { getSupabaseBrowser } from '../lib/supabase-browser';
import { withStudioRoutePrefix } from '../lib/studio-routes';
import { getVisualAsset, visualAssets } from '../lib/visual-assets';
import type {
  AiVariantResponseItem,
  ExportImageInput,
  Hotspot,
  LayerSettings,
  LayerTarget,
  NetworkTarget,
  PlayableVariant,
  ProjectSettings,
  ReferenceImageInput,
  ScanStyle,
  SourceItem,
  StudioAppSummary,
  StudioEditorContextPayload,
  StudioProjectDetail,
} from '../lib/types';

type HealthState = {
  aiConfigured: boolean;
  openAiConfigured?: boolean;
  geminiConfigured?: boolean;
  supabaseConfigured: boolean;
  supabaseReady?: boolean;
  supabaseError?: string;
  ok: boolean;
  error?: string;
} | null;

type Notice = { tone: 'ok' | 'warn' | 'error' | 'busy'; text: string } | null;
type AiWorkerStatus = 'idle' | 'running' | 'done' | 'error';
type AssetLibraryTab = 'hand' | 'scan' | 'button';
type FrameMetrics = { width: number; height: number };
type GenerationHistoryEntry = {
  id: string;
  name: string;
  createdAt: number;
  provider: ProjectSettings['aiProvider'];
  model: string;
  durationSeconds: number | null;
  variants: PlayableVariant[];
};

type PromptSuggestionState = 'idle' | 'loading' | 'ready' | 'error';

type PlayableStudioProps = {
  appId?: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isNaN(value) ? min : value));

const uid = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createWorkerStatuses = (count: number, status: AiWorkerStatus) =>
  Array.from({ length: normalizeVariantCount(count) }, () => status);

const shouldAutoApplyPrompt = (prompt: string) => {
  const normalized = prompt.trim();
  return !normalized || normalized === legacyDefaultProjectPrompt || normalized === defaultProjectPrompt;
};

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}

const LAYER_DRAG_TYPE = 'application/x-playable-layer';
const ASSET_DRAG_TYPE = 'application/x-playable-asset';
const SCAN_STYLE_DRAG_TYPE = 'application/x-playable-scan-style';
const DRAG_FALLBACK_TYPE = 'text/plain';
const layerFieldMap: Record<LayerTarget, Array<keyof LayerSettings>> = {
  image: ['imageX', 'imageY', 'imageWidth', 'imageHeight', 'imageRotation', 'imageLocked'],
  hand: [
    'layerOrder',
    'handId',
    'handMotion',
    'handX',
    'handY',
    'handSize',
    'handRotation',
    'handLocked',
    'injectHand',
    'ctaScanGrouped',
    'scanX',
    'scanY',
    'injectScan',
  ],
  scan: [
    'layerOrder',
    'scanStyle',
    'scanX',
    'scanY',
    'scanSize',
    'scanRotation',
    'scanLocked',
    'scanSpeed',
    'scanDelay',
    'scanLoop',
    'scanAutoplay',
    'scanAnimationName',
    'scanColor',
    'scanScaleStart',
    'scanScaleEnd',
    'scanOpacityStart',
    'scanOpacityEnd',
    'scanOffsetX',
    'scanOffsetY',
    'injectScan',
    'ctaScanGrouped',
    'ctaX',
    'ctaY',
    'showCta',
    'handX',
    'handY',
    'handMotion',
    'injectHand',
  ],
  asset: ['layerOrder', 'assetId', 'assetX', 'assetY', 'assetSize', 'assetRotation', 'assetLocked', 'assetSpeed', 'customAssetDataUrl', 'customAssetName', 'injectAsset'],
  cta: [
    'layerOrder',
    'ctaText',
    'ctaX',
    'ctaY',
    'ctaWidth',
    'ctaRotation',
    'ctaLocked',
    'showCta',
    'buttonAnimation',
    'ctaButtonId',
    'ctaColorFrom',
    'ctaColorTo',
    'ctaTextColor',
    'ctaShadowColor',
    'ctaScanGrouped',
    'scanX',
    'scanY',
    'injectScan',
    'handX',
    'handY',
    'handMotion',
    'injectHand',
  ],
  text: [
    'layerOrder',
    'cueText',
    'cueX',
    'cueY',
    'cueWidth',
    'cueSize',
    'cueRotation',
    'cueLocked',
    'cueAnimation',
    'cueColor',
    'cueBgColor',
    'cueShadowColor',
    'showCue',
  ],
};
const lockedLayerFieldMap: Record<LayerTarget, Array<keyof LayerSettings>> = {
  image: ['imageX', 'imageY', 'imageWidth', 'imageHeight', 'imageRotation'],
  hand: ['handId', 'handMotion', 'handX', 'handY', 'handSize', 'handRotation', 'injectHand'],
  scan: [
    'scanStyle',
    'scanX',
    'scanY',
    'scanSize',
    'scanRotation',
    'scanSpeed',
    'scanDelay',
    'scanLoop',
    'scanAutoplay',
    'scanAnimationName',
    'scanColor',
    'scanScaleStart',
    'scanScaleEnd',
    'scanOpacityStart',
    'scanOpacityEnd',
    'scanOffsetX',
    'scanOffsetY',
    'injectScan',
  ],
  asset: ['assetId', 'assetX', 'assetY', 'assetSize', 'assetRotation', 'assetSpeed', 'customAssetDataUrl', 'customAssetName', 'injectAsset'],
  cta: [
    'ctaText',
    'ctaX',
    'ctaY',
    'ctaWidth',
    'ctaRotation',
    'showCta',
    'buttonAnimation',
    'ctaButtonId',
    'ctaColorFrom',
    'ctaColorTo',
    'ctaTextColor',
    'ctaShadowColor',
  ],
  text: [
    'cueText',
    'cueX',
    'cueY',
    'cueWidth',
    'cueSize',
    'cueRotation',
    'cueAnimation',
    'cueColor',
    'cueBgColor',
    'cueShadowColor',
    'showCue',
  ],
};
const layerLockFieldMap: Record<LayerTarget, keyof LayerSettings> = {
  image: 'imageLocked',
  hand: 'handLocked',
  scan: 'scanLocked',
  asset: 'assetLocked',
  cta: 'ctaLocked',
  text: 'cueLocked',
};
const layerMeta: Record<LayerTarget, { label: string; group: string }> = {
  image: { label: 'Ảnh', group: 'Nền' },
  hand: { label: 'Tay', group: 'Tương tác' },
  scan: { label: 'Scan', group: 'Nhận diện' },
  asset: { label: 'Hiệu ứng', group: 'Hiển thị' },
  cta: { label: 'CTA', group: 'Hành động' },
  text: { label: 'Chữ nhắc', group: 'Lời nhắc' },
};
const toolbarLayerMeta: Record<LayerTarget, string> = {
  image: 'IMAGE',
  hand: 'HAND',
  scan: 'SCAN',
  asset: 'FX',
  cta: 'CTA',
  text: 'TEXT',
};
const layerPickerTargets: LayerTarget[] = ['image', 'hand', 'scan', 'cta', 'text'];
const storeTargetMeta: Record<
  ProjectSettings['storePlatform'],
  {
    label: string;
    field: 'appStoreUrl' | 'googlePlayUrl' | 'storeUrl';
    placeholder: string;
    hint: string;
  }
> = {
  'app-store': {
    label: 'App Store',
    field: 'appStoreUrl',
    placeholder: 'https://apps.apple.com/app/...',
    hint: 'Dùng khi playable này cần mở App Store.',
  },
  'google-play': {
    label: 'Google Play',
    field: 'googlePlayUrl',
    placeholder: 'https://play.google.com/store/apps/details?id=...',
    hint: 'Dùng khi playable này cần mở Google Play.',
  },
  custom: {
    label: 'URL tùy chỉnh',
    field: 'storeUrl',
    placeholder: 'https://example.com/landing',
    hint: 'Dùng cho landing page hoặc bất kỳ đích nào ngoài store.',
  },
};
const storeRoutingMeta: Record<ProjectSettings['storeRoutingMode'], { label: string; hint: string }> = {
  single: {
    label: 'Một liên kết',
    hint: 'Xuất một đích duy nhất. Chọn App Store, Google Play hoặc URL tùy chỉnh.',
  },
  'platform-auto': {
    label: 'Tự chọn theo thiết bị',
    hint: 'Xuất cả hai liên kết store. iOS mở App Store, Android mở Google Play.',
  },
};
const aiProviderModelMap: Record<ProjectSettings['aiProvider'], string> = {
  openai: 'gpt-image-2',
  'gemini-flash': 'gemini/gemini-3.1-flash-image-preview',
  'gemini-pro': 'gemini/gemini-3-pro-image-preview',
};
const scanColorSwatches = ['#7c3cff', '#2563eb', '#22d3ee', '#10b981', '#f59e0b', '#ef4444', '#ffffff'];
const APPLOVIN_MAX_HTML_BYTES = 5 * 1024 * 1024;
const ANALYZE_CONCURRENCY = 4;
const MAX_REFERENCE_IMAGES = 6;

function setLayerDragData(event: DragEvent<HTMLElement>, layer: LayerTarget, assetId?: string, scanStyle?: ScanStyle) {
  event.dataTransfer.setData(LAYER_DRAG_TYPE, layer);
  if (assetId) event.dataTransfer.setData(ASSET_DRAG_TYPE, assetId);
  if (scanStyle) event.dataTransfer.setData(SCAN_STYLE_DRAG_TYPE, scanStyle);
  event.dataTransfer.setData(
    DRAG_FALLBACK_TYPE,
    JSON.stringify({
      layer,
      assetId,
      scanStyle,
    }),
  );
  event.dataTransfer.effectAllowed = 'move';
}

function getLayerDragData(event: DragEvent<HTMLElement>): LayerTarget | null {
  const value = event.dataTransfer.getData(LAYER_DRAG_TYPE);
  if (value === '') {
    const fallback = event.dataTransfer.getData(DRAG_FALLBACK_TYPE);
    if (!fallback) return null;
    try {
      const payload = JSON.parse(fallback) as { layer?: string };
      const parsed = payload.layer;
      return parsed === 'image' || parsed === 'hand' || parsed === 'scan' || parsed === 'asset' || parsed === 'cta' || parsed === 'text' ? parsed : null;
    } catch {
      return null;
    }
  }
  return value === 'image' || value === 'hand' || value === 'scan' || value === 'asset' || value === 'cta' || value === 'text' ? value : null;
}

function getAssetDragData(event: DragEvent<HTMLElement>) {
  const direct = event.dataTransfer.getData(ASSET_DRAG_TYPE);
  if (direct) return direct;
  const fallback = event.dataTransfer.getData(DRAG_FALLBACK_TYPE);
  if (!fallback) return '';
  try {
    const payload = JSON.parse(fallback) as { assetId?: string };
    return payload.assetId || '';
  } catch {
    return '';
  }
}

function getScanStyleDragData(event: DragEvent<HTMLElement>): ScanStyle | null {
  const direct = event.dataTransfer.getData(SCAN_STYLE_DRAG_TYPE);
  if (direct === 'ripple' || direct === 'face' || direct === 'sweep' || direct === 'ring' || direct === 'spotlight' || direct === 'border' || direct === 'frame' || direct === 'spark' || direct === 'none') {
    return direct;
  }
  const fallback = event.dataTransfer.getData(DRAG_FALLBACK_TYPE);
  if (!fallback) return null;
  try {
    const payload = JSON.parse(fallback) as { scanStyle?: string };
    const value = payload.scanStyle;
    return value === 'ripple' || value === 'face' || value === 'sweep' || value === 'ring' || value === 'spotlight' || value === 'border' || value === 'frame' || value === 'spark' || value === 'none'
      ? value
      : null;
  } catch {
    return null;
  }
}

function getPointInElement(element: HTMLElement, clientX: number, clientY: number) {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(clamp(((clientX - rect.left) / rect.width) * 100, 0, 100)),
    y: Math.round(clamp(((clientY - rect.top) / rect.height) * 100, 0, 100)),
  };
}

function scopeLayerPatch(partial: Partial<LayerSettings>, layer: LayerTarget) {
  const allowed = new Set(layerFieldMap[layer]);
  return Object.fromEntries(
    Object.entries(partial).filter(([key]) => allowed.has(key as keyof LayerSettings)),
  ) as Partial<LayerSettings>;
}

function mergeLayerSettings(base: Partial<LayerSettings>, partial: Partial<LayerSettings> = {}) {
  const merged = {
    ...defaultLayerSettings,
    ...base,
    ...partial,
  } as LayerSettings;
  return {
    ...merged,
    ctaScanGrouped: merged.ctaScanGrouped !== false,
    layerOrder: getLayerOrder(merged),
  };
}

function isLayerLocked(layer: Partial<LayerSettings>, target: LayerTarget) {
  if (target === 'image') return Boolean(layer.imageLocked);
  if (target === 'hand') return Boolean(layer.handLocked);
  if (target === 'scan') return Boolean(layer.scanLocked);
  if (target === 'asset') return Boolean(layer.assetLocked);
  if (target === 'text') return Boolean(layer.cueLocked);
  return Boolean(layer.ctaLocked);
}

function getLayerLockPatch(target: LayerTarget, locked: boolean) {
  if (target === 'image') return { imageLocked: locked } satisfies Partial<LayerSettings>;
  if (target === 'hand') return { handLocked: locked } satisfies Partial<LayerSettings>;
  if (target === 'scan') return { scanLocked: locked } satisfies Partial<LayerSettings>;
  if (target === 'asset') return { assetLocked: locked } satisfies Partial<LayerSettings>;
  if (target === 'text') return { cueLocked: locked } satisfies Partial<LayerSettings>;
  return { ctaLocked: locked } satisfies Partial<LayerSettings>;
}

function getLayerRotationPatch(target: LayerTarget, rotation: number) {
  const next = Math.round(clamp(rotation, -180, 180));
  if (target === 'image') return { imageRotation: next } satisfies Partial<LayerSettings>;
  if (target === 'hand') return { handRotation: next } satisfies Partial<LayerSettings>;
  if (target === 'scan') return { scanRotation: next } satisfies Partial<LayerSettings>;
  if (target === 'asset') return { assetRotation: next } satisfies Partial<LayerSettings>;
  if (target === 'text') return { cueRotation: next } satisfies Partial<LayerSettings>;
  return { ctaRotation: next } satisfies Partial<LayerSettings>;
}

function getLayerSizePatch(target: LayerTarget, size: number) {
  if (target === 'image') {
    const next = roundCssNumber(clamp(size, 12, 180));
    return { imageWidth: next, imageHeight: next } satisfies Partial<LayerSettings>;
  }
  if (target === 'hand') return { handSize: Math.round(clamp(size, 32, 260)) } satisfies Partial<LayerSettings>;
  if (target === 'scan') return { scanSize: Math.round(clamp(size, 48, 360)) } satisfies Partial<LayerSettings>;
  if (target === 'asset') return { assetSize: Math.round(clamp(size, 48, 280)) } satisfies Partial<LayerSettings>;
  if (target === 'text') return { cueWidth: Math.round(clamp(size, 28, 96)) } satisfies Partial<LayerSettings>;
  return { ctaWidth: Math.round(clamp(size, 44, 92)) } satisfies Partial<LayerSettings>;
}

function hasLayerLockPatch(partial: Partial<LayerSettings>, target: LayerTarget) {
  return Object.prototype.hasOwnProperty.call(partial, layerLockFieldMap[target]);
}

function filterLockedLayerPatch(base: Partial<LayerSettings>, partial: Partial<LayerSettings>, target: LayerTarget) {
  if (isLayerLocked(base, target) && !hasLayerLockPatch(partial, target)) return {};

  const entries = Object.entries(partial).filter(([key]) => {
    for (const layerTarget of ['image', 'hand', 'scan', 'asset', 'cta', 'text'] as LayerTarget[]) {
      if (key === layerLockFieldMap[layerTarget]) return true;
      if (isLayerLocked(base, layerTarget) && lockedLayerFieldMap[layerTarget].includes(key as keyof LayerSettings)) return false;
    }
    return true;
  });

  return Object.fromEntries(entries) as Partial<LayerSettings>;
}

function buildCtaCompanionPatch(base: Partial<LayerSettings>, partial: Partial<LayerSettings>) {
  return partial;
}

function buildHandCompanionPatch(base: Partial<LayerSettings>, partial: Partial<LayerSettings>) {
  const next = mergeLayerSettings(base, partial);
  return {
    ...partial,
    ...(next.ctaScanGrouped && next.injectScan
      ? {
          scanX: next.handX,
          scanY: next.handY,
        }
      : {}),
  } satisfies Partial<LayerSettings>;
}

function buildScanCompanionPatch(base: Partial<LayerSettings>, partial: Partial<LayerSettings>) {
  const next = mergeLayerSettings(base, partial);
  if (!next.ctaScanGrouped) return partial;

  return buildHandCompanionPatch(next, {
    ...partial,
    ...('scanX' in partial || 'scanY' in partial
      ? {
          handX: 'handX' in partial ? next.handX : next.scanX,
          handY: 'handY' in partial ? next.handY : next.scanY,
          injectHand: true,
        }
      : {}),
  });
}

function setCtaScanGroupPatch(base: Partial<LayerSettings>, grouped: boolean) {
  if (!grouped) return { ctaScanGrouped: false } satisfies Partial<LayerSettings>;
  return buildCtaCompanionPatch(base, {
    ctaScanGrouped: true,
    scanStyle: 'frame',
    injectScan: true,
    showCta: true,
  });
}

function getRemoveLayerPatch(target: LayerTarget, layerOrder: LayerTarget[]) {
  const base = { layerOrder } satisfies Partial<LayerSettings>;
  if (target === 'image') return base;
  if (target === 'hand') return { ...base, injectHand: false } satisfies Partial<LayerSettings>;
  if (target === 'scan') return { ...base, injectScan: false, ctaScanGrouped: false } satisfies Partial<LayerSettings>;
  if (target === 'asset') return { ...base, injectAsset: false } satisfies Partial<LayerSettings>;
  if (target === 'text') return { ...base, showCue: false } satisfies Partial<LayerSettings>;
  return { ...base, showCta: false, ctaScanGrouped: false } satisfies Partial<LayerSettings>;
}

function pickLayerFields(layer: Partial<LayerSettings>, fields: Array<keyof LayerSettings>) {
  return Object.fromEntries(Object.entries(layer).filter(([key]) => fields.includes(key as keyof LayerSettings))) as Partial<LayerSettings>;
}

function getRecipePatchForLayer(layer: Partial<LayerSettings>, target: LayerTarget) {
  if (target === 'hand') {
    const patch = pickLayerFields(layer, ['handId', 'handMotion', 'handSize']);
    return Object.keys(patch).length
      ? ({
          ...patch,
          handMotion: patch.handMotion || 'tap',
          injectHand: true,
        } satisfies Partial<LayerSettings>)
      : {};
  }

  if (target === 'scan') {
    const patch = pickLayerFields(layer, ['scanStyle', 'scanX', 'scanY', 'scanSize', 'scanSpeed']);
    return Object.keys(patch).length
      ? ({
          ...patch,
          injectScan: true,
        } satisfies Partial<LayerSettings>)
      : {};
  }

  if (target === 'cta') {
    const patch = pickLayerFields(layer, [
      'buttonAnimation',
      'ctaButtonId',
      'ctaColorFrom',
      'ctaColorTo',
      'ctaTextColor',
      'ctaShadowColor',
      'ctaX',
      'ctaY',
      'ctaWidth',
      'ctaText',
    ]);
    return Object.keys(patch).length
      ? ({
          ...patch,
          showCta: true,
        } satisfies Partial<LayerSettings>)
      : {};
  }

  if (target === 'text') {
    const patch = pickLayerFields(layer, ['cueText', 'cueX', 'cueY', 'cueWidth', 'cueSize', 'cueAnimation']);
    return Object.keys(patch).length
      ? ({
          ...patch,
          showCue: true,
        } satisfies Partial<LayerSettings>)
      : {};
  }

  const patch = pickLayerFields(layer, ['assetId', 'assetX', 'assetY', 'assetSize', 'assetSpeed', 'customAssetDataUrl', 'customAssetName']);
  return Object.keys(patch).length
    ? ({
        ...patch,
        injectAsset: true,
      } satisfies Partial<LayerSettings>)
    : {};
}

export function PlayableStudio({ appId = '' }: PlayableStudioProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const brandAssetInputRef = useRef<HTMLInputElement>(null);
  const handDataUrlCache = useRef(new Map<string, string>());
  const freshProjectHandledRef = useRef(false);
  const projectQueryHandledRef = useRef('');
  const currentProjectIdRef = useRef('');
  const pendingProjectIdRef = useRef('');
  const saveRequestRef = useRef<Promise<string | null> | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSnapshotRef = useRef('');
  const lastFailedSnapshotRef = useRef('');
  const draftBaselineSnapshotRef = useRef('');
  const pendingPersistRef = useRef(false);
  const promptValueRef = useRef('');
  const promptSuggestionRequestRef = useRef(0);
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeFor = useCallback((href: string) => withStudioRoutePrefix(pathname, href), [pathname]);
  const homeHref = routeFor('/');
  const [health, setHealth] = useState<HealthState>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(Boolean(appId));
  const [authToken, setAuthToken] = useState('');
  const [studioApp, setStudioApp] = useState<StudioAppSummary | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState('');
  const [settings, setSettings] = useState<ProjectSettings>(() => normalizeProjectSettings(createDefaultProjectSettings()));
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [referenceImages, setReferenceImages] = useState<ReferenceImageInput[]>([]);
  const [activeSourceId, setActiveSourceId] = useState('');
  const [variants, setVariants] = useState<PlayableVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [htmlLayerSettings, setHtmlLayerSettings] = useState<LayerSettings>(() => normalizeLayerSettings(defaultLayerSettings));
  const [htmlPreviewHandDataUrl, setHtmlPreviewHandDataUrl] = useState<string | undefined>();
  const [selectedLayer, setSelectedLayer] = useState<LayerTarget>('hand');
  const [notice, setNotice] = useState<Notice>({ tone: 'warn', text: 'Chưa có ảnh nguồn' });
  const [busy, setBusy] = useState(false);
  const [projectSaving, setProjectSaving] = useState(false);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [autosaveError, setAutosaveError] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [aiWorkers, setAiWorkers] = useState<AiWorkerStatus[]>(() => createWorkerStatuses(DEFAULT_VARIANT_COUNT, 'idle'));
  const [lastAiDuration, setLastAiDuration] = useState<number | null>(null);
  const [generationHistory, setGenerationHistory] = useState<GenerationHistoryEntry[]>([]);
  const [assetLibraryTab, setAssetLibraryTab] = useState<AssetLibraryTab>('hand');
  const [selectedPreviewMetrics, setSelectedPreviewMetrics] = useState<FrameMetrics | null>(null);
  const [promptSuggestion, setPromptSuggestion] = useState('');
  const [promptSuggestionTitle, setPromptSuggestionTitle] = useState('');
  const [promptSuggestionSourceName, setPromptSuggestionSourceName] = useState('');
  const [promptSuggestionStatus, setPromptSuggestionStatus] = useState<PromptSuggestionState>('idle');
  const [promptSuggestionError, setPromptSuggestionError] = useState('');

  useEffect(() => {
    setSettings((current) => (current.imageFit === 'cover' ? current : { ...current, imageFit: 'cover' }));
  }, []);

  useEffect(() => {
    promptValueRef.current = settings.prompt;
  }, [settings.prompt]);

  const activeSource = useMemo(
    () => sources.find((source) => source.id === activeSourceId) || sources[0] || null,
    [activeSourceId, sources],
  );
  const selectedVariant = useMemo(
    () => variants.find((variant) => variant.id === selectedVariantId) || variants[0] || null,
    [selectedVariantId, variants],
  );
  const activeLayer = selectedVariant?.settings || (activeSource?.kind === 'html' ? htmlLayerSettings : defaultLayerSettings);
  const activeImageFit = settings.imageFit || 'cover';
  const storeConfig = useMemo(
    () => resolveProjectStoreConfig(settings),
    [settings.appStoreUrl, settings.googlePlayUrl, settings.storePlatform, settings.storeRoutingMode, settings.storeUrl],
  );
  const isPlatformAutoStore = settings.storeRoutingMode === 'platform-auto';
  const selectedStoreMeta = storeTargetMeta[settings.storePlatform];
  const selectedStoreValue = settings[selectedStoreMeta.field];
  const targetVariantCount = normalizeVariantCount(settings.variantCount || DEFAULT_VARIANT_COUNT);
  const activeAiReady =
    settings.aiProvider === 'openai' ? Boolean(health?.openAiConfigured) : Boolean(health?.geminiConfigured);
  const activeAiStatusMessage = !health
    ? ''
    : !health.ok
      ? health.error || 'Kiểm tra trạng thái AI thất bại. Hãy khởi động lại local để nạp lại .env.local.'
      : activeAiReady
        ? ''
        : 'Thiếu khóa AI ở server (AI_API_KEY hoặc OPENAI_API_KEY). Hãy khởi động lại local sau khi cập nhật .env.local.';
  const visibleVisualAssets = useMemo(
    () =>
      assetLibraryTab === 'hand' || assetLibraryTab === 'button'
        ? []
        : visualAssets.filter((asset) => asset.category === 'scan'),
    [assetLibraryTab],
  );
  const activeSourceLabel = activeSource ? (activeSource.kind === 'image' ? 'Ảnh nguồn' : 'HTML playable') : 'Chưa có nguồn';
  const toolbarLayerLabel = toolbarLayerMeta[selectedLayer];
  const alignPanelItems = [
    { command: 'left', title: 'Align left', Icon: AlignHorizontalJustifyStart },
    { command: 'center', title: 'Align horizontal center', Icon: AlignHorizontalJustifyCenter },
    { command: 'right', title: 'Align right', Icon: AlignHorizontalJustifyEnd },
    { command: 'top', title: 'Align top', Icon: AlignVerticalJustifyStart },
    { command: 'middle', title: 'Align vertical center', Icon: AlignVerticalJustifyCenter },
    { command: 'bottom', title: 'Align bottom', Icon: AlignVerticalJustifyEnd },
  ] as const;
  const assetLibraryCount =
    assetLibraryTab === 'hand' ? handAssets.length : assetLibraryTab === 'button' ? buttonAssets.length : visibleVisualAssets.length;
  const appScopedEditor = Boolean(appId);
  const requestedProjectId = searchParams?.get('projectId') || '';
  const requestedProjectName = searchParams?.get('name') || '';
  const wantsFreshProject = searchParams?.get('new') === '1';
  const localizedPrompt = useMemo(() => applyContentLocaleToPrompt(settings.prompt, settings.locale), [settings.locale, settings.prompt]);
  const autosaveSnapshot = useMemo(() => {
    if (!appScopedEditor || !appId) return '';
    return buildProjectAutosaveSnapshot(buildProjectSavePayload({
      id: currentProjectId || '',
      appId,
      name: settings.name,
      prompt: settings.prompt,
      settings,
      sourceImageDataUrl: activeSource?.dataUrl || '',
      referenceImages,
      variants,
    }));
  }, [activeSource?.dataUrl, appId, appScopedEditor, currentProjectId, referenceImages, settings, variants]);
  const hasProjectContent = Boolean(activeSource?.dataUrl || variants.length);
  const hasPersistableProject = Boolean(appScopedEditor && appId && hasProjectContent);
  const hasUnsavedProjectChanges = Boolean(autosaveSnapshot && autosaveSnapshot !== lastSavedSnapshotRef.current);

  useEffect(() => {
    currentProjectIdRef.current = currentProjectId;
  }, [currentProjectId]);

  useEffect(() => {
    if (!appScopedEditor) {
      setSessionLoading(false);
      return;
    }
    if (!supabase) {
      setSessionLoading(false);
      setNotice({ tone: 'error', text: 'Missing Supabase browser config.' });
      return;
    }

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session || null);
      setAuthToken(data.session?.access_token || '');
      setSessionLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession || null);
      setAuthToken(nextSession?.access_token || '');
      setSessionLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [appScopedEditor, supabase]);

  const fetchEditorContext = useCallback(async () => {
    if (!appScopedEditor || !authToken) return;
    const response = await fetch(`/api/apps/${encodeURIComponent(appId)}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Không tải được ngữ cảnh editor.');

    const editorContext = payload as StudioEditorContextPayload;
    if (!editorContext.workspace || !editorContext.app) throw new Error('Không tìm thấy ứng dụng trong không gian của bạn.');

    setStudioApp(editorContext.app);
  }, [appId, appScopedEditor, authToken]);

  useEffect(() => {
    if (!appScopedEditor || !authToken) return;
    fetchEditorContext().catch((error) => {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Không tải được ngữ cảnh ứng dụng.' });
    });
  }, [appScopedEditor, authToken, fetchEditorContext]);

  useEffect(() => {
    if (!appScopedEditor || !studioApp || currentProjectId || sources.length || variants.length) return;
    setSettings((current) => {
      if (!shouldUseGeneratedProjectName(current.name, studioApp.name)) return current;
      return {
        ...current,
        name: requestedProjectName.trim() || studioApp.name || 'Untitled Project',
      };
    });
  }, [appScopedEditor, currentProjectId, requestedProjectName, sources.length, studioApp, variants.length]);

  useEffect(() => {
    if (!appScopedEditor || !appId || !studioApp || currentProjectId || activeSource?.dataUrl || variants.length || draftBaselineSnapshotRef.current) return;
    if (studioApp && !shouldUseGeneratedProjectName(settings.name, studioApp.name)) return;
    if (!autosaveSnapshot) return;
    draftBaselineSnapshotRef.current = autosaveSnapshot;
  }, [activeSource?.dataUrl, appId, appScopedEditor, autosaveSnapshot, currentProjectId, settings.name, studioApp, variants.length]);

  const markProjectForPersist = useCallback(() => {
    pendingPersistRef.current = true;
  }, []);

  useEffect(() => {
    if (busy) return;
    setAiWorkers((current) => (current.length === targetVariantCount ? current : createWorkerStatuses(targetVariantCount, 'idle')));
  }, [busy, targetVariantCount]);

  useEffect(() => {
    if (!selectedVariant) setSelectedPreviewMetrics(null);
  }, [selectedVariant]);

  const refreshHealth = useCallback(() => {
    let cancelled = false;
    setHealth(null);
    fetch('/api/health', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof payload?.error === 'string' && payload.error.trim() ? payload.error : `Health check failed (${response.status})`,
          );
        }
        if (!cancelled) setHealth(payload as Exclude<HealthState, null>);
      })
      .catch((error) => {
        if (!cancelled) {
          setHealth({
            ok: false,
            aiConfigured: false,
            supabaseConfigured: false,
            error: error instanceof Error ? error.message : 'AI health check failed.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refreshHealth(), [refreshHealth]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('playable-generation-history');
      if (!raw) return;
      const parsed = JSON.parse(raw) as GenerationHistoryEntry[];
      setGenerationHistory(
        parsed.slice(0, 6).map((entry) => ({
          ...entry,
          variants: entry.variants.map((variant) => ({
            ...variant,
            settings: normalizeLayerSettings(variant.settings),
          })),
        })),
      );
    } catch {
      setGenerationHistory([]);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('playable-generation-history', JSON.stringify(generationHistory.slice(0, 6)));
    } catch {
      // Base64 image history can exceed browser quota; keep the current session state even if persistence fails.
    }
  }, [generationHistory]);

  const setProjectSetting = <K extends keyof ProjectSettings>(key: K, value: ProjectSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const applyPromptSuggestion = useCallback(() => {
    if (!promptSuggestion) return;
    setProjectSetting('prompt', promptSuggestion);
    markProjectForPersist();
  }, [markProjectForPersist, promptSuggestion]);

  const suggestPromptForSource = useCallback(
    async (source: Pick<SourceItem, 'id' | 'name' | 'kind' | 'dataUrl'>, options?: { autoApply?: boolean }) => {
      if (!source.dataUrl) return;

      const requestId = promptSuggestionRequestRef.current + 1;
      promptSuggestionRequestRef.current = requestId;
      setPromptSuggestionStatus('loading');
      setPromptSuggestionError('');
      setPromptSuggestionSourceName(source.name);

      try {
        const response = await fetch('/api/ai/suggest-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageDataUrl: source.dataUrl,
            sourceKind: source.kind,
            sourceName: source.name,
            language: 'vi',
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          prompt?: string;
          title?: string;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || `Prompt suggestion failed (${response.status})`);
        }

        const suggestedPrompt = String(payload.prompt || '').trim();
        if (!suggestedPrompt) throw new Error('Prompt suggestion returned empty content.');
        if (promptSuggestionRequestRef.current !== requestId) return;

        setPromptSuggestion(suggestedPrompt);
        setPromptSuggestionTitle(String(payload.title || '').trim() || `Gợi ý từ ${source.name}`);
        setPromptSuggestionStatus('ready');

        if (options?.autoApply && shouldAutoApplyPrompt(promptValueRef.current)) {
          setProjectSetting('prompt', suggestedPrompt);
          markProjectForPersist();
        }
      } catch (error) {
        if (promptSuggestionRequestRef.current !== requestId) return;
        setPromptSuggestionStatus('error');
        setPromptSuggestionError(error instanceof Error ? error.message : 'Không gợi ý được prompt từ ảnh.');
      }
    },
    [markProjectForPersist],
  );

  const saveProject = useCallback(
    async ({ silent = false, force = false }: { silent?: boolean; force?: boolean } = {}) => {
      if (appScopedEditor && (!authToken || !appId)) {
        if (!silent) setNotice({ tone: 'error', text: 'Bạn chưa đăng nhập hoặc chưa chọn app.' });
        return null;
      }
      if (!appScopedEditor || !appId) {
        if (!silent) setNotice({ tone: 'error', text: 'Chưa có project hợp lệ để lưu.' });
        return null;
      }
      if (!hasProjectContent) {
        if (!silent) setNotice({ tone: 'warn', text: 'Thêm ảnh nguồn hoặc biến thể trước khi lưu project.' });
        return null;
      }

      const stableProjectId = currentProjectIdRef.current || pendingProjectIdRef.current || '';
      const savePayload = buildProjectSavePayload({
        id: stableProjectId,
        appId: appId || '',
        name: settings.name,
        prompt: settings.prompt,
        settings,
        sourceImageDataUrl: activeSource?.dataUrl || '',
        referenceImages,
        variants,
      });
      const snapshot = buildProjectAutosaveSnapshot(savePayload);
      if (!force && snapshot === lastSavedSnapshotRef.current) {
        return stableProjectId || null;
      }

      if (saveRequestRef.current) {
        pendingPersistRef.current = true;
        return saveRequestRef.current;
      }

      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }

      const resolvedProjectId = stableProjectId || crypto.randomUUID();
      pendingProjectIdRef.current = resolvedProjectId;
      setProjectSaving(true);
      setAutosaveError('');
      if (silent) {
        setAutosaveState('saving');
      } else {
        setBusy(true);
        setNotice({ tone: 'busy', text: 'Đang lưu Supabase' });
      }

      const request = (async () => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authToken) headers.Authorization = `Bearer ${authToken}`;
        const response = await fetch('/api/projects', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...savePayload,
            id: resolvedProjectId,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Supabase save failed');

        const savedId = typeof payload.id === 'string' ? payload.id : resolvedProjectId;
        if (savedId) {
          currentProjectIdRef.current = savedId;
          pendingProjectIdRef.current = savedId;
          setCurrentProjectId(savedId);
          lastFailedSnapshotRef.current = '';
          lastSavedSnapshotRef.current = buildProjectAutosaveSnapshot({
            ...savePayload,
            id: savedId,
          });
        }
        setAutosaveState('saved');
        setLastSavedAt(Date.now());
        if (!silent) {
          setNotice({ tone: 'ok', text: `Đã lưu project ${savedId || payload.id}` });
        }
        return savedId || null;
      })();

      saveRequestRef.current = request;

      try {
        return await request;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Lưu thất bại';
        if (!currentProjectIdRef.current) {
          pendingProjectIdRef.current = '';
        }
        lastFailedSnapshotRef.current = snapshot;
        setAutosaveState('error');
        setAutosaveError(message);
        setNotice({ tone: 'error', text: message });
        return null;
      } finally {
        saveRequestRef.current = null;
        setProjectSaving(false);
        if (!silent) setBusy(false);
      }
    },
    [activeSource?.dataUrl, appId, appScopedEditor, authToken, hasProjectContent, referenceImages, settings, variants],
  );

  const resetCurrentProject = useCallback((nextProjectName?: string) => {
    const baseSettings = normalizeProjectSettings(createDefaultProjectSettings());
    const projectName = nextProjectName?.trim() || studioApp?.name || 'Untitled Project';
    const baselineSnapshot = buildProjectAutosaveSnapshot(buildProjectSavePayload({
      id: '',
      appId: appId || '',
      name: projectName,
      prompt: baseSettings.prompt,
      settings: {
        ...baseSettings,
        name: projectName,
      },
      sourceImageDataUrl: '',
      referenceImages: [],
      variants: [],
    }));
    lastSavedSnapshotRef.current = '';
    lastFailedSnapshotRef.current = '';
    draftBaselineSnapshotRef.current = baselineSnapshot;
    pendingPersistRef.current = false;
    setAutosaveState('idle');
    setAutosaveError('');
    setLastSavedAt(null);
    currentProjectIdRef.current = '';
    pendingProjectIdRef.current = '';
    setCurrentProjectId('');
    setSettings({
      ...baseSettings,
      name: projectName,
    });
    setSources([]);
    setReferenceImages([]);
    setActiveSourceId('');
    setVariants([]);
    setSelectedVariantId('');
    setSelectedLayer('hand');
    setNotice({ tone: 'ok', text: 'Đã mở một project mới trong editor hiện tại.' });
  }, [appId, studioApp?.name]);

  useEffect(() => {
    if (!appScopedEditor || !wantsFreshProject || freshProjectHandledRef.current) return;

    freshProjectHandledRef.current = true;
    resetCurrentProject(requestedProjectName);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('new');
      url.searchParams.delete('name');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [appScopedEditor, requestedProjectName, resetCurrentProject, wantsFreshProject]);

  const leaveEditor = useCallback(
    async (href: string, options?: { signOut?: boolean }) => {
      if (hasPersistableProject && hasUnsavedProjectChanges) {
        const savedId = await saveProject({ force: true });
        if (!savedId && !currentProjectId) return;
      }

      if (options?.signOut) {
        if (!supabase) return;
        await supabase.auth.signOut();
        window.location.href = href;
        return;
      }

      if (typeof window !== 'undefined' && href === homeHref) {
        window.sessionStorage.setItem('playable-dashboard-refresh', String(Date.now()));
        window.location.assign(href);
        return;
      }

      router.push(href);
    },
    [currentProjectId, hasPersistableProject, hasUnsavedProjectChanges, homeHref, router, saveProject, supabase],
  );

  const loadSavedProject = useCallback(
    async (projectId: string) => {
      if (!authToken) {
        setNotice({ tone: 'error', text: 'Cần đăng nhập để thao tác.' });
        return;
      }

      setBusy(true);
      setNotice({ tone: 'busy', text: 'Đang mở project từ Supabase' });
      try {
        const response = await fetch(`/api/projects/${projectId}`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Cannot load project.');

        const project = payload.project as StudioProjectDetail;
        const restoredReferenceImages = normalizeReferenceImageInputs(project.referenceImages);
        const sourceId = `source-${project.id}`;
        const sourceItem: SourceItem | null = project.sourceImageDataUrl
          ? {
              id: sourceId,
              name: `${project.name}.png`,
              kind: 'image',
              status: 'ready',
              dataUrl: project.sourceImageDataUrl,
              width: project.variants[0]?.width || 0,
              height: project.variants[0]?.height || 0,
              hotspot: project.variants[0]?.hotspot,
              createdAt: Date.now(),
            }
          : null;

        setCurrentProjectId(project.id);
        currentProjectIdRef.current = project.id;
        pendingProjectIdRef.current = project.id;
        setSettings(normalizeProjectSettings(project.settings || createDefaultProjectSettings()));
        setReferenceImages(restoredReferenceImages);
        setSources(sourceItem ? [sourceItem] : []);
        setActiveSourceId(sourceItem?.id || '');
        setVariants(
          project.variants.map((variant, index) => ({
            ...variant,
            sourceId,
            index: Number(variant.index) || index + 1,
            hotspot: variant.hotspot || { x: 50, y: 72, confidence: 0.28 },
            settings: normalizeLayerSettings(variant.settings),
          })),
        );
        setSelectedVariantId(project.variants[0]?.id || '');
        lastSavedSnapshotRef.current = buildProjectAutosaveSnapshot(buildProjectSavePayload({
          id: project.id,
          appId: project.appId,
          name: project.settings?.name || project.name,
          prompt: project.prompt,
          settings: normalizeProjectSettings(project.settings || createDefaultProjectSettings()),
          sourceImageDataUrl: sourceItem?.dataUrl || '',
          referenceImages: restoredReferenceImages,
          variants: project.variants.map((variant) => ({
            ...variant,
            sourceId,
            hotspot: variant.hotspot || { x: 50, y: 72, confidence: 0.28 },
            settings: normalizeLayerSettings(variant.settings),
          })),
        }));
        lastFailedSnapshotRef.current = '';
        draftBaselineSnapshotRef.current = lastSavedSnapshotRef.current;
        pendingPersistRef.current = false;
        setAutosaveState('saved');
        setAutosaveError('');
        setLastSavedAt(Date.parse(project.updatedAt) || Date.now());
        setNotice({ tone: 'ok', text: `Đã mở project ${project.name}` });
      } catch (error) {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Không mở được project.' });
      } finally {
        setBusy(false);
      }
    },
    [authToken],
  );

  useEffect(() => {
    if (!appScopedEditor || !requestedProjectId || !authToken) return;
    if (currentProjectId === requestedProjectId || projectQueryHandledRef.current === requestedProjectId) return;

    projectQueryHandledRef.current = requestedProjectId;
    loadSavedProject(requestedProjectId)
      .then(() => {
        if (typeof window === 'undefined') return;
        const url = new URL(window.location.href);
        url.searchParams.delete('projectId');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      })
      .catch(() => {
        projectQueryHandledRef.current = '';
      });
  }, [appScopedEditor, authToken, currentProjectId, loadSavedProject, requestedProjectId]);

  useEffect(() => {
    if (!appScopedEditor || !authToken || !appId || !studioApp || !autosaveSnapshot || busy || projectSaving) return;
    if (autosaveSnapshot === lastSavedSnapshotRef.current) return;
    if (autosaveSnapshot === lastFailedSnapshotRef.current) return;
    if (!currentProjectId && autosaveSnapshot === draftBaselineSnapshotRef.current) return;

    setAutosaveState((current) => (current === 'saving' ? current : 'idle'));
    autosaveTimerRef.current = setTimeout(() => {
      void saveProject({ silent: true });
    }, 1200);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [appId, appScopedEditor, authToken, autosaveSnapshot, busy, currentProjectId, projectSaving, saveProject, studioApp]);

  useEffect(() => {
    if (!pendingPersistRef.current || busy || projectSaving || !hasPersistableProject) return;
    pendingPersistRef.current = false;
    void saveProject({ silent: true });
  }, [busy, hasPersistableProject, projectSaving, saveProject]);

  useEffect(() => {
    if (!hasPersistableProject || !hasUnsavedProjectChanges) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [hasPersistableProject, hasUnsavedProjectChanges]);

  const updateLayer = useCallback(
    (partial: Partial<LayerSettings>, targetVariantId = selectedVariant?.id, layerTarget = selectedLayer) => {
      const targetId = targetVariantId || selectedVariant?.id || '';
      const sharedPartial = scopeLayerPatch(partial, layerTarget);
      const hasSharedChanges = Object.keys(sharedPartial).length > 0;

      if (!targetId && activeSource?.kind === 'html') {
        setHtmlLayerSettings((current) => {
          const allowedPartial = filterLockedLayerPatch(current, partial, layerTarget);
          if (!Object.keys(allowedPartial).length) return current;
          return normalizeLayerSettings({ ...current, ...allowedPartial });
        });
        return;
      }

      setVariants((current) =>
        current.map((variant) => {
          if (variant.id === targetId) {
            const allowedPartial = filterLockedLayerPatch(variant.settings, partial, layerTarget);
            if (!Object.keys(allowedPartial).length) return variant;
            return { ...variant, settings: { ...variant.settings, ...allowedPartial } };
          }
          if (!settings.syncAllVariants || !hasSharedChanges) return variant;
          const allowedSharedPartial = filterLockedLayerPatch(variant.settings, sharedPartial, layerTarget);
          if (!Object.keys(allowedSharedPartial).length) return variant;
          return { ...variant, settings: { ...variant.settings, ...allowedSharedPartial } };
        }),
      );
    },
    [activeSource?.kind, selectedLayer, selectedVariant?.id, settings.syncAllVariants],
  );

  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;

    setBusy(true);
    setNotice({ tone: 'busy', text: 'Đang đọc file' });
    setPromptSuggestion('');
    setPromptSuggestionTitle('');
    setPromptSuggestionSourceName('');
    setPromptSuggestionStatus('idle');
    setPromptSuggestionError('');
    const imported: SourceItem[] = [];

    try {
      for (const file of list) {
        if (/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
          const dataUrl = await readFileAsDataUrl(file);
          const dimensions = await getImageDimensions(dataUrl);
          const hotspot = await detectImageHotspot(dataUrl).catch(() => defaultHotspot());
          imported.push({
            id: uid(),
            name: file.name,
            kind: 'image',
            status: 'ready',
            dataUrl,
            width: dimensions.width,
            height: dimensions.height,
            hotspot,
            createdAt: Date.now(),
          });
        } else if (/\.html?$/i.test(file.name)) {
          imported.push(await buildPlayableHtmlSource(file, settings.orientation));
        }
      }

      if (!imported.length) {
        setNotice({ tone: 'error', text: 'File không hợp lệ' });
        return;
      }

      setSources((current) => [...imported, ...current]);
      setActiveSourceId(imported[0].id);
      setVariants([]);
      setSelectedVariantId('');
      setHtmlLayerSettings(normalizeLayerSettings(defaultLayerSettings));
      setAiWorkers(createWorkerStatuses(targetVariantCount, 'idle'));
      setLastAiDuration(null);
      setProjectSetting('name', safeFileName(imported[0].name));
      setProjectSetting('imageFit', 'cover');
      const currentPrompt = settings.prompt.trim();
      if (!currentPrompt || currentPrompt === legacyDefaultProjectPrompt || currentPrompt === defaultProjectPrompt) {
        setProjectSetting('prompt', defaultProjectPrompt);
      }
      const firstVisualSource = imported.find((source) => source.dataUrl);
      const htmlFrameReadyCount = imported.filter((source) => source.kind === 'html' && source.dataUrl).length;
      const htmlFrameFailedCount = imported.filter((source) => source.kind === 'html' && !source.dataUrl).length;
      if (firstVisualSource) {
        void suggestPromptForSource(firstVisualSource, { autoApply: true });
        const drafts = await createDraftVariants(firstVisualSource);
        setVariants(drafts);
        setSelectedVariantId(drafts[0]?.id || '');
        markProjectForPersist();
        setNotice({
          tone: htmlFrameFailedCount ? 'warn' : 'ok',
          text: `${imported.length} file sẵn sàng, ${drafts.length} bản xem trước nháp đã tạo${
            htmlFrameReadyCount ? `, ${htmlFrameReadyCount} playable đã có frame AI` : ''
          }${htmlFrameFailedCount ? `, ${htmlFrameFailedCount} playable chưa chụp được frame` : ''}`,
        });
        return;
      }
      setNotice({
        tone: htmlFrameFailedCount ? 'warn' : 'ok',
        text: `${imported.length} file sẵn sàng${htmlFrameFailedCount ? `, ${htmlFrameFailedCount} playable chưa chụp được frame AI` : ''}`,
      });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Import tháº¥t báº¡i' });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const importReferenceImages = async (files: FileList | File[] | null | undefined) => {
    const list = Array.from(files || []).filter((file) => /^image\/(png|jpe?g|webp)$/i.test(file.type));
    if (!list.length) {
      if (referenceInputRef.current) referenceInputRef.current.value = '';
      setNotice({ tone: 'error', text: 'Chỉ nhận PNG, JPG, WEBP cho input ref.' });
      return;
    }

    const availableSlots = Math.max(0, MAX_REFERENCE_IMAGES - referenceImages.length);
    if (!availableSlots) {
      if (referenceInputRef.current) referenceInputRef.current.value = '';
      setNotice({ tone: 'warn', text: `Input ref tối đa ${MAX_REFERENCE_IMAGES} ảnh.` });
      return;
    }

    const acceptedFiles = list.slice(0, availableSlots);
    setBusy(true);
    setNotice({ tone: 'busy', text: 'Đang đọc input ref...' });

    try {
      const imported = await Promise.all(
        acceptedFiles.map(async (file, index) => {
          const dataUrl = await readFileAsDataUrl(file);
          const dimensions = await getImageDimensions(dataUrl);
          return {
            id: `ref-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`,
            name: file.name,
            dataUrl,
            width: dimensions.width,
            height: dimensions.height,
            createdAt: Date.now(),
          } satisfies ReferenceImageInput;
        }),
      );

      setReferenceImages((current) => [...imported, ...current].slice(0, MAX_REFERENCE_IMAGES));
      markProjectForPersist();
      setNotice({
        tone: list.length > acceptedFiles.length ? 'warn' : 'ok',
        text:
          list.length > acceptedFiles.length
            ? `Đã thêm ${imported.length} input ref, bỏ qua ${list.length - acceptedFiles.length} ảnh vì đã chạm giới hạn ${MAX_REFERENCE_IMAGES}.`
            : `Đã thêm ${imported.length} input ref.`,
      });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Không đọc được input ref.' });
    } finally {
      setBusy(false);
      if (referenceInputRef.current) referenceInputRef.current.value = '';
    }
  };

  const removeReferenceImage = (referenceId: string) => {
    setReferenceImages((current) => current.filter((reference) => reference.id !== referenceId));
    markProjectForPersist();
  };

  const attachBrandAssetToLayer = (layer: Partial<LayerSettings>, dataUrl: string, name: string) => {
    const current = normalizeLayerSettings(layer);
    const hadCustomAsset = Boolean(current.customAssetDataUrl);
    return normalizeLayerSettings({
      ...current,
      customAssetDataUrl: dataUrl,
      customAssetName: name,
      injectAsset: true,
      assetX: hadCustomAsset || current.injectAsset ? current.assetX : 14,
      assetY: hadCustomAsset || current.injectAsset ? current.assetY : 10,
      assetSize: hadCustomAsset || current.injectAsset ? current.assetSize : 88,
      assetRotation: hadCustomAsset ? current.assetRotation : 0,
      layerOrder: ensureLayerInOrder(getLayerOrder(current), 'asset'),
    });
  };

  const detachBrandAssetFromLayer = (layer: Partial<LayerSettings>) => {
    const current = normalizeLayerSettings(layer);
    return normalizeLayerSettings({
      ...current,
      customAssetDataUrl: '',
      customAssetName: '',
      injectAsset: false,
    });
  };

  const syncBrandAssetAcrossEditor = (dataUrl: string, name: string) => {
    if (variants.length) {
      setVariants((current) =>
        current.map((variant) => ({
          ...variant,
          settings: attachBrandAssetToLayer(variant.settings, dataUrl, name),
        })),
      );
    }

    if (activeSource?.kind === 'html') {
      setHtmlLayerSettings((current) => attachBrandAssetToLayer(current, dataUrl, name));
    }
  };

  const clearBrandAssetAcrossEditor = () => {
    if (variants.length) {
      setVariants((current) =>
        current.map((variant) => ({
          ...variant,
          settings: detachBrandAssetFromLayer(variant.settings),
        })),
      );
    }

    if (activeSource?.kind === 'html') {
      setHtmlLayerSettings((current) => detachBrandAssetFromLayer(current));
    }
  };

  const importBrandAsset = async (files: FileList | File[] | null | undefined) => {
    const file = files?.[0];
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setSettings((current) => ({
        ...current,
        brandAssetDataUrl: dataUrl,
        brandAssetName: file.name,
      }));
      syncBrandAssetAcrossEditor(dataUrl, file.name);
      setSelectedLayer('asset');
      markProjectForPersist();
      setNotice({ tone: 'ok', text: `Đã gắn ${file.name} vào asset layer` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Không đọc được logo/icon.' });
    } finally {
      if (brandAssetInputRef.current) brandAssetInputRef.current.value = '';
    }
  };

  const clearBrandAsset = () => {
    setSettings((current) => ({
      ...current,
      brandAssetDataUrl: '',
      brandAssetName: '',
    }));
    clearBrandAssetAcrossEditor();
    markProjectForPersist();
    setNotice({ tone: 'ok', text: 'Đã xóa logo/icon khỏi asset layer' });
  };

  const createVariantFromImage = async (
    source: SourceItem,
    image: { name: string; dataUrl: string; revisedPrompt?: string },
    index: number,
  ): Promise<PlayableVariant> => {
    const dimensions = await getImageDimensions(image.dataUrl);
    const rawHotspot = await detectImageHotspot(image.dataUrl).catch(() => source.hotspot || defaultHotspot());
    const hotspot = projectHotspotToFrame(rawHotspot, dimensions, settings.orientation, activeImageFit);
    const plan = heuristicPlanFromHotspot(hotspot, index, localizedPrompt);
    return {
      id: uid(),
      sourceId: source.id,
      index,
      name: image.name,
      dataUrl: image.dataUrl,
      width: dimensions.width,
      height: dimensions.height,
      revisedPrompt: image.revisedPrompt || '',
      hotspot: hotspotFromPlayablePlan(plan),
      plan,
      settings: settings.brandAssetDataUrl
        ? attachBrandAssetToLayer(layerFromPlayablePlan(plan, localizedPrompt || image.revisedPrompt || ''), settings.brandAssetDataUrl, settings.brandAssetName)
        : layerFromPlayablePlan(plan, localizedPrompt || image.revisedPrompt || ''),
    };
  };

  const createDraftVariants = (source: SourceItem) =>
    Promise.all(
      Array.from({ length: targetVariantCount }, (_, index) =>
        createVariantFromImage(
          source,
          {
            name: `${safeFileName(source.name)}_draft_${index + 1}.png`,
            dataUrl: source.dataUrl || '',
          },
          index + 1,
        ).then((variant) => ({
          ...variant,
          settings: normalizeLayerSettings({
            ...variant.settings,
            showCta: false,
          }),
        })),
      ),
    );

  const cloneSourceToVariants = async () => {
    if (!activeSource?.dataUrl) {
      setNotice({ tone: 'error', text: 'Chọn ảnh nguồn hoặc playable HTML trước' });
      return;
    }

    setBusy(true);
    try {
      const next = await createDraftVariants(activeSource);
      setVariants(next);
      setSelectedVariantId(next[0]?.id || '');
      markProjectForPersist();
      setAiWorkers(createWorkerStatuses(targetVariantCount, 'idle'));
      setLastAiDuration(null);
      setNotice({ tone: 'ok', text: activeSource.kind === 'html' ? 'Đã tạo bản nháp từ playable HTML' : 'Đã tạo 4 bản nháp từ ảnh nguồn' });
    } finally {
      setBusy(false);
    }
  };

  const generateVariants = async () => {
    if (!activeSource?.dataUrl) {
      setNotice({ tone: 'error', text: 'Chọn ảnh nguồn hoặc playable HTML trước' });
      return;
    }

    setBusy(true);
    setNotice({ tone: 'busy', text: `AI đang tạo ${targetVariantCount} biến thể, ảnh nào xong sẽ hiện trước...` });
    setLastAiDuration(null);
    setAiWorkers(createWorkerStatuses(targetVariantCount, 'running'));
    setSources((current) =>
      current.map((source) => (source.id === activeSource.id ? { ...source, status: 'generating', error: '' } : source)),
    );

    try {
      const response = await fetch('/api/ai/generate-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl: activeSource.dataUrl,
          referenceImageDataUrls: referenceImages.map((reference) => reference.dataUrl),
          prompt: localizedPrompt,
          hasBrandAssetOverlay: Boolean(settings.brandAssetDataUrl),
          referenceMode: activeSource.kind === 'html' ? 'playable-import' : 'image',
          count: targetVariantCount,
          provider: settings.aiProvider,
          model: aiProviderModelMap[settings.aiProvider],
          aspectRatio: settings.orientation === 'landscape' ? '16:9' : '9:16',
          stream: true,
        }),
      });

      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `AI request failed (${response.status})`);
      }

      let next: PlayableVariant[] = [];
      let durationSeconds: number | null = null;
      let warningCount = 0;

      if (contentType.includes('application/x-ndjson') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const slots: Array<PlayableVariant | null> = Array.from({ length: targetVariantCount }, () => null);
        const streamErrors: string[] = [];
        let buffer = '';

        const handleLine = async (line: string) => {
          if (!line.trim()) return;
          let event: {
            type?: string;
            index?: number;
            variant?: AiVariantResponseItem;
            error?: string;
            errors?: string[];
            durationMs?: number;
          };

          try {
            event = JSON.parse(line);
          } catch {
            return;
          }

          if (event.type === 'variant' && typeof event.index === 'number' && event.variant) {
            const playable = await createVariantFromImage(activeSource, event.variant, event.index + 1);
            slots[event.index] = playable;
            next = slots.filter((item): item is PlayableVariant => Boolean(item));
            setVariants(next);
            setSelectedVariantId((current) => current || playable.id);
            setAiWorkers((current) => current.map((status, index) => (index === event.index ? 'done' : status)));
          }

          if (event.type === 'error' && typeof event.index === 'number') {
            if (event.error) streamErrors.push(event.error);
            setAiWorkers((current) => current.map((status, index) => (index === event.index ? 'error' : status)));
          }

          if (event.type === 'done') {
            durationSeconds = typeof event.durationMs === 'number' ? Math.max(1, Math.round(event.durationMs / 1000)) : null;
            warningCount = Array.isArray(event.errors) ? event.errors.length : streamErrors.length;
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) await handleLine(line);
          if (done) break;
        }

        if (buffer.trim()) await handleLine(buffer);
        if (!next.length) throw new Error(streamErrors.join('; ') || 'AI không trả về ảnh biến thể');
      } else {
        const payload = await response.json().catch(() => ({}));
        const generated = (payload.variants || []).slice(0, targetVariantCount) as AiVariantResponseItem[];
        if (!generated.length) throw new Error('AI không trả về ảnh biến thể');
        durationSeconds = typeof payload.durationMs === 'number' ? Math.max(1, Math.round(payload.durationMs / 1000)) : null;
        warningCount = Array.isArray(payload.errors) ? payload.errors.length : 0;
        setAiWorkers(Array.from({ length: targetVariantCount }, (_, index) => (index < generated.length ? 'done' : 'error')));
        next = await Promise.all(generated.map((item, index) => createVariantFromImage(activeSource, item, index + 1)));
      }

      next = await autoPlanVariants(next).catch(() => next);
      setLastAiDuration(durationSeconds);
      setVariants(next);
      setSelectedVariantId(next[0]?.id || '');
      markProjectForPersist();
      setSources((current) =>
        current.map((source) => (source.id === activeSource.id ? { ...source, status: 'done' } : source)),
      );
      rememberGeneration(next, durationSeconds);
      setNotice({
        tone: warningCount ? 'warn' : 'ok',
        text: `${next.length} biến thể đã tạo${durationSeconds ? ` trong ${durationSeconds}s` : ''}${warningCount ? `, lỗi ${warningCount}` : ''}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI generation failed';
      setAiWorkers(createWorkerStatuses(targetVariantCount, 'error'));
      setSources((current) =>
        current.map((source) =>
          source.id === activeSource.id ? { ...source, status: 'error', error: message } : source,
        ),
      );
      setNotice({ tone: 'error', text: message });
    } finally {
      setBusy(false);
    }
  };
  const autoPlanVariants = (items: PlayableVariant[]) =>
    mapWithConcurrency(items, ANALYZE_CONCURRENCY, async (variant) => {
      const rawHotspot = await detectImageHotspot(variant.dataUrl);
      const hotspot = projectHotspotToFrame(rawHotspot, variant, settings.orientation, activeImageFit);
      const plan = await analyzeVariantPlan(variant, hotspot, items.length || targetVariantCount);
      return {
        ...variant,
        hotspot: hotspotFromPlayablePlan(plan),
        plan,
        settings: settings.brandAssetDataUrl
          ? attachBrandAssetToLayer(layerFromPlayablePlan(plan, localizedPrompt || variant.revisedPrompt || ''), settings.brandAssetDataUrl, settings.brandAssetName)
          : layerFromPlayablePlan(plan, localizedPrompt || variant.revisedPrompt || ''),
      };
    });

  const detectAllVariants = async () => {
    if (!variants.length) return;
    setBusy(true);
    setNotice({ tone: 'busy', text: settings.useAiAnalyze ? 'Đang dùng AI Analyze để lên animation plan' : 'Đang auto-plan local, không tốn quota AI' });

    try {
      const next = await autoPlanVariants(variants);
      setVariants(next);
      setNotice({ tone: 'ok', text: `Đã auto-plan ${next.length} bản xem trước${settings.useAiAnalyze ? ' bằng AI Analyze' : ' bằng local heuristic'}` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Detect tháº¥t báº¡i' });
    } finally {
      setBusy(false);
    }
  };

  const analyzeVariantPlan = async (variant: PlayableVariant, hotspot: Hotspot, count = variants.length || targetVariantCount) => {
    if (!settings.useAiAnalyze || !activeAiReady) {
      return heuristicPlanFromHotspot(hotspot, variant.index, localizedPrompt || variant.revisedPrompt || '');
    }

    try {
      const response = await fetch('/api/ai/analyze-playable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          imageDataUrl: variant.dataUrl,
          prompt: localizedPrompt || variant.revisedPrompt || '',
          index: variant.index,
          count,
          hotspot,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.plan) throw new Error(payload.error || `Analyze failed (${response.status})`);
      return payload.plan as NonNullable<PlayableVariant['plan']>;
    } catch {
      return heuristicPlanFromHotspot(hotspot, variant.index, localizedPrompt || variant.revisedPrompt || '');
    }
  };

  const exportVariantHtml = async (variant: PlayableVariant, network: NetworkTarget = settings.network) => {
    const layer = normalizeLayerSettings(variant.settings);
    const handDataUrl = layer.injectHand ? await getHandDataUrl(layer.handId) : undefined;
    let image: ExportImageInput = {
      name: variant.name,
      dataUrl: variant.dataUrl,
      width: variant.width,
      height: variant.height,
    };

    if (network === 'applovin') {
      image = await optimizeImageForAppLovin(image, settings.orientation);
    }

    return generateImagePlayableHtml({
      image,
      layer,
      store: storeConfig,
      network,
      useClickTag: settings.useClickTag,
      handDataUrl,
      orientation: settings.orientation,
      imageFit: activeImageFit,
    });
  };

  const addVariantNetworkFiles = async (zip: JSZip, variant: PlayableVariant) => {
    const safeName = safeFileName(variant.name);
    const folder = zip.folder(safeName) || zip;
    for (const network of networkExportTargets) {
      const html = await exportVariantHtml(variant, network);
      folder.file(`${safeName}_${network}.html`, html);
    }
    const gif = await buildVariantPreviewGif(variant, {
      orientation: settings.orientation,
      imageFit: activeImageFit,
    });
    folder.file(getVariantPreviewGifName(variant.name), gif);
  };

  const exportSelected = async () => {
    if (selectedVariant) {
      setBusy(true);
      setNotice({ tone: 'busy', text: 'Đang đóng gói 5 HTML network và 1 GIF preview cho biến thể đang chọn' });
      try {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        const safeName = safeFileName(selectedVariant.name);
        for (const network of networkExportTargets) {
          const html = await exportVariantHtml(selectedVariant, network);
          zip.file(`${safeName}_${network}.html`, html);
        }
        const gif = await buildVariantPreviewGif(selectedVariant, {
          orientation: settings.orientation,
          imageFit: activeImageFit,
        });
        zip.file(getVariantPreviewGifName(selectedVariant.name), gif);
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(`${safeName}_5_networks_plus_gif.zip`, blob, 'application/zip');
        setNotice({ tone: 'ok', text: `Đã xuất 5 HTML và 1 GIF cho ${selectedVariant.name}` });
      } catch (error) {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Export GIF thất bại' });
      } finally {
        setBusy(false);
      }
      return;
    }

    if (activeSource?.kind === 'html' && activeSource.html) {
      setBusy(true);
      try {
        setNotice({ tone: 'busy', text: 'Đang đóng gói 5 HTML network cho playable HTML' });
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        const layer = normalizeLayerSettings(activeLayer);
        const handDataUrl = layer.injectHand ? await getHandDataUrl(layer.handId) : undefined;
        const safeName = safeFileName(activeSource.name);
        for (const network of networkExportTargets) {
          const html = patchPlayableHtml({
            html: activeSource.html,
            layer,
            store: storeConfig,
            network,
            useClickTag: settings.useClickTag,
            replaceLinks: settings.replaceLinks,
            ctaSelector: settings.ctaSelector,
            handDataUrl,
          });
          zip.file(`${safeName}_${network}.html`, html);
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(`${safeName}_5_networks.zip`, blob, 'application/zip');
        setNotice({ tone: 'ok', text: `Đã xuất 5 network cho ${activeSource.name}` });
      } finally {
        setBusy(false);
      }
    }
  };

  const exportZip = async () => {
    if (!variants.length) {
      setNotice({ tone: 'error', text: 'Chưa có biến thể để xuất' });
      return;
    }

    setBusy(true);
    setNotice({ tone: 'busy', text: 'Đang đóng gói HTML và GIF preview' });

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const variant of variants) {
        await addVariantNetworkFiles(zip, variant);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(`${safeFileName(settings.name)}_${variants.length}_playables_5_networks_plus_gif.zip`, blob, 'application/zip');
      setNotice({ tone: 'ok', text: `Đã xuất ZIP ${variants.length} playable kèm GIF preview` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Export ZIP thất bại' });
    } finally {
      setBusy(false);
    }
  };

  const getHandDataUrl = useCallback(async (handId: string) => {
    const cached = handDataUrlCache.current.get(handId);
    if (cached) return cached;
    const asset = getHandAsset(handId);
    const dataUrl = await loadAssetAsDataUrl(asset.src);
    handDataUrlCache.current.set(handId, dataUrl);
    return dataUrl;
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (activeSource?.kind !== 'html' || !activeLayer.injectHand) {
      setHtmlPreviewHandDataUrl(undefined);
      return () => {
        cancelled = true;
      };
    }

    getHandDataUrl(activeLayer.handId)
      .then((dataUrl) => {
        if (!cancelled) setHtmlPreviewHandDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setHtmlPreviewHandDataUrl(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [activeLayer.handId, activeLayer.injectHand, activeSource?.kind, getHandDataUrl]);

  const htmlPreviewMarkup = useMemo(() => {
    if (activeSource?.kind !== 'html' || !activeSource.html) return '';
    const layer = normalizeLayerSettings(activeLayer);
    return patchPlayableHtml({
      html: activeSource.html,
      layer,
      store: storeConfig,
      network: settings.network,
      useClickTag: settings.useClickTag,
      replaceLinks: settings.replaceLinks,
      ctaSelector: settings.ctaSelector,
      handDataUrl: htmlPreviewHandDataUrl,
      previewMode: true,
    });
  }, [
    activeLayer,
    activeSource?.html,
    activeSource?.kind,
    htmlPreviewHandDataUrl,
    settings.ctaSelector,
    settings.network,
    settings.replaceLinks,
    storeConfig,
    settings.useClickTag,
  ]);

  const rememberGeneration = (nextVariants: PlayableVariant[], durationSeconds: number | null) => {
    if (!nextVariants.length) return;
    const entry: GenerationHistoryEntry = {
      id: uid(),
      name: `${settings.name || 'Playable'} - ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      createdAt: Date.now(),
      provider: settings.aiProvider,
      model: aiProviderModelMap[settings.aiProvider],
      durationSeconds,
      variants: nextVariants.map((variant) => ({
        ...variant,
        settings: normalizeLayerSettings(variant.settings),
      })),
    };
    setGenerationHistory((current) => [entry, ...current].slice(0, 6));
  };

  const restoreGeneration = (entry: GenerationHistoryEntry) => {
    const restored = entry.variants.map((variant, index) => ({
      ...variant,
      id: uid(),
      index: index + 1,
      settings: normalizeLayerSettings(variant.settings),
    }));
    setVariants(restored);
    setSelectedVariantId(restored[0]?.id || '');
    markProjectForPersist();
    setSelectedLayer('hand');
    setLastAiDuration(entry.durationSeconds);
    setAiWorkers(Array.from({ length: Math.max(restored.length, targetVariantCount) }, (_, index) => (index < restored.length ? 'done' : 'idle')));
    setNotice({ tone: 'ok', text: `Đã khôi phục ${restored.length} biến thể từ lịch sử` });
  };

  const applyRecipe = (recipeId: string) => {
    const recipe = recipePresets.find((item) => item.id === recipeId);
    if (!recipe) return;
    const patch = getRecipePatchForLayer(recipe.layer, selectedLayer);
    if (!Object.keys(patch).length) {
      setNotice({ tone: 'warn', text: `${recipe.label} không áp dụng cho ${layerMeta[selectedLayer].label}` });
      return;
    }

    if (selectedLayer === 'scan') updateLayer(buildScanCompanionPatch(layerForControls, patch), undefined, 'scan');
    else if (selectedLayer === 'cta') updateLayer(buildCtaCompanionPatch(layerForControls, patch), undefined, 'cta');
    else if (selectedLayer === 'hand') updateLayer(buildHandCompanionPatch(layerForControls, patch), undefined, 'hand');
    else updateLayer(patch, undefined, selectedLayer);

    setNotice({ tone: 'ok', text: `${recipe.label} đã áp dụng cho ${layerMeta[selectedLayer].label}` });
  };

  const applyVisualAsset = (assetId: string) => {
    const asset = getVisualAsset(assetId);
    const scanLibraryPreset = getScanLibraryPreset(asset.id);
    if (scanLibraryPreset) {
      setSelectedLayer('scan');
      updateLayer(
        {
          scanStyle: scanLibraryPreset.scanStyle,
          scanAnimationName: getScanAnimationLabel(scanLibraryPreset.scanStyle),
          scanColor: layerForControls.scanColor || '#7c3cff',
          injectScan: true,
          layerOrder: ensureLayerInOrder(getLayerOrder(activeLayer), 'scan'),
        },
        undefined,
        'scan',
      );
      setNotice({ tone: 'ok', text: `Đã áp dụng ${scanLibraryPreset.label}` });
      return;
    }

    setSelectedLayer('asset');
    updateLayer(
      {
        assetId,
        injectAsset: true,
        layerOrder: ensureLayerInOrder(getLayerOrder(activeLayer), 'asset'),
      },
      undefined,
      'asset',
    );
    setNotice({ tone: 'ok', text: `Asset ${asset.label}` });
  };

  const applyButtonAsset = (assetId: string) => {
    const asset = getButtonAsset(assetId);
    setSelectedLayer('cta');
    updateLayer(
      buildCtaCompanionPatch(layerForControls, {
        ctaButtonId: asset.id,
        ctaColorFrom: asset.colorFrom,
        ctaColorTo: asset.colorTo,
        ctaTextColor: asset.textColor,
        ctaShadowColor: asset.shadowColor,
        showCta: true,
        layerOrder: ensureLayerInOrder(getLayerOrder(activeLayer), 'cta'),
      }),
      undefined,
      'cta',
    );
    setNotice({ tone: 'ok', text: `${asset.label} đã áp dụng nút` });
  };

  const removeSource = (sourceId: string) => {
    setSources((current) => current.filter((source) => source.id !== sourceId));
    if (activeSourceId === sourceId) {
      setActiveSourceId('');
      setVariants([]);
      setSelectedVariantId('');
    }
  };

  const removeSelectedLayer = () => {
    if (!selectedVariant && activeSource?.kind !== 'html') return;
    const order = getLayerOrder(layerForControls);
    if (!order.includes(selectedLayer)) return;

    const nextOrder = order.filter((target) => target !== selectedLayer);
    const removedLayer = selectedLayer;
    const nextSelectedLayer = [...nextOrder].reverse()[0] || 'hand';
    updateLayer(getRemoveLayerPatch(removedLayer, nextOrder), undefined, removedLayer);
    setSelectedLayer(nextSelectedLayer);
    setNotice({
      tone: 'ok',
      text: selectedVariant ? `Đã xóa ${layerMeta[removedLayer].label} khỏi biến thể ${selectedVariant.index}` : `Đã xóa ${layerMeta[removedLayer].label} khỏi HTML`,
    });
  };

  const deleteSelectedVariant = () => {
    if (!selectedVariant) return;
    const targetIndex = variants.findIndex((variant) => variant.id === selectedVariant.id);
    const next = variants
      .filter((variant) => variant.id !== selectedVariant.id)
      .map((variant, index) => ({ ...variant, index: index + 1 }));
    const nextSelected = next[Math.min(Math.max(targetIndex, 0), next.length - 1)] || next[0] || null;

    setVariants(next);
    setSelectedVariantId(nextSelected?.id || '');
    setNotice({ tone: 'ok', text: `Đã xóa biến thể ${selectedVariant.index}` });
  };

  const layerForControls = normalizeLayerSettings(activeLayer);
  const imageFrameForControls = getImageFrameLayout(
    layerForControls,
    selectedVariant?.width || activeSource?.width,
    selectedVariant?.height || activeSource?.height,
    settings.orientation,
    activeImageFit,
  );
  const selectedLayerLocked = isLayerLocked(layerForControls, selectedLayer);
  const canEditSelectedLayer = selectedLayer === 'image'
    ? Boolean(selectedVariant)
    : Boolean((selectedVariant || activeSource?.kind === 'html') && getLayerOrder(layerForControls).includes(selectedLayer));
  const canRemoveSelectedLayer = selectedLayer !== 'image' && canEditSelectedLayer && !selectedLayerLocked;
  const visibleLayerCount = Array.from(new Set<LayerTarget>(['image', ...getLayerOrder(layerForControls)])).filter((target) => isLayerVisible(layerForControls, target)).length;
  const selectedLayerMeta = layerMeta[selectedLayer];
  const selectedLayerVisible = isLayerVisible(layerForControls, selectedLayer);
  const layerStackSummary = selectedVariant ? `V${selectedVariant.index} · ${visibleLayerCount}` : activeSource?.kind === 'html' ? `HTML · ${visibleLayerCount}` : 'Chưa có biến thể';

  const moveLayer = useCallback(
    (variantId: string, layer: LayerTarget, x: number, y: number, assetId?: string, scanStyle?: ScanStyle | null) => {
      const currentLayer = normalizeLayerSettings(variants.find((variant) => variant.id === variantId)?.settings || defaultLayerSettings);
      setSelectedVariantId(variantId);
      setSelectedLayer(layer);
      if (layer === 'image') {
        updateLayer({ imageX: x, imageY: y }, variantId, 'image');
      }
      if (layer === 'hand') {
        updateLayer(
          buildHandCompanionPatch(currentLayer, { handX: x, handY: y, injectHand: true, layerOrder: ensureLayerInOrder(getLayerOrder(currentLayer), 'hand') }),
          variantId,
          'hand',
        );
      }
      if (layer === 'scan') {
        const scanPatch: Partial<LayerSettings> = {
          scanX: x,
          scanY: y,
          injectScan: true,
          layerOrder: ensureLayerInOrder(getLayerOrder(currentLayer), 'scan'),
          ...(scanStyle
            ? {
                scanStyle,
                scanAnimationName: getScanAnimationLabel(scanStyle),
              }
            : {}),
        };
        updateLayer(
          buildScanCompanionPatch(currentLayer, scanPatch),
          variantId,
          'scan',
        );
      }
      if (layer === 'asset') {
        updateLayer(
          { assetX: x, assetY: y, injectAsset: true, layerOrder: ensureLayerInOrder(getLayerOrder(currentLayer), 'asset'), ...(assetId ? { assetId } : {}) },
          variantId,
          'asset',
        );
      }
      if (layer === 'cta') {
        updateLayer(
          buildCtaCompanionPatch(currentLayer, { ctaX: x, ctaY: y, showCta: true, layerOrder: ensureLayerInOrder(getLayerOrder(currentLayer), 'cta') }),
          variantId,
          'cta',
        );
      }
      if (layer === 'text') {
        updateLayer(
          { cueX: x, cueY: y, showCue: true, layerOrder: ensureLayerInOrder(getLayerOrder(currentLayer), 'text') },
          variantId,
          'text',
        );
      }
    },
    [updateLayer, variants],
  );

  const patchPreviewLayer = useCallback(
    (variantId: string, layer: LayerTarget, partial: Partial<LayerSettings>) => {
      const currentLayer = normalizeLayerSettings(variants.find((variant) => variant.id === variantId)?.settings || defaultLayerSettings);
      setSelectedVariantId(variantId);
      setSelectedLayer(layer);
      if (layer === 'scan') {
        updateLayer(buildScanCompanionPatch(currentLayer, partial), variantId, 'scan');
        return;
      }
      if (layer === 'cta') {
        updateLayer(buildCtaCompanionPatch(currentLayer, partial), variantId, 'cta');
        return;
      }
      if (layer === 'hand') {
        updateLayer(buildHandCompanionPatch(currentLayer, partial), variantId, 'hand');
        return;
      }
      updateLayer(partial, variantId, layer);
    },
    [updateLayer, variants],
  );

  const setLayerVisibility = (layer: LayerTarget, visible: boolean) => {
    setSelectedLayer(layer);
    if (layer === 'image') return;
    const nextOrder = visible ? ensureLayerInOrder(getLayerOrder(layerForControls), layer) : getLayerOrder(layerForControls);
    if (layer === 'hand') updateLayer({ injectHand: visible, layerOrder: nextOrder }, undefined, 'hand');
    if (layer === 'scan') {
      updateLayer(
        {
          injectScan: visible,
          scanStyle: visible && layerForControls.scanStyle === 'none' ? 'frame' : layerForControls.scanStyle,
          ctaScanGrouped: visible ? layerForControls.ctaScanGrouped : false,
          layerOrder: nextOrder,
        },
        undefined,
        'scan',
      );
    }
    if (layer === 'asset') updateLayer({ injectAsset: visible, layerOrder: nextOrder }, undefined, 'asset');
    if (layer === 'cta') updateLayer({ showCta: visible, layerOrder: nextOrder }, undefined, 'cta');
    if (layer === 'text') updateLayer({ showCue: visible, layerOrder: nextOrder }, undefined, 'text');
  };

  const moveLayerOrder = (layer: LayerTarget, direction: 'up' | 'down') => {
    if (layer === 'image') return;
    const order = getLayerOrder(layerForControls);
    const index = order.indexOf(layer);
    const swapIndex = direction === 'up' ? index + 1 : index - 1;
    if (index < 0 || swapIndex < 0 || swapIndex >= order.length) return;
    const next = [...order];
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    setSelectedLayer(layer);
    updateLayer({ layerOrder: next }, undefined, layer);
  };

  const setLayerLock = (layer: LayerTarget, locked: boolean) => {
    setSelectedLayer(layer);
    updateLayer(getLayerLockPatch(layer, locked), undefined, layer);
  };

  const updateScanControls = (partial: Partial<LayerSettings>) => {
    updateLayer(buildScanCompanionPatch(layerForControls, partial), undefined, 'scan');
  };

  const updateCtaControls = (partial: Partial<LayerSettings>) => {
    updateLayer(buildCtaCompanionPatch(layerForControls, partial), undefined, 'cta');
  };

  const updateHandControls = (partial: Partial<LayerSettings>) => {
    updateLayer(buildHandCompanionPatch(layerForControls, partial), undefined, 'hand');
  };

  const updateTextControls = (partial: Partial<LayerSettings>) => {
    updateLayer(partial, undefined, 'text');
  };

  const updateImageControls = (partial: Partial<LayerSettings>) => {
    updateLayer(partial, undefined, 'image');
  };

  const setCtaScanGrouped = (grouped: boolean) => {
    updateLayer(setCtaScanGroupPatch(layerForControls, grouped), undefined, selectedLayer === 'scan' ? 'scan' : 'cta');
  };

  const canAlignSelectedLayer =
    canEditSelectedLayer && Boolean(selectedPreviewMetrics) && !(selectedLayer === 'scan' && shouldAnchorScanToFinger(layerForControls));

  const alignSelectedLayer = (command: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (!canAlignSelectedLayer || !selectedPreviewMetrics) return;

    const box = getLayerSelectionMetrics(layerForControls, selectedLayer, selectedPreviewMetrics, imageFrameForControls);
    if (!box) return;

    const horizontal =
      command === 'left' ? box.widthPercent / 2 : command === 'center' ? 50 : command === 'right' ? 100 - box.widthPercent / 2 : null;
    const vertical =
      command === 'top' ? box.heightPercent / 2 : command === 'middle' ? 50 : command === 'bottom' ? 100 - box.heightPercent / 2 : null;

    const nextX = horizontal === null ? null : roundCssNumber(clamp(horizontal, 0, 100));
    const nextY = vertical === null ? null : roundCssNumber(clamp(vertical, 0, 100));

    if (selectedLayer === 'image') {
      updateImageControls({
        ...(nextX === null ? {} : { imageX: nextX }),
        ...(nextY === null ? {} : { imageY: nextY }),
      });
      return;
    }

    if (selectedLayer === 'hand') {
      updateHandControls({
        ...(nextX === null ? {} : { handX: nextX }),
        ...(nextY === null ? {} : { handY: nextY }),
      });
      return;
    }

    if (selectedLayer === 'scan') {
      updateScanControls({
        ...(nextX === null ? {} : { scanX: nextX }),
        ...(nextY === null ? {} : { scanY: nextY }),
      });
      return;
    }

    if (selectedLayer === 'asset') {
      updateLayer(
        {
          ...(nextX === null ? {} : { assetX: nextX }),
          ...(nextY === null ? {} : { assetY: nextY }),
        },
        undefined,
        'asset',
      );
      return;
    }

    if (selectedLayer === 'text') {
      updateTextControls({
        ...(nextX === null ? {} : { cueX: nextX }),
        ...(nextY === null ? {} : { cueY: nextY }),
      });
      return;
    }

    updateCtaControls({
      ...(nextX === null ? {} : { ctaX: nextX }),
      ...(nextY === null ? {} : { ctaY: nextY }),
    });
  };

  if (appScopedEditor && sessionLoading) {
    return (
      <main className="dashboard-state">
        <Loader2 className="spin" size={18} />
        <span>Đang kiểm tra đăng nhập editor...</span>
      </main>
    );
  }

  if (appScopedEditor && !session) {
    return (
      <main className="dashboard-state">
        <AlertCircle size={18} />
        <span>Trình chỉnh sửa này yêu cầu đăng nhập Supabase.</span>
        <Link href={homeHref} className="secondary-button">
          Quay lại home
        </Link>
      </main>
    );
  }

  return (
    <main className="studio-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <Grid2X2 size={20} />
          </div>
          <div>
            <strong>Playable Studio</strong>
            <span>Editor theo app</span>
          </div>
        </div>

        {appScopedEditor ? (
          <section className="sidebar-section workspace-scope-section">
            <div className="editor-sidebar-actions">
              <button type="button" className="secondary-button" onClick={() => void leaveEditor(homeHref)}>
                <ArrowLeft size={15} />
                Home
              </button>
            </div>

          </section>
        ) : null}

        <button className="upload-zone" type="button" onClick={() => fileInputRef.current?.click()}>
          <Upload size={22} />
          <strong>Nguồn chính</strong>
          <span>PNG, JPG, WEBP, HTML</span>
        </button>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp,.html,.htm"
          multiple
          onChange={(event) => importFiles(event.target.files || [])}
        />

        <button className="upload-zone reference-upload-zone" type="button" onClick={() => referenceInputRef.current?.click()}>
          <ImagePlus size={22} />
          <strong>Input ref</strong>
          <span>PNG, JPG, WEBP</span>
        </button>
        <input
          ref={referenceInputRef}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(event) => void importReferenceImages(event.target.files)}
        />

        <section className="sidebar-section">
          <div className="section-head">
            <span>Hàng chờ</span>
            <b>{sources.length}</b>
          </div>
          <div className="source-list">
            <AnimatePresence initial={false}>
              {sources.map((source) => (
                <motion.button
                  layout
                  key={source.id}
                  className={`source-row ${source.id === activeSource?.id ? 'active' : ''}`}
                  type="button"
                  onClick={async () => {
                    setActiveSourceId(source.id);
                    if (source.kind === 'image' && source.dataUrl) {
                      const drafts = await createDraftVariants(source);
                      setVariants(drafts);
                      setSelectedVariantId(drafts[0]?.id || '');
                      return;
                    }
                    setVariants([]);
                    setSelectedVariantId('');
                  }}
                >
                  <span className="source-icon">{source.kind === 'image' ? <ImagePlus size={16} /> : <FileCode2 size={16} />}</span>
                  <span className="source-meta">
                    <strong>{source.name}</strong>
                    <small>
                      {source.kind === 'image'
                        ? `${source.width}x${source.height}`
                        : source.dataUrl
                          ? `HTML playable · ${source.width || 0}x${source.height || 0}`
                          : 'HTML playable · chưa có frame AI'}
                    </small>
                  </span>
                  <SourceState source={source} />
                  <span
                    className="row-remove"
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeSource(source.id);
                    }}
                  >
                    <X size={13} />
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </section>

        <section className="sidebar-section">
          <div className="section-head">
            <span>Input ref</span>
            <b>{referenceImages.length}</b>
          </div>
          {referenceImages.length ? (
            <div className="reference-list">
              {referenceImages.map((reference) => (
                <article key={reference.id} className="reference-row">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="reference-thumb" src={reference.dataUrl} alt={reference.name} />
                  <span className="reference-meta">
                    <strong>{reference.name}</strong>
                    <small>{`${reference.width}x${reference.height}`}</small>
                  </span>
                  <button
                    className="row-remove"
                    type="button"
                    onClick={() => removeReferenceImage(reference.id)}
                    aria-label={`Xóa input ref ${reference.name}`}
                  >
                    <X size={14} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-note">Chưa có input ref.</p>
          )}
        </section>

        <section className="sidebar-section">
          <div className="section-head">
            <span>Lịch sử tạo</span>
            <b>{generationHistory.length}</b>
          </div>
          <div className="history-list">
            {generationHistory.length ? (
              generationHistory.map((entry) => (
                <button key={entry.id} type="button" className="history-row" onClick={() => restoreGeneration(entry)}>
                  <span className="source-icon">
                    <History size={15} />
                  </span>
                  <span className="source-meta">
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.variants.length} biến thể · {entry.provider === 'openai' ? 'GPT' : 'Gemini'}
                      {entry.durationSeconds ? ` · ${entry.durationSeconds}s` : ``}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p className="empty-note">Các batch đã tạo sẽ xuất hiện tại đây.</p>
            )}
          </div>
        </section>

        <section className="sidebar-section asset-library-section">
          <div className="section-head">
            <span>Thư viện asset</span>
            <b>{assetLibraryCount}</b>
          </div>
          <div className="asset-tabs" role="tablist" aria-label="Thư viện asset">
            {(['hand', 'button', 'scan'] as AssetLibraryTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={assetLibraryTab === tab ? 'active' : ''}
                onClick={() => setAssetLibraryTab(tab)}
              >
                {tab === 'hand' ? (
                  <Hand size={14} />
                ) : tab === 'button' ? (
                  <MousePointerClick size={14} />
                ) : (
                  <ScanLine size={14} />
                )}
                <span>{tab}</span>
              </button>
            ))}
          </div>

          {assetLibraryTab === 'hand' ? (
            <div className="hand-grid asset-library-grid">
              {handAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  draggable
                  className={`hand-tile ${layerForControls.handId === asset.id ? 'active' : ''}`}
                  onDragStart={(event) => {
                    setLayerDragData(event, 'hand');
                    setSelectedLayer('hand');
                    updateLayer({ handId: asset.id, handMotion: asset.motion, injectHand: true }, undefined, 'hand');
                  }}
                  onClick={() => {
                    setSelectedLayer('hand');
                    updateLayer({ handId: asset.id, handMotion: asset.motion, injectHand: true }, undefined, 'hand');
                  }}
                  title={asset.label}
                >
                  <img src={asset.src} alt="" />
                </button>
              ))}
            </div>
          ) : assetLibraryTab === 'button' ? (
            <div className="button-asset-grid asset-library-grid">
              {buttonAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className={`button-asset-tile ${layerForControls.ctaButtonId === asset.id ? 'active' : ''}`}
                  onClick={() => applyButtonAsset(asset.id)}
                  title={`${asset.label} - ${asset.note}`}
                >
                  <span
                    className="button-asset-preview"
                    style={{
                      ['--cta-from' as string]: asset.colorFrom,
                      ['--cta-to' as string]: asset.colorTo,
                      ['--cta-text' as string]: asset.textColor,
                      ['--cta-shadow-rgb' as string]: hexToRgbTriplet(asset.shadowColor, '#f45100'),
                    }}
                  >
                    {layerForControls.ctaText || 'INSTALL NOW'}
                  </span>
                  <strong>{asset.label}</strong>
                  <small>{asset.note}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="asset-grid asset-library-grid">
              {visibleVisualAssets.map((asset) => {
                const scanLibraryPreset = getScanLibraryPreset(asset.id);
                const isActive = scanLibraryPreset
                  ? layerForControls.injectScan && layerForControls.scanStyle === scanLibraryPreset.scanStyle
                  : layerForControls.assetId === asset.id;

                return (
                  <button
                    key={asset.id}
                    type="button"
                    draggable
                    className={`asset-tile ${isActive ? 'active' : ''}`}
                    onDragStart={(event) => {
                      if (scanLibraryPreset) {
                        setLayerDragData(event, 'scan', undefined, scanLibraryPreset.scanStyle);
                        return;
                      }
                      setLayerDragData(event, 'asset', asset.id);
                    }}
                    onClick={() => applyVisualAsset(asset.id)}
                    title={`${asset.label} - ${asset.note}`}
                  >
                    <VisualAssetIcon assetId={asset.id} loopPreview />
                    <strong>{asset.label}</strong>
                    <small>{asset.note}</small>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </aside>

      <section className="workspace">
        <header className={`workspace-top ${appScopedEditor ? 'toolbar-only' : ''}`}>
          {appScopedEditor ? (
            <div className="workspace-top-main">
              <label className="workspace-title-field">
                <span className="eyebrow">Tên project</span>
                <input
                  value={settings.name}
                  onChange={(event) => setProjectSetting('name', event.target.value)}
                  placeholder={studioApp?.name || 'Nhập tên project'}
                />
              </label>
            </div>
          ) : (
            <div className="workspace-top-main">
              <span className="eyebrow">Playable Studio</span>
              <h1>{settings.name || 'Untitled'}</h1>
              <div className="workspace-summary-strip">
                <span className="workspace-summary-pill">{activeSourceLabel}</span>
                <span className="workspace-summary-pill soft">{variants.length ? `${variants.length} biến thể` : 'Chưa có biến thể'}</span>
              </div>
            </div>
          )}
          <div className="workspace-top-side">
            <div className="toolbar">
              <label className="batch-count-control" title={`1-${MAX_VARIANT_COUNT} variants`}>
                <span>Count</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_VARIANT_COUNT}
                  value={targetVariantCount}
                  onChange={(event) => setProjectSetting('variantCount', normalizeVariantCount(event.target.value))}
                />
              </label>
              <button className="ghost-button" type="button" onClick={cloneSourceToVariants} disabled={!activeSource || busy}>
                <Grid2X2 size={16} />
                Draft x{targetVariantCount}
              </button>
              <div className="fit-toggle" role="group" aria-label="Frame fit mode">
                <button
                  className={activeImageFit === 'cover' ? 'active' : ''}
                  type="button"
                  onClick={() => setProjectSetting('imageFit', 'cover')}
                  title="Fill the 9:16 frame without distortion"
                >
                  <Maximize2 size={14} />
                  Fill
                </button>
                <button
                  className={activeImageFit === 'contain' ? 'active' : ''}
                  type="button"
                  onClick={() => setProjectSetting('imageFit', 'contain')}
                  title="Show the full image without cropping"
                >
                  <Minimize2 size={14} />
                  Fit
                </button>
              </div>
              <div className="align-panel" role="group" aria-label={`Align ${toolbarLayerLabel}`}>
                <div className="align-panel-head">
                  <span className="align-panel-title">Align</span>
                  <strong>{toolbarLayerLabel}</strong>
                </div>
                <div className="align-panel-grid">
                  {alignPanelItems.map(({ command, title, Icon }) => (
                    <button
                      key={command}
                      type="button"
                      onClick={() => alignSelectedLayer(command)}
                      disabled={!canAlignSelectedLayer}
                      title={title}
                      aria-label={title}
                    >
                      <Icon size={14} />
                    </button>
                  ))}
                </div>
              </div>
              <button className="secondary-button" type="button" onClick={detectAllVariants} disabled={!variants.length || busy}>
                <Crosshair size={16} />
                Auto plan
              </button>
              <button className="primary-button" type="button" onClick={generateVariants} disabled={!activeSource?.dataUrl || busy || !activeAiReady}>
                {busy ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}
                Create {targetVariantCount}
              </button>
            </div>
          </div>
        </header>

        <div className="notice-row">
          <NoticeView notice={notice} />
          <div className="playback-controls">
            <button className="icon-button" type="button" onClick={() => setPaused((value) => !value)} title={paused ? 'Chạy' : 'Tạm dừng'}>
              {paused ? <Play size={16} /> : <Eye size={16} />}
            </button>
            <button className="icon-button" type="button" onClick={refreshHealth} title="Làm mới trạng thái">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        <section className={`preview-grid orientation-${settings.orientation} ${paused ? 'is-paused' : ''}`}>
          {variants.length ? (
            variants.map((variant) => (
              <PreviewCard
                key={variant.id}
                variant={variant}
                orientation={settings.orientation}
                imageFit={activeImageFit}
                selected={variant.id === selectedVariant?.id}
                selectedLayer={selectedLayer}
                onSelect={() => setSelectedVariantId(variant.id)}
                onLayerSelect={setSelectedLayer}
                onLayerDrop={(layer, x, y, assetId, scanStyle) => moveLayer(variant.id, layer, x, y, assetId, scanStyle)}
                onLayerPatch={(layer, partial) => patchPreviewLayer(variant.id, layer, partial)}
                onFrameMetricsChange={variant.id === selectedVariant?.id ? setSelectedPreviewMetrics : undefined}
              />
            ))
          ) : (
            <EmptyPreview source={activeSource} htmlPreview={htmlPreviewMarkup} />
          )}
        </section>

        <section className="layer-dock-panel">
          <div className="layer-dock-head">
            <div className="tab-group">
              <button
                className={selectedLayer === 'image' ? 'active' : ''}
                type="button"
                draggable
                onDragStart={(event) => setLayerDragData(event, 'image')}
                onClick={() => setSelectedLayer('image')}
              >
                <ImagePlus size={15} />
                Image
              </button>
              <button
                className={selectedLayer === 'hand' ? 'active' : ''}
                type="button"
                draggable
                onDragStart={(event) => setLayerDragData(event, 'hand')}
                onClick={() => setSelectedLayer('hand')}
              >
                <Hand size={15} />
                Hand
              </button>
              <button
                className={selectedLayer === 'scan' ? 'active' : ''}
                type="button"
                draggable
                onDragStart={(event) => setLayerDragData(event, 'scan')}
                onClick={() => setSelectedLayer('scan')}
              >
                <ScanLine size={15} />
                Scan
              </button>
              <button
                className={selectedLayer === 'cta' ? 'active' : ''}
                type="button"
                draggable
                onDragStart={(event) => setLayerDragData(event, 'cta')}
                onClick={() => setSelectedLayer('cta')}
              >
                <MousePointerClick size={15} />
                CTA
              </button>
              <button
                className={selectedLayer === 'text' ? 'active' : ''}
                type="button"
                draggable
                onDragStart={(event) => setLayerDragData(event, 'text')}
                onClick={() => setSelectedLayer('text')}
              >
                <Hash size={15} />
                Text
              </button>
            </div>
            <button
              className={`group-toggle ${layerForControls.ctaScanGrouped ? 'active' : ''}`}
              type="button"
              onClick={() => setCtaScanGrouped(!layerForControls.ctaScanGrouped)}
              title={layerForControls.ctaScanGrouped ? 'Tách scan khỏi CTA' : 'Gộp scan với CTA'}
            >
              {layerForControls.ctaScanGrouped ? <Link2 size={14} /> : <Unlink2 size={14} />}
              {layerForControls.ctaScanGrouped ? 'Đã gộp' : 'Tách rời'}
            </button>
            <div className="worker-strip">
              {aiWorkers.map((status, index) => (
                <span className={`worker-pill ${status}`} key={`${status}-${index}`}>
                  {status === 'running' ? <Loader2 className="spin" size={13} /> : <Sparkles size={13} />}
                  V{index + 1}
                </span>
              ))}
              {lastAiDuration ? <b>{lastAiDuration}s</b> : null}
            </div>
          </div>
        </section>
      </section>

      <aside className="inspector">
        <div className="inspector-head">
          <div>
            <span className="eyebrow">Thiết lập</span>
            <h2>{selectedVariant ? `Biến thể ${selectedVariant.index}` : activeSource?.kind === 'html' ? 'Bản vá HTML' : 'Cài đặt'}</h2>
          </div>
          <Settings2 size={18} />
        </div>

        <section className="panel-section">
          <label className="field">
            <span>Mô tả</span>
            <textarea rows={5} value={settings.prompt} onChange={(event) => setProjectSetting('prompt', event.target.value)} />
          </label>
          <div className="prompt-suggestion-row">
            <div
              className={`field-status ${
                promptSuggestionStatus === 'error' ? 'warn' : promptSuggestionStatus === 'ready' ? 'ok' : ''
              }`}
            >
              {promptSuggestionStatus === 'loading' ? (
                <>
                  <Loader2 className="spin" size={14} />
                  <span>Đang gợi ý prompt từ ảnh nguồn...</span>
                </>
              ) : promptSuggestionStatus === 'ready' ? (
                <span>{promptSuggestionTitle || `Đã có prompt gợi ý từ ${promptSuggestionSourceName}`}</span>
              ) : promptSuggestionStatus === 'error' ? (
                <span>{promptSuggestionError || 'Không gợi ý được prompt từ ảnh.'}</span>
              ) : (
                <span>Tải ảnh nguồn để hệ thống gợi ý prompt tự động.</span>
              )}
            </div>
            <div className="prompt-suggestion-actions">
              <button
                className="ghost-button slim"
                type="button"
                onClick={applyPromptSuggestion}
                disabled={!promptSuggestion || settings.prompt.trim() === promptSuggestion.trim()}
              >
                Dùng gợi ý
              </button>
              <button
                className="ghost-button slim"
                type="button"
                onClick={() => activeSource?.dataUrl && void suggestPromptForSource(activeSource, { autoApply: false })}
                disabled={!activeSource?.dataUrl || promptSuggestionStatus === 'loading'}
              >
                Gợi ý lại
              </button>
            </div>
          </div>
          <label className="field">
            <span>Ngôn ngữ localize</span>
            <select value={settings.locale} onChange={(event) => setProjectSetting('locale', event.target.value as ProjectSettings['locale'])}>
              {contentLocaleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <input
            ref={brandAssetInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => void importBrandAsset(event.target.files)}
          />
          <div className="field brand-asset-field">
            <span>Logo / biểu tượng</span>
            <div className="brand-asset-row">
              {settings.brandAssetDataUrl ? (
                <img className="brand-asset-preview" src={settings.brandAssetDataUrl} alt={settings.brandAssetName || 'Brand asset'} />
              ) : (
                <span className="brand-asset-placeholder">
                  <ImagePlus size={16} />
                </span>
              )}
              <div className="brand-asset-copy">
                <strong>{settings.brandAssetName || 'Chưa có logo/icon'}</strong>
                <small>
                  {settings.brandAssetDataUrl
                    ? 'Đang dùng asset layer để hiện logo/icon này trong preview và file xuất. AI generate cũng sẽ tránh vẽ lặp lại logo này vào ảnh nền.'
                    : 'Tải logo hoặc biểu tượng PNG/JPG/SVG/WEBP. Sau khi thêm, bạn có thể kéo vị trí ở layer Asset và AI generate sẽ tránh vẽ trùng logo trong ảnh nền.'}
                </small>
              </div>
            </div>
            <div className="brand-asset-actions">
              <button className="secondary-button" type="button" onClick={() => brandAssetInputRef.current?.click()}>
                <Upload size={15} />
                {settings.brandAssetDataUrl ? 'Thay logo/icon' : 'Tải logo/icon'}
              </button>
              <button className="secondary-button" type="button" onClick={clearBrandAsset} disabled={!settings.brandAssetDataUrl}>
                <Trash2 size={15} />
                Xóa logo/icon
              </button>
            </div>
          </div>
          <div className="section-title compact">
            <h3>Liên kết store</h3>
            <span>{storeRoutingMeta[settings.storeRoutingMode].label}</span>
          </div>
          <div className="store-routing-grid">
            {(['single', 'platform-auto'] as ProjectSettings['storeRoutingMode'][]).map((mode) => (
              <button
                key={mode}
                className={`store-target-chip ${settings.storeRoutingMode === mode ? 'active' : ''}`}
                type="button"
                onClick={() => setProjectSetting('storeRoutingMode', mode)}
              >
                {storeRoutingMeta[mode].label}
              </button>
            ))}
          </div>
          {!isPlatformAutoStore ? (
            <>
              <div className="store-target-grid">
                {(['app-store', 'google-play', 'custom'] as ProjectSettings['storePlatform'][]).map((target) => (
                  <button
                    key={target}
                    className={`store-target-chip ${settings.storePlatform === target ? 'active' : ''}`}
                    type="button"
                    onClick={() => setProjectSetting('storePlatform', target)}
                  >
                    {storeTargetMeta[target].label}
                  </button>
                ))}
              </div>
              <label className="field">
                <span>{selectedStoreMeta.label} URL</span>
                <input
                  value={selectedStoreValue}
                  placeholder={selectedStoreMeta.placeholder}
                  onChange={(event) => setProjectSetting(selectedStoreMeta.field, event.target.value)}
                />
                <small className={`field-help ${selectedStoreValue ? '' : 'warn'}`}>
                  {selectedStoreValue ? selectedStoreMeta.hint : 'Điền liên kết này trước khi xuất để thao tác chạm mở đúng trang store.'}
                </small>
              </label>
            </>
          ) : (
            <div className="field">
              <span>Liên kết theo nền tảng</span>
              <div className="field-grid">
                <label className="field">
                  <span>App Store URL</span>
                  <input
                    value={settings.appStoreUrl}
                    placeholder={storeTargetMeta['app-store'].placeholder}
                    onChange={(event) => setProjectSetting('appStoreUrl', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Google Play URL</span>
                  <input
                    value={settings.googlePlayUrl}
                    placeholder={storeTargetMeta['google-play'].placeholder}
                    onChange={(event) => setProjectSetting('googlePlayUrl', event.target.value)}
                  />
                </label>
              </div>
              <small className={`field-help ${settings.appStoreUrl || settings.googlePlayUrl ? '' : 'warn'}`}>
                {settings.appStoreUrl || settings.googlePlayUrl
                  ? 'Runtime sẽ mở App Store trên iOS và Google Play trên Android. Nếu một ô trống, hệ thống sẽ dùng liên kết store còn lại.'
                  : 'Điền cả App Store và Google Play nếu bạn muốn file xuất tự tách theo thiết bị.'}
              </small>
            </div>
          )}
          <div className="section-title compact">
            <h3>Đầu ra</h3>
          </div>
          <label className="field">
            <span>Mô hình AI</span>
            <select value={settings.aiProvider} onChange={(event) => setProjectSetting('aiProvider', event.target.value as ProjectSettings['aiProvider'])}>
              <option value="gemini-flash">Gemini 3.1 Flash Image</option>
              <option value="gemini-pro">Gemini 3 Pro Image</option>
              <option value="openai">GPT Image</option>
            </select>
          </label>
          {activeAiStatusMessage && <div className="field-status warn">{activeAiStatusMessage}</div>}
          <div className="field-grid">
            <label className="field">
              <span>Network xem trước</span>
              <select value={settings.network} onChange={(event) => setProjectSetting('network', event.target.value as ProjectSettings['network'])}>
                {networkExportTargets.map((network) => (
                  <option key={network} value={network}>
                    {networkLabels[network]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Tỷ lệ</span>
              <select value={settings.orientation} onChange={(event) => setProjectSetting('orientation', event.target.value as ProjectSettings['orientation'])}>
                <option value="portrait">9:16</option>
                <option value="landscape">16:9</option>
              </select>
            </label>
          </div>
          <div className="section-title compact">
            <h3>Thiết lập batch</h3>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.syncAllVariants}
              onChange={(event) => setProjectSetting('syncAllVariants', event.target.checked)}
            />
            <span>Đồng bộ layer đang chọn sang mọi biến thể đang hiển thị</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.useAiAnalyze}
              onChange={(event) => setProjectSetting('useAiAnalyze', event.target.checked)}
            />
            <span>Dùng AI Analyze để tự lên plan</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={settings.useClickTag} onChange={(event) => setProjectSetting('useClickTag', event.target.checked)} />
            <span>Tương thích clickTag</span>
          </label>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <h3>Thứ tự layer</h3>
            <span>{layerStackSummary}</span>
          </div>
          <LayerStack
            layer={layerForControls}
            selectedLayer={selectedLayer}
            onSelect={setSelectedLayer}
            onVisibleChange={setLayerVisibility}
            onMove={moveLayerOrder}
            onLockChange={setLayerLock}
          />
          <button className="secondary-button wide layer-remove-button" type="button" onClick={removeSelectedLayer} disabled={!canRemoveSelectedLayer}>
            <Trash2 size={15} />
            Xóa layer
          </button>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <h3>Chỉnh layer</h3>
            <span>{selectedLayerMeta.label}</span>
          </div>
          <div className="layer-status-row">
            <span className={`layer-status-chip ${selectedLayerVisible ? 'ok' : ''}`}>{selectedLayerVisible ? 'Hiện' : 'Ẩn'}</span>
            <span className={`layer-status-chip ${selectedLayerLocked ? 'warn' : ''}`}>{selectedLayerLocked ? 'Khóa' : 'Sửa được'}</span>
          </div>
          {selectedVariant && (
            <div className="analysis-card">
              <span>{selectedVariant.plan ? `Plan ${selectedVariant.plan.source.toUpperCase()}` : 'AI đặt vị trí'}</span>
              <strong>{Math.round(selectedVariant.hotspot.confidence * 100)}% tin cậy</strong>
              <small>
                {selectedVariant.plan ? `${playableIntentLabels[selectedVariant.plan.intent]} / ${selectedVariant.plan.recipeId}` : `X ${Math.round(selectedVariant.hotspot.x)} / Y ${Math.round(selectedVariant.hotspot.y)}`} - {layerForControls.handMotion} +{' '}
                {layerForControls.scanStyle} + {layerForControls.buttonAnimation}
              </small>
            </div>
          )}
          <button
            className={`layer-lock-toggle ${selectedLayerLocked ? 'active' : ''}`}
            type="button"
            onClick={() => setLayerLock(selectedLayer, !selectedLayerLocked)}
          >
            {selectedLayerLocked ? <Lock size={15} /> : <Unlock size={15} />}
            {selectedLayerLocked ? 'Khóa' : 'Mở khóa'}
          </button>
          <div className="layer-target-grid">
            {layerPickerTargets.map((target) => (
              <button
                key={target}
                className={`layer-target-button ${selectedLayer === target ? 'active' : ''}`}
                type="button"
                draggable
                onDragStart={(event) => setLayerDragData(event, target)}
                onClick={() => setSelectedLayer(target)}
              >
                {layerIcon(target)}
                <span>{layerMeta[target].label}</span>
              </button>
            ))}
          </div>

          {selectedLayer === 'image' && (
            <fieldset className="control-stack" disabled={selectedLayerLocked || !selectedVariant}>
              <NumberControl label="X" value={layerForControls.imageX} min={0} max={100} onChange={(value) => updateImageControls({ imageX: value })} />
              <NumberControl label="Y" value={layerForControls.imageY} min={0} max={100} onChange={(value) => updateImageControls({ imageY: value })} />
              <NumberControl label="Width" value={imageFrameForControls.widthPercent} min={12} max={180} step={0.5} onChange={(value) => updateImageControls({ imageWidth: value })} />
              <NumberControl label="Height" value={imageFrameForControls.heightPercent} min={12} max={180} step={0.5} onChange={(value) => updateImageControls({ imageHeight: value })} />
              <NumberControl label="Rotate" value={layerForControls.imageRotation} min={-180} max={180} onChange={(value) => updateImageControls(getLayerRotationPatch('image', value))} />
              <button
                className="secondary-button wide"
                type="button"
                onClick={() =>
                  updateImageControls({
                    imageX: 50,
                    imageY: 50,
                    imageWidth: 0,
                    imageHeight: 0,
                    imageRotation: 0,
                  })
                }
              >
                Đặt lại khung tự động
              </button>
            </fieldset>
          )}

          {selectedLayer === 'hand' && (
            <fieldset className="control-stack" disabled={selectedLayerLocked}>
              <label className="field">
                <span>Chuyển động</span>
                <select value={layerForControls.handMotion} onChange={(event) => updateHandControls({ handMotion: event.target.value as LayerSettings['handMotion'] })}>
                  {handMotionPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <NumberControl label="X" value={layerForControls.handX} min={0} max={100} onChange={(value) => updateHandControls({ handX: value })} />
              <NumberControl label="Y" value={layerForControls.handY} min={0} max={100} onChange={(value) => updateHandControls({ handY: value })} />
              <NumberControl label="Size" value={layerForControls.handSize} min={32} max={260} onChange={(value) => updateHandControls({ handSize: value })} />
              <NumberControl label="Rotate" value={layerForControls.handRotation} min={-180} max={180} onChange={(value) => updateHandControls(getLayerRotationPatch('hand', value))} />
              <label className="check-row">
                <input type="checkbox" checked={layerForControls.injectHand} onChange={(event) => updateHandControls({ injectHand: event.target.checked })} />
                <span>Hiện tay</span>
              </label>
            </fieldset>
          )}

          {selectedLayer === 'scan' && (
            <fieldset className="control-stack" disabled={selectedLayerLocked}>
              <label className="field">
                <span>Kiểu scan</span>
                <select value={layerForControls.scanStyle} onChange={(event) => updateScanControls({ scanStyle: event.target.value as LayerSettings['scanStyle'] })}>
                  {scanPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="animation-parameter-card">
                <div className="section-title compact">
                  <h3>Thông số animation</h3>
                  <span>{layerForControls.scanAnimationName || 'Frame Scan'}</span>
                </div>
                <label className="field">
                  <span>Tên</span>
                  <input value={layerForControls.scanAnimationName} onChange={(event) => updateScanControls({ scanAnimationName: event.target.value })} />
                </label>
                <label className="field color-field">
                  <span>Màu scan</span>
                  <span className="color-control">
                    <input
                      type="color"
                      value={normalizeHexColor(layerForControls.scanColor)}
                      onChange={(event) => updateScanControls({ scanColor: event.target.value })}
                    />
                    <code>{normalizeHexColor(layerForControls.scanColor)}</code>
                  </span>
                </label>
                <div className="scan-color-swatches" aria-label="Màu scan swatches">
                  {scanColorSwatches.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={normalizeHexColor(layerForControls.scanColor).toLowerCase() === color.toLowerCase() ? 'active' : ''}
                      style={{ ['--swatch-color' as string]: color }}
                      onClick={() => updateScanControls({ scanColor: color })}
                      title={color}
                    />
                  ))}
                </div>
                <div className="field-grid">
                  <label className="field">
                    <span>Kiểu lặp</span>
                    <select value={layerForControls.scanLoop} onChange={(event) => updateScanControls({ scanLoop: event.target.value as LayerSettings['scanLoop'] })}>
                      <option value="once">Chạy 1 lần</option>
                      <option value="loop">Lặp một chiều</option>
                      <option value="pingpong">Lặp hai chiều</option>
                    </select>
                  </label>
                  <label className="check-row animation-check">
                    <input type='checkbox' checked={layerForControls.scanAutoplay} onChange={(event) => updateScanControls({ scanAutoplay: event.target.checked })} />
                    <span>Tự chạy</span>
                  </label>
                </div>
                <NumberControl label='Độ trễ' value={layerForControls.scanDelay} min={0} max={3000} step={100} onChange={(value) => updateScanControls({ scanDelay: value })} />
                <NumberControl label="Thời lượng" value={layerForControls.scanSpeed} min={400} max={5000} step={100} onChange={(value) => updateScanControls({ scanSpeed: value })} />
                <div className="parameter-subtitle">Tỷ lệ</div>
                <NumberControl label="Start" value={layerForControls.scanScaleStart} min={0.2} max={2} step={0.05} onChange={(value) => updateScanControls({ scanScaleStart: value })} />
                <NumberControl label="End" value={layerForControls.scanScaleEnd} min={0.2} max={3} step={0.05} onChange={(value) => updateScanControls({ scanScaleEnd: value })} />
                <div className="parameter-subtitle">Độ mờ</div>
                <NumberControl label="Start" value={layerForControls.scanOpacityStart} min={0} max={100} onChange={(value) => updateScanControls({ scanOpacityStart: value })} />
                <NumberControl label="End" value={layerForControls.scanOpacityEnd} min={0} max={100} onChange={(value) => updateScanControls({ scanOpacityEnd: value })} />
                <div className="parameter-subtitle">Vị trí khung scan</div>
                {layerForControls.ctaScanGrouped ? (
                  <>
                    <NumberControl label="Lệch X" value={layerForControls.scanOffsetX} min={-220} max={220} onChange={(value) => updateScanControls({ scanOffsetX: value })} />
                    <NumberControl label="Lệch Y" value={layerForControls.scanOffsetY} min={-220} max={220} onChange={(value) => updateScanControls({ scanOffsetY: value })} />
                  </>
                ) : (
                  <>
                    <NumberControl label="X" value={layerForControls.scanX} min={0} max={100} onChange={(value) => updateScanControls({ scanX: value })} />
                    <NumberControl label="Y" value={layerForControls.scanY} min={0} max={100} onChange={(value) => updateScanControls({ scanY: value })} />
                  </>
                )}
                <NumberControl label="Size" value={layerForControls.scanSize} min={48} max={360} onChange={(value) => updateScanControls({ scanSize: value })} />
                <NumberControl label="Rotate" value={layerForControls.scanRotation} min={-180} max={180} onChange={(value) => updateScanControls(getLayerRotationPatch('scan', value))} />
              </div>
              <label className="check-row">
                <input type="checkbox" checked={layerForControls.ctaScanGrouped} onChange={(event) => setCtaScanGrouped(event.target.checked)} />
                <span>Gộp với CTA</span>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={layerForControls.injectScan}
                  onChange={(event) =>
                    event.target.checked
                      ? updateScanControls({ injectScan: true })
                      : updateLayer({ injectScan: false, ctaScanGrouped: false }, undefined, 'scan')
                  }
                />
                <span>Hiện scan</span>
              </label>
            </fieldset>
          )}

          {selectedLayer === 'asset' && (
            <fieldset className="control-stack" disabled={selectedLayerLocked}>
              {layerForControls.customAssetDataUrl && (
                <div className="asset-upload-note">
                  <img className="asset-upload-note-preview" src={layerForControls.customAssetDataUrl} alt={layerForControls.customAssetName || 'Brand asset'} />
                  <div>
                    <strong>{layerForControls.customAssetName || 'Logo / biểu tượng'}</strong>
                    <small>Asset upload đang ghi đè icon preset bên dưới. Bạn vẫn có thể kéo vị trí và đổi size như bình thường.</small>
                  </div>
                </div>
              )}
              <label className="field">
                <span>Loại asset</span>
                <select value={layerForControls.assetId} onChange={(event) => updateLayer({ assetId: event.target.value, injectAsset: true })}>
                  {visualAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.label}
                    </option>
                  ))}
                </select>
              </label>
              <NumberControl label="X" value={layerForControls.assetX} min={0} max={100} onChange={(value) => updateLayer({ assetX: value })} />
              <NumberControl label="Y" value={layerForControls.assetY} min={0} max={100} onChange={(value) => updateLayer({ assetY: value })} />
              <NumberControl label="Size" value={layerForControls.assetSize} min={48} max={280} onChange={(value) => updateLayer({ assetSize: value })} />
              <NumberControl label="Rotate" value={layerForControls.assetRotation} min={-180} max={180} onChange={(value) => updateLayer(getLayerRotationPatch('asset', value))} />
              <NumberControl label="Speed" value={layerForControls.assetSpeed} min={500} max={5000} step={100} onChange={(value) => updateLayer({ assetSpeed: value })} />
              <label className="check-row">
                <input type="checkbox" checked={layerForControls.injectAsset} onChange={(event) => updateLayer({ injectAsset: event.target.checked })} />
                <span>Hiện asset</span>
              </label>
            </fieldset>
          )}

          {selectedLayer === 'cta' && (
            <fieldset className="control-stack" disabled={selectedLayerLocked}>
              <label className="field">
                <span>Chữ</span>
                <input value={layerForControls.ctaText} onChange={(event) => updateCtaControls({ ctaText: event.target.value })} />
              </label>
              <label className="field">
                <span>Hiệu ứng nút</span>
                <select
                  value={layerForControls.buttonAnimation}
                  onChange={(event) => updateCtaControls({ buttonAnimation: event.target.value as LayerSettings['buttonAnimation'] })}
                >
                  {buttonPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-grid">
                <label className="field color-field">
                  <span>Màu trên</span>
                  <span className="color-control">
                    <input
                      type="color"
                      value={normalizeHexColor(layerForControls.ctaColorFrom, '#ff9a2f')}
                      onChange={(event) => updateCtaControls({ ctaButtonId: 'custom', ctaColorFrom: event.target.value })}
                    />
                    <code>{normalizeHexColor(layerForControls.ctaColorFrom, '#ff9a2f')}</code>
                  </span>
                </label>
                <label className="field color-field">
                  <span>Màu dưới</span>
                  <span className="color-control">
                    <input
                      type="color"
                      value={normalizeHexColor(layerForControls.ctaColorTo, '#f45100')}
                      onChange={(event) => updateCtaControls({ ctaButtonId: 'custom', ctaColorTo: event.target.value })}
                    />
                    <code>{normalizeHexColor(layerForControls.ctaColorTo, '#f45100')}</code>
                  </span>
                </label>
              </div>
              <div className="field-grid">
                <label className="field color-field">
                  <span>Màu chữ</span>
                  <span className="color-control">
                    <input
                      type="color"
                      value={normalizeHexColor(layerForControls.ctaTextColor, '#ffffff')}
                      onChange={(event) => updateCtaControls({ ctaButtonId: 'custom', ctaTextColor: event.target.value })}
                    />
                    <code>{normalizeHexColor(layerForControls.ctaTextColor, '#ffffff')}</code>
                  </span>
                </label>
                <label className="field color-field">
                  <span>Bóng</span>
                  <span className="color-control">
                    <input
                      type="color"
                      value={normalizeHexColor(layerForControls.ctaShadowColor, '#f45100')}
                      onChange={(event) => updateCtaControls({ ctaButtonId: 'custom', ctaShadowColor: event.target.value })}
                    />
                    <code>{normalizeHexColor(layerForControls.ctaShadowColor, '#f45100')}</code>
                  </span>
                </label>
              </div>
              <NumberControl label="X" value={layerForControls.ctaX} min={0} max={100} onChange={(value) => updateCtaControls({ ctaX: value })} />
              <NumberControl label="Y" value={layerForControls.ctaY} min={0} max={100} onChange={(value) => updateCtaControls({ ctaY: value })} />
              <NumberControl label="Width" value={layerForControls.ctaWidth} min={44} max={92} onChange={(value) => updateCtaControls({ ctaWidth: value })} />
              <NumberControl label="Rotate" value={layerForControls.ctaRotation} min={-180} max={180} onChange={(value) => updateCtaControls(getLayerRotationPatch('cta', value))} />
              <label className="check-row">
                <input type="checkbox" checked={layerForControls.ctaScanGrouped} onChange={(event) => setCtaScanGrouped(event.target.checked)} />
                <span>Gộp scan với CTA</span>
              </label>
              <label className="check-row">
                <input type="checkbox" checked={layerForControls.showCta} onChange={(event) => updateCtaControls({ showCta: event.target.checked })} />
                <span>Hiện CTA</span>
              </label>
            </fieldset>
          )}

          {selectedLayer === 'text' && (
            <fieldset className="control-stack" disabled={selectedLayerLocked}>
              <label className="field">
                <span>Chữ nhắc</span>
                <input value={layerForControls.cueText} onChange={(event) => updateTextControls({ cueText: event.target.value })} />
              </label>
              <label className="field">
                <span>Hiệu ứng chữ</span>
                <select
                  value={layerForControls.cueAnimation}
                  onChange={(event) => updateTextControls({ cueAnimation: event.target.value as LayerSettings['cueAnimation'] })}
                >
                  {textCuePresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-grid">
                <label className="field color-field">
                  <span>Màu chữ</span>
                  <span className="color-control">
                    <input
                      type="color"
                      value={normalizeHexColor(layerForControls.cueColor, '#ffffff')}
                      onChange={(event) => updateTextControls({ cueColor: event.target.value })}
                    />
                    <code>{normalizeHexColor(layerForControls.cueColor, '#ffffff')}</code>
                  </span>
                </label>
                <label className="field color-field">
                  <span>Nền</span>
                  <span className="color-control">
                    <input
                      type="color"
                      value={normalizeHexColor(layerForControls.cueBgColor, '#111827')}
                      onChange={(event) => updateTextControls({ cueBgColor: event.target.value })}
                    />
                    <code>{normalizeHexColor(layerForControls.cueBgColor, '#111827')}</code>
                  </span>
                </label>
              </div>
              <label className="field color-field">
                <span>Bóng</span>
                <span className="color-control">
                  <input
                    type="color"
                    value={normalizeHexColor(layerForControls.cueShadowColor, '#000000')}
                    onChange={(event) => updateTextControls({ cueShadowColor: event.target.value })}
                  />
                  <code>{normalizeHexColor(layerForControls.cueShadowColor, '#000000')}</code>
                </span>
              </label>
              <NumberControl label="X" value={layerForControls.cueX} min={0} max={100} onChange={(value) => updateTextControls({ cueX: value })} />
              <NumberControl label="Y" value={layerForControls.cueY} min={0} max={100} onChange={(value) => updateTextControls({ cueY: value })} />
              <NumberControl label="Width" value={layerForControls.cueWidth} min={28} max={96} onChange={(value) => updateTextControls({ cueWidth: value })} />
              <NumberControl label="Size" value={layerForControls.cueSize} min={12} max={42} onChange={(value) => updateTextControls({ cueSize: value })} />
              <NumberControl label="Rotate" value={layerForControls.cueRotation} min={-180} max={180} onChange={(value) => updateTextControls(getLayerRotationPatch('text', value))} />
              <label className="check-row">
                <input type="checkbox" checked={layerForControls.showCue} onChange={(event) => updateTextControls({ showCue: event.target.checked })} />
                <span>Hiện chữ nhắc</span>
              </label>
            </fieldset>
          )}

          <div className="layer-actions">
            <button className="danger-button wide" type="button" onClick={deleteSelectedVariant} disabled={!selectedVariant}>
              <Trash2 size={16} />
              Xóa biến thể
            </button>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <h3>Thao tác</h3>
            <span>
              {selectedVariant
                ? '5 HTML + 1 GIF'
                : activeSource?.kind === 'html'
                  ? '5 HTML'
                  : `${variants.length * networkExportTargets.length} HTML + ${variants.length} GIF`}
            </span>
          </div>
          <div className="action-grid">
            <button className="secondary-button wide" type="button" onClick={exportSelected} disabled={busy || (!selectedVariant && !activeSource?.html)}>
              <Download size={16} />
              {selectedVariant ? 'Xuất HTML + GIF' : 'Xuất 5 HTML'}
            </button>
            <button className="secondary-button wide" type="button" onClick={exportZip} disabled={busy || !variants.length}>
              <Archive size={16} />
              {`ZIP HTML + GIF x${variants.length}`}
            </button>
            <button className="primary-button wide" type="button" onClick={() => void saveProject({ force: true })} disabled={busy || projectSaving || !appScopedEditor || !appId || !hasProjectContent}>
              <Save size={16} />
              {projectSaving ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
          <p className={`field-help ${autosaveState === 'error' ? 'warn' : ''}`}>
            {autosaveState === 'saving'
              ? 'Tự lưu lên Supabase...'
              : autosaveState === 'error'
                ? `Tự lưu lỗi: ${autosaveError || 'không rõ nguyên nhân'}`
                : lastSavedAt
                  ? `Đã lưu Supabase lúc ${formatProjectSaveTime(lastSavedAt)}`
                  : 'Project sẽ tự lưu lên Supabase sau khi bạn đổi tên hoặc chỉnh nội dung. Bạn cũng có thể bấm Lưu bằng tay.'}
          </p>
        </section>
      </aside>
    </main>
  );
}

function LayerStack({
  layer,
  selectedLayer,
  onSelect,
  onVisibleChange,
  onMove,
  onLockChange,
}: {
  layer: LayerSettings;
  selectedLayer: LayerTarget;
  onSelect: (layer: LayerTarget) => void;
  onVisibleChange: (layer: LayerTarget, visible: boolean) => void;
  onMove: (layer: LayerTarget, direction: 'up' | 'down') => void;
  onLockChange: (layer: LayerTarget, locked: boolean) => void;
}) {
  const stackOrder = getLayerOrder(layer);
  const topToBottom = [...stackOrder].reverse();
  const rows = [...topToBottom, 'image' as LayerTarget];

  return (
    <div className="layer-stack">
      {rows.map((target, displayIndex) => {
        const sourceIndex = stackOrder.indexOf(target);
        const visible = isLayerVisible(layer, target);
        const locked = isLayerLocked(layer, target);
        const isImage = target === 'image';
        return (
          <div key={target} className={`layer-row ${selectedLayer === target ? 'active' : ''}`}>
            <button className="layer-select" type="button" onClick={() => onSelect(target)}>
              <span className="layer-icon">{layerIcon(target)}</span>
              <span>
                <strong>{layerMeta[target].label}</strong>
                <small>{layerMeta[target].group}</small>
              </span>
            </button>
            <button className="layer-mini" type="button" onClick={() => onVisibleChange(target, !visible)} title={visible ? 'Ẩn' : 'Hiện'} disabled={isImage}>
              {visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button className={`layer-mini ${locked ? 'locked' : ''}`} type="button" onClick={() => onLockChange(target, !locked)} title={locked ? 'Mở khóa' : 'Khóa'}>
              {locked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
            <button className="layer-mini" type="button" onClick={() => onMove(target, 'up')} disabled={isImage || displayIndex === 0} title="Đưa lên">
              <ArrowUp size={14} />
            </button>
            <button
              className="layer-mini"
              type="button"
              onClick={() => onMove(target, 'down')}
              disabled={isImage || sourceIndex === 0}
              title="Đưa xuống"
            >
              <ArrowDown size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function getArtboardStyle(
  width: number | undefined,
  height: number | undefined,
  orientation: ProjectSettings['orientation'],
  imageFit: ProjectSettings['imageFit'],
) {
  if (imageFit === 'cover') return { width: '100%', height: '100%' };
  const frameAspect = orientation === 'landscape' ? 16 / 9 : 9 / 16;
  const imageAspect = width && height && width > 0 && height > 0 ? width / height : frameAspect;
  if (imageAspect > frameAspect) {
    return { width: '100%', height: `${roundCssNumber((frameAspect / imageAspect) * 100)}%` };
  }
  return { width: `${roundCssNumber((imageAspect / frameAspect) * 100)}%`, height: '100%' };
}

function roundCssNumber(value: number) {
  return Math.round(value * 1000) / 1000;
}

function PreviewCard({
  variant,
  orientation,
  imageFit,
  selected,
  selectedLayer,
  onSelect,
  onLayerSelect,
  onLayerDrop,
  onLayerPatch,
  onFrameMetricsChange,
}: {
  variant: PlayableVariant;
  orientation: ProjectSettings['orientation'];
  imageFit: ProjectSettings['imageFit'];
  selected: boolean;
  selectedLayer: LayerTarget;
  onSelect: () => void;
  onLayerSelect: (layer: LayerTarget) => void;
  onLayerDrop: (layer: LayerTarget, x: number, y: number, assetId?: string, scanStyle?: ScanStyle | null) => void;
  onLayerPatch: (layer: LayerTarget, partial: Partial<LayerSettings>) => void;
  onFrameMetricsChange?: (metrics: FrameMetrics | null) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const layer = normalizeLayerSettings(variant.settings);
  const hand = getHandAsset(layer.handId);
  const ratio = orientation === 'landscape' ? '16 / 9' : '9 / 16';
  const imageFrame = getImageFrameLayout(layer, variant.width, variant.height, orientation, imageFit);
  const artboardStyle = {
    left: `${imageFrame.x}%`,
    top: `${imageFrame.y}%`,
    width: `${imageFrame.widthPercent}%`,
    height: `${imageFrame.heightPercent}%`,
    rotate: `${imageFrame.rotation}deg`,
  };
  const anchoredScanCss = shouldAnchorScanToFinger(layer) ? getFingerAnchorCss(layer) : null;
  const scanAnimationVars = getScanAnimationVars(layer);
  const ctaStyleVars = getCtaStyleVars(layer);
  const cueStyleVars = getCueStyleVars(layer);
  const orderedLayerMarkup = getLayerOrder(layer).map((target, index) => {
    const zIndex = 5 + index;
    if (target === 'scan' && layer.injectScan && layer.scanStyle !== 'none') {
      return (
        <span
          key="scan"
          className={`preview-scan scan-${layer.scanStyle} ${selectedLayer === 'scan' && selected ? 'active' : ''}`}
          style={{
            left: anchoredScanCss?.left || `${layer.scanX}%`,
            top: anchoredScanCss?.top || `${layer.scanY}%`,
            width: `${layer.scanSize}px`,
            height: `${layer.scanSize}px`,
            zIndex,
            rotate: `${layer.scanRotation}deg`,
            ['--scan-speed' as string]: `${layer.scanSpeed}ms`,
            ['--scan-color' as string]: normalizeHexColor(layer.scanColor),
            ['--scan-color-rgb' as string]: hexToRgbTriplet(layer.scanColor),
            ['--scan-size-px' as string]: `${layer.scanSize}px`,
            ...scanAnimationVars,
            animationPlayState: layer.scanAutoplay ? undefined : 'paused',
          }}
          onPointerDown={(event) => startDrag('scan', event)}
        />
      );
    }

    if (target === 'asset' && layer.injectAsset) {
      return (
        <span
          key="asset"
          className={`preview-asset ${layer.customAssetDataUrl ? 'preview-asset-custom' : `asset-motion-${getVisualAsset(layer.assetId).motion}`} ${selectedLayer === 'asset' && selected ? 'active' : ''}`}
          style={{
            left: `${layer.assetX}%`,
            top: `${layer.assetY}%`,
            width: `${layer.assetSize}px`,
            height: `${layer.assetSize}px`,
            zIndex,
            rotate: `${layer.assetRotation}deg`,
            ['--asset-speed' as string]: `${layer.assetSpeed}ms`,
          }}
          onPointerDown={(event) => startDrag('asset', event)}
        >
          {layer.customAssetDataUrl ? (
            <img className="preview-asset-media" src={layer.customAssetDataUrl} alt={layer.customAssetName || 'Brand asset'} />
          ) : (
            <VisualAssetIcon assetId={layer.assetId} />
          )}
        </span>
      );
    }

    if (target === 'hand' && layer.injectHand) {
      return (
        <img
          key="hand"
          className={`preview-hand motion-${layer.handMotion} ${selectedLayer === 'hand' && selected ? 'active' : ''}`}
          src={hand.src}
          alt=""
          style={{
            left: `${layer.handX}%`,
            top: `${layer.handY}%`,
            width: `${layer.handSize}px`,
            zIndex,
            rotate: `${layer.handRotation}deg`,
          }}
          onPointerDown={(event) => startDrag('hand', event)}
        />
      );
    }

    if (target === 'text' && layer.showCue) {
      return (
        <span
          key="text"
          className={`preview-cue cue-${layer.cueAnimation} ${selectedLayer === 'text' && selected ? 'active' : ''}`}
          style={{
            left: `${layer.cueX}%`,
            top: `${layer.cueY}%`,
            width: `${layer.cueWidth}%`,
            fontSize: `${layer.cueSize}px`,
            zIndex,
            rotate: `${layer.cueRotation}deg`,
            ...cueStyleVars,
          }}
          onPointerDown={(event) => startDrag('text', event)}
        >
          {layer.cueText}
        </span>
      );
    }

    if (target === 'cta' && layer.showCta) {
      return (
        <button
          key="cta"
          className={`preview-cta btn-${layer.buttonAnimation} ${selectedLayer === 'cta' && selected ? 'active' : ''}`}
          type="button"
          style={{
            left: `${layer.ctaX}%`,
            top: `${layer.ctaY}%`,
            width: `${layer.ctaWidth}%`,
            zIndex,
            rotate: `${layer.ctaRotation}deg`,
            ...ctaStyleVars,
          }}
          onPointerDown={(event) => startDrag('cta', event)}
        >
          {layer.ctaText}
        </button>
      );
    }

    return null;
  });
  const selectionBox = selected && selectedLayer !== 'image' ? getLayerSelectionBox(layer, selectedLayer) : null;
  const imageSelectionBox = selected && selectedLayer === 'image'
    ? {
        left: `${imageFrame.x}%`,
        top: `${imageFrame.y}%`,
        width: `${imageFrame.widthPercent}%`,
        height: `${imageFrame.heightPercent}%`,
        rotation: imageFrame.rotation,
      }
    : null;
  const selectedLayerIsLocked = isLayerLocked(layer, selectedLayer);

  useEffect(() => {
    if (!selected || !onFrameMetricsChange || !frameRef.current) return;
    const node = frameRef.current;
    const report = () => {
      const rect = node.getBoundingClientRect();
      onFrameMetricsChange({ width: rect.width, height: rect.height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => {
      observer.disconnect();
      onFrameMetricsChange(null);
    };
  }, [onFrameMetricsChange, selected]);

  const startResize = (target: LayerTarget, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    onLayerSelect(target);
    if (isLayerLocked(layer, target)) return;

    if (target === 'image') {
      if (!frameRef.current) return;
      const rect = frameRef.current.getBoundingClientRect();
      const centerX = rect.left + (imageFrame.x / 100) * rect.width;
      const centerY = rect.top + (imageFrame.y / 100) * rect.height;
      const startDistance = Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY));
      const startWidth = imageFrame.widthPercent;
      const startHeight = imageFrame.heightPercent;

      const move = (moveEvent: PointerEvent) => {
        const nextDistance = Math.max(1, Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY));
        const scale = nextDistance / startDistance;
        onLayerPatch('image', {
          imageWidth: roundCssNumber(clamp(startWidth * scale, 12, 180)),
          imageHeight: roundCssNumber(clamp(startHeight * scale, 12, 180)),
        });
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end, { once: true });
      return;
    }

    if (!frameRef.current) return;

    const rect = frameRef.current.getBoundingClientRect();
    const position = target === 'scan' && shouldAnchorScanToFinger(layer) ? getFingerAnchorPercent(layer, rect) : getLayerPosition(layer, target);
    const centerX = rect.left + (position.x / 100) * rect.width;
    const centerY = rect.top + (position.y / 100) * rect.height;
    const startDistance = Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY));
    const startSize = getLayerSizeValue(layer, target);

    const move = (moveEvent: PointerEvent) => {
      const nextDistance = Math.max(1, Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY));
      onLayerPatch(target, getLayerSizePatch(target, startSize * (nextDistance / startDistance)));
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  };

  const startRotate = (target: LayerTarget, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    onLayerSelect(target);
    if (isLayerLocked(layer, target)) return;

    if (target === 'image') {
      if (!frameRef.current) return;
      const rect = frameRef.current.getBoundingClientRect();
      const centerX = rect.left + (imageFrame.x / 100) * rect.width;
      const centerY = rect.top + (imageFrame.y / 100) * rect.height;
      const startAngle = (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI;
      const startRotation = imageFrame.rotation;

      const move = (moveEvent: PointerEvent) => {
        const nextAngle = (Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) * 180) / Math.PI;
        onLayerPatch('image', { imageRotation: Math.round(clamp(startRotation + nextAngle - startAngle, -180, 180)) });
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end, { once: true });
      return;
    }

    if (!frameRef.current) return;

    const rect = frameRef.current.getBoundingClientRect();
    const position = target === 'scan' && shouldAnchorScanToFinger(layer) ? getFingerAnchorPercent(layer, rect) : getLayerPosition(layer, target);
    const centerX = rect.left + (position.x / 100) * rect.width;
    const centerY = rect.top + (position.y / 100) * rect.height;
    const startAngle = (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI;
    const startRotation = getLayerRotation(layer, target);

    const move = (moveEvent: PointerEvent) => {
      const nextAngle = (Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) * 180) / Math.PI;
      onLayerPatch(target, getLayerRotationPatch(target, startRotation + nextAngle - startAngle));
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  };

  const startDrag = (target: LayerTarget, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const dragSurface = frameRef.current;
    if (!dragSurface) {
      onSelect();
      onLayerSelect(target);
      return;
    }
    const dragTarget = target === 'image' ? 'image' : resolveDragTargetForPointer(target, layer, frameRef.current!, event.clientX, event.clientY);
    onSelect();
    onLayerSelect(dragTarget);
    if (isLayerLocked(layer, dragTarget)) return;
    const rect = frameRef.current!.getBoundingClientRect();
    const startPoint = getPointInElement(frameRef.current!, event.clientX, event.clientY);
    const startPosition =
      dragTarget === 'image'
        ? { x: imageFrame.x, y: imageFrame.y }
        : dragTarget === 'scan' && shouldAnchorScanToFinger(layer)
        ? getFingerAnchorPercent(layer, rect)
        : dragTarget === 'hand'
        ? { x: layer.handX, y: layer.handY }
        : dragTarget === 'scan'
          ? { x: layer.scanX, y: layer.scanY }
          : dragTarget === 'asset'
            ? { x: layer.assetX, y: layer.assetY }
            : dragTarget === 'text'
              ? { x: layer.cueX, y: layer.cueY }
              : { x: layer.ctaX, y: layer.ctaY };

    const move = (moveEvent: PointerEvent) => {
      const surface = frameRef.current;
      if (!surface) return;
      const point = getPointInElement(surface, moveEvent.clientX, moveEvent.clientY);
      const x = clamp(startPosition.x + point.x - startPoint.x, 0, 100);
      const y = clamp(startPosition.y + point.y - startPoint.y, 0, 100);
      if (dragTarget === 'scan' && shouldAnchorScanToFinger(layer)) {
        const nextRect = frameRef.current!.getBoundingClientRect();
        const offset = getScanOffsetFromFingerPoint(layer, nextRect, x, y);
        onLayerPatch('scan', { scanOffsetX: offset.x, scanOffsetY: offset.y, injectScan: true });
        return;
      }
      onLayerDrop(dragTarget, x, y);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  };

  const placeLayer = (target: LayerTarget, clientX: number, clientY: number, assetId?: string, scanStyle?: ScanStyle | null) => {
    const surface = frameRef.current;
    if (!surface) return;
    const point = getPointInElement(surface, clientX, clientY);
    onSelect();
    onLayerSelect(target);
    if (target === 'scan' && shouldAnchorScanToFinger(layer)) {
      const rect = frameRef.current!.getBoundingClientRect();
      const offset = getScanOffsetFromFingerPoint(layer, rect, point.x, point.y);
      onLayerPatch('scan', { scanOffsetX: offset.x, scanOffsetY: offset.y, injectScan: true });
      return;
    }
    onLayerDrop(target, point.x, point.y, assetId, scanStyle);
  };

  return (
    <motion.article layout className={`preview-card ${selected ? 'selected' : ''}`} style={{ aspectRatio: ratio }} onClick={onSelect}>
      <div className="preview-stage">
        <div
          ref={frameRef}
          className="creative-frame"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(event) => {
            event.preventDefault();
            const assetId = getAssetDragData(event);
            const scanStyle = getScanStyleDragData(event);
            const layerTarget = assetId ? 'asset' : getLayerDragData(event) || selectedLayer;
            placeLayer(layerTarget, event.clientX, event.clientY, assetId, scanStyle);
          }}
        >
          <img className="creative-backdrop" src={variant.dataUrl} alt="" />
          <div ref={artboardRef} className={`creative-artboard ${selected && selectedLayer === 'image' ? 'image-selected' : ''}`} style={artboardStyle} onPointerDown={(event) => startDrag('image', event)}>
            <img className="creative-image" src={variant.dataUrl} alt="" style={{ objectFit: imageFit }} />
          </div>
          {orderedLayerMarkup}
          {selectionBox && (
            <span
              className={`selection-box ${selectedLayerIsLocked ? 'locked' : ''}`}
              style={{
                left: selectionBox.left,
                top: selectionBox.top,
                width: selectionBox.width,
                height: selectionBox.height,
                rotate: `${selectionBox.rotation}deg`,
              }}
              onPointerDown={(event) => startDrag(selectedLayer, event)}
            >
              <span className="selection-handle nw" onPointerDown={(event) => startResize(selectedLayer, event)} />
              <span className="selection-handle ne" onPointerDown={(event) => startResize(selectedLayer, event)} />
              <span className="selection-handle sw" onPointerDown={(event) => startResize(selectedLayer, event)} />
              <span className="selection-handle se" onPointerDown={(event) => startResize(selectedLayer, event)} />
              <span className="selection-rotate-handle" onPointerDown={(event) => startRotate(selectedLayer, event)} />
              {selectedLayerIsLocked && (
                <span className="selection-lock-badge">
                  <Lock size={11} />
                </span>
              )}
            </span>
          )}
          {imageSelectionBox && (
            <span
              className={`selection-box ${selectedLayerIsLocked ? 'locked' : ''}`}
              style={{
                left: imageSelectionBox.left,
                top: imageSelectionBox.top,
                width: imageSelectionBox.width,
                height: imageSelectionBox.height,
                rotate: `${imageSelectionBox.rotation}deg`,
              }}
              onPointerDown={(event) => startDrag('image', event)}
            >
              <span className="selection-handle nw" onPointerDown={(event) => startResize('image', event)} />
              <span className="selection-handle ne" onPointerDown={(event) => startResize('image', event)} />
              <span className="selection-handle sw" onPointerDown={(event) => startResize('image', event)} />
              <span className="selection-handle se" onPointerDown={(event) => startResize('image', event)} />
              <span className="selection-rotate-handle" onPointerDown={(event) => startRotate('image', event)} />
              {selectedLayerIsLocked && (
                <span className="selection-lock-badge">
                  <Lock size={11} />
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </motion.article>
  );
}

function EmptyPreview({ source, htmlPreview }: { source: SourceItem | null; htmlPreview?: string }) {
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    if (source?.kind !== 'html') {
      setPreviewUrl('');
      return;
    }

    const html = htmlPreview || source.html || '';
    if (!html) {
      setPreviewUrl('');
      return;
    }

    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [htmlPreview, source?.html, source?.kind]);

  if (source?.kind === 'html') {
    return (
      <div className="html-preview-card">
        <div className="html-preview-head">
          <div>
            <span className="eyebrow">HTML playable</span>
            <h2>{source.name}</h2>
          </div>
          <FileCode2 size={18} />
        </div>
        <iframe
          className="html-preview-frame"
          title={`${source.name} preview`}
          src={previewUrl || undefined}
          sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
        />
      </div>
    );
  }

  return (
    <div className="empty-preview">
      <div className="empty-frame">
        {source?.dataUrl ? <img src={source.dataUrl} alt="" /> : <Grid2X2 size={56} />}
      </div>
      <div>
        <span className="eyebrow">{source ? source.name : 'Chưa có ảnh nguồn'}</span>
        <h2>Tạo các biến thể playable</h2>
      </div>
    </div>
  );
}

function NumberControl({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="number-control">
      <span>{label}</span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
      <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function NoticeView({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const Icon = notice.tone === 'ok' ? CheckCircle2 : notice.tone === 'busy' ? Loader2 : AlertCircle;
  return (
    <div className={`notice ${notice.tone}`}>
      <Icon className={notice.tone === 'busy' ? 'spin' : ''} size={16} />
      <span>{notice.text}</span>
    </div>
  );
}

function SourceState({ source }: { source: SourceItem }) {
  if (source.status === 'generating') return <Loader2 className="spin source-state busy" size={15} />;
  if (source.status === 'done') return <CheckCircle2 className="source-state ok" size={15} />;
  if (source.status === 'error') return <AlertCircle className="source-state error" size={15} />;
  return <span className="source-state idle" />;
}

function normalizeLayerSettings(settings: Partial<LayerSettings>): LayerSettings {
  const merged = {
    ...defaultLayerSettings,
    ...settings,
  } as LayerSettings;
  const validScanStyles: ScanStyle[] = ['ripple', 'face', 'sweep', 'ring', 'spotlight', 'border', 'frame', 'spark', 'none'];
  const scanStyle = validScanStyles.includes(merged.scanStyle) ? merged.scanStyle : 'frame';
  const legacyScanNames = new Set(['Tap Ripple', 'Face Scan', 'Pulse Ring', 'Sweep Line', 'Spotlight', 'Border Scan', 'Spark Hit', 'Square Light Scan']);
  const scanAnimationName =
    scanStyle === 'none'
      ? 'None'
      : !merged.scanAnimationName || legacyScanNames.has(merged.scanAnimationName)
        ? getScanAnimationLabel(scanStyle)
        : merged.scanAnimationName;
  return {
    ...merged,
    scanStyle,
    scanAnimationName,
    customAssetDataUrl: typeof merged.customAssetDataUrl === 'string' ? merged.customAssetDataUrl : '',
    customAssetName: typeof merged.customAssetName === 'string' ? merged.customAssetName : '',
    scanColor: normalizeHexColor(merged.scanColor, '#7c3cff'),
    ctaColorFrom: normalizeHexColor(merged.ctaColorFrom, '#ff9a2f'),
    ctaColorTo: normalizeHexColor(merged.ctaColorTo, '#f45100'),
    ctaTextColor: normalizeHexColor(merged.ctaTextColor, '#ffffff'),
    ctaShadowColor: normalizeHexColor(merged.ctaShadowColor, '#f45100'),
    cueColor: normalizeHexColor(merged.cueColor, '#ffffff'),
    cueBgColor: normalizeHexColor(merged.cueBgColor, '#111827'),
    cueShadowColor: normalizeHexColor(merged.cueShadowColor, '#000000'),
    layerOrder: getLayerOrder(merged),
  };
}

function getScanAnimationLabel(scanStyle: ScanStyle) {
  const labels: Record<ScanStyle, string> = {
    ripple: 'Tap Ripple',
    face: 'Face Scan',
    sweep: 'Sweep Line',
    ring: 'Pulse Ring',
    spotlight: 'Spotlight',
    border: 'Border Scan',
    frame: 'Frame Scan',
    spark: 'Spark Hit',
    none: 'None',
  };
  return labels[scanStyle];
}

function getScanLibraryPreset(assetId: string): { scanStyle: ScanStyle; label: string } | null {
  const presetMap: Record<string, { scanStyle: ScanStyle; label: string }> = {
    'scan-frame-box': { scanStyle: 'frame', label: 'Frame Scan' },
    'scan-beam': { scanStyle: 'sweep', label: 'Sweep Line' },
    'scan-vertical-beam': { scanStyle: 'border', label: 'Border Scan' },
    'scan-reticle': { scanStyle: 'face', label: 'Face Scan' },
    'scan-radar-sweep': { scanStyle: 'ring', label: 'Pulse Ring' },
  };
  return presetMap[assetId] || null;
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

function getLayerOrder(settings: Partial<LayerSettings>): LayerTarget[] {
  const hasExplicitOrder = Array.isArray(settings.layerOrder);
  const raw = hasExplicitOrder ? settings.layerOrder || [] : defaultLayerSettings.layerOrder;
  const valid = raw.filter((layer): layer is LayerTarget => layer === 'hand' || layer === 'scan' || layer === 'asset' || layer === 'cta' || layer === 'text');
  const next = valid.filter((layer, index) => valid.indexOf(layer) === index);
  if (settings.injectScan && settings.scanStyle !== 'none' && !next.includes('scan')) next.push('scan');
  if (settings.injectAsset && !next.includes('asset')) next.push('asset');
  if (settings.showCue && !next.includes('text')) next.push('text');
  if (settings.showCta && !next.includes('cta')) next.push('cta');
  if (settings.injectHand && !next.includes('hand')) next.push('hand');
  return keepHandAboveCta(keepCtaAboveScan(next));
}

function ensureLayerInOrder(order: LayerTarget[], ...layers: LayerTarget[]) {
  const next = order.filter((layer, index) => order.indexOf(layer) === index);
  for (const layer of layers) {
    if (!next.includes(layer)) next.push(layer);
  }
  return next;
}

function keepHandAboveCta(order: LayerTarget[]) {
  const handIndex = order.indexOf('hand');
  const ctaIndex = order.indexOf('cta');
  if (handIndex < 0 || ctaIndex < 0 || handIndex > ctaIndex) return order;
  const next: LayerTarget[] = order.filter((layer) => layer !== 'hand');
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
  const next: LayerTarget[] = order.filter((layer) => layer !== 'scan');
  next.splice(firstInteractiveIndex, 0, 'scan');
  return next;
}

function isLayerVisible(layer: LayerSettings, target: LayerTarget) {
  if (target === 'image') return true;
  if (target === 'hand') return layer.injectHand;
  if (target === 'scan') return layer.injectScan && layer.scanStyle !== 'none';
  if (target === 'asset') return layer.injectAsset;
  if (target === 'text') return layer.showCue;
  return layer.showCta;
}

function getLayerPosition(layer: LayerSettings, target: LayerTarget) {
  if (target === 'image') return { x: layer.imageX, y: layer.imageY };
  if (target === 'hand') return { x: layer.handX, y: layer.handY };
  if (target === 'scan') return { x: layer.scanX, y: layer.scanY };
  if (target === 'asset') return { x: layer.assetX, y: layer.assetY };
  if (target === 'text') return { x: layer.cueX, y: layer.cueY };
  return { x: layer.ctaX, y: layer.ctaY };
}

function shouldAnchorScanToFinger(layer: LayerSettings) {
  return layer.ctaScanGrouped && layer.injectHand && layer.injectScan;
}

function getFingerAnchorCss(layer: LayerSettings) {
  const offset = getHandAnchorOffset(layer.handId, layer.handSize);
  return {
    left: `calc(${layer.handX}% + ${offset.x + layer.scanOffsetX}px)`,
    top: `calc(${layer.handY}% + ${offset.y + layer.scanOffsetY}px)`,
  };
}

function getFingerAnchorPercent(layer: LayerSettings, rect: DOMRect) {
  const offset = getHandAnchorOffset(layer.handId, layer.handSize);
  return {
    x: clamp(layer.handX + ((offset.x + layer.scanOffsetX) / rect.width) * 100, 0, 100),
    y: clamp(layer.handY + ((offset.y + layer.scanOffsetY) / rect.height) * 100, 0, 100),
  };
}

function getScanOffsetFromFingerPoint(layer: LayerSettings, rect: DOMRect, x: number, y: number) {
  const offset = getHandAnchorOffset(layer.handId, layer.handSize);
  return {
    x: Math.round(clamp(((x - layer.handX) / 100) * rect.width - offset.x, -220, 220)),
    y: Math.round(clamp(((y - layer.handY) / 100) * rect.height - offset.y, -220, 220)),
  };
}

function getLayerRotation(layer: LayerSettings, target: LayerTarget) {
  if (target === 'image') return layer.imageRotation;
  if (target === 'hand') return layer.handRotation;
  if (target === 'scan') return layer.scanRotation;
  if (target === 'asset') return layer.assetRotation;
  if (target === 'text') return layer.cueRotation;
  return layer.ctaRotation;
}

function getLayerSizeValue(layer: LayerSettings, target: LayerTarget) {
  if (target === 'image') return Math.max(layer.imageWidth || 100, layer.imageHeight || 100);
  if (target === 'hand') return layer.handSize;
  if (target === 'scan') return layer.scanSize;
  if (target === 'asset') return layer.assetSize;
  if (target === 'text') return layer.cueWidth;
  return layer.ctaWidth;
}

function getLayerSelectionBox(layer: LayerSettings, target: LayerTarget) {
  if (!isLayerVisible(layer, target)) return null;
  const position = getLayerPosition(layer, target);
  const rotation = getLayerRotation(layer, target);
  const anchoredScan = target === 'scan' && shouldAnchorScanToFinger(layer) ? getFingerAnchorCss(layer) : null;

  if (target === 'image') {
    return {
      left: `${position.x}%`,
      top: `${position.y}%`,
      rotation,
      width: `${layer.imageWidth}%`,
      height: `${layer.imageHeight}%`,
    };
  }

  if (target === 'cta') {
    return {
      left: `${position.x}%`,
      top: `${position.y}%`,
      rotation,
      width: `${layer.ctaWidth}%`,
      height: '42px',
    };
  }

  if (target === 'text') {
    return {
      left: `${position.x}%`,
      top: `${position.y}%`,
      rotation,
      width: `${layer.cueWidth}%`,
      height: `${Math.max(32, layer.cueSize + 18)}px`,
    };
  }

  const size = getLayerSizeValue(layer, target);
  return {
    left: anchoredScan?.left || `${position.x}%`,
    top: anchoredScan?.top || `${position.y}%`,
    rotation,
    width: `${size}px`,
    height: `${size}px`,
  };
}

function getLayerSelectionMetrics(
  layer: LayerSettings,
  target: LayerTarget,
  frame: FrameMetrics,
  imageFrame: ReturnType<typeof getImageFrameLayout>,
) {
  if (!isLayerVisible(layer, target) || frame.width <= 0 || frame.height <= 0) return null;

  if (target === 'image') {
    return {
      widthPercent: imageFrame.widthPercent,
      heightPercent: imageFrame.heightPercent,
    };
  }

  if (target === 'cta') {
    return {
      widthPercent: clamp(layer.ctaWidth, 1, 100),
      heightPercent: (42 / frame.height) * 100,
    };
  }

  if (target === 'text') {
    return {
      widthPercent: clamp(layer.cueWidth, 1, 100),
      heightPercent: (Math.max(32, layer.cueSize + 18) / frame.height) * 100,
    };
  }

  const size = getLayerSizeValue(layer, target);
  return {
    widthPercent: (size / frame.width) * 100,
    heightPercent: (size / frame.height) * 100,
  };
}

function resolveDragTargetForPointer(target: LayerTarget, _layer: LayerSettings, _artboard: HTMLElement, _clientX: number, _clientY: number) {
  return target;
}

function getScanAnimationVars(layer: LayerSettings) {
  return {
    ['--scan-delay' as string]: `${layer.scanDelay}ms`,
    ['--scan-iterations' as string]: layer.scanLoop === 'once' ? '1' : 'infinite',
    ['--scan-direction' as string]: layer.scanLoop === 'pingpong' ? 'alternate' : 'normal',
    ['--scan-scale-start' as string]: String(layer.scanScaleStart),
    ['--scan-scale-end' as string]: String(layer.scanScaleEnd),
    ['--scan-opacity-start' as string]: String(clamp(layer.scanOpacityStart / 100, 0, 1)),
    ['--scan-opacity-end' as string]: String(clamp(layer.scanOpacityEnd / 100, 0, 1)),
  };
}

function getCtaStyleVars(layer: LayerSettings) {
  return {
    ['--cta-from' as string]: normalizeHexColor(layer.ctaColorFrom, '#ff9a2f'),
    ['--cta-to' as string]: normalizeHexColor(layer.ctaColorTo, '#f45100'),
    ['--cta-text' as string]: normalizeHexColor(layer.ctaTextColor, '#ffffff'),
    ['--cta-shadow-rgb' as string]: hexToRgbTriplet(layer.ctaShadowColor, '#f45100'),
  };
}

function getCueStyleVars(layer: LayerSettings) {
  return {
    ['--cue-color' as string]: normalizeHexColor(layer.cueColor, '#ffffff'),
    ['--cue-bg' as string]: normalizeHexColor(layer.cueBgColor, '#111827'),
    ['--cue-shadow-rgb' as string]: hexToRgbTriplet(layer.cueShadowColor, '#000000'),
  };
}

function layerIcon(target: LayerTarget) {
  if (target === 'image') return <ImagePlus size={15} />;
  if (target === 'hand') return <Hand size={15} />;
  if (target === 'scan') return <ScanLine size={15} />;
  if (target === 'asset') return <Activity size={15} />;
  if (target === 'text') return <Hash size={15} />;
  return <MousePointerClick size={15} />;
}

function VisualAssetIcon({ assetId, loopPreview = false }: { assetId: string; loopPreview?: boolean }) {
  const asset = getVisualAsset(assetId);
  const className = `asset-preview asset-preview-${asset.id}${loopPreview ? ` asset-motion-${asset.motion}` : ''}`;
  if (asset.category === 'counter') {
    return (
      <span className={className}>
        <b>{asset.value || '86'}</b>
        <small>{asset.id === 'counter-bpm' ? 'BPM' : asset.id === 'counter-countdown' ? 'tap' : 'score'}</small>
      </span>
    );
  }

  if (asset.id === 'ecg-wave-line') {
    return (
      <span className={`asset-preview asset-preview-ecg${loopPreview ? ` asset-motion-${asset.motion}` : ''}`}>
        <i />
      </span>
    );
  }

  if (asset.id === 'heart-live-dot' || asset.id === 'status-normal') {
    return (
      <span className={className}>
        <i />
        <b>{asset.value || 'Live'}</b>
      </span>
    );
  }

  if (asset.category === 'scan') {
    return (
      <span className={className}>
        <i />
        {(asset.id === 'scan-food-card' || asset.id === 'scan-calorie-chip') && (
          <>
            <b>{asset.value || '690'}</b>
            <small>kcal</small>
          </>
        )}
      </span>
    );
  }

  return (
    <span className={className}>
      <HeartPulse size={28} />
      <b>{asset.value || ''}</b>
    </span>
  );
}

function layerFromHotspot(hotspot: Hotspot, index: number): LayerSettings {
  const recipe = selectRecipeForHotspot(hotspot, index);
  const targetX = Math.round(clamp(hotspot.x, 12, 88));
  const targetY = Math.round(clamp(hotspot.y, 18, 84));
  const scanSize = targetY < 44 ? 164 : targetY > 74 ? 132 : 148;
  const handSize = targetY > 76 ? 116 : 112;
  const baseLayer: LayerSettings = {
    ...defaultLayerSettings,
    ...recipe.layer,
    handMotion: 'tap',
    handSize: recipe.layer.handSize || handSize,
    scanStyle: 'frame',
    scanColor: '#7c3cff',
    scanSize: recipe.layer.scanSize || scanSize,
    ctaX: 50,
    ctaY: targetY > 78 ? 90 : 88,
    ctaScanGrouped: false,
  };
  return mergeLayerSettings(baseLayer, buildCtaCompanionPatch(baseLayer, {}));
}

function selectRecipeForHotspot(hotspot: Hotspot, index: number) {
  const lowerArea = hotspot.y > 74;
  const upperArea = hotspot.y < 44;
  const sideArea = hotspot.x < 34 || hotspot.x > 66;
  const pool = lowerArea
    ? ['cta-push', 'spark-hit', 'double-tap', 'shake-cta']
    : upperArea
      ? ['scan-sweep', 'wave-guide', 'border-lock', 'tap-target']
      : sideArea
        ? ['swipe-reveal', 'drag-focus', 'wave-guide', 'real-press']
        : ['heart-pulse', 'tap-target', 'real-press', 'double-tap'];
  const id = pool[(index - 1) % pool.length];
  return recipePresets.find((recipe) => recipe.id === id) || recipePresets[(index - 1) % recipePresets.length];
}

function projectHotspotToFrame(
  hotspot: Hotspot,
  dimensions: { width?: number; height?: number },
  orientation: ProjectSettings['orientation'],
  imageFit: ProjectSettings['imageFit'] = 'cover',
): Hotspot {
  const frameAspect = orientation === 'landscape' ? 16 / 9 : 9 / 16;
  const imageAspect = dimensions.width && dimensions.height && dimensions.width > 0 && dimensions.height > 0 ? dimensions.width / dimensions.height : frameAspect;
  let x = hotspot.x;
  let y = hotspot.y;

  if (imageFit === 'cover' && imageAspect > 0 && Math.abs(imageAspect - frameAspect) > 0.001) {
    if (imageAspect > frameAspect) {
      const displayedWidth = (imageAspect / frameAspect) * 100;
      x = (hotspot.x / 100) * displayedWidth - (displayedWidth - 100) / 2;
    } else {
      const displayedHeight = (frameAspect / imageAspect) * 100;
      y = (hotspot.y / 100) * displayedHeight - (displayedHeight - 100) / 2;
    }
  }

  return {
    ...hotspot,
    x: clamp(x, 8, 92),
    y: clamp(y, 12, 88),
    reason: `${hotspot.reason || 'detected'}; ${imageFit} artboard`,
  };
}

function defaultHotspot(): Hotspot {
  return { x: 50, y: 72, confidence: 0.28, reason: 'fallback' };
}

async function buildPlayableHtmlSource(file: File, orientation: ProjectSettings['orientation']): Promise<SourceItem> {
  const analyzed = await analyzePlayableImportFile(file).catch(async () => ({
    documentHtml: await readFileAsText(file),
    convertedFromWrapper: false,
  }));
  const html = analyzed.documentHtml || (await readFileAsText(file));

  try {
    const captured = await capturePlayableImportFrame(html, orientation);
    const hotspot = await detectImageHotspot(captured.dataUrl).catch(() => defaultHotspot());
    return {
      id: uid(),
      name: file.name,
      kind: 'html',
      status: 'ready',
      html,
      dataUrl: captured.dataUrl,
      width: captured.width,
      height: captured.height,
      hotspot,
      createdAt: Date.now(),
    };
  } catch (error) {
    return {
      id: uid(),
      name: file.name,
      kind: 'html',
      status: 'error',
      html,
      error: error instanceof Error ? error.message : 'Không chụp được frame từ playable HTML.',
      createdAt: Date.now(),
    };
  }
}

async function analyzePlayableImportFile(file: File): Promise<{ documentHtml: string; convertedFromWrapper: boolean }> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/playables/analyze', { method: 'POST', body: form });
  const payload = (await response.json().catch(() => ({}))) as {
    documentHtml?: string;
    convertedFromWrapper?: boolean;
    error?: string;
  };
  if (!response.ok || !payload.documentHtml) {
    throw new Error(payload.error || 'Không phân tích được playable HTML.');
  }
  return {
    documentHtml: payload.documentHtml,
    convertedFromWrapper: Boolean(payload.convertedFromWrapper),
  };
}

function capturePlayableImportFrame(html: string, orientation: ProjectSettings['orientation']) {
  return new Promise<{ dataUrl: string; width: number; height: number; sourceKind: string }>((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('Capture playable chỉ chạy trong trình duyệt.'));
      return;
    }

    const targetWidth = orientation === 'landscape' ? 1280 : 720;
    const targetHeight = orientation === 'landscape' ? 720 : 1280;
    const previewWidth = orientation === 'landscape' ? 640 : 360;
    const previewHeight = orientation === 'landscape' ? 360 : 640;
    const requestId = uid();
    const frame = document.createElement('iframe');
    const blobUrl = URL.createObjectURL(
      new Blob([injectPlayableImportCaptureBridge(html)], { type: 'text/html;charset=utf-8' }),
    );

    let timeout = 0;

    const cleanup = () => {
      if (timeout) window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      URL.revokeObjectURL(blobUrl);
      frame.remove();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'playable-import-capture-result' || event.data?.requestId !== requestId) {
        return;
      }
      cleanup();
      if (event.data.error) {
        reject(new Error(String(event.data.error)));
        return;
      }
      resolve({
        dataUrl: String(event.data.dataUrl || ''),
        width: Number(event.data.width || targetWidth),
        height: Number(event.data.height || targetHeight),
        sourceKind: String(event.data.sourceKind || 'preview'),
      });
    };

    timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Playable HTML quá thời gian khi chụp frame.'));
    }, 10000);

    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads',
    );
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.left = '-200vw';
    frame.style.top = '0';
    frame.style.width = `${previewWidth}px`;
    frame.style.height = `${previewHeight}px`;
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.style.border = '0';

    window.addEventListener('message', onMessage);
    frame.addEventListener(
      'load',
      () => {
        window.setTimeout(() => {
          frame.contentWindow?.postMessage({ type: 'playable-import-capture', requestId, targetWidth, targetHeight }, '*');
        }, 1100);
      },
      { once: true },
    );

    document.body.appendChild(frame);
    frame.src = blobUrl;
  });
}

function injectPlayableImportCaptureBridge(html: string) {
  const script = `<script id="playable-import-preview-bridge">
(function(){
  function captureFrame(requestId,targetWidth,targetHeight){
    try{
      var width=Math.max(256,Math.min(1600,Number(targetWidth)||720));
      var height=Math.max(256,Math.min(2200,Number(targetHeight)||1280));
      var nodes=Array.prototype.slice.call(document.querySelectorAll("canvas,video,img")).filter(function(node){
        var rect=node.getBoundingClientRect(),style=getComputedStyle(node);
        return rect.width>12&&rect.height>12&&style.display!=="none"&&style.visibility!=="hidden"&&Number(style.opacity)!==0;
      });
      nodes.sort(function(a,b){
        var ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
        return br.width*br.height-ar.width*ar.height;
      });
      var source=nodes[0],sourceKind="preview",sourceWidth=0,sourceHeight=0;
      if(!source)throw new Error("No visible canvas, video, or image found.");
      if(source.tagName==="CANVAS"){sourceKind="canvas";sourceWidth=source.width;sourceHeight=source.height;}
      else if(source.tagName==="VIDEO"){sourceKind="video";sourceWidth=source.videoWidth;sourceHeight=source.videoHeight;}
      else{sourceKind="image";sourceWidth=source.naturalWidth||source.width;sourceHeight=source.naturalHeight||source.height;}
      if(!sourceWidth||!sourceHeight)throw new Error("Preview frame is not ready.");
      var canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
      canvas.width=width;canvas.height=height;
      ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);
      var scale=Math.max(width/sourceWidth,height/sourceHeight);
      var drawWidth=sourceWidth*scale,drawHeight=sourceHeight*scale;
      ctx.drawImage(source,(width-drawWidth)/2,(height-drawHeight)/2,drawWidth,drawHeight);
      window.parent.postMessage({type:"playable-import-capture-result",requestId:requestId,dataUrl:canvas.toDataURL("image/jpeg",.9),sourceKind:sourceKind,width:width,height:height},"*");
    }catch(error){
      window.parent.postMessage({type:"playable-import-capture-result",requestId:requestId,error:error&&error.message||String(error)},"*");
    }
  }
  addEventListener("message",function(event){
    if(event.data&&event.data.type==="playable-import-capture"){
      captureFrame(event.data.requestId,event.data.targetWidth,event.data.targetHeight);
    }
  });
})();
</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}</body>`) : `${html}${script}`;
}

async function optimizeImageForAppLovin(image: ExportImageInput, orientation: ProjectSettings['orientation']): Promise<ExportImageInput> {
  const maxFrame = orientation === 'landscape' ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
  const source = await loadImageForCanvas(image.dataUrl).catch(() => null);
  if (!source) return image;

  const sourceWidth = source.naturalWidth || image.width || maxFrame.width;
  const sourceHeight = source.naturalHeight || image.height || maxFrame.height;
  const baseScale = Math.min(1, maxFrame.width / sourceWidth, maxFrame.height / sourceHeight);
  const attempts = [
    { scale: baseScale, quality: 0.86 },
    { scale: baseScale, quality: 0.78 },
    { scale: baseScale, quality: 0.7 },
    { scale: baseScale * 0.88, quality: 0.72 },
    { scale: baseScale * 0.78, quality: 0.68 },
    { scale: baseScale * 0.66, quality: 0.64 },
  ];
  let best: ExportImageInput | null = null;

  for (const attempt of attempts) {
    const width = Math.max(1, Math.round(sourceWidth * attempt.scale));
    const height = Math.max(1, Math.round(sourceHeight * attempt.scale));
    const dataUrl = renderJpegDataUrl(source, width, height, attempt.quality);
    const candidate = { ...image, dataUrl, width, height };
    if (!best || candidate.dataUrl.length < best.dataUrl.length) best = candidate;
    if (dataUrl.length < 3_800_000) return candidate;
  }

  return best || image;
}

function loadImageForCanvas(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('Cannot optimize image.'));
    image.onload = () => resolve(image);
    image.src = src;
  });
}

function renderJpegDataUrl(image: HTMLImageElement, width: number, height: number, quality: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return image.src;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

function getExportNotice(network: NetworkTarget, bytes: number, html: string): Notice {
  const sizeMb = (bytes / 1024 / 1024).toFixed(2);
  if (network === 'applovin') {
    if (bytes > APPLOVIN_MAX_HTML_BYTES) {
      return { tone: 'warn', text: `AppLovin HTML ${sizeMb}MB > 5MB` };
    }
    if (hasExternalResource(html)) {
      return { tone: 'warn', text: 'HTML AppLovin cần tài nguyên ngoài' };
    }
  }
  return { tone: 'ok', text: `Đã xuất ${networkLabels[network]} HTML (${sizeMb}MB)` };
}

function hasExternalResource(html: string) {
  return /\b(?:src|href)\s*=\s*["']https?:\/\//i.test(html) || /https?:\/\/(?!apps\.apple\.com|play\.google\.com|itunes\.apple\.com)/i.test(html);
}

function downloadBlob(name: string, content: Blob | string, type: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function shouldUseGeneratedProjectName(currentName: string, appName?: string) {
  const normalized = currentName.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === 'playable batch' || normalized === 'playable project') return true;
  if (appName && normalized === `${appName} project`.trim().toLowerCase()) return true;
  if (/^project \d{4}-\d{2}-\d{2} \d{2}-\d{2}$/.test(normalized)) return true;
  return false;
}

function buildDateProjectName(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `Project ${year}-${month}-${day} ${hour}-${minute}`;
}

type ProjectSavePayload = {
  id: string;
  appId?: string;
  name: string;
  prompt: string;
  settings: ProjectSettings;
  sourceImageDataUrl: string;
  referenceImages: ReferenceImageInput[];
  variants: Array<{
    id: string;
    sourceId: string;
    index: number;
    name: string;
    dataUrl: string;
    width: number;
    height: number;
    revisedPrompt: string;
    hotspot: Hotspot;
    settings: LayerSettings;
  }>;
};

function buildProjectSavePayload({
  id,
  appId,
  name,
  prompt,
  settings,
  sourceImageDataUrl,
  referenceImages,
  variants,
}: {
  id: string;
  appId: string;
  name: string;
  prompt: string;
  settings: ProjectSettings;
  sourceImageDataUrl: string;
  referenceImages: ReferenceImageInput[];
  variants: PlayableVariant[];
}): ProjectSavePayload {
  return {
    id: safeString(id),
    appId: safeString(appId) || undefined,
    name: safeString(name),
    prompt: safeString(prompt),
    settings: toJsonSafe(normalizeProjectSettings(settings)),
    sourceImageDataUrl: safeString(sourceImageDataUrl),
    referenceImages: normalizeReferenceImageInputs(referenceImages).map((reference, index) => ({
      id: safeString(reference.id) || `reference-${index + 1}`,
      name: safeString(reference.name) || `Reference ${index + 1}`,
      dataUrl: safeString(reference.dataUrl),
      width: safeInteger(reference.width),
      height: safeInteger(reference.height),
      createdAt: safeInteger(reference.createdAt, Date.now()),
    })),
    variants: variants.map((variant, index) => ({
      id: safeString(variant.id) || `variant-${index + 1}`,
      sourceId: safeString(variant.sourceId),
      index: safeInteger(variant.index, index + 1),
      name: safeString(variant.name) || `Variant ${index + 1}`,
      dataUrl: safeString(variant.dataUrl),
      width: safeNumber(variant.width),
      height: safeNumber(variant.height),
      revisedPrompt: safeString(variant.revisedPrompt),
      hotspot: toJsonSafe({
        x: clamp(safeNumber(variant.hotspot?.x, 50), 0, 100),
        y: clamp(safeNumber(variant.hotspot?.y, 72), 0, 100),
        confidence: clamp(safeNumber(variant.hotspot?.confidence, 0.28), 0, 1),
        ...(typeof variant.hotspot?.reason === 'string' ? { reason: variant.hotspot.reason } : {}),
      }),
      settings: toJsonSafe(normalizeLayerSettings(variant.settings)),
    })),
  };
}

function buildProjectAutosaveSnapshot(payload: ProjectSavePayload) {
  return JSON.stringify(payload);
}

function normalizeReferenceImageInputs(items: unknown): ReferenceImageInput[] {
  if (!Array.isArray(items)) return [];

  return items
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Partial<ReferenceImageInput>;
      const dataUrl = typeof record.dataUrl === 'string' ? record.dataUrl : '';
      if (!dataUrl.startsWith('data:image/')) return null;
      return {
        id: typeof record.id === 'string' && record.id.trim() ? record.id : `reference-${index + 1}`,
        name: typeof record.name === 'string' && record.name.trim() ? record.name : `Reference ${index + 1}`,
        dataUrl,
        width: safeInteger(record.width),
        height: safeInteger(record.height),
        createdAt: safeInteger(record.createdAt, Date.now()),
      } satisfies ReferenceImageInput;
    })
    .filter((item): item is ReferenceImageInput => Boolean(item))
    .slice(0, MAX_REFERENCE_IMAGES);
}

function toJsonSafe<T>(value: T, seen = new WeakSet<object>(), depth = 0): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return (Number.isFinite(value) ? value : 0) as T;
  if (depth > 24) return null as T;
  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item, seen, depth + 1)) as T;
  }
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    if (seen.has(objectValue)) return null as T;
    seen.add(objectValue);
    const plain: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(objectValue)) {
      if (typeof entry === 'function' || typeof entry === 'symbol' || entry === undefined) continue;
      plain[key] = toJsonSafe(entry, seen, depth + 1);
    }
    seen.delete(objectValue);
    return plain as T;
  }
  return null as T;
}

function safeString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function safeNumber(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function safeInteger(value: unknown, fallback = 0) {
  return Math.max(0, Math.round(safeNumber(value, fallback)));
}

function formatProjectSaveTime(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}



