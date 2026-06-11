'use client';

import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode2,
  Loader2,
  Package,
  RefreshCw,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyContentLocaleToPrompt,
  contentLocaleOptions,
} from '../lib/content-locales';
import {
  createDefaultProjectSettings,
  generateImagePlayableHtml,
  networkExportTargets,
  networkLabels,
  normalizeProjectSettings,
  resolveProjectStoreConfig,
  safeFileName,
} from '../lib/export-engine';
import { getHandAsset } from '../lib/hand-assets';
import { detectImageHotspot, getImageDimensions, loadAssetAsDataUrl, readFileAsDataUrl } from '../lib/image-utils';
import {
  buildPlayableClonePrompt,
  createPlayableClonePromptSeed,
  inferPlayableClonePlan,
  type PlayableCloneLayoutSnapshot,
} from '../lib/playable-clone';
import type { PlayableAudit, PlayableLayerAsset } from '../lib/playable-layers';
import {
  buttonAnimationValues,
  handMotionValues,
  layerFromPlayablePlan,
  playableIntentLabels,
  scanStyleValues,
  textCueAnimationValues,
} from '../lib/playable-plan';
import { withStudioRoutePrefix } from '../lib/studio-routes';
import type {
  AiVariantResponseItem,
  Hotspot,
  LayerSettings,
  NetworkTarget,
  PlayableVariant,
  ProjectSettings,
  ReferenceImageInput,
  SourceItem,
  StudioCloneImportPayload,
} from '../lib/types';

type PlayableCloneStudioProps = {
  appId: string;
};

type AnalysisResult = {
  name: string;
  documentHtml: string;
  convertedFromWrapper: boolean;
  assets: PlayableLayerAsset[];
  audit: PlayableAudit;
};

type Notice = { tone: 'ok' | 'warn' | 'error' | 'busy'; text: string } | null;
type CaptureResult = { dataUrl: string; width: number; height: number; sourceKind: string };

const aiProviderModelMap: Record<ProjectSettings['aiProvider'], string> = {
  openai: 'gpt-image-2',
  'gemini-flash': 'gemini/gemini-3.1-flash-image-preview',
  'gemini-pro': 'gemini/gemini-3-pro-image-preview',
};

const MAX_REFERENCE_IMAGES = 6;

export function PlayableCloneStudio({ appId }: PlayableCloneStudioProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handDataUrlCache = useRef(new Map<string, string>());
  const pathname = usePathname();
  const routeFor = useCallback((href: string) => withStudioRoutePrefix(pathname, href), [pathname]);
  const [settings, setSettings] = useState<ProjectSettings>(() =>
    normalizeProjectSettings({
      ...createDefaultProjectSettings(),
      name: 'Bản clone playable',
      prompt: '',
      variantCount: 4,
    }),
  );
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewVariants, setPreviewVariants] = useState<Record<string, string>>({});
  const [sourceCapture, setSourceCapture] = useState<SourceItem | null>(null);
  const [referenceImages, setReferenceImages] = useState<ReferenceImageInput[]>([]);
  const [variants, setVariants] = useState<PlayableVariant[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<'analyze' | 'generate' | 'handoff' | 'export' | 'zip' | 'refs' | ''>('');
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [inference, setInference] = useState<ReturnType<typeof inferPlayableClonePlan> | null>(null);
  const [sourceLayout, setSourceLayout] = useState<PlayableCloneLayoutSnapshot | null>(null);
  const [syncLayerEdits, setSyncLayerEdits] = useState(true);

  const storeConfig = useMemo(() => resolveProjectStoreConfig(settings), [settings]);
  const selectedVariant = variants.find((item) => item.id === selectedVariantId) || variants[0] || null;
  const cloneSourceLabel = analysis ? (analysis.convertedFromWrapper ? 'Wrapper đã xử lý' : 'HTML trực tiếp') : 'Chưa có nguồn';
  const localizedPrompt = useMemo(() => applyContentLocaleToPrompt(settings.prompt, settings.locale), [settings.locale, settings.prompt]);

  const resetCloneWorkspace = useCallback(() => {
    setAnalysis(null);
    setPreviewVariants({});
    setSourceCapture(null);
    setReferenceImages([]);
    setVariants([]);
    setNotice({ tone: 'ok', text: 'Đã tạo phiên clone mới.' });
    setBusy('');
    setSelectedVariantId('');
    setInference(null);
    setSourceLayout(null);
    setSyncLayerEdits(true);
    setSettings((current) =>
      normalizeProjectSettings({
        ...createDefaultProjectSettings(),
        aiProvider: current.aiProvider,
        network: current.network,
        orientation: current.orientation,
        variantCount: current.variantCount,
        storeRoutingMode: current.storeRoutingMode,
        storePlatform: current.storePlatform,
        storeUrl: current.storeUrl,
        appStoreUrl: current.appStoreUrl,
        googlePlayUrl: current.googlePlayUrl,
        name: 'Bản clone playable',
        prompt: '',
      }),
    );
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (referenceInputRef.current) referenceInputRef.current.value = '';
  }, []);

  useEffect(() => {
    if (!analysis?.documentHtml) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(new Blob([injectClonePreviewBridge(analysis.documentHtml)], { type: 'text/html' }));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [analysis]);

  useEffect(() => {
    let cancelled = false;
    const revoke: string[] = [];

    if (!variants.length) {
      setPreviewVariants({});
      return;
    }

    const build = async () => {
      const entries = await Promise.all(
        variants.map(async (variant) => {
          const handDataUrl = variant.settings.injectHand ? await getHandDataUrl(variant.settings.handId, handDataUrlCache.current) : undefined;
          const html = generateImagePlayableHtml({
            image: {
              name: variant.name,
              dataUrl: variant.dataUrl,
              width: variant.width,
              height: variant.height,
            },
            layer: variant.settings,
            store: storeConfig,
            network: settings.network,
            useClickTag: settings.useClickTag,
            handDataUrl,
            orientation: settings.orientation,
            imageFit: settings.imageFit,
            previewMode: true,
          });
          const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
          revoke.push(url);
          return [variant.id, url] as const;
        }),
      );

      if (cancelled) {
        revoke.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      setPreviewVariants(Object.fromEntries(entries));
    };

    build().catch((error) => {
      if (!cancelled) {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Không dựng được bản xem trước playable.' });
      }
    });

    return () => {
      cancelled = true;
      revoke.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [settings.imageFit, settings.network, settings.orientation, settings.useClickTag, storeConfig, variants]);

  const setProjectSetting = <K extends keyof ProjectSettings>(key: K, value: ProjectSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const inspectSourcePreview = async (seedPrompt: boolean) => {
    if (!analysis) return null;
    const layout = await inspectPlayableLayout(iframeRef.current);
    setSourceLayout(layout);
    const seeded = inferPlayableClonePlan({
      html: analysis.documentHtml,
      assets: analysis.assets,
      hotspot: defaultHotspot(),
      prompt: localizedPrompt,
      layout,
    });
    setInference((current) => (variants.length ? current : seeded));
    if (seedPrompt) {
      setSettings((current) =>
        normalizeProjectSettings({
          ...current,
          ...seeded.storeSettings,
          prompt: current.prompt.trim() || createPlayableClonePromptSeed(seeded),
        }),
      );
    }
    return layout;
  };

  const analyzeCloneSourcePlan = async ({
    imageDataUrl,
    hotspot,
    sourceKind,
  }: {
    imageDataUrl: string;
    hotspot: Hotspot;
    sourceKind: string;
  }) => {
    const response = await fetch('/api/ai/analyze-playable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageDataUrl,
        prompt: localizedPrompt,
        index: 1,
        count: settings.variantCount,
        hotspot,
        mode: 'clone-source',
        sourceKind,
        preserveVisibleCopy: true,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { plan?: PlayableVariant['plan']; error?: string };
    if (!response.ok || !payload.plan) {
      throw new Error(payload.error || `Phân tích clone thất bại (${response.status})`);
    }
    return payload.plan;
  };

  const updateVariantLayers = (partial: Partial<LayerSettings>) => {
    if (!selectedVariant) return;
    setVariants((current) =>
      current.map((variant) => {
        if (!syncLayerEdits && variant.id !== selectedVariant.id) return variant;
        return {
          ...variant,
          settings: { ...variant.settings, ...partial },
          plan: applyLayerPatchToPlan(variant.plan, partial),
        };
      }),
    );
  };

  const resetVariantLayersFromInference = () => {
    if (!selectedVariant || !inference) return;
    const rebuilt = layerFromPlayablePlan(inference.plan, localizedPrompt);
    setVariants((current) =>
      current.map((variant) => {
        if (!syncLayerEdits && variant.id !== selectedVariant.id) return variant;
        return {
          ...variant,
          settings: { ...rebuilt },
          plan: inference.plan,
        };
      }),
    );
  };

  const analyzeFile = async (file: File) => {
    setBusy('analyze');
    setNotice({ tone: 'busy', text: 'Đang phân tích playable HTML...' });
    setVariants([]);
    setSelectedVariantId('');
    setSourceCapture(null);
    setInference(null);
    setSourceLayout(null);

    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/playables/analyze', { method: 'POST', body: form });
      const payload = (await response.json()) as AnalysisResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Không phân tích được playable.');

      const storeSettings = inferPlayableClonePlan({
        html: payload.documentHtml,
        assets: payload.assets,
        hotspot: defaultHotspot(),
        prompt: '',
      }).storeSettings;

      setAnalysis(payload);
      setSettings((current) =>
        normalizeProjectSettings({
          ...current,
          ...storeSettings,
          name: `${safeFileName(file.name.replace(/\.html?$/i, ''))} clone`,
          prompt: current.prompt.trim(),
        }),
      );
      setNotice({
        tone: payload.audit.appLovinReady ? 'ok' : 'warn',
        text: `${payload.assets.length} tài nguyên · ${payload.audit.sizeMiB} MiB${payload.convertedFromWrapper ? ' · đã chuyển từ wrapper' : ''}`,
      });
    } catch (error) {
      setAnalysis(null);
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Phân tích playable thất bại.' });
    } finally {
      setBusy('');
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
    setBusy('refs');
    setNotice({ tone: 'busy', text: 'Đang đọc input ref...' });

    try {
      const imported = await Promise.all(
        acceptedFiles.map(async (file, index) => {
          const dataUrl = await readFileAsDataUrl(file);
          const dimensions = await getImageDimensions(dataUrl);
          return {
            id: `clone-ref-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`,
            name: file.name,
            dataUrl,
            width: dimensions.width,
            height: dimensions.height,
            createdAt: Date.now(),
          } satisfies ReferenceImageInput;
        }),
      );

      setReferenceImages((current) => [...imported, ...current].slice(0, MAX_REFERENCE_IMAGES));
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
      setBusy('');
      if (referenceInputRef.current) referenceInputRef.current.value = '';
    }
  };

  const removeReferenceImage = (referenceId: string) => {
    setReferenceImages((current) => current.filter((reference) => reference.id !== referenceId));
  };

  const generateCloneBatch = async () => {
    if (!analysis || !previewUrl) {
      setNotice({ tone: 'error', text: 'Hãy nhập playable trước.' });
      return;
    }

    setBusy('generate');
    setNotice({
      tone: 'busy',
      text: `Đang chụp khung hình và tạo ${settings.variantCount} biến thể clone${referenceImages.length ? ` với ${referenceImages.length} input ref` : ''}...`,
    });

    try {
      const frameSize = settings.orientation === 'landscape' ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
      const captured = await capturePlayableFrame(iframeRef.current, frameSize.width, frameSize.height);
      const hotspot = await detectImageHotspot(captured.dataUrl).catch(() => defaultHotspot());
      const layout = sourceLayout || (await inspectSourcePreview(!settings.prompt.trim()).catch(() => null));
      const shouldUseVisionPlan = captured.sourceKind === 'video' || !layout || (!layout.buttons.length && !layout.texts.length);
      const visionPlan = shouldUseVisionPlan
        ? await analyzeCloneSourcePlan({
            imageDataUrl: captured.dataUrl,
            hotspot,
            sourceKind: captured.sourceKind,
          }).catch(() => null)
        : null;
      const cloneInference = inferPlayableClonePlan({
        html: analysis.documentHtml,
        assets: analysis.assets,
        hotspot,
        prompt: localizedPrompt,
        layout,
        sourceKind: captured.sourceKind,
        visionPlan,
      });
      const requestPrompt = buildPlayableClonePrompt({
        userPrompt: localizedPrompt,
        inference: cloneInference,
        orientation: settings.orientation,
      });
      const response = await fetch('/api/ai/generate-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: settings.aiProvider,
          model: aiProviderModelMap[settings.aiProvider],
          imageDataUrl: captured.dataUrl,
          referenceImageDataUrls: referenceImages.map((reference) => reference.dataUrl),
          prompt: requestPrompt,
          count: clampInteger(settings.variantCount, 1, 8),
          aspectRatio: settings.orientation === 'landscape' ? '16:9' : '9:16',
          referenceMode: 'playable-import',
        }),
      });
      const payload = (await response.json()) as { variants?: AiVariantResponseItem[]; error?: string };
      if (!response.ok || !payload.variants?.length) {
        throw new Error(payload.error || 'AI không trả về clone variants.');
      }

      const sourceId = uid();
      const referenceSource: SourceItem = {
        id: sourceId,
        name: `${safeFileName(analysis.name.replace(/\.html?$/i, ''))}_reference.jpg`,
        kind: 'image',
        status: 'ready',
        dataUrl: captured.dataUrl,
        width: captured.width,
        height: captured.height,
        hotspot,
        createdAt: Date.now(),
      };
      const layerBase = layerFromPlayablePlan(cloneInference.plan, localizedPrompt);
      const nextVariants = await Promise.all(
        payload.variants.map(async (item, index) => {
          const dimensions = await getImageDimensions(item.dataUrl);
          return {
            id: uid(),
            sourceId: referenceSource.id,
            index: index + 1,
            name: item.name || `${safeFileName(settings.name)}_${index + 1}.jpg`,
            dataUrl: item.dataUrl,
            width: dimensions.width,
            height: dimensions.height,
            revisedPrompt: item.revisedPrompt || '',
            hotspot,
            plan: cloneInference.plan,
            settings: { ...layerBase },
          } satisfies PlayableVariant;
        }),
      );

      setSourceCapture(referenceSource);
      setSourceLayout(layout);
      setInference(cloneInference);
      setVariants(nextVariants);
      setSelectedVariantId(nextVariants[0]?.id || '');
      setNotice({ tone: 'ok', text: `Đã tạo ${nextVariants.length} bản xem trước playable clone.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Táº¡o clone tháº¥t báº¡i.' });
    } finally {
      setBusy('');
    }
  };

  const exportCloneVariantHtml = async (variant: PlayableVariant, network: NetworkTarget) => {
    const handDataUrl = variant.settings.injectHand ? await getHandDataUrl(variant.settings.handId, handDataUrlCache.current) : undefined;
    return generateImagePlayableHtml({
      image: {
        name: variant.name,
        dataUrl: variant.dataUrl,
        width: variant.width,
        height: variant.height,
      },
      layer: variant.settings,
      store: storeConfig,
      network,
      useClickTag: settings.useClickTag,
      handDataUrl,
      orientation: settings.orientation,
      imageFit: settings.imageFit,
    });
  };

  const exportSelectedNetworks = async () => {
    if (!selectedVariant) {
      setNotice({ tone: 'error', text: 'Chọn một biến thể trước khi xuất.' });
      return;
    }

    setBusy('export');
    setNotice({ tone: 'busy', text: 'Đang đóng gói 5 network cho biến thể đang chọn...' });

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const safeName = safeFileName(selectedVariant.name);
      for (const network of networkExportTargets) {
        const html = await exportCloneVariantHtml(selectedVariant, network);
        zip.file(`${safeName}_${network}.html`, html);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(`${safeName}_5_networks.zip`, blob, 'application/zip');
      setNotice({ tone: 'ok', text: `Đã xuất 5 network cho ${selectedVariant.name}.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Xuáº¥t 5 network tháº¥t báº¡i.' });
    } finally {
      setBusy('');
    }
  };

  const exportCloneBatchZip = async () => {
    if (!variants.length) {
      setNotice({ tone: 'error', text: 'Chưa có clone variants để xuất.' });
      return;
    }

    setBusy('zip');
    setNotice({ tone: 'busy', text: 'Đang đóng gói toàn bộ clone variants...' });

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const variant of variants) {
        const safeName = safeFileName(variant.name);
        const folder = zip.folder(safeName) || zip;
        for (const network of networkExportTargets) {
          const html = await exportCloneVariantHtml(variant, network);
          folder.file(`${safeName}_${network}.html`, html);
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(`${safeFileName(settings.name)}_${variants.length}_clone_playables_5_networks.zip`, blob, 'application/zip');
      setNotice({ tone: 'ok', text: `Đã xuất ZIP ${variants.length} playable clone.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Xuáº¥t ZIP clone tháº¥t báº¡i.' });
    } finally {
      setBusy('');
    }
  };

  const openInStudio = () => {
    if (!sourceCapture || !variants.length) {
      setNotice({ tone: 'error', text: 'Cần tạo biến thể trước.' });
      return;
    }

    setBusy('handoff');
    try {
      const payload: StudioCloneImportPayload = {
        appId,
        importedAt: Date.now(),
        settings: normalizeProjectSettings({
          ...settings,
          name: settings.name.trim() || `${safeFileName(analysis?.name || 'Playable')} clone`,
          prompt: settings.prompt.trim() || createPlayableClonePromptSeed(inference || undefined),
        }),
        source: sourceCapture,
        referenceImages,
        variants: variants.map((variant, index) => ({
          ...variant,
          sourceId: sourceCapture.id,
          index: index + 1,
        })),
      };
      window.sessionStorage.setItem(`playable-clone-import:${appId}`, JSON.stringify(payload));
      window.location.href = routeFor(`/apps/${appId}`);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Không chuyển được sang Studio.' });
      setBusy('');
    }
  };

  return (
    <main className="studio-shell clone-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <FileCode2 size={20} />
          </div>
          <div>
            <strong>Tái tạo playable</strong>
            <span>Clone từ HTML nguồn</span>
          </div>
        </div>

        <section className="sidebar-section workspace-scope-section">
          <div className="editor-sidebar-actions">
            <Link href={routeFor('/')} className="secondary-button">
              <ArrowLeft size={15} />
              Home
            </Link>
            <Link href={routeFor(`/apps/${appId}`)} className="secondary-button">
              <WandSparkles size={15} />
              Mở editor
            </Link>
            <button className="primary-button editor-primary-action" type="button" onClick={resetCloneWorkspace}>
              <RefreshCw size={15} />
              Phiên mới
            </button>
          </div>
          <div className="workspace-scope-card editor-context-card">
            <div className="editor-context-head">
              <div>
                <strong>{settings.name || 'Bản clone playable'}</strong>
                <small>{analysis ? analysis.name : 'Chưa nhập playable nguồn'}</small>
              </div>
              <span className={`workspace-scope-status ${analysis ? 'saved' : 'idle'}`}>
                {analysis ? 'Đã phân tích' : 'Chờ HTML'}
              </span>
            </div>
            <div className="editor-context-chips">
              <span className="editor-context-chip">{cloneSourceLabel}</span>
              <span className="editor-context-chip soft">{variants.length ? `${variants.length} biến thể` : 'Chưa có biến thể'}</span>
              <span className="editor-context-chip soft">{networkLabels[settings.network]}</span>
            </div>
          </div>
        </section>

        <button className="upload-zone" type="button" onClick={() => fileInputRef.current?.click()}>
          <Upload size={22} />
          <strong>Nhập playable</strong>
          <span>HTML, HTM</span>
        </button>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept=".html,.htm"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) analyzeFile(file);
          }}
        />
        <button className="upload-zone" type="button" onClick={() => referenceInputRef.current?.click()}>
          <Upload size={22} />
          <strong>Input ref</strong>
          <span>PNG, JPG, WEBP</span>
        </button>
        <input
          ref={referenceInputRef}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          multiple
          onChange={(event) => {
            void importReferenceImages(event.target.files);
          }}
        />

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
            <div className="empty-note">Chưa có input ref.</div>
          )}
        </section>

        <section className="sidebar-section">
          <div className="section-head">
            <span>Cài đặt</span>
            <b>{settings.variantCount}</b>
          </div>
          <label className="field">
            <span>Tên project</span>
            <input value={settings.name} onChange={(event) => setProjectSetting('name', event.target.value)} />
          </label>
          <label className="field">
            <span>Mô tả</span>
            <textarea
              rows={8}
              value={settings.prompt}
              onChange={(event) => setProjectSetting('prompt', event.target.value)}
              placeholder="Mô tả creative mới. Ý đồ của playable nguồn và logic overlay sẽ được giữ và tách xử lý riêng."
            />
          </label>
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
          <div className="field-grid two">
            <label className="field">
              <span>Mô hình AI</span>
              <select value={settings.aiProvider} onChange={(event) => setProjectSetting('aiProvider', event.target.value as ProjectSettings['aiProvider'])}>
                <option value="gemini-flash">Gemini 3.1 Flash Image</option>
                <option value="gemini-pro">Gemini 3 Pro Image</option>
                <option value="openai">OpenAI GPT Image</option>
              </select>
            </label>
            <label className="field">
              <span>Số lượng</span>
              <input
                type="number"
                min={1}
                max={8}
                value={settings.variantCount}
                onChange={(event) => setProjectSetting('variantCount', clampInteger(Number(event.target.value), 1, 8))}
              />
            </label>
          </div>
          <div className="field-grid two">
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
          <div className="field-grid two">
            <label className="field">
              <span>Điều hướng store</span>
              <select
                value={settings.storeRoutingMode}
                onChange={(event) => setProjectSetting('storeRoutingMode', event.target.value as ProjectSettings['storeRoutingMode'])}
              >
                <option value="single">Một liên kết</option>
                <option value="platform-auto">Tự chọn theo thiết bị</option>
              </select>
            </label>
            <label className="field">
              <span>Đích ưu tiên</span>
              <select
                value={settings.storePlatform}
                onChange={(event) => setProjectSetting('storePlatform', event.target.value as ProjectSettings['storePlatform'])}
              >
                <option value="app-store">App Store</option>
                <option value="google-play">Google Play</option>
                <option value="custom">Liên kết tùy chỉnh</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>App Store URL</span>
            <input value={settings.appStoreUrl} onChange={(event) => setProjectSetting('appStoreUrl', event.target.value)} placeholder="https://apps.apple.com/app/..." />
          </label>
          <label className="field">
            <span>Google Play URL</span>
            <input
              value={settings.googlePlayUrl}
              onChange={(event) => setProjectSetting('googlePlayUrl', event.target.value)}
              placeholder="https://play.google.com/store/apps/details?id=..."
            />
          </label>
          <label className="field">
            <span>Liên kết tùy chỉnh</span>
            <input value={settings.storeUrl} onChange={(event) => setProjectSetting('storeUrl', event.target.value)} placeholder="https://example.com/landing" />
          </label>
        </section>

        <section className="sidebar-section">
          <div className="section-head">
            <span>Thao tác</span>
            <b>{variants.length ? `${variants.length * networkExportTargets.length}` : '0'}</b>
          </div>
          <div className="action-grid clone-action-grid">
            <button className="primary-button" type="button" onClick={generateCloneBatch} disabled={!analysis || Boolean(busy)}>
              {busy === 'generate' ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}
              Tạo batch clone
            </button>
            <button className="secondary-button" type="button" onClick={exportSelectedNetworks} disabled={!selectedVariant || Boolean(busy)}>
              {busy === 'export' ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
              Xuất 5 network
            </button>
            <button className="secondary-button" type="button" onClick={exportCloneBatchZip} disabled={!variants.length || Boolean(busy)}>
              {busy === 'zip' ? <Loader2 className="spin" size={16} /> : <Package size={16} />}
              {`ZIP x${Math.max(variants.length, 1) * networkExportTargets.length}`}
            </button>
            <button className="secondary-button" type="button" onClick={openInStudio} disabled={!variants.length || Boolean(busy)}>
              <ExternalLink size={16} />
              Mở trong Studio
            </button>
          </div>
        </section>
        {selectedVariant ? (
          <section className="sidebar-section">
            <div className="section-head">
              <span>Chỉnh layer</span>
              <b>{syncLayerEdits ? 'all' : 'one'}</b>
            </div>
            <label className="clone-checkbox-row">
              <input type="checkbox" checked={syncLayerEdits} onChange={(event) => setSyncLayerEdits(event.target.checked)} />
              <span>Áp dụng chỉnh layer cho tất cả biến thể</span>
            </label>
            <div className="clone-toggle-grid">
              <label className="clone-checkbox-row">
                <input type="checkbox" checked={selectedVariant.settings.injectHand} onChange={(event) => updateVariantLayers({ injectHand: event.target.checked })} />
                <span>Hand</span>
              </label>
              <label className="clone-checkbox-row">
                <input type="checkbox" checked={selectedVariant.settings.injectScan} onChange={(event) => updateVariantLayers({ injectScan: event.target.checked })} />
                <span>Scan</span>
              </label>
              <label className="clone-checkbox-row">
                <input type="checkbox" checked={selectedVariant.settings.showCue} onChange={(event) => updateVariantLayers({ showCue: event.target.checked })} />
                <span>Chữ nhắc</span>
              </label>
              <label className="clone-checkbox-row">
                <input type="checkbox" checked={selectedVariant.settings.showCta} onChange={(event) => updateVariantLayers({ showCta: event.target.checked })} />
                <span>CTA</span>
              </label>
            </div>
            <label className="field">
              <span>Chữ nhắc</span>
              <input value={selectedVariant.settings.cueText} onChange={(event) => updateVariantLayers({ cueText: event.target.value })} />
            </label>
            <label className="field">
              <span>Nội dung CTA</span>
              <input value={selectedVariant.settings.ctaText} onChange={(event) => updateVariantLayers({ ctaText: event.target.value })} />
            </label>
            <div className="field-grid two">
              <label className="field">
                <span>Chuyển động tay</span>
                <select value={selectedVariant.settings.handMotion} onChange={(event) => updateVariantLayers({ handMotion: event.target.value as LayerSettings['handMotion'] })}>
                  {handMotionValues.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Kiểu scan</span>
                <select value={selectedVariant.settings.scanStyle} onChange={(event) => updateVariantLayers({ scanStyle: event.target.value as LayerSettings['scanStyle'] })}>
                  {scanStyleValues.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="field-grid two">
              <label className="field">
                <span>Hiệu ứng CTA</span>
                <select value={selectedVariant.settings.buttonAnimation} onChange={(event) => updateVariantLayers({ buttonAnimation: event.target.value as LayerSettings['buttonAnimation'] })}>
                  {buttonAnimationValues.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Hiệu ứng chữ nhắc</span>
                <select value={selectedVariant.settings.cueAnimation} onChange={(event) => updateVariantLayers({ cueAnimation: event.target.value as LayerSettings['cueAnimation'] })}>
                  {textCueAnimationValues.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="field-grid two">
              <label className="field">
                <span>Hand X</span>
                <input type="number" min={0} max={100} value={selectedVariant.settings.handX} onChange={(event) => updateVariantLayers({ handX: clampInteger(Number(event.target.value), 0, 100) })} />
              </label>
              <label className="field">
                <span>Hand Y</span>
                <input type="number" min={0} max={100} value={selectedVariant.settings.handY} onChange={(event) => updateVariantLayers({ handY: clampInteger(Number(event.target.value), 0, 100) })} />
              </label>
            </div>
            <div className="field-grid two">
              <label className="field">
                <span>Scan X</span>
                <input type="number" min={0} max={100} value={selectedVariant.settings.scanX} onChange={(event) => updateVariantLayers({ scanX: clampInteger(Number(event.target.value), 0, 100) })} />
              </label>
              <label className="field">
                <span>Scan Y</span>
                <input type="number" min={0} max={100} value={selectedVariant.settings.scanY} onChange={(event) => updateVariantLayers({ scanY: clampInteger(Number(event.target.value), 0, 100) })} />
              </label>
            </div>
            <div className="field-grid two">
              <label className="field">
                <span>CTA X</span>
                <input type="number" min={0} max={100} value={selectedVariant.settings.ctaX} onChange={(event) => updateVariantLayers({ ctaX: clampInteger(Number(event.target.value), 0, 100) })} />
              </label>
              <label className="field">
                <span>CTA Y</span>
                <input type="number" min={0} max={100} value={selectedVariant.settings.ctaY} onChange={(event) => updateVariantLayers({ ctaY: clampInteger(Number(event.target.value), 0, 100) })} />
              </label>
            </div>
            <div className="field-grid two">
              <label className="field">
                <span>Cue X</span>
                <input type="number" min={0} max={100} value={selectedVariant.settings.cueX} onChange={(event) => updateVariantLayers({ cueX: clampInteger(Number(event.target.value), 0, 100) })} />
              </label>
              <label className="field">
                <span>Cue Y</span>
                <input type="number" min={0} max={100} value={selectedVariant.settings.cueY} onChange={(event) => updateVariantLayers({ cueY: clampInteger(Number(event.target.value), 0, 100) })} />
              </label>
            </div>
            <div className="field-grid two">
              <label className="field">
                <span>Kích thước tay</span>
                <input type="number" min={48} max={220} value={selectedVariant.settings.handSize} onChange={(event) => updateVariantLayers({ handSize: clampInteger(Number(event.target.value), 48, 220) })} />
              </label>
              <label className="field">
                <span>Kích thước scan</span>
                <input type="number" min={64} max={320} value={selectedVariant.settings.scanSize} onChange={(event) => updateVariantLayers({ scanSize: clampInteger(Number(event.target.value), 64, 320) })} />
              </label>
            </div>
            <div className="clone-mini-actions">
              <button className="secondary-button slim" type="button" onClick={resetVariantLayersFromInference} disabled={!inference}>
                Khôi phục theo plan nguồn
              </button>
            </div>
          </section>
        ) : null}
      </aside>

      <section className="workspace">
        <div className="workspace-top">
          <div className="workspace-top-main">
            <span className="eyebrow">Clone</span>
            <h1>{settings.name || 'Bản clone playable'}</h1>
            <div className="workspace-summary-strip">
              <span className="workspace-summary-pill">{cloneSourceLabel}</span>
              <span className="workspace-summary-pill soft">{networkLabels[settings.network]}</span>
              <span className="workspace-summary-pill soft">{variants.length ? `${variants.length} biến thể` : 'Chưa có biến thể'}</span>
            </div>
          </div>
        </div>

        <div className="notice-row">{notice ? <NoticeBanner notice={notice} /> : null}</div>

        <section className="clone-panels">
          <article className="preview-card clone-source-card">
            <div className="preview-card-head">
              <span>Playable nguồn</span>
              <b>{analysis?.convertedFromWrapper ? 'Đã xử lý wrapper' : 'HTML trực tiếp'}</b>
            </div>
            <div className="clone-source-frame">
              {previewUrl ? (
                <iframe
                  ref={iframeRef}
                  className="clone-preview-iframe"
                  src={previewUrl}
                  title="Xem trước playable nguồn"
                  onLoad={() => {
                    void inspectSourcePreview(true).catch(() => null);
                  }}
                />
              ) : (
                <EmptyState text="Nhập playable HTML để xem trước tại đây." />
              )}
            </div>
          </article>

          <section className={`preview-grid ${settings.orientation === 'landscape' ? 'orientation-landscape' : ''}`}>
            {variants.length ? (
              variants.map((variant) => (
                <article
                  key={variant.id}
                  className={`preview-card clone-variant-card ${selectedVariant?.id === variant.id ? 'selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedVariantId(variant.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedVariantId(variant.id);
                    }
                  }}
                >
                  <div className="preview-card-head">
                    <span>{`Biến thể ${variant.index}`}</span>
                    <b>{Math.round((variant.plan?.confidence || 0.72) * 100)}%</b>
                  </div>
                  <div className="clone-card-stage">
                    {previewVariants[variant.id] ? (
                      <iframe className="clone-preview-iframe" src={previewVariants[variant.id]} title={variant.name} />
                    ) : (
                      <EmptyState text="Đang chuẩn bị xem trước..." />
                    )}
                  </div>
                  <div className="clone-card-foot">
                    <strong>{variant.plan ? playableIntentLabels[variant.plan.intent] : 'Bản clone'}</strong>
                    <small>{variant.settings.cueText || variant.settings.ctaText}</small>
                  </div>
                </article>
              ))
            ) : (
              <div className="clone-grid-empty">
                <EmptyState text="Tạo các biến thể clone để xem trước animation fake playable đã dựng lại." />
              </div>
            )}
          </section>
        </section>
      </section>

      <aside className="inspector clone-inspector">
        <div className="inspector-head">
          <div>
            <span className="eyebrow">Phân tích</span>
            <h2>{selectedVariant ? `Biến thể ${selectedVariant.index}` : 'Phân tích nguồn'}</h2>
          </div>
        </div>

        <section className="sidebar-section">
          <div className="section-head">
            <span>Kiểm tra nguồn</span>
            <b>{analysis?.assets.length || 0}</b>
          </div>
          <div className="clone-detail-list">
            <div>
              <strong>Sẵn sàng cho AppLovin</strong>
              <small>{analysis ? (analysis.audit.appLovinReady ? 'Có' : 'Cần kiểm tra') : '—'}</small>
            </div>
            <div>
              <strong>Tài nguyên nhúng</strong>
              <small>{analysis?.audit.embeddedAssetCount || 0}</small>
            </div>
            <div>
              <strong>Size</strong>
              <small>{analysis ? `${analysis.audit.sizeMiB} MiB` : '—'}</small>
            </div>
            <div>
              <strong>Tham chiếu ngoài</strong>
              <small>{analysis?.audit.externalRefCount || 0}</small>
            </div>
          </div>
        </section>

        <section className="sidebar-section">
          <div className="section-head">
            <span>Chuyển động nhận diện</span>
            <b>{inference ? inference.animationHints.length : 0}</b>
          </div>
          {inference ? (
            <div className="clone-summary-stack">
              <div className="clone-summary-chip">{inference.analysisMode}</div>
              <div className="clone-summary-chip">Nguồn: {inference.sourceKind}</div>
              <div className="clone-summary-chip">{inference.plan.intent.replace(/_/g, ' ')}</div>
              <div className="clone-summary-chip">Tay: {inference.plan.handMotion}</div>
              <div className="clone-summary-chip">Scan: {inference.plan.scanStyle}</div>
              <div className="clone-summary-chip">CTA: {inference.plan.cta.text}</div>
              <div className="clone-summary-chip">Nhắc: {inference.plan.cue.text}</div>
              {inference.animationHints.map((hint) => (
                <div key={hint} className="clone-summary-chip soft">
                  {hint}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-note">Hãy tạo trước để xem plan clone được suy ra.</div>
          )}
        </section>

        <section className="sidebar-section">
          <div className="section-head">
            <span>Tóm tắt nội dung</span>
            <b>{inference?.summary.length || 0}</b>
          </div>
          <div className="clone-summary-list">
            {(inference?.summary || []).map((item) => (
              <div key={item} className="clone-summary-row">
                {item}
              </div>
            ))}
            {!inference?.summary.length ? <div className="empty-note">Chưa có tóm tắt.</div> : null}
          </div>
        </section>
      </aside>
    </main>
  );
}

function NoticeBanner({ notice }: { notice: Exclude<Notice, null> }) {
  const Icon = notice.tone === 'ok' ? CheckCircle2 : notice.tone === 'error' ? AlertCircle : Loader2;
  return (
    <div className={`notice ${notice.tone}`}>
      <Icon className={notice.tone === 'busy' ? 'spin' : ''} size={16} />
      <span>{notice.text}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="clone-empty-state">
      <FileCode2 size={18} />
      <span>{text}</span>
    </div>
  );
}

async function getHandDataUrl(handId: string, cache: Map<string, string>) {
  const cached = cache.get(handId);
  if (cached) return cached;
  const dataUrl = await loadAssetAsDataUrl(getHandAsset(handId).src);
  cache.set(handId, dataUrl);
  return dataUrl;
}

function injectClonePreviewBridge(html: string) {
  const script = `<script id="playable-clone-preview-bridge">
(function(){
  function visible(node){
    if(!node||!node.getBoundingClientRect)return false;
    var rect=node.getBoundingClientRect(),style=getComputedStyle(node);
    return rect.width>8&&rect.height>8&&style.display!=="none"&&style.visibility!=="hidden"&&Number(style.opacity)!==0;
  }
  function elementText(node){
    return String((node&&node.innerText)||node&&node.textContent||"").replace(/\\s+/g," ").trim();
  }
  function layoutItem(node){
    if(!visible(node)) return null;
    var text=elementText(node);
    if(!text||text.length<2||text.length>64) return null;
    var rect=node.getBoundingClientRect();
    var vw=Math.max(window.innerWidth||1,1),vh=Math.max(window.innerHeight||1,1);
    return {
      text:text,
      x:Math.max(0,Math.min(100,(rect.left/vw)*100)),
      y:Math.max(0,Math.min(100,(rect.top/vh)*100)),
      width:Math.max(0,Math.min(100,(rect.width/vw)*100)),
      height:Math.max(0,Math.min(100,(rect.height/vh)*100)),
      tag:String(node.tagName||"div").toLowerCase(),
      className:String(node.className||"")
    };
  }
  function inspectLayout(requestId){
    try{
      var buttons=[],texts=[];
      var buttonNodes=document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],.cta,.btn');
      for(var i=0;i<buttonNodes.length;i++){
        var item=layoutItem(buttonNodes[i]);
        if(item) buttons.push(item);
      }
      var textNodes=document.querySelectorAll('h1,h2,h3,h4,p,span,strong,b,small,div');
      for(var j=0;j<textNodes.length;j++){
        var textItem=layoutItem(textNodes[j]);
        if(!textItem) continue;
        if(buttons.some(function(button){ return button.text===textItem.text; })) continue;
        texts.push(textItem);
      }
      window.parent.postMessage({type:"playable-clone-layout-result",requestId:requestId,layout:{buttons:buttons.slice(0,24),texts:texts.slice(0,48)}},"*");
    }catch(error){
      window.parent.postMessage({type:"playable-clone-layout-result",requestId:requestId,error:error&&error.message||String(error)},"*");
    }
  }
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
      window.parent.postMessage({type:"playable-clone-capture-result",requestId:requestId,dataUrl:canvas.toDataURL("image/jpeg",.9),sourceKind:sourceKind,width:width,height:height},"*");
    }catch(error){
      window.parent.postMessage({type:"playable-clone-capture-result",requestId:requestId,error:error&&error.message||String(error)},"*");
    }
  }
  addEventListener("message",function(event){
    if(event.data&&event.data.type==="playable-clone-capture"){
      captureFrame(event.data.requestId,event.data.targetWidth,event.data.targetHeight);
    }
    if(event.data&&event.data.type==="playable-clone-layout"){
      inspectLayout(event.data.requestId);
    }
  });
})();
</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}</body>`) : `${html}${script}`;
}

function inspectPlayableLayout(iframe: HTMLIFrameElement | null) {
  return new Promise<PlayableCloneLayoutSnapshot>((resolve, reject) => {
    const win = iframe?.contentWindow;
    if (!win) {
      reject(new Error('Preview frame is not ready.'));
      return;
    }

    const requestId = uid();
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Layout inspect timed out.'));
    }, 6000);

    function onMessage(event: MessageEvent) {
      if (event.source !== win || event.data?.type !== 'playable-clone-layout-result' || event.data?.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (event.data.error) {
        reject(new Error(String(event.data.error)));
        return;
      }
      resolve({
        buttons: Array.isArray(event.data.layout?.buttons) ? event.data.layout.buttons : [],
        texts: Array.isArray(event.data.layout?.texts) ? event.data.layout.texts : [],
      });
    }

    window.addEventListener('message', onMessage);
    win.postMessage({ type: 'playable-clone-layout', requestId }, '*');
  });
}

function capturePlayableFrame(iframe: HTMLIFrameElement | null, targetWidth: number, targetHeight: number) {
  return new Promise<CaptureResult>((resolve, reject) => {
    const win = iframe?.contentWindow;
    if (!win) {
      reject(new Error('Preview chưa sẵn sàng để capture.'));
      return;
    }

    const requestId = uid();
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Capture playable quá thời gian.'));
    }, 8000);

    function onMessage(event: MessageEvent) {
      if (event.source !== win || event.data?.type !== 'playable-clone-capture-result' || event.data?.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (event.data.error) {
        reject(new Error(String(event.data.error)));
        return;
      }
      resolve({
        dataUrl: String(event.data.dataUrl),
        width: Number(event.data.width || targetWidth),
        height: Number(event.data.height || targetHeight),
        sourceKind: String(event.data.sourceKind || 'preview'),
      });
    }

    window.addEventListener('message', onMessage);
    win.postMessage({ type: 'playable-clone-capture', requestId, targetWidth, targetHeight }, '*');
  });
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.round(Math.min(max, Math.max(min, value)));
}

function applyLayerPatchToPlan(plan: PlayableVariant['plan'], partial: Partial<LayerSettings>) {
  if (!plan) return plan;
  return {
    ...plan,
    handMotion: partial.handMotion ?? plan.handMotion,
    scanStyle: partial.scanStyle ?? plan.scanStyle,
    cta: {
      ...plan.cta,
      text: partial.ctaText ?? plan.cta.text,
      x: partial.ctaX ?? plan.cta.x,
      y: partial.ctaY ?? plan.cta.y,
      animation: partial.buttonAnimation ?? plan.cta.animation,
    },
    cue: {
      ...plan.cue,
      text: partial.cueText ?? plan.cue.text,
      x: partial.cueX ?? plan.cue.x,
      y: partial.cueY ?? plan.cue.y,
      animation: partial.cueAnimation ?? plan.cue.animation,
    },
  };
}

function uid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultHotspot(): Hotspot {
  return { x: 50, y: 58, confidence: 0.42, reason: 'clone default' };
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



