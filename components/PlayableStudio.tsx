'use client';

import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Crosshair,
  Database,
  Download,
  Eye,
  FileCode2,
  Grid2X2,
  Hand,
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
  Upload,
  WandSparkles,
  X,
} from 'lucide-react';
import type { DragEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { generateImagePlayableHtml, patchPlayableHtml, safeFileName, createDefaultProjectSettings } from '../lib/export-engine';
import { getHandAsset, handAssets } from '../lib/hand-assets';
import { detectImageHotspot, getImageDimensions, loadAssetAsDataUrl, readFileAsDataUrl, readFileAsText } from '../lib/image-utils';
import { buttonPresets, defaultLayerSettings, handMotionPresets, recipePresets, scanPresets } from '../lib/presets';
import type {
  AiVariantResponseItem,
  ExportImageInput,
  Hotspot,
  LayerSettings,
  LayerTarget,
  PlayableVariant,
  ProjectSettings,
  SourceItem,
} from '../lib/types';

type HealthState = {
  aiConfigured: boolean;
  supabaseConfigured: boolean;
  ok: boolean;
} | null;

type Notice = { tone: 'ok' | 'warn' | 'error' | 'busy'; text: string } | null;
type AiWorkerStatus = 'idle' | 'running' | 'done' | 'error';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isNaN(value) ? min : value));

const uid = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const LAYER_DRAG_TYPE = 'application/x-playable-layer';
const layerFieldMap: Record<LayerTarget, Array<keyof LayerSettings>> = {
  hand: ['handId', 'handMotion', 'handX', 'handY', 'handSize', 'injectHand'],
  scan: ['scanStyle', 'scanX', 'scanY', 'scanSize', 'scanSpeed', 'injectScan'],
  cta: ['ctaText', 'ctaX', 'ctaY', 'ctaWidth', 'showCta', 'buttonAnimation'],
};

function setLayerDragData(event: DragEvent<HTMLElement>, layer: LayerTarget) {
  event.dataTransfer.setData(LAYER_DRAG_TYPE, layer);
  event.dataTransfer.effectAllowed = 'move';
}

function getLayerDragData(event: DragEvent<HTMLElement>): LayerTarget | null {
  const value = event.dataTransfer.getData(LAYER_DRAG_TYPE);
  return value === 'hand' || value === 'scan' || value === 'cta' ? value : null;
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

  const activeSource = useMemo(
    () => sources.find((source) => source.id === activeSourceId) || sources[0] || null,
    [activeSourceId, sources],
  );
  const selectedVariant = useMemo(
    () => variants.find((variant) => variant.id === selectedVariantId) || variants[0] || null,
    [selectedVariantId, variants],
  );
  const activeLayer = selectedVariant?.settings || defaultLayerSettings;

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
    const hotspot = await detectImageHotspot(image.dataUrl).catch(() => source.hotspot || defaultHotspot());
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
      setNotice({ tone: 'error', text: 'Chọn ảnh nguồn trước' });
      return;
    }

    setBusy(true);
    setNotice({ tone: 'busy', text: 'AI đang chạy 4 luồng tạo variant song song...' });
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
          aspectRatio: settings.orientation === 'landscape' ? '16:9' : '9:16',
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `AI request failed (${response.status})`);

      const generated = (payload.variants || []).slice(0, 4) as AiVariantResponseItem[];
      if (!generated.length) throw new Error('AI không trả ảnh variant');
      const durationSeconds = typeof payload.durationMs === 'number' ? Math.max(1, Math.round(payload.durationMs / 1000)) : null;
      const warningCount = Array.isArray(payload.errors) ? payload.errors.length : 0;
      setLastAiDuration(durationSeconds);
      setAiWorkers(Array.from({ length: 4 }, (_, index) => (index < generated.length ? 'done' : 'error')));

      const next = await Promise.all(generated.map((item, index) => createVariantFromImage(activeSource, item, index + 1)));
      setVariants(next);
      setSelectedVariantId(next[0]?.id || '');
      setSources((current) =>
        current.map((source) => (source.id === activeSource.id ? { ...source, status: 'done' } : source)),
      );
      setNotice({
        tone: warningCount ? 'warn' : 'ok',
        text: `${next.length} variant đã tạo${durationSeconds ? ` trong ${durationSeconds}s` : ''}${warningCount ? `, lỗi ${warningCount}` : ''}`,
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
          const hotspot = await detectImageHotspot(variant.dataUrl);
          return {
            ...variant,
            hotspot,
            settings: {
              ...variant.settings,
              handX: Math.round(hotspot.x),
              handY: Math.round(hotspot.y),
              scanX: Math.round(hotspot.x),
              scanY: Math.round(hotspot.y),
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

  const exportVariantHtml = async (variant: PlayableVariant) => {
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
      network: settings.network,
      useClickTag: settings.useClickTag,
      handDataUrl,
      orientation: settings.orientation,
    });
  };

  const exportSelected = async () => {
    if (selectedVariant) {
      setBusy(true);
      try {
        const html = await exportVariantHtml(selectedVariant);
        downloadBlob(`${safeFileName(selectedVariant.name)}_applovin.html`, html, 'text/html;charset=utf-8');
        setNotice({ tone: 'ok', text: 'Đã xuất variant đang chọn' });
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
        const html = await exportVariantHtml(variant);
        zip.file(`${safeFileName(variant.name)}_applovin.html`, html);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(`${safeFileName(settings.name)}_4_playables.zip`, blob, 'application/zip');
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

  const applyRecipe = (recipeId: string) => {
    const recipe = recipePresets.find((item) => item.id === recipeId);
    if (!recipe) return;
    updateLayer(recipe.layer);
    setNotice({ tone: 'ok', text: `Preset ${recipe.label}` });
  };

  const removeSource = (sourceId: string) => {
    setSources((current) => current.filter((source) => source.id !== sourceId));
    if (activeSourceId === sourceId) {
      setActiveSourceId('');
      setVariants([]);
      setSelectedVariantId('');
    }
  };

  const layerForControls = selectedVariant?.settings || defaultLayerSettings;

  const moveLayer = useCallback(
    (variantId: string, layer: LayerTarget, x: number, y: number) => {
      setSelectedVariantId(variantId);
      setSelectedLayer(layer);
      if (layer === 'hand') updateLayer({ handX: x, handY: y, injectHand: true }, variantId, 'hand');
      if (layer === 'scan') updateLayer({ scanX: x, scanY: y, injectScan: true }, variantId, 'scan');
      if (layer === 'cta') updateLayer({ ctaX: x, ctaY: y, showCta: true }, variantId, 'cta');
    },
    [updateLayer],
  );

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
          <StatusPill icon={<WandSparkles size={14} />} label="AI" ready={Boolean(health?.aiConfigured)} loading={!health} />
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
            <span>Mix preset</span>
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

        <section className="sidebar-section hands-section">
          <div className="section-head">
            <span>Hand asset</span>
            <b>{handAssets.length}</b>
          </div>
          <div className="hand-grid">
            {handAssets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                className={`hand-tile ${layerForControls.handId === asset.id ? 'active' : ''}`}
                onClick={() => updateLayer({ handId: asset.id, handMotion: asset.motion }, undefined, 'hand')}
                title={asset.label}
              >
                <img src={asset.src} alt="" />
              </button>
            ))}
          </div>
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
            <button className="primary-button" type="button" onClick={generateVariants} disabled={!activeSource || activeSource.kind !== 'image' || busy}>
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
                onLayerDrop={(layer, x, y) => moveLayer(variant.id, layer, x, y)}
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
          <div className="field-grid">
            <label className="field">
              <span>Network</span>
              <select value={settings.network} onChange={(event) => setProjectSetting('network', event.target.value as ProjectSettings['network'])}>
                <option value="applovin">Applovin</option>
                <option value="mintegral">Mintegral</option>
                <option value="mraid">Generic MRAID</option>
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
            <h3>Layer Control</h3>
            <span>{selectedLayer}</span>
          </div>
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
        </section>

        <section className="panel-section">
          <div className="section-title">
            <h3>Actions</h3>
            <span>{variants.length}/4</span>
          </div>
          <div className="action-grid">
            <button className="secondary-button wide" type="button" onClick={exportSelected} disabled={busy || (!selectedVariant && !activeSource?.html)}>
              <Download size={16} />
              Export
            </button>
            <button className="secondary-button wide" type="button" onClick={exportZip} disabled={busy || !variants.length}>
              <Archive size={16} />
              ZIP x4
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
  onLayerDrop: (layer: LayerTarget, x: number, y: number) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const layer = variant.settings;
  const hand = getHandAsset(layer.handId);
  const ratio = orientation === 'landscape' ? '16 / 9' : '9 / 16';

  const startDrag = (target: LayerTarget, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    onLayerSelect(target);

    const update = (clientX: number, clientY: number) => {
      if (!frameRef.current) return;
      const point = getPointInElement(frameRef.current, clientX, clientY);
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

  const placeLayer = (target: LayerTarget, clientX: number, clientY: number) => {
    if (!frameRef.current) return;
    const point = getPointInElement(frameRef.current, clientX, clientY);
    onSelect();
    onLayerSelect(target);
    onLayerDrop(target, point.x, point.y);
  };

  return (
    <motion.article layout className={`preview-card ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="preview-card-head">
        <span>Variant {variant.index}</span>
        <b>{Math.round(variant.hotspot.confidence * 100)}%</b>
      </div>
      <div
        ref={frameRef}
        className="creative-frame"
        style={{ aspectRatio: ratio }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => {
          event.preventDefault();
          const layerTarget = getLayerDragData(event) || selectedLayer;
          placeLayer(layerTarget, event.clientX, event.clientY);
        }}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (target !== event.currentTarget && !target.classList.contains('creative-image')) return;
          placeLayer(selectedLayer, event.clientX, event.clientY);
        }}
      >
        <img className="creative-image" src={variant.dataUrl} alt="" />
        {layer.injectScan && layer.scanStyle !== 'none' && (
          <span
            className={`preview-scan scan-${layer.scanStyle} ${selectedLayer === 'scan' && selected ? 'active' : ''}`}
            style={{
              left: `${layer.scanX}%`,
              top: `${layer.scanY}%`,
              width: `${layer.scanSize}px`,
              height: `${layer.scanSize}px`,
              ['--scan-speed' as string]: `${layer.scanSpeed}ms`,
            }}
            onPointerDown={(event) => startDrag('scan', event)}
          />
        )}
        {layer.injectHand && (
          <img
            className={`preview-hand motion-${layer.handMotion} ${selectedLayer === 'hand' && selected ? 'active' : ''}`}
            src={hand.src}
            alt=""
            style={{
              left: `${layer.handX}%`,
              top: `${layer.handY}%`,
              width: `${layer.handSize}px`,
            }}
            onPointerDown={(event) => startDrag('hand', event)}
          />
        )}
        {layer.showCta && (
          <button
            className={`preview-cta btn-${layer.buttonAnimation} ${selectedLayer === 'cta' && selected ? 'active' : ''}`}
            type="button"
            style={{
              left: `${layer.ctaX}%`,
              top: `${layer.ctaY}%`,
              width: `${layer.ctaWidth}%`,
            }}
            onPointerDown={(event) => startDrag('cta', event)}
          >
            {layer.ctaText}
          </button>
        )}
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

function layerFromHotspot(hotspot: Hotspot, index: number): LayerSettings {
  const recipe = recipePresets[(index - 1) % recipePresets.length];
  const targetX = Math.round(hotspot.x);
  const targetY = Math.round(hotspot.y);
  return {
    ...defaultLayerSettings,
    ...recipe.layer,
    handX: targetX,
    handY: targetY,
    scanX: targetX,
    scanY: targetY,
    ctaX: 50,
    ctaY: targetY > 78 ? 90 : 88,
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
