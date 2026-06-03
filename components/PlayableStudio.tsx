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
  Loader2,
  MousePointerClick,
  Play,
  RefreshCw,
  Save,
  ScanLine,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
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
import { getHandAsset, handAssets } from '../lib/hand-assets';
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
  hand: ['layerOrder', 'handId', 'handMotion', 'handX', 'handY', 'handSize', 'injectHand'],
  scan: ['layerOrder', 'scanStyle', 'scanX', 'scanY', 'scanSize', 'scanSpeed', 'injectScan'],
  asset: ['layerOrder', 'assetId', 'assetX', 'assetY', 'assetSize', 'assetSpeed', 'injectAsset'],
  cta: ['layerOrder', 'ctaText', 'ctaX', 'ctaY', 'ctaWidth', 'showCta', 'buttonAnimation'],
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

export function PlayableStudio() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handDataUrlCache = useRef(new Map<string, string>());
  const [health, setHealth] = useState<HealthState>(null);
  const [settings, setSettings] = useState<ProjectSettings>(() => createDefaultProjectSettings());
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [activeSourceId, setActiveSourceId] = useState('');
  const [variants, setVariants] = useState<PlayableVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [selectedLayer, setSelectedLayer] = useState<LayerTarget>('hand');
  const [notice, setNotice] = useState<Notice>({ tone: 'warn', text: 'Chưa có ảnh nguồn' });
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [aiWorkers, setAiWorkers] = useState<AiWorkerStatus[]>(['idle', 'idle', 'idle', 'idle']);
  const [lastAiDuration, setLastAiDuration] = useState<number | null>(null);
  const [generationHistory, setGenerationHistory] = useState<GenerationHistoryEntry[]>([]);
  const [assetLibraryTab, setAssetLibraryTab] = useState<AssetLibraryTab>('hand');

  const activeSource = useMemo(
    () => sources.find((source) => source.id === activeSourceId) || sources[0] || null,
    [activeSourceId, sources],
  );
  const selectedVariant = useMemo(
    () => variants.find((variant) => variant.id === selectedVariantId) || variants[0] || null,
    [selectedVariantId, variants],
  );
  const activeLayer = selectedVariant?.settings || defaultLayerSettings;
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

      setVariants((current) =>
        current.map((variant) => {
          if (variant.id === targetId) return { ...variant, settings: { ...variant.settings, ...partial } };
          if (!settings.syncAllVariants || !hasSharedChanges) return variant;
          return { ...variant, settings: { ...variant.settings, ...sharedPartial } };
        }),
      );
    },
    [selectedLayer, selectedVariant?.id, settings.syncAllVariants],
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
      setAiWorkers(['idle', 'idle', 'idle', 'idle']);
      setLastAiDuration(null);
      setProjectSetting('name', safeFileName(imported[0].name));
      const firstImage = imported.find((source) => source.kind === 'image' && source.dataUrl);
      if (firstImage) {
        const drafts = await createDraftVariants(firstImage);
        setVariants(drafts);
        setSelectedVariantId(drafts[0]?.id || '');
        setNotice({ tone: 'ok', text: `${imported.length} file ready, 4 draft preview created` });
        return;
      }
      setNotice({ tone: 'ok', text: `${imported.length} file sẵn sàng` });
      setNotice({ tone: 'ok', text: `Da export ${variants.length * networkExportTargets.length} HTML (${variants.length} variant x 5 nen tang)` });
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
    const hotspot = projectHotspotToFrame(rawHotspot, dimensions, settings.orientation);
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
          const hotspot = projectHotspotToFrame(rawHotspot, variant, settings.orientation);
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
    const handDataUrl = variant.settings.injectHand ? await getHandDataUrl(variant.settings.handId) : undefined;
    const image: ExportImageInput = {
      name: variant.name,
      dataUrl: variant.dataUrl,
      width: variant.width,
      height: variant.height,
    };
    return generateImagePlayableHtml({
      image,
      layer: variant.settings,
      storeUrl: settings.storeUrl,
      network,
      useClickTag: settings.useClickTag,
      handDataUrl,
      orientation: settings.orientation,
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
        const handDataUrl = activeLayer.injectHand ? await getHandDataUrl(activeLayer.handId) : undefined;
        const html = patchPlayableHtml({
          html: activeSource.html,
          layer: activeLayer,
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

  const getHandDataUrl = async (handId: string) => {
    const cached = handDataUrlCache.current.get(handId);
    if (cached) return cached;
    const asset = getHandAsset(handId);
    const dataUrl = await loadAssetAsDataUrl(asset.src);
    handDataUrlCache.current.set(handId, dataUrl);
    return dataUrl;
  };

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
    updateLayer(recipe.layer);
    setNotice({ tone: 'ok', text: `Preset ${recipe.label}` });
  };

  const applyVisualAsset = (assetId: string) => {
    const asset = getVisualAsset(assetId);
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
    if (!selectedVariant) return;
    const patch =
      selectedLayer === 'hand'
        ? ({ injectHand: false } satisfies Partial<LayerSettings>)
        : selectedLayer === 'scan'
          ? ({ injectScan: false } satisfies Partial<LayerSettings>)
          : selectedLayer === 'asset'
            ? ({ injectAsset: false } satisfies Partial<LayerSettings>)
            : ({ showCta: false } satisfies Partial<LayerSettings>);

    setVariants((current) =>
      current.map((variant) =>
        variant.id === selectedVariant.id ? { ...variant, settings: { ...variant.settings, ...patch } } : variant,
      ),
    );
    setNotice({ tone: 'ok', text: `Removed ${selectedLayer} from Variant ${selectedVariant.index}` });
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

  const layerForControls = normalizeLayerSettings(selectedVariant?.settings || defaultLayerSettings);

  const moveLayer = useCallback(
    (variantId: string, layer: LayerTarget, x: number, y: number, assetId?: string) => {
      setSelectedVariantId(variantId);
      setSelectedLayer(layer);
      if (layer === 'hand') updateLayer({ handX: x, handY: y, injectHand: true }, variantId, 'hand');
      if (layer === 'scan') updateLayer({ scanX: x, scanY: y, injectScan: true }, variantId, 'scan');
      if (layer === 'asset') {
        updateLayer(
          { assetX: x, assetY: y, injectAsset: true, ...(assetId ? { assetId } : {}) },
          variantId,
          'asset',
        );
      }
      if (layer === 'cta') updateLayer({ ctaX: x, ctaY: y, showCta: true }, variantId, 'cta');
    },
    [updateLayer],
  );

  const setLayerVisibility = (layer: LayerTarget, visible: boolean) => {
    setSelectedLayer(layer);
    if (layer === 'hand') updateLayer({ injectHand: visible }, undefined, 'hand');
    if (layer === 'scan') updateLayer({ injectScan: visible }, undefined, 'scan');
    if (layer === 'asset') updateLayer({ injectAsset: visible }, undefined, 'asset');
    if (layer === 'cta') updateLayer({ showCta: visible }, undefined, 'cta');
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

        <section className="sidebar-section">
          <div className="section-head">
            <span>Animation library</span>
            <b>{recipePresets.length}</b>
          </div>
          <div className="recipe-grid">
            {recipePresets.map((recipe) => (
              <button key={recipe.id} type="button" className="recipe-card" onClick={() => applyRecipe(recipe.id)}>
                <Sparkles size={16} />
                <strong>{recipe.label}</strong>
                <small>{recipe.note}</small>
              </button>
            ))}
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
                  onDragStart={(event) => setLayerDragData(event, 'asset', asset.id)}
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
                selected={variant.id === selectedVariant?.id}
                selectedLayer={selectedLayer}
                onSelect={() => setSelectedVariantId(variant.id)}
                onLayerSelect={setSelectedLayer}
                onLayerDrop={(layer, x, y, assetId) => moveLayer(variant.id, layer, x, y, assetId)}
              />
            ))
          ) : (
            <EmptyPreview source={activeSource} />
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
            <span>{selectedVariant ? `V${selectedVariant.index}` : 'none'}</span>
          </div>
          <LayerStack
            layer={layerForControls}
            selectedLayer={selectedLayer}
            onSelect={setSelectedLayer}
            onVisibleChange={setLayerVisibility}
            onMove={moveLayerOrder}
          />
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
            <div className="control-stack">
              <label className="field">
                <span>Motion</span>
                <select value={layerForControls.handMotion} onChange={(event) => updateLayer({ handMotion: event.target.value as LayerSettings['handMotion'] })}>
                  {handMotionPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <NumberControl label="X" value={layerForControls.handX} min={0} max={100} onChange={(value) => updateLayer({ handX: value })} />
              <NumberControl label="Y" value={layerForControls.handY} min={0} max={100} onChange={(value) => updateLayer({ handY: value })} />
              <NumberControl label="Size" value={layerForControls.handSize} min={32} max={260} onChange={(value) => updateLayer({ handSize: value })} />
              <label className="check-row">
                <input type="checkbox" checked={layerForControls.injectHand} onChange={(event) => updateLayer({ injectHand: event.target.checked })} />
                <span>Hand visible</span>
              </label>
            </div>
          )}

          {selectedLayer === 'scan' && (
            <div className="control-stack">
              <label className="field">
                <span>Scan style</span>
                <select value={layerForControls.scanStyle} onChange={(event) => updateLayer({ scanStyle: event.target.value as LayerSettings['scanStyle'] })}>
                  {scanPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <NumberControl label="X" value={layerForControls.scanX} min={0} max={100} onChange={(value) => updateLayer({ scanX: value })} />
              <NumberControl label="Y" value={layerForControls.scanY} min={0} max={100} onChange={(value) => updateLayer({ scanY: value })} />
              <NumberControl label="Size" value={layerForControls.scanSize} min={48} max={360} onChange={(value) => updateLayer({ scanSize: value })} />
              <NumberControl label="Speed" value={layerForControls.scanSpeed} min={400} max={5000} step={100} onChange={(value) => updateLayer({ scanSpeed: value })} />
              <label className="check-row">
                <input type="checkbox" checked={layerForControls.injectScan} onChange={(event) => updateLayer({ injectScan: event.target.checked })} />
                <span>Scan visible</span>
              </label>
            </div>
          )}

          {selectedLayer === 'asset' && (
            <div className="control-stack">
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
              <NumberControl label="Speed" value={layerForControls.assetSpeed} min={500} max={5000} step={100} onChange={(value) => updateLayer({ assetSpeed: value })} />
              <label className="check-row">
                <input type="checkbox" checked={layerForControls.injectAsset} onChange={(event) => updateLayer({ injectAsset: event.target.checked })} />
                <span>Asset visible</span>
              </label>
            </div>
          )}

          {selectedLayer === 'cta' && (
            <div className="control-stack">
              <label className="field">
                <span>Text</span>
                <input value={layerForControls.ctaText} onChange={(event) => updateLayer({ ctaText: event.target.value })} />
              </label>
              <label className="field">
                <span>Button animation</span>
                <select
                  value={layerForControls.buttonAnimation}
                  onChange={(event) => updateLayer({ buttonAnimation: event.target.value as LayerSettings['buttonAnimation'] })}
                >
                  {buttonPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <NumberControl label="X" value={layerForControls.ctaX} min={0} max={100} onChange={(value) => updateLayer({ ctaX: value })} />
              <NumberControl label="Y" value={layerForControls.ctaY} min={0} max={100} onChange={(value) => updateLayer({ ctaY: value })} />
              <NumberControl label="Width" value={layerForControls.ctaWidth} min={44} max={92} onChange={(value) => updateLayer({ ctaWidth: value })} />
              <label className="check-row">
                <input type="checkbox" checked={layerForControls.showCta} onChange={(event) => updateLayer({ showCta: event.target.checked })} />
                <span>CTA visible</span>
              </label>
            </div>
          )}

          <div className="layer-actions">
            <button className="secondary-button wide" type="button" onClick={removeSelectedLayer} disabled={!selectedVariant}>
              <EyeOff size={16} />
              Remove Layer
            </button>
            <button className="danger-button wide" type="button" onClick={deleteSelectedVariant} disabled={!selectedVariant}>
              <Trash2 size={16} />
              Delete Variant
            </button>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <h3>Actions</h3>
            <span>{variants.length}/4</span>
          </div>
          <div className="action-grid">
            <button className="secondary-button wide" type="button" onClick={exportSelected} disabled={busy || (!selectedVariant && !activeSource?.html)}>
              <Download size={16} />
              Export x5
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
}: {
  layer: LayerSettings;
  selectedLayer: LayerTarget;
  onSelect: (layer: LayerTarget) => void;
  onVisibleChange: (layer: LayerTarget, visible: boolean) => void;
  onMove: (layer: LayerTarget, direction: 'up' | 'down') => void;
}) {
  const order = getLayerOrder(layer);
  const topToBottom = [...order].reverse();

  return (
    <div className="layer-stack">
      {topToBottom.map((target, displayIndex) => {
        const sourceIndex = order.indexOf(target);
        const visible = isLayerVisible(layer, target);
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

function getContainedArtboardStyle(width: number | undefined, height: number | undefined, orientation: ProjectSettings['orientation']) {
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
  selected,
  selectedLayer,
  onSelect,
  onLayerSelect,
  onLayerDrop,
}: {
  variant: PlayableVariant;
  orientation: ProjectSettings['orientation'];
  selected: boolean;
  selectedLayer: LayerTarget;
  onSelect: () => void;
  onLayerSelect: (layer: LayerTarget) => void;
  onLayerDrop: (layer: LayerTarget, x: number, y: number, assetId?: string) => void;
}) {
  const artboardRef = useRef<HTMLDivElement>(null);
  const layer = normalizeLayerSettings(variant.settings);
  const hand = getHandAsset(layer.handId);
  const ratio = orientation === 'landscape' ? '16 / 9' : '9 / 16';
  const artboardStyle = getContainedArtboardStyle(variant.width, variant.height, orientation);
  const orderedLayerMarkup = getLayerOrder(layer).map((target, index) => {
    const zIndex = 5 + index;
    if (target === 'scan' && layer.injectScan && layer.scanStyle !== 'none') {
      return (
        <span
          key="scan"
          className={`preview-scan scan-${layer.scanStyle} ${selectedLayer === 'scan' && selected ? 'active' : ''}`}
          style={{
            left: `${layer.scanX}%`,
            top: `${layer.scanY}%`,
            width: `${layer.scanSize}px`,
            height: `${layer.scanSize}px`,
            zIndex,
            ['--scan-speed' as string]: `${layer.scanSpeed}ms`,
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
          }}
          onPointerDown={(event) => startDrag('cta', event)}
        >
          {layer.ctaText}
        </button>
      );
    }

    return null;
  });

  const startDrag = (target: LayerTarget, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    onLayerSelect(target);

    const update = (clientX: number, clientY: number) => {
      if (!artboardRef.current) return;
      const point = getPointInElement(artboardRef.current, clientX, clientY);
      onLayerDrop(target, point.x, point.y);
    };

    update(event.clientX, event.clientY);
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX, moveEvent.clientY);
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
    onLayerDrop(target, point.x, point.y, assetId);
  };

  return (
    <motion.article layout className={`preview-card ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="preview-card-head">
        <span>Variant {variant.index}</span>
        <b>{Math.round(variant.hotspot.confidence * 100)}%</b>
      </div>
      <div
        className="creative-frame"
        style={{ aspectRatio: ratio }}
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
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (
            target !== event.currentTarget &&
            !target.classList.contains('creative-image') &&
            !target.classList.contains('creative-artboard') &&
            !target.classList.contains('creative-backdrop')
          ) {
            return;
          }
          placeLayer(selectedLayer, event.clientX, event.clientY);
        }}
      >
        <img className="creative-backdrop" src={variant.dataUrl} alt="" />
        <div ref={artboardRef} className="creative-artboard" style={artboardStyle}>
          <img className="creative-image" src={variant.dataUrl} alt="" />
          {orderedLayerMarkup}
        </div>
      </div>
    </motion.article>
  );
}

function EmptyPreview({ source }: { source: SourceItem | null }) {
  return (
    <div className="empty-preview">
      <div className="empty-frame">
        {source?.dataUrl ? <img src={source.dataUrl} alt="" /> : <Grid2X2 size={56} />}
      </div>
      <div>
        <span className="eyebrow">{source ? source.name : 'No source'}</span>
        <h2>{source?.kind === 'html' ? 'HTML source selected' : 'Generate 4 variants'}</h2>
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
  return {
    ...merged,
    layerOrder: getLayerOrder(merged),
  };
}

function getLayerOrder(settings: Partial<LayerSettings>): LayerTarget[] {
  const raw = Array.isArray(settings.layerOrder) ? settings.layerOrder : defaultLayerSettings.layerOrder;
  const valid = raw.filter((layer): layer is LayerTarget => layer === 'hand' || layer === 'scan' || layer === 'asset' || layer === 'cta');
  return ensureLayerInOrder(valid, 'scan', 'asset', 'hand', 'cta');
}

function ensureLayerInOrder(order: LayerTarget[], ...layers: LayerTarget[]) {
  const next = order.filter((layer, index) => order.indexOf(layer) === index);
  for (const layer of layers) {
    if (!next.includes(layer)) next.push(layer);
  }
  return next;
}

function isLayerVisible(layer: LayerSettings, target: LayerTarget) {
  if (target === 'hand') return layer.injectHand;
  if (target === 'scan') return layer.injectScan && layer.scanStyle !== 'none';
  if (target === 'asset') return layer.injectAsset;
  return layer.showCta;
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
  return {
    ...defaultLayerSettings,
    ...recipe.layer,
    handX: targetX,
    handY: targetY,
    handSize: recipe.layer.handSize || handSize,
    scanX: targetX,
    scanY: targetY,
    scanSize: recipe.layer.scanSize || scanSize,
    ctaX: 50,
    ctaY: targetY > 78 ? 90 : 88,
  };
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
  _dimensions: { width?: number; height?: number },
  _orientation: ProjectSettings['orientation'],
): Hotspot {
  return {
    ...hotspot,
    x: clamp(hotspot.x, 8, 92),
    y: clamp(hotspot.y, 12, 88),
    reason: `${hotspot.reason || 'detected'}; contained artboard`,
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
