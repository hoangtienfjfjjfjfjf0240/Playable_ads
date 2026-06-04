'use client';

import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  AlertCircle,
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Crosshair,
  Database,
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
  Layers3,
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
import type { DragEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type JSZip from 'jszip';
import {
  createDefaultProjectSettings,
  generateImagePlayableHtml,
  networkExportTargets,
  networkLabels,
  patchPlayableHtml,
  safeFileName,
} from '../lib/export-engine';
import { getHandAnchorOffset, getHandAsset, handAssets } from '../lib/hand-assets';
import { detectImageHotspot, getImageDimensions, loadAssetAsDataUrl, readFileAsDataUrl, readFileAsText } from '../lib/image-utils';
import { buttonPresets, defaultLayerSettings, handMotionPresets, recipePresets, scanPresets } from '../lib/presets';
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
  SourceItem,
} from '../lib/types';

type HealthState = {
  aiConfigured: boolean;
  openAiConfigured?: boolean;
  geminiConfigured?: boolean;
  supabaseConfigured: boolean;
  ok: boolean;
} | null;

type Notice = { tone: 'ok' | 'warn' | 'error' | 'busy'; text: string } | null;
type AiWorkerStatus = 'idle' | 'running' | 'done' | 'error';
type AssetLibraryTab = 'hand' | 'scan' | 'heart' | 'counter';
type GenerationHistoryEntry = {
  id: string;
  name: string;
  createdAt: number;
  provider: ProjectSettings['aiProvider'];
  model: string;
  durationSeconds: number | null;
  variants: PlayableVariant[];
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isNaN(value) ? min : value));

const uid = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const LAYER_DRAG_TYPE = 'application/x-playable-layer';
const ASSET_DRAG_TYPE = 'application/x-playable-asset';
const layerFieldMap: Record<LayerTarget, Array<keyof LayerSettings>> = {
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
  asset: ['layerOrder', 'assetId', 'assetX', 'assetY', 'assetSize', 'assetRotation', 'assetLocked', 'assetSpeed', 'injectAsset'],
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
    'ctaScanGrouped',
    'scanX',
    'scanY',
    'injectScan',
    'handX',
    'handY',
    'handMotion',
    'injectHand',
  ],
};
const lockedLayerFieldMap: Record<LayerTarget, Array<keyof LayerSettings>> = {
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
  asset: ['assetId', 'assetX', 'assetY', 'assetSize', 'assetRotation', 'assetSpeed', 'injectAsset'],
  cta: ['ctaText', 'ctaX', 'ctaY', 'ctaWidth', 'ctaRotation', 'showCta', 'buttonAnimation'],
};
const layerLockFieldMap: Record<LayerTarget, keyof LayerSettings> = {
  hand: 'handLocked',
  scan: 'scanLocked',
  asset: 'assetLocked',
  cta: 'ctaLocked',
};
const layerMeta: Record<LayerTarget, { label: string; group: string }> = {
  hand: { label: 'Hand', group: 'Interaction' },
  scan: { label: 'Scan', group: 'Detection' },
  asset: { label: 'Asset', group: 'Visual' },
  cta: { label: 'CTA', group: 'Action' },
};
const aiProviderModelMap: Record<ProjectSettings['aiProvider'], string> = {
  openai: 'gpt-image-2',
  'gemini-flash': 'gemini/gemini-3.1-flash-image-preview',
  'gemini-pro': 'gemini/gemini-3-pro-image-preview',
};
const scanColorSwatches = ['#7c3cff', '#2563eb', '#22d3ee', '#10b981', '#f59e0b', '#ef4444', '#ffffff'];

function setLayerDragData(event: DragEvent<HTMLElement>, layer: LayerTarget, assetId?: string) {
  event.dataTransfer.setData(LAYER_DRAG_TYPE, layer);
  if (assetId) event.dataTransfer.setData(ASSET_DRAG_TYPE, assetId);
  event.dataTransfer.effectAllowed = 'move';
}

function getLayerDragData(event: DragEvent<HTMLElement>): LayerTarget | null {
  const value = event.dataTransfer.getData(LAYER_DRAG_TYPE);
  return value === 'hand' || value === 'scan' || value === 'asset' || value === 'cta' ? value : null;
}

function getAssetDragData(event: DragEvent<HTMLElement>) {
  return event.dataTransfer.getData(ASSET_DRAG_TYPE) || '';
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

function getCtaHandPatch(layer: Partial<LayerSettings>) {
  const merged = mergeLayerSettings(layer);
  return {
    handX: Math.round(clamp(merged.ctaX + Math.min(14, Math.max(8, merged.ctaWidth * 0.18)), 8, 92)),
    handY: Math.round(clamp(merged.ctaY - 1, 12, 92)),
    handMotion: 'tap' as LayerSettings['handMotion'],
    injectHand: true,
  } satisfies Partial<LayerSettings>;
}

function isLayerLocked(layer: Partial<LayerSettings>, target: LayerTarget) {
  if (target === 'hand') return Boolean(layer.handLocked);
  if (target === 'scan') return Boolean(layer.scanLocked);
  if (target === 'asset') return Boolean(layer.assetLocked);
  return Boolean(layer.ctaLocked);
}

function getLayerLockPatch(target: LayerTarget, locked: boolean) {
  if (target === 'hand') return { handLocked: locked } satisfies Partial<LayerSettings>;
  if (target === 'scan') return { scanLocked: locked } satisfies Partial<LayerSettings>;
  if (target === 'asset') return { assetLocked: locked } satisfies Partial<LayerSettings>;
  return { ctaLocked: locked } satisfies Partial<LayerSettings>;
}

function getLayerRotationPatch(target: LayerTarget, rotation: number) {
  const next = Math.round(clamp(rotation, -180, 180));
  if (target === 'hand') return { handRotation: next } satisfies Partial<LayerSettings>;
  if (target === 'scan') return { scanRotation: next } satisfies Partial<LayerSettings>;
  if (target === 'asset') return { assetRotation: next } satisfies Partial<LayerSettings>;
  return { ctaRotation: next } satisfies Partial<LayerSettings>;
}

function getLayerSizePatch(target: LayerTarget, size: number) {
  if (target === 'hand') return { handSize: Math.round(clamp(size, 32, 260)) } satisfies Partial<LayerSettings>;
  if (target === 'scan') return { scanSize: Math.round(clamp(size, 48, 360)) } satisfies Partial<LayerSettings>;
  if (target === 'asset') return { assetSize: Math.round(clamp(size, 48, 280)) } satisfies Partial<LayerSettings>;
  return { ctaWidth: Math.round(clamp(size, 44, 92)) } satisfies Partial<LayerSettings>;
}

function hasLayerLockPatch(partial: Partial<LayerSettings>, target: LayerTarget) {
  return Object.prototype.hasOwnProperty.call(partial, layerLockFieldMap[target]);
}

function filterLockedLayerPatch(base: Partial<LayerSettings>, partial: Partial<LayerSettings>, target: LayerTarget) {
  if (isLayerLocked(base, target) && !hasLayerLockPatch(partial, target)) return {};

  const entries = Object.entries(partial).filter(([key]) => {
    for (const layerTarget of ['hand', 'scan', 'asset', 'cta'] as LayerTarget[]) {
      if (key === layerLockFieldMap[layerTarget]) return true;
      if (isLayerLocked(base, layerTarget) && lockedLayerFieldMap[layerTarget].includes(key as keyof LayerSettings)) return false;
    }
    return true;
  });

  return Object.fromEntries(entries) as Partial<LayerSettings>;
}

function buildCtaCompanionPatch(base: Partial<LayerSettings>, partial: Partial<LayerSettings>) {
  const next = mergeLayerSettings(base, partial);
  const handPatch = getCtaHandPatch(next);
  return {
    ...partial,
    ...(next.injectHand ? handPatch : {}),
  } satisfies Partial<LayerSettings>;
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
  if (target === 'hand') return { ...base, injectHand: false } satisfies Partial<LayerSettings>;
  if (target === 'scan') return { ...base, injectScan: false, ctaScanGrouped: false } satisfies Partial<LayerSettings>;
  if (target === 'asset') return { ...base, injectAsset: false } satisfies Partial<LayerSettings>;
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
    const patch = pickLayerFields(layer, ['buttonAnimation', 'ctaX', 'ctaY', 'ctaWidth', 'ctaText']);
    return Object.keys(patch).length
      ? ({
          ...patch,
          showCta: true,
        } satisfies Partial<LayerSettings>)
      : {};
  }

  const patch = pickLayerFields(layer, ['assetId', 'assetX', 'assetY', 'assetSize', 'assetSpeed']);
  return Object.keys(patch).length
    ? ({
        ...patch,
        injectAsset: true,
      } satisfies Partial<LayerSettings>)
    : {};
}

export function PlayableStudio() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handDataUrlCache = useRef(new Map<string, string>());
  const [health, setHealth] = useState<HealthState>(null);
  const [settings, setSettings] = useState<ProjectSettings>(() => createDefaultProjectSettings());
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [activeSourceId, setActiveSourceId] = useState('');
  const [variants, setVariants] = useState<PlayableVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [htmlLayerSettings, setHtmlLayerSettings] = useState<LayerSettings>(() => normalizeLayerSettings(defaultLayerSettings));
  const [htmlPreviewHandDataUrl, setHtmlPreviewHandDataUrl] = useState<string | undefined>();
  const [selectedLayer, setSelectedLayer] = useState<LayerTarget>('hand');
  const [notice, setNotice] = useState<Notice>({ tone: 'warn', text: 'Chưa có ảnh nguồn' });
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [aiWorkers, setAiWorkers] = useState<AiWorkerStatus[]>(['idle', 'idle', 'idle', 'idle']);
  const [lastAiDuration, setLastAiDuration] = useState<number | null>(null);
  const [generationHistory, setGenerationHistory] = useState<GenerationHistoryEntry[]>([]);
  const [assetLibraryTab, setAssetLibraryTab] = useState<AssetLibraryTab>('hand');

  useEffect(() => {
    setSettings((current) => (current.imageFit === 'cover' ? current : { ...current, imageFit: 'cover' }));
  }, []);

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
  const activeAiReady =
    settings.aiProvider === 'openai' ? Boolean(health?.openAiConfigured) : Boolean(health?.geminiConfigured);
  const activeAiLabel = settings.aiProvider === 'openai' ? 'GPT' : 'Gemini';
  const visibleVisualAssets = useMemo(
    () => (assetLibraryTab === 'hand' ? [] : visualAssets.filter((asset) => asset.category === assetLibraryTab)),
    [assetLibraryTab],
  );

  const refreshHealth = useCallback(() => {
    let cancelled = false;
    setHealth(null);
    fetch('/api/health', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled) setHealth(payload);
      })
      .catch(() => {
        if (!cancelled) setHealth({ ok: false, aiConfigured: false, supabaseConfigured: false });
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
          imported.push({
            id: uid(),
            name: file.name,
            kind: 'html',
            status: 'ready',
            html: await readFileAsText(file),
            createdAt: Date.now(),
          });
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
      setAiWorkers(['idle', 'idle', 'idle', 'idle']);
      setLastAiDuration(null);
      setProjectSetting('name', safeFileName(imported[0].name));
      setProjectSetting('imageFit', 'cover');
      const firstImage = imported.find((source) => source.kind === 'image' && source.dataUrl);
      if (firstImage) {
        const drafts = await createDraftVariants(firstImage);
        setVariants(drafts);
        setSelectedVariantId(drafts[0]?.id || '');
        setNotice({ tone: 'ok', text: `${imported.length} file ready, 4 draft preview created` });
        return;
      }
      setNotice({ tone: 'ok', text: `${imported.length} file sẵn sàng` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Import thất bại' });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const createVariantFromImage = async (
    source: SourceItem,
    image: { name: string; dataUrl: string; revisedPrompt?: string },
    index: number,
  ): Promise<PlayableVariant> => {
    const dimensions = await getImageDimensions(image.dataUrl);
    const rawHotspot = await detectImageHotspot(image.dataUrl).catch(() => source.hotspot || defaultHotspot());
    const hotspot = projectHotspotToFrame(rawHotspot, dimensions, settings.orientation, activeImageFit);
    return {
      id: uid(),
      sourceId: source.id,
      index,
      name: image.name,
      dataUrl: image.dataUrl,
      width: dimensions.width,
      height: dimensions.height,
      revisedPrompt: image.revisedPrompt || '',
      hotspot,
      settings: layerFromHotspot(hotspot, index),
    };
  };

  const createDraftVariants = (source: SourceItem) =>
    Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        createVariantFromImage(
          source,
          {
            name: `${safeFileName(source.name)}_draft_${index + 1}.png`,
            dataUrl: source.dataUrl || '',
          },
          index + 1,
        ),
      ),
    );

  const cloneSourceToVariants = async () => {
    if (!activeSource?.dataUrl || activeSource.kind !== 'image') {
      setNotice({ tone: 'error', text: 'Chọn ảnh nguồn trước' });
      return;
    }

    setBusy(true);
    try {
      const next = await createDraftVariants(activeSource);
      setVariants(next);
      setSelectedVariantId(next[0]?.id || '');
      setAiWorkers(['idle', 'idle', 'idle', 'idle']);
      setLastAiDuration(null);
      setNotice({ tone: 'ok', text: 'Đã tạo 4 bản nháp từ ảnh nguồn' });
    } finally {
      setBusy(false);
    }
  };

  const generateVariants = async () => {
    if (!activeSource?.dataUrl || activeSource.kind !== 'image') {
      setNotice({ tone: 'error', text: 'Chon anh nguon truoc' });
      return;
    }

    setBusy(true);
    setNotice({ tone: 'busy', text: 'AI dang chay 4 luong song song, anh nao xong se hien truoc...' });
    setLastAiDuration(null);
    setAiWorkers(['running', 'running', 'running', 'running']);
    setSources((current) =>
      current.map((source) => (source.id === activeSource.id ? { ...source, status: 'generating', error: '' } : source)),
    );

    try {
      const response = await fetch('/api/ai/generate-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl: activeSource.dataUrl,
          prompt: settings.prompt,
          count: 4,
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
        const slots: Array<PlayableVariant | null> = Array.from({ length: 4 }, () => null);
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
        if (!next.length) throw new Error(streamErrors.join('; ') || 'AI khong tra anh variant');
      } else {
        const payload = await response.json().catch(() => ({}));
        const generated = (payload.variants || []).slice(0, 4) as AiVariantResponseItem[];
        if (!generated.length) throw new Error('AI khong tra anh variant');
        durationSeconds = typeof payload.durationMs === 'number' ? Math.max(1, Math.round(payload.durationMs / 1000)) : null;
        warningCount = Array.isArray(payload.errors) ? payload.errors.length : 0;
        setAiWorkers(Array.from({ length: 4 }, (_, index) => (index < generated.length ? 'done' : 'error')));
        next = await Promise.all(generated.map((item, index) => createVariantFromImage(activeSource, item, index + 1)));
      }

      setLastAiDuration(durationSeconds);
      setVariants(next);
      setSelectedVariantId(next[0]?.id || '');
      setSources((current) =>
        current.map((source) => (source.id === activeSource.id ? { ...source, status: 'done' } : source)),
      );
      rememberGeneration(next, durationSeconds);
      setNotice({
        tone: warningCount ? 'warn' : 'ok',
        text: `${next.length} variant da tao${durationSeconds ? ` trong ${durationSeconds}s` : ''}${warningCount ? `, loi ${warningCount}` : ''}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI generation failed';
      setAiWorkers(['error', 'error', 'error', 'error']);
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
  const detectAllVariants = async () => {
    if (!variants.length) return;
    setBusy(true);
    setNotice({ tone: 'busy', text: 'Đang scan điểm animation' });

    try {
      const next = await Promise.all(
        variants.map(async (variant) => {
          const rawHotspot = await detectImageHotspot(variant.dataUrl);
          const hotspot = projectHotspotToFrame(rawHotspot, variant, settings.orientation, activeImageFit);
          const suggestedLayer = layerFromHotspot(hotspot, variant.index);
          return {
            ...variant,
            hotspot,
            settings: {
              ...variant.settings,
              ...suggestedLayer,
              ctaText: variant.settings.ctaText,
            },
          };
        }),
      );
      setVariants(next);
      setNotice({ tone: 'ok', text: 'Đã cập nhật hotspot cho 4 preview' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Detect thất bại' });
    } finally {
      setBusy(false);
    }
  };

  const exportVariantHtml = async (variant: PlayableVariant, network: NetworkTarget = settings.network) => {
    const layer = normalizeLayerSettings(variant.settings);
    const handDataUrl = layer.injectHand ? await getHandDataUrl(layer.handId) : undefined;
    const image: ExportImageInput = {
      name: variant.name,
      dataUrl: variant.dataUrl,
      width: variant.width,
      height: variant.height,
    };
    return generateImagePlayableHtml({
      image,
      layer,
      storeUrl: settings.storeUrl,
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
  };

  const exportSelected = async () => {
    if (selectedVariant) {
      setBusy(true);
      setNotice({ tone: 'busy', text: 'Dang xuat 5 nen tang cho variant' });
      try {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        await addVariantNetworkFiles(zip, selectedVariant);
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(`${safeFileName(selectedVariant.name)}_5_networks.zip`, blob, 'application/zip');
        setNotice({ tone: 'ok', text: 'Đã xuất variant đang chọn' });
        setNotice({ tone: 'ok', text: 'Da xuat 5 nen tang cho variant dang chon' });
      } finally {
        setBusy(false);
      }
      return;
    }

    if (activeSource?.kind === 'html' && activeSource.html) {
      setBusy(true);
      try {
        const layer = normalizeLayerSettings(activeLayer);
        const handDataUrl = layer.injectHand ? await getHandDataUrl(layer.handId) : undefined;
        const html = patchPlayableHtml({
          html: activeSource.html,
          layer,
          storeUrl: settings.storeUrl,
          network: settings.network,
          useClickTag: settings.useClickTag,
          replaceLinks: settings.replaceLinks,
          ctaSelector: settings.ctaSelector,
          handDataUrl,
        });
        downloadBlob(`${safeFileName(activeSource.name)}_patched.html`, html, 'text/html;charset=utf-8');
        setNotice({ tone: 'ok', text: 'Đã xuất HTML patched' });
      } finally {
        setBusy(false);
      }
    }
  };

  const exportZip = async () => {
    if (!variants.length) {
      setNotice({ tone: 'error', text: 'Chưa có 4 variant để export' });
      return;
    }

    setBusy(true);
    setNotice({ tone: 'busy', text: 'Đang đóng gói HTML' });

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const variant of variants) {
        await addVariantNetworkFiles(zip, variant);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(`${safeFileName(settings.name)}_4_playables_5_networks.zip`, blob, 'application/zip');
      setNotice({ tone: 'ok', text: 'Đã export ZIP 4 playable' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Export ZIP thất bại' });
    } finally {
      setBusy(false);
    }
  };

  const saveProject = async () => {
    if (!activeSource || !variants.length) {
      setNotice({ tone: 'error', text: 'Cần ảnh nguồn và variant trước khi lưu' });
      return;
    }

    setBusy(true);
    setNotice({ tone: 'busy', text: 'Đang lưu Supabase' });

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: settings.name,
          prompt: settings.prompt,
          settings,
          sourceImageDataUrl: activeSource.dataUrl,
          variants,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Supabase save failed');
      setNotice({ tone: 'ok', text: `Đã lưu project ${payload.id}` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Lưu thất bại' });
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
      storeUrl: settings.storeUrl,
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
    settings.storeUrl,
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
    setSelectedLayer('hand');
    setLastAiDuration(entry.durationSeconds);
    setAiWorkers(Array.from({ length: 4 }, (_, index) => (index < restored.length ? 'done' : 'idle')));
    setNotice({ tone: 'ok', text: `Restored ${restored.length} variants from history` });
  };

  const applyRecipe = (recipeId: string) => {
    const recipe = recipePresets.find((item) => item.id === recipeId);
    if (!recipe) return;
    const patch = getRecipePatchForLayer(recipe.layer, selectedLayer);
    if (!Object.keys(patch).length) {
      setNotice({ tone: 'warn', text: `${recipe.label} does not target ${layerMeta[selectedLayer].label}` });
      return;
    }

    if (selectedLayer === 'scan') updateLayer(buildScanCompanionPatch(layerForControls, patch), undefined, 'scan');
    else if (selectedLayer === 'cta') updateLayer(buildCtaCompanionPatch(layerForControls, patch), undefined, 'cta');
    else if (selectedLayer === 'hand') updateLayer(buildHandCompanionPatch(layerForControls, patch), undefined, 'hand');
    else updateLayer(patch, undefined, selectedLayer);

    setNotice({ tone: 'ok', text: `${recipe.label} applied to ${layerMeta[selectedLayer].label}` });
  };

  const applyVisualAsset = (assetId: string) => {
    const asset = getVisualAsset(assetId);
    if (asset.id === 'scan-frame-box') {
      setSelectedLayer('scan');
      updateLayer(
        {
          scanStyle: 'frame',
          scanAnimationName: 'Frame Scan',
          scanColor: layerForControls.scanColor || '#7c3cff',
          injectScan: true,
          layerOrder: ensureLayerInOrder(getLayerOrder(activeLayer), 'scan'),
        },
        undefined,
        'scan',
      );
      setNotice({ tone: 'ok', text: 'Frame Scan applied' });
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
      text: selectedVariant ? `Removed ${layerMeta[removedLayer].label} from Variant ${selectedVariant.index}` : `Removed ${layerMeta[removedLayer].label} from HTML`,
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
    setNotice({ tone: 'ok', text: `Deleted Variant ${selectedVariant.index}` });
  };

  const layerForControls = normalizeLayerSettings(activeLayer);
  const selectedLayerLocked = isLayerLocked(layerForControls, selectedLayer);
  const canEditSelectedLayer = Boolean((selectedVariant || activeSource?.kind === 'html') && getLayerOrder(layerForControls).includes(selectedLayer));
  const canRemoveSelectedLayer = canEditSelectedLayer && !selectedLayerLocked;

  const moveLayer = useCallback(
    (variantId: string, layer: LayerTarget, x: number, y: number, assetId?: string) => {
      const currentLayer = normalizeLayerSettings(variants.find((variant) => variant.id === variantId)?.settings || defaultLayerSettings);
      setSelectedVariantId(variantId);
      setSelectedLayer(layer);
      if (layer === 'hand') {
        updateLayer(
          buildHandCompanionPatch(currentLayer, { handX: x, handY: y, injectHand: true, layerOrder: ensureLayerInOrder(getLayerOrder(currentLayer), 'hand') }),
          variantId,
          'hand',
        );
      }
      if (layer === 'scan') {
        updateLayer(
          buildScanCompanionPatch(currentLayer, { scanX: x, scanY: y, injectScan: true, layerOrder: ensureLayerInOrder(getLayerOrder(currentLayer), 'scan') }),
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
  };

  const moveLayerOrder = (layer: LayerTarget, direction: 'up' | 'down') => {
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

  const setCtaScanGrouped = (grouped: boolean) => {
    updateLayer(setCtaScanGroupPatch(layerForControls, grouped), undefined, selectedLayer === 'scan' ? 'scan' : 'cta');
  };

  return (
    <main className="studio-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <Grid2X2 size={20} />
          </div>
          <div>
            <strong>Playable Studio</strong>
            <span>Batch AI editor</span>
          </div>
        </div>

        <div className="status-strip">
          <StatusPill icon={<WandSparkles size={14} />} label={activeAiLabel} ready={activeAiReady} loading={!health} />
          <StatusPill icon={<Database size={14} />} label="DB" ready={Boolean(health?.supabaseConfigured)} loading={!health} />
        </div>

        <button className="upload-zone" type="button" onClick={() => fileInputRef.current?.click()}>
          <Upload size={22} />
          <strong>Import</strong>
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

        <section className="sidebar-section">
          <div className="section-head">
            <span>Queue</span>
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
                    <small>{source.kind === 'image' ? `${source.width}x${source.height}` : 'HTML playable'}</small>
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
            <span>Gen history</span>
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
                      {entry.variants.length} variants · {entry.provider === 'openai' ? 'GPT' : 'Gemini'}
                      {entry.durationSeconds ? ` · ${entry.durationSeconds}s` : ''}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p className="empty-note">Generated batches will appear here.</p>
            )}
          </div>
        </section>

        <section className="sidebar-section asset-library-section">
          <div className="section-head">
            <span>Asset library</span>
            <b>{assetLibraryTab === 'hand' ? handAssets.length : visibleVisualAssets.length}</b>
          </div>
          <div className="asset-tabs" role="tablist" aria-label="Asset library">
            {(['hand', 'scan', 'heart', 'counter'] as AssetLibraryTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={assetLibraryTab === tab ? 'active' : ''}
                onClick={() => setAssetLibraryTab(tab)}
              >
                {tab === 'hand' ? <Hand size={14} /> : tab === 'scan' ? <ScanLine size={14} /> : tab === 'heart' ? <HeartPulse size={14} /> : <Hash size={14} />}
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
          ) : (
            <div className="asset-grid asset-library-grid">
              {visibleVisualAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  draggable
                  className={`asset-tile ${layerForControls.assetId === asset.id ? 'active' : ''}`}
                  onDragStart={(event) => {
                    if (asset.id === 'scan-frame-box') {
                      setLayerDragData(event, 'scan');
                      setSelectedLayer('scan');
                      updateLayer(
                        {
                          scanStyle: 'frame',
                          scanAnimationName: 'Frame Scan',
                          injectScan: true,
                          layerOrder: ensureLayerInOrder(getLayerOrder(activeLayer), 'scan'),
                        },
                        undefined,
                        'scan',
                      );
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
              ))}
            </div>
          )}
        </section>
      </aside>

      <section className="workspace">
        <header className="workspace-top">
          <div>
            <span className="eyebrow">Workspace</span>
            <h1>{settings.name || 'Playable batch'}</h1>
          </div>
          <div className="toolbar">
            <button className="ghost-button" type="button" onClick={cloneSourceToVariants} disabled={!activeSource || busy}>
              <Grid2X2 size={16} />
              Draft x4
            </button>
            <div className="fit-toggle" role="group" aria-label="Image fit mode">
              <button
                className={activeImageFit === 'cover' ? 'active' : ''}
                type="button"
                onClick={() => setProjectSetting('imageFit', 'cover')}
                title="Fill 9:16 without distortion"
              >
                <Maximize2 size={14} />
                Fill
              </button>
              <button
                className={activeImageFit === 'contain' ? 'active' : ''}
                type="button"
                onClick={() => setProjectSetting('imageFit', 'contain')}
                title="Fit full image without cropping"
              >
                <Minimize2 size={14} />
                Fit
              </button>
            </div>
            <button className="secondary-button" type="button" onClick={detectAllVariants} disabled={!variants.length || busy}>
              <Crosshair size={16} />
              Detect
            </button>
            <button className="primary-button" type="button" onClick={generateVariants} disabled={!activeSource || activeSource.kind !== 'image' || busy || !activeAiReady}>
              {busy ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}
              Generate 4
            </button>
          </div>
        </header>

        <div className="notice-row">
          <NoticeView notice={notice} />
          <div className="playback-controls">
            <button className="icon-button" type="button" onClick={() => setPaused((value) => !value)} title={paused ? 'Play' : 'Pause'}>
              {paused ? <Play size={16} /> : <Eye size={16} />}
            </button>
            <button className="icon-button" type="button" onClick={refreshHealth} title="Refresh status">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        <section className={`preview-grid orientation-${settings.orientation} ${paused ? 'is-paused' : ''}`}>
          {variants.length ? (
            variants.slice(0, 4).map((variant) => (
              <PreviewCard
                key={variant.id}
                variant={variant}
                orientation={settings.orientation}
                imageFit={activeImageFit}
                selected={variant.id === selectedVariant?.id}
                selectedLayer={selectedLayer}
                onSelect={() => setSelectedVariantId(variant.id)}
                onLayerSelect={setSelectedLayer}
                onLayerDrop={(layer, x, y, assetId) => moveLayer(variant.id, layer, x, y, assetId)}
                onLayerPatch={(layer, partial) => patchPreviewLayer(variant.id, layer, partial)}
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
                className={selectedLayer === 'asset' ? 'active' : ''}
                type="button"
                draggable
                onDragStart={(event) => setLayerDragData(event, 'asset')}
                onClick={() => setSelectedLayer('asset')}
              >
                <Activity size={15} />
                Asset
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
            </div>
            <button
              className={`group-toggle ${layerForControls.ctaScanGrouped ? 'active' : ''}`}
              type="button"
              onClick={() => setCtaScanGrouped(!layerForControls.ctaScanGrouped)}
              title={layerForControls.ctaScanGrouped ? 'Ungroup scan from CTA' : 'Group scan with CTA'}
            >
              {layerForControls.ctaScanGrouped ? <Link2 size={14} /> : <Unlink2 size={14} />}
              {layerForControls.ctaScanGrouped ? 'Grouped' : 'Ungrouped'}
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
            <span className="eyebrow">Inspector</span>
            <h2>{selectedVariant ? `Variant ${selectedVariant.index}` : activeSource?.kind === 'html' ? 'HTML patch' : 'Settings'}</h2>
          </div>
          <Settings2 size={18} />
        </div>

        <section className="panel-section">
          <label className="field">
            <span>Project name</span>
            <input value={settings.name} onChange={(event) => setProjectSetting('name', event.target.value)} />
          </label>
          <label className="field">
            <span>Prompt</span>
            <textarea rows={5} value={settings.prompt} onChange={(event) => setProjectSetting('prompt', event.target.value)} />
          </label>
          <label className="field">
            <span>Store URL</span>
            <input value={settings.storeUrl} onChange={(event) => setProjectSetting('storeUrl', event.target.value)} />
          </label>
          <label className="field">
            <span>AI model</span>
            <select value={settings.aiProvider} onChange={(event) => setProjectSetting('aiProvider', event.target.value as ProjectSettings['aiProvider'])}>
              <option value="gemini-flash">Gemini 3.1 Flash Image</option>
              <option value="gemini-pro">Gemini 3 Pro Image</option>
              <option value="openai">GPT Image</option>
            </select>
          </label>
          {!activeAiReady && health && <div className="field-status warn">Missing AI_API_KEY</div>}
          <div className="field-grid">
            <label className="field">
              <span>Network</span>
              <select value={settings.network} onChange={(event) => setProjectSetting('network', event.target.value as ProjectSettings['network'])}>
                {networkExportTargets.map((network) => (
                  <option key={network} value={network}>
                    {networkLabels[network]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Mode</span>
              <select value={settings.orientation} onChange={(event) => setProjectSetting('orientation', event.target.value as ProjectSettings['orientation'])}>
                <option value="portrait">9:16</option>
                <option value="landscape">16:9</option>
              </select>
            </label>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.syncAllVariants}
              onChange={(event) => setProjectSetting('syncAllVariants', event.target.checked)}
            />
            <span>Apply selected layer to all 4</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={settings.useClickTag} onChange={(event) => setProjectSetting('useClickTag', event.target.checked)} />
            <span>clickTag fallback</span>
          </label>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <h3>Layer Stack</h3>
            <span>{selectedVariant ? `V${selectedVariant.index}` : activeSource?.kind === 'html' ? 'HTML' : 'none'}</span>
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
            Remove Layer
          </button>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <h3>Layer Control</h3>
            <span>{selectedLayer}</span>
          </div>
          {selectedVariant && (
            <div className="analysis-card">
              <span>AI placement</span>
              <strong>{Math.round(selectedVariant.hotspot.confidence * 100)}% confidence</strong>
              <small>
                X {Math.round(selectedVariant.hotspot.x)} / Y {Math.round(selectedVariant.hotspot.y)} - {layerForControls.handMotion} +{' '}
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
            {selectedLayerLocked ? 'Locked' : 'Unlocked'}
          </button>
          <div className="segmented-row">
            <button
              className={selectedLayer === 'hand' ? 'active' : ''}
              type="button"
              draggable
              onDragStart={(event) => setLayerDragData(event, 'hand')}
              onClick={() => setSelectedLayer('hand')}
            >
              <Hand size={15} />
            </button>
            <button
              className={selectedLayer === 'scan' ? 'active' : ''}
              type="button"
              draggable
              onDragStart={(event) => setLayerDragData(event, 'scan')}
              onClick={() => setSelectedLayer('scan')}
            >
              <ScanLine size={15} />
            </button>
            <button
              className={selectedLayer === 'asset' ? 'active' : ''}
              type="button"
              draggable
              onDragStart={(event) => setLayerDragData(event, 'asset')}
              onClick={() => setSelectedLayer('asset')}
            >
              <Activity size={15} />
            </button>
            <button
              className={selectedLayer === 'cta' ? 'active' : ''}
              type="button"
              draggable
              onDragStart={(event) => setLayerDragData(event, 'cta')}
              onClick={() => setSelectedLayer('cta')}
            >
              <MousePointerClick size={15} />
            </button>
          </div>

          {selectedLayer === 'hand' && (
            <fieldset className="control-stack" disabled={selectedLayerLocked}>
              <label className="field">
                <span>Motion</span>
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
                <span>Hand visible</span>
              </label>
            </fieldset>
          )}

          {selectedLayer === 'scan' && (
            <fieldset className="control-stack" disabled={selectedLayerLocked}>
              <label className="field">
                <span>Scan style</span>
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
                  <h3>Animation Parameters</h3>
                  <span>{layerForControls.scanAnimationName || 'Frame Scan'}</span>
                </div>
                <label className="field">
                  <span>Name</span>
                  <input value={layerForControls.scanAnimationName} onChange={(event) => updateScanControls({ scanAnimationName: event.target.value })} />
                </label>
                <label className="field color-field">
                  <span>Scan color</span>
                  <span className="color-control">
                    <input
                      type="color"
                      value={normalizeHexColor(layerForControls.scanColor)}
                      onChange={(event) => updateScanControls({ scanColor: event.target.value })}
                    />
                    <code>{normalizeHexColor(layerForControls.scanColor)}</code>
                  </span>
                </label>
                <div className="scan-color-swatches" aria-label="Scan color swatches">
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
                    <span>Loop Times</span>
                    <select value={layerForControls.scanLoop} onChange={(event) => updateScanControls({ scanLoop: event.target.value as LayerSettings['scanLoop'] })}>
                      <option value="once">Play 1 time</option>
                      <option value="loop">One-way cycle</option>
                      <option value="pingpong">Two-way loop</option>
                    </select>
                  </label>
                  <label className="check-row animation-check">
                    <input type="checkbox" checked={layerForControls.scanAutoplay} onChange={(event) => updateScanControls({ scanAutoplay: event.target.checked })} />
                    <span>Autoplay</span>
                  </label>
                </div>
                <NumberControl label="Delay" value={layerForControls.scanDelay} min={0} max={3000} step={100} onChange={(value) => updateScanControls({ scanDelay: value })} />
                <NumberControl label="Duration" value={layerForControls.scanSpeed} min={400} max={5000} step={100} onChange={(value) => updateScanControls({ scanSpeed: value })} />
                <div className="parameter-subtitle">Scale</div>
                <NumberControl label="Start" value={layerForControls.scanScaleStart} min={0.2} max={2} step={0.05} onChange={(value) => updateScanControls({ scanScaleStart: value })} />
                <NumberControl label="End" value={layerForControls.scanScaleEnd} min={0.2} max={3} step={0.05} onChange={(value) => updateScanControls({ scanScaleEnd: value })} />
                <div className="parameter-subtitle">Opacity</div>
                <NumberControl label="Start" value={layerForControls.scanOpacityStart} min={0} max={100} onChange={(value) => updateScanControls({ scanOpacityStart: value })} />
                <NumberControl label="End" value={layerForControls.scanOpacityEnd} min={0} max={100} onChange={(value) => updateScanControls({ scanOpacityEnd: value })} />
                <div className="parameter-subtitle">Square Scan Position</div>
                {layerForControls.ctaScanGrouped ? (
                  <>
                    <NumberControl label="Off X" value={layerForControls.scanOffsetX} min={-220} max={220} onChange={(value) => updateScanControls({ scanOffsetX: value })} />
                    <NumberControl label="Off Y" value={layerForControls.scanOffsetY} min={-220} max={220} onChange={(value) => updateScanControls({ scanOffsetY: value })} />
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
                <span>Group with CTA</span>
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
                <span>Scan visible</span>
              </label>
            </fieldset>
          )}

          {selectedLayer === 'asset' && (
            <fieldset className="control-stack" disabled={selectedLayerLocked}>
              <label className="field">
                <span>Asset type</span>
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
                <span>Asset visible</span>
              </label>
            </fieldset>
          )}

          {selectedLayer === 'cta' && (
            <fieldset className="control-stack" disabled={selectedLayerLocked}>
              <label className="field">
                <span>Text</span>
                <input value={layerForControls.ctaText} onChange={(event) => updateCtaControls({ ctaText: event.target.value })} />
              </label>
              <label className="field">
                <span>Button animation</span>
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
              <NumberControl label="X" value={layerForControls.ctaX} min={0} max={100} onChange={(value) => updateCtaControls({ ctaX: value })} />
              <NumberControl label="Y" value={layerForControls.ctaY} min={0} max={100} onChange={(value) => updateCtaControls({ ctaY: value })} />
              <NumberControl label="Width" value={layerForControls.ctaWidth} min={44} max={92} onChange={(value) => updateCtaControls({ ctaWidth: value })} />
              <NumberControl label="Rotate" value={layerForControls.ctaRotation} min={-180} max={180} onChange={(value) => updateCtaControls(getLayerRotationPatch('cta', value))} />
              <label className="check-row">
                <input type="checkbox" checked={layerForControls.ctaScanGrouped} onChange={(event) => setCtaScanGrouped(event.target.checked)} />
                <span>Group scan with CTA</span>
              </label>
              <label className="check-row">
                <input type="checkbox" checked={layerForControls.showCta} onChange={(event) => updateCtaControls({ showCta: event.target.checked })} />
                <span>CTA visible</span>
              </label>
            </fieldset>
          )}

          <div className="layer-actions">
            <button className="danger-button wide" type="button" onClick={deleteSelectedVariant} disabled={!selectedVariant}>
              <Trash2 size={16} />
              Delete Variant
            </button>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <h3>Actions</h3>
            <span>{activeSource?.kind === 'html' && !selectedVariant ? networkLabels[settings.network] : `${variants.length}/4`}</span>
          </div>
          <div className="action-grid">
            <button className="secondary-button wide" type="button" onClick={exportSelected} disabled={busy || (!selectedVariant && !activeSource?.html)}>
              <Download size={16} />
              {activeSource?.kind === 'html' && !selectedVariant ? 'Export HTML' : 'Export x5'}
            </button>
            <button className="secondary-button wide" type="button" onClick={exportZip} disabled={busy || !variants.length}>
              <Archive size={16} />
              ZIP x20
            </button>
            <button className="primary-button wide" type="button" onClick={saveProject} disabled={busy || !variants.length}>
              <Save size={16} />
              Save
            </button>
          </div>
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

  return (
    <div className="layer-stack">
      {topToBottom.map((target, displayIndex) => {
        const sourceIndex = stackOrder.indexOf(target);
        const visible = isLayerVisible(layer, target);
        const locked = isLayerLocked(layer, target);
        return (
          <div key={target} className={`layer-row ${selectedLayer === target ? 'active' : ''}`}>
            <button className="layer-select" type="button" onClick={() => onSelect(target)}>
              <span className="layer-icon">{layerIcon(target)}</span>
              <span>
                <strong>{layerMeta[target].label}</strong>
                <small>{layerMeta[target].group}</small>
              </span>
            </button>
            <button className="layer-mini" type="button" onClick={() => onVisibleChange(target, !visible)} title={visible ? 'Hide' : 'Show'}>
              {visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button className={`layer-mini ${locked ? 'locked' : ''}`} type="button" onClick={() => onLockChange(target, !locked)} title={locked ? 'Unlock' : 'Lock'}>
              {locked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
            <button className="layer-mini" type="button" onClick={() => onMove(target, 'up')} disabled={displayIndex === 0} title="Move up">
              <ArrowUp size={14} />
            </button>
            <button
              className="layer-mini"
              type="button"
              onClick={() => onMove(target, 'down')}
              disabled={sourceIndex === 0}
              title="Move down"
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
}: {
  variant: PlayableVariant;
  orientation: ProjectSettings['orientation'];
  imageFit: ProjectSettings['imageFit'];
  selected: boolean;
  selectedLayer: LayerTarget;
  onSelect: () => void;
  onLayerSelect: (layer: LayerTarget) => void;
  onLayerDrop: (layer: LayerTarget, x: number, y: number, assetId?: string) => void;
  onLayerPatch: (layer: LayerTarget, partial: Partial<LayerSettings>) => void;
}) {
  const artboardRef = useRef<HTMLDivElement>(null);
  const layer = normalizeLayerSettings(variant.settings);
  const hand = getHandAsset(layer.handId);
  const ratio = orientation === 'landscape' ? '16 / 9' : '9 / 16';
  const artboardStyle = getArtboardStyle(variant.width, variant.height, orientation, imageFit);
  const anchoredScanCss = shouldAnchorScanToFinger(layer) ? getFingerAnchorCss(layer) : null;
  const scanAnimationVars = getScanAnimationVars(layer);
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
          className={`preview-asset asset-motion-${getVisualAsset(layer.assetId).motion} ${selectedLayer === 'asset' && selected ? 'active' : ''}`}
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
          <VisualAssetIcon assetId={layer.assetId} />
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
          }}
          onPointerDown={(event) => startDrag('cta', event)}
        >
          {layer.ctaText}
        </button>
      );
    }

    return null;
  });
  const selectionBox = selected ? getLayerSelectionBox(layer, selectedLayer) : null;
  const selectedLayerIsLocked = isLayerLocked(layer, selectedLayer);

  const startResize = (target: LayerTarget, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    onLayerSelect(target);
    if (!artboardRef.current || isLayerLocked(layer, target)) return;

    const rect = artboardRef.current.getBoundingClientRect();
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
    if (!artboardRef.current || isLayerLocked(layer, target)) return;

    const rect = artboardRef.current.getBoundingClientRect();
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
    onSelect();
    onLayerSelect(target);
    if (isLayerLocked(layer, target)) return;
    if (!artboardRef.current) return;
    const rect = artboardRef.current.getBoundingClientRect();

    const startPoint = getPointInElement(artboardRef.current, event.clientX, event.clientY);
    const startPosition =
      target === 'scan' && shouldAnchorScanToFinger(layer)
        ? getFingerAnchorPercent(layer, rect)
        : target === 'hand'
        ? { x: layer.handX, y: layer.handY }
        : target === 'scan'
          ? { x: layer.scanX, y: layer.scanY }
          : target === 'asset'
            ? { x: layer.assetX, y: layer.assetY }
            : { x: layer.ctaX, y: layer.ctaY };

    const move = (moveEvent: PointerEvent) => {
      if (!artboardRef.current) return;
      const point = getPointInElement(artboardRef.current, moveEvent.clientX, moveEvent.clientY);
      const x = clamp(startPosition.x + point.x - startPoint.x, 0, 100);
      const y = clamp(startPosition.y + point.y - startPoint.y, 0, 100);
      if (target === 'scan' && shouldAnchorScanToFinger(layer)) {
        const nextRect = artboardRef.current.getBoundingClientRect();
        const offset = getScanOffsetFromFingerPoint(layer, nextRect, x, y);
        onLayerPatch('scan', { scanOffsetX: offset.x, scanOffsetY: offset.y, injectScan: true });
        return;
      }
      onLayerDrop(target, x, y);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  };

  const placeLayer = (target: LayerTarget, clientX: number, clientY: number, assetId?: string) => {
    if (!artboardRef.current) return;
    const point = getPointInElement(artboardRef.current, clientX, clientY);
    onSelect();
    onLayerSelect(target);
    if (target === 'scan' && shouldAnchorScanToFinger(layer)) {
      const rect = artboardRef.current.getBoundingClientRect();
      const offset = getScanOffsetFromFingerPoint(layer, rect, point.x, point.y);
      onLayerPatch('scan', { scanOffsetX: offset.x, scanOffsetY: offset.y, injectScan: true });
      return;
    }
    onLayerDrop(target, point.x, point.y, assetId);
  };

  return (
    <motion.article layout className={`preview-card ${selected ? 'selected' : ''}`} style={{ aspectRatio: ratio }} onClick={onSelect}>
      <div className="preview-card-head">
        <span>Variant {variant.index}</span>
        <b>{Math.round(variant.hotspot.confidence * 100)}%</b>
      </div>
      <div className="preview-stage">
        <div
          className="creative-frame"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(event) => {
            event.preventDefault();
            const assetId = getAssetDragData(event);
            const layerTarget = assetId ? 'asset' : getLayerDragData(event) || selectedLayer;
            placeLayer(layerTarget, event.clientX, event.clientY, assetId);
          }}
        >
          <img className="creative-backdrop" src={variant.dataUrl} alt="" />
          <div ref={artboardRef} className="creative-artboard" style={artboardStyle}>
            <img className="creative-image" src={variant.dataUrl} alt="" style={{ objectFit: imageFit }} />
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
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function EmptyPreview({ source, htmlPreview }: { source: SourceItem | null; htmlPreview?: string }) {
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
          srcDoc={htmlPreview || source.html || ''}
          sandbox="allow-scripts allow-forms allow-pointer-lock"
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
        <span className="eyebrow">{source ? source.name : 'No source'}</span>
        <h2>Generate 4 variants</h2>
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

function StatusPill({ icon, label, ready, loading }: { icon: React.ReactNode; label: string; ready: boolean; loading: boolean }) {
  return (
    <span className={`status-pill ${loading ? 'busy' : ready ? 'ready' : 'error'}`}>
      {loading ? <Loader2 className="spin" size={14} /> : icon}
      {label}
    </span>
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
  const scanStyle = merged.scanStyle === 'none' ? 'none' : 'frame';
  const legacyScanNames = new Set(['Tap Ripple', 'Face Scan', 'Pulse Ring', 'Sweep Line', 'Spotlight', 'Border Scan', 'Spark Hit', 'Square Light Scan']);
  const scanAnimationName =
    scanStyle === 'none'
      ? 'None'
      : !merged.scanAnimationName || legacyScanNames.has(merged.scanAnimationName)
        ? 'Frame Scan'
        : merged.scanAnimationName;
  return {
    ...merged,
    scanStyle,
    scanAnimationName,
    scanColor: normalizeHexColor(merged.scanColor),
    layerOrder: getLayerOrder(merged),
  };
}

function normalizeHexColor(value?: string) {
  if (value && /^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim();
  if (value && /^#[0-9a-f]{3}$/i.test(value.trim())) {
    const [, r, g, b] = value.trim();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#7c3cff';
}

function hexToRgbTriplet(value?: string) {
  const color = normalizeHexColor(value).slice(1);
  const r = parseInt(color.slice(0, 2), 16);
  const g = parseInt(color.slice(2, 4), 16);
  const b = parseInt(color.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function getLayerOrder(settings: Partial<LayerSettings>): LayerTarget[] {
  const hasExplicitOrder = Array.isArray(settings.layerOrder);
  const raw = hasExplicitOrder ? settings.layerOrder || [] : defaultLayerSettings.layerOrder;
  const valid = raw.filter((layer): layer is LayerTarget => layer === 'hand' || layer === 'scan' || layer === 'asset' || layer === 'cta');
  const next = valid.filter((layer, index) => valid.indexOf(layer) === index);
  if (settings.injectScan && settings.scanStyle !== 'none' && !next.includes('scan')) next.push('scan');
  if (settings.injectAsset && !next.includes('asset')) next.push('asset');
  if (settings.showCta && !next.includes('cta')) next.push('cta');
  if (settings.injectHand && !next.includes('hand')) next.push('hand');
  return keepHandAboveCta(next);
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

function isLayerVisible(layer: LayerSettings, target: LayerTarget) {
  if (target === 'hand') return layer.injectHand;
  if (target === 'scan') return layer.injectScan && layer.scanStyle !== 'none';
  if (target === 'asset') return layer.injectAsset;
  return layer.showCta;
}

function getLayerPosition(layer: LayerSettings, target: LayerTarget) {
  if (target === 'hand') return { x: layer.handX, y: layer.handY };
  if (target === 'scan') return { x: layer.scanX, y: layer.scanY };
  if (target === 'asset') return { x: layer.assetX, y: layer.assetY };
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
  if (target === 'hand') return layer.handRotation;
  if (target === 'scan') return layer.scanRotation;
  if (target === 'asset') return layer.assetRotation;
  return layer.ctaRotation;
}

function getLayerSizeValue(layer: LayerSettings, target: LayerTarget) {
  if (target === 'hand') return layer.handSize;
  if (target === 'scan') return layer.scanSize;
  if (target === 'asset') return layer.assetSize;
  return layer.ctaWidth;
}

function getLayerSelectionBox(layer: LayerSettings, target: LayerTarget) {
  if (!isLayerVisible(layer, target)) return null;
  const position = getLayerPosition(layer, target);
  const rotation = getLayerRotation(layer, target);
  const anchoredScan = target === 'scan' && shouldAnchorScanToFinger(layer) ? getFingerAnchorCss(layer) : null;

  if (target === 'cta') {
    return {
      left: `${position.x}%`,
      top: `${position.y}%`,
      rotation,
      width: `${layer.ctaWidth}%`,
      height: '42px',
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

function layerIcon(target: LayerTarget) {
  if (target === 'hand') return <Hand size={15} />;
  if (target === 'scan') return <ScanLine size={15} />;
  if (target === 'asset') return <Activity size={15} />;
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
