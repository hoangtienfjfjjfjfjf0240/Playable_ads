'use client';

import {
  AlertCircle,
  ArrowLeft,
  Box,
  CheckCircle2,
  Code2,
  Download,
  FileCode2,
  Film,
  ImageIcon,
  Layers3,
  Loader2,
  RefreshCw,
  Sparkles,
  Upload,
  WandSparkles,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getImageDimensions, readFileAsDataUrl } from '../lib/image-utils';
import type {
  PlayableAudit,
  PlayableLayerAsset,
  PlayableLayerEditability,
  PlayableLayerRole,
} from '../lib/playable-layers';
import { withStudioRoutePrefix } from '../lib/studio-routes';
import type { AiVariantResponseItem } from '../lib/types';

type AnalysisResult = {
  name: string;
  documentHtml: string;
  convertedFromWrapper: boolean;
  assets: PlayableLayerAsset[];
  audit: PlayableAudit;
};

type Notice = { tone: 'ok' | 'warn' | 'error' | 'busy'; text: string } | null;
type RemakeAnimation = 'auto' | 'tap' | 'scan' | 'swipe' | 'pulse' | 'none';
type RemakeVariant = AiVariantResponseItem & { width: number; height: number };
type PreviewMode = 'live' | 'select';

const roleOrder: PlayableLayerRole[] = [
  'background',
  'product',
  'ui',
  'text-logo',
  'cta',
  'tutorial',
  'effect',
  'atlas',
  'video',
  'audio',
  'font',
  'unknown',
];

const roleLabels: Record<PlayableLayerRole, string> = {
  background: 'Background',
  product: 'Product / Object',
  ui: 'UI',
  'text-logo': 'Text / Logo',
  cta: 'CTA / Button',
  tutorial: 'Tutorial',
  effect: 'Effect',
  atlas: 'Atlas',
  video: 'Video',
  audio: 'Audio',
  font: 'Font',
  unknown: 'Other assets',
};

const editabilityLabels: Record<PlayableLayerEditability, string> = {
  direct: 'Direct replace',
  'atlas-sheet': 'Whole atlas',
  'whole-media': 'Whole media',
  'code-bound': 'Code-bound',
};

const remakeAnimationLabels: Record<RemakeAnimation, string> = {
  auto: 'Auto from prompt',
  tap: 'Tap cue',
  scan: 'Scan sweep',
  swipe: 'Swipe motion',
  pulse: 'CTA pulse',
  none: 'No overlay',
};

export function PlayableLayerEditor() {
  const inputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pathname = usePathname();
  const homeHref = withStudioRoutePrefix(pathname, '/');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState('');
  const [prompt, setPrompt] = useState('');
  const [aiVariants, setAiVariants] = useState<AiVariantResponseItem[]>([]);
  const [remakeVariants, setRemakeVariants] = useState<RemakeVariant[]>([]);
  const [remakeImage, setRemakeImage] = useState('');
  const [remakeTargetSize, setRemakeTargetSize] = useState(916);
  const [remakeAnimation, setRemakeAnimation] = useState<RemakeAnimation>('auto');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('live');
  const [busy, setBusy] = useState<'analyze' | 'ai' | 'remake' | 'pack' | ''>('');
  const [notice, setNotice] = useState<Notice>(null);

  const selectedAsset = useMemo(
    () => analysis?.assets.find((asset) => asset.id === selectedId) || analysis?.assets[0] || null,
    [analysis, selectedId],
  );

  const groupedAssets = useMemo(() => {
    if (!analysis) return [];
    return roleOrder
      .map((role) => ({
        role,
        assets: analysis.assets.filter((asset) => asset.role === role),
      }))
      .filter((group) => group.assets.length);
  }, [analysis]);

  const editedHtml = useMemo(() => {
    if (!analysis) return '';
    let html = analysis.documentHtml;
    for (const asset of analysis.assets) {
      const replacement = replacements[asset.hash];
      if (replacement) html = html.split(asset.dataUrl).join(replacement);
    }
    html = injectAiRemakeLayer(html, remakeImage, getEffectiveRemakeAnimation(remakeAnimation, prompt));
    return injectLayerSelectionBridge(html);
  }, [analysis, prompt, remakeAnimation, remakeImage, replacements]);

  useEffect(() => {
    if (!editedHtml) {
      setPreviewUrl('');
      return;
    }
    const nextUrl = URL.createObjectURL(new Blob([editedHtml], { type: 'text/html' }));
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [editedHtml]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.data?.type !== 'playable-layer-select') {
        return;
      }
      const source = String(event.data.source || '');
      const match = analysis?.assets.find(
        (asset) =>
          normalizeDataUrl(source) === normalizeDataUrl(asset.dataUrl) ||
          normalizeDataUrl(source) === normalizeDataUrl(replacements[asset.hash] || ''),
      );
      if (match) setSelectedId(match.id);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [analysis, replacements]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: 'playable-layer-highlight',
          source: selectedAsset ? replacements[selectedAsset.hash] || selectedAsset.dataUrl : '',
          selectMode: previewMode === 'select',
        },
        '*',
      );
    }, 50);
    return () => window.clearTimeout(timeout);
  }, [previewMode, previewUrl, replacements, selectedAsset]);

  async function analyzeFile(file: File) {
    setBusy('analyze');
    setNotice({ tone: 'busy', text: 'Đang phân tích playable...' });
    setAiVariants([]);
    setRemakeVariants([]);
    setRemakeImage('');
    setRemakeTargetSize(916);
    setPreviewMode('live');
    setReplacements({});
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/playables/analyze', { method: 'POST', body: form });
      const payload = (await response.json()) as AnalysisResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Không phân tích được playable.');
      setAnalysis(payload);
      const firstVisibleAsset = [...payload.assets].sort(
        (left, right) =>
          roleOrder.indexOf(left.role) - roleOrder.indexOf(right.role) || right.bytes - left.bytes,
      )[0];
      setSelectedId(firstVisibleAsset?.id || '');
      setNotice({
        tone: payload.audit.appLovinReady ? 'ok' : 'warn',
        text: `${payload.assets.length} assets · ${payload.audit.sizeMiB} MiB${
          payload.convertedFromWrapper ? ' · wrapper converted' : ''
        }`,
      });
    } catch (error) {
      setAnalysis(null);
      setNotice({ tone: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy('');
    }
  }

  async function replaceSelected(file: File) {
    if (!selectedAsset) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setReplacements((current) => ({ ...current, [selectedAsset.hash]: dataUrl }));
      setAiVariants([]);
      if (selectedAsset.mime.startsWith('image/') && selectedAsset.width && selectedAsset.height) {
        const dimensions = await getImageDimensions(dataUrl);
        const changed =
          dimensions.width !== selectedAsset.width || dimensions.height !== selectedAsset.height;
        setNotice({
          tone: changed ? 'warn' : 'ok',
          text: changed
            ? `Đã thay ${selectedAsset.name} · kích thước mới ${dimensions.width}x${dimensions.height}`
            : `Đã thay ${selectedAsset.name}`,
        });
      } else {
        setNotice({ tone: 'ok', text: `Đã thay ${selectedAsset.name}` });
      }
    } catch (error) {
      setNotice({ tone: 'error', text: getErrorMessage(error) });
    }
  }

  async function generateLayerVariants() {
    if (!selectedAsset || !selectedAsset.mime.startsWith('image/')) return;
    setBusy('ai');
    setNotice({ tone: 'busy', text: 'AI đang tạo 4 lựa chọn...' });
    setAiVariants([]);
    try {
      const response = await fetch('/api/ai/generate-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'gemini-flash',
          imageDataUrl: replacements[selectedAsset.hash] || selectedAsset.dataUrl,
          prompt: [
            `Create a replacement asset for the layer "${selectedAsset.name}".`,
            `Semantic role: ${roleLabels[selectedAsset.role]}.`,
            selectedAsset.width && selectedAsset.height
              ? `Preserve the exact composition ratio ${selectedAsset.width}:${selectedAsset.height}.`
              : '',
            'Do not add editor UI, device frames, captions, or unrelated CTA text.',
            prompt,
          ]
            .filter(Boolean)
            .join('\n'),
          aspectRatio:
            selectedAsset.width && selectedAsset.height
              ? `${selectedAsset.width}:${selectedAsset.height}`
              : '1:1',
          count: 4,
        }),
      });
      const payload = (await response.json()) as {
        variants?: AiVariantResponseItem[];
        error?: string;
      };
      if (!response.ok || !payload.variants?.length) {
        throw new Error(payload.error || 'AI không trả về ảnh.');
      }
      setAiVariants(payload.variants);
      setNotice({ tone: 'ok', text: `${payload.variants.length} lựa chọn đã tạo` });
    } catch (error) {
      setNotice({ tone: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy('');
    }
  }

  async function generatePlayableRemake() {
    if (!analysis) return;
    const size = clampInteger(remakeTargetSize, 256, 1536);
    setRemakeTargetSize(size);
    setBusy('remake');
    setNotice({ tone: 'busy', text: `Capture preview va gen 4 anh ${size}x${size}...` });
    setRemakeVariants([]);
    try {
      const reference = await capturePlayableFrame(size);
      const response = await fetch('/api/ai/generate-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'gemini-flash',
          imageDataUrl: reference.dataUrl,
          prompt: buildPlayableRemakePrompt({
            prompt,
            size,
            animation: getEffectiveRemakeAnimation(remakeAnimation, prompt),
            sourceKind: reference.sourceKind,
          }),
          aspectRatio: '1:1',
          targetSize: size,
          count: 4,
        }),
      });
      const payload = (await response.json()) as {
        variants?: AiVariantResponseItem[];
        error?: string;
      };
      if (!response.ok || !payload.variants?.length) {
        throw new Error(payload.error || 'AI khong tra ve anh remake.');
      }

      const resized = await Promise.all(
        payload.variants.map(async (variant, index) => ({
          ...variant,
          name: variant.name || `playable_remake_${index + 1}.jpg`,
          dataUrl: await resizeImageToSquare(variant.dataUrl, size),
          width: size,
          height: size,
        })),
      );
      setRemakeVariants(resized);
      setNotice({ tone: 'ok', text: `Da gen ${resized.length} anh remake ${size}x${size}` });
    } catch (error) {
      setNotice({ tone: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy('');
    }
  }

  async function packAndDownload() {
    if (!analysis) return;
    setBusy('pack');
    setNotice({ tone: 'busy', text: 'Đang đóng gói và audit...' });
    try {
      const response = await fetch('/api/playables/pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: analysis.documentHtml,
          replacements: Object.entries(replacements).map(([hash, dataUrl]) => ({ hash, dataUrl })),
          remake: remakeImage
            ? {
                imageDataUrl: remakeImage,
                animation: getEffectiveRemakeAnimation(remakeAnimation, prompt),
              }
            : null,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || 'Không đóng gói được playable.');
      }
      const blob = await response.blob();
      const ready = response.headers.get('X-Playable-Ready') === '1';
      const sizeMiB = response.headers.get('X-Playable-Size-Mib') || '?';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeBaseName(analysis.name)}_layer_edited_applovin.html`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({
        tone: ready ? 'ok' : 'warn',
        text: `${ready ? 'AppLovin ready' : 'Cần kiểm tra lại'} · ${sizeMiB} MiB`,
      });
    } catch (error) {
      setNotice({ tone: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy('');
    }
  }

  return (
    <main className="layer-editor-shell">
      <aside className="layer-editor-sidebar">
        <div className="layer-editor-brand">
          <Link className="icon-button" href={homeHref} title="Về Animation Editor" aria-label="Về Animation Editor">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <span className="eyebrow">Separate workspace</span>
            <strong>Playable Layer Editor</strong>
          </div>
        </div>

        <button className="upload-zone" type="button" onClick={() => inputRef.current?.click()}>
          {busy === 'analyze' ? <Loader2 className="spin" size={22} /> : <Upload size={22} />}
          <strong>Import playable HTML</strong>
          <span>HTML, HTM, AppLovin wrapper</span>
        </button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept=".html,.htm,text/html"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void analyzeFile(file);
            event.currentTarget.value = '';
          }}
        />

        {analysis ? (
          <>
            <section className="layer-file-summary">
              <FileCode2 size={17} />
              <span>
                <strong>{analysis.name}</strong>
                <small>
                  {analysis.audit.engines.join(', ') || 'DOM'} · {analysis.assets.length} assets
                </small>
              </span>
            </section>

            <div className="layer-tree">
              {groupedAssets.map((group) => (
                <section className="layer-group" key={group.role}>
                  <div className="section-head">
                    <span>{roleLabels[group.role]}</span>
                    <b>{group.assets.length}</b>
                  </div>
                  {group.assets.map((asset) => (
                    <button
                      className={`layer-asset-row ${selectedAsset?.id === asset.id ? 'active' : ''}`}
                      key={asset.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(asset.id);
                        setAiVariants([]);
                      }}
                    >
                      <LayerThumbnail asset={asset} source={replacements[asset.hash] || asset.dataUrl} />
                      <span>
                        <strong>{asset.name}</strong>
                        <small>
                          {asset.width && asset.height ? `${asset.width}x${asset.height} · ` : ''}
                          {formatBytes(asset.bytes)}
                        </small>
                      </span>
                      {replacements[asset.hash] ? <span className="edited-dot" title="Đã thay" /> : null}
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </>
        ) : (
          <div className="layer-editor-empty">
            <Layers3 size={22} />
            <span>Chưa có playable</span>
          </div>
        )}
      </aside>

      <section className="layer-editor-workspace">
        <header className="layer-editor-toolbar">
          <div>
            <span className="eyebrow">Live document</span>
            <h1>{analysis ? safeBaseName(analysis.name) : 'Preview'}</h1>
          </div>
          <div className="toolbar">
            {analysis ? (
              <div className="mode-toggle" role="group" aria-label="Preview interaction mode">
                <button
                  className={previewMode === 'live' ? 'active' : ''}
                  type="button"
                  onClick={() => setPreviewMode('live')}
                >
                  Live click
                </button>
                <button
                  className={previewMode === 'select' ? 'active' : ''}
                  type="button"
                  onClick={() => setPreviewMode('select')}
                >
                  Select layer
                </button>
              </div>
            ) : null}
            {analysis ? (
              <span className={`audit-pill ${analysis.audit.appLovinReady ? 'ready' : 'warn'}`}>
                {analysis.audit.appLovinReady ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                {analysis.audit.sizeMiB} MiB
              </span>
            ) : null}
            <button
              className="secondary-button"
              type="button"
              disabled={!analysis || busy === 'pack'}
              onClick={() => {
                setReplacements({});
                setRemakeImage('');
                setRemakeVariants([]);
                setPreviewMode('live');
              }}
            >
              <RefreshCw size={16} />
              Reset
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!analysis || busy === 'pack'}
              onClick={() => void packAndDownload()}
            >
              {busy === 'pack' ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
              Export HTML
            </button>
          </div>
        </header>

        {notice ? (
          <div className={`notice ${notice.tone}`}>
            {notice.tone === 'busy' ? (
              <Loader2 className="spin" size={15} />
            ) : notice.tone === 'error' || notice.tone === 'warn' ? (
              <AlertCircle size={15} />
            ) : (
              <CheckCircle2 size={15} />
            )}
            <span>{notice.text}</span>
          </div>
        ) : null}

        <div className="layer-preview-surface">
          {previewUrl ? (
            <iframe
              ref={iframeRef}
              className="layer-preview-frame"
              title="Playable layer preview"
              src={previewUrl}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock"
              onLoad={(event) =>
                event.currentTarget.contentWindow?.postMessage(
                  {
                    type: 'playable-layer-highlight',
                    source: selectedAsset
                      ? replacements[selectedAsset.hash] || selectedAsset.dataUrl
                      : '',
                    selectMode: previewMode === 'select',
                  },
                  '*',
                )
              }
            />
          ) : (
            <div className="layer-preview-empty">
              <Code2 size={30} />
              <strong>Import HTML</strong>
            </div>
          )}
        </div>
      </section>

      <aside className="layer-editor-inspector">
        <div className="inspector-head">
          <div>
            <span className="eyebrow">Selected runtime asset</span>
            <h2>{selectedAsset?.name || 'No selection'}</h2>
          </div>
          {selectedAsset ? <span className={`edit-badge edit-${selectedAsset.editability}`}>{editabilityLabels[selectedAsset.editability]}</span> : null}
        </div>

        {analysis ? (
          <section className="panel-section compact remake-panel">
            <div className="section-title">
              <strong>AI Remake 916</strong>
              <WandSparkles size={16} />
            </div>
            <label className="field">
              <span>Playable content prompt</span>
              <textarea
                rows={4}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Vi du: thay 4 mon an khac, logo khac, giu bo cuc chon mon"
              />
            </label>
            <div className="remake-control-grid">
              <label className="field">
                <span>Size</span>
                <input
                  type="number"
                  min={256}
                  max={1536}
                  step={4}
                  value={remakeTargetSize}
                  onChange={(event) => setRemakeTargetSize(Number(event.target.value) || 916)}
                />
              </label>
              <label className="field">
                <span>Animation</span>
                <select
                  value={remakeAnimation}
                  onChange={(event) => setRemakeAnimation(event.target.value as RemakeAnimation)}
                >
                  {(Object.keys(remakeAnimationLabels) as RemakeAnimation[]).map((animation) => (
                    <option key={animation} value={animation}>
                      {remakeAnimationLabels[animation]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              className="primary-button wide"
              type="button"
              disabled={busy === 'remake'}
              onClick={() => void generatePlayableRemake()}
            >
              {busy === 'remake' ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
              Generate playable
            </button>
            {remakeImage ? (
              <button
                className="secondary-button wide"
                type="button"
                onClick={() => {
                  setRemakeImage('');
                  setPreviewMode('live');
                }}
              >
                <RefreshCw size={16} />
                Clear remake layer
              </button>
            ) : null}
            {remakeVariants.length ? (
              <div className="ai-layer-grid remake-grid">
                {remakeVariants.map((variant, index) => (
                  <button
                    type="button"
                    key={`${variant.name}-${index}`}
                    onClick={() => {
                      setRemakeImage(variant.dataUrl);
                      setPreviewMode('live');
                      setNotice({
                        tone: 'ok',
                        text: `Applied playable remake V${index + 1} - ${variant.width}x${variant.height}`,
                      });
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={variant.dataUrl} alt={`Playable remake ${index + 1}`} />
                    <span>{remakeImage === variant.dataUrl ? 'ON' : `V${index + 1}`}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {selectedAsset ? (
          <>
            <section className="selected-layer-preview">
              <LayerPreview asset={selectedAsset} source={replacements[selectedAsset.hash] || selectedAsset.dataUrl} />
            </section>

            <section className="panel-section compact">
              <div className="property-list">
                <PropertyRow label="Role" value={roleLabels[selectedAsset.role]} />
                <PropertyRow label="Source" value={selectedAsset.kinds.join(', ')} />
                <PropertyRow label="Occurrences" value={String(selectedAsset.occurrences)} />
                <PropertyRow label="MIME" value={selectedAsset.mime} />
                <PropertyRow
                  label="Dimensions"
                  value={
                    selectedAsset.width && selectedAsset.height
                      ? `${selectedAsset.width} x ${selectedAsset.height}`
                      : 'Runtime-defined'
                  }
                />
              </div>
            </section>

            <section className="panel-section compact">
              <div className="section-title">
                <strong>Replacement</strong>
                {replacements[selectedAsset.hash] ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setReplacements((current) => {
                        const next = { ...current };
                        delete next[selectedAsset.hash];
                        return next;
                      })
                    }
                  >
                    Original
                  </button>
                ) : null}
              </div>
              <label className="secondary-button wide file-button">
                <Upload size={16} />
                Replace file
                <input
                  type="file"
                  accept={replacementAccept(selectedAsset.mime)}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void replaceSelected(file);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </section>

            {selectedAsset.mime.startsWith('image/') ? (
              <section className="panel-section compact">
                <div className="section-title">
                  <strong>AI layer replacement</strong>
                  <WandSparkles size={16} />
                </div>
                <label className="field">
                  <span>Layer brief</span>
                  <textarea
                    rows={4}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Ví dụ: món salad xanh, ánh sáng studio, giữ góc camera"
                  />
                </label>
                <button
                  className="primary-button wide"
                  type="button"
                  disabled={busy === 'ai'}
                  onClick={() => void generateLayerVariants()}
                >
                  {busy === 'ai' ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                  Generate 4
                </button>
                {aiVariants.length ? (
                  <div className="ai-layer-grid">
                    {aiVariants.map((variant, index) => (
                      <button
                        type="button"
                        key={`${variant.name}-${index}`}
                        onClick={() => {
                          setReplacements((current) => ({
                            ...current,
                            [selectedAsset.hash]: variant.dataUrl,
                          }));
                          setNotice({ tone: 'ok', text: `Đã áp dụng AI variant ${index + 1}` });
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={variant.dataUrl} alt={`AI variant ${index + 1}`} />
                        <span>V{index + 1}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        ) : (
          <div className="layer-editor-empty">
            <Box size={22} />
            <span>Chọn một asset</span>
          </div>
        )}
      </aside>
    </main>
  );
}

function LayerThumbnail({ asset, source }: { asset: PlayableLayerAsset; source: string }) {
  if (asset.mime.startsWith('image/')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="layer-thumb" src={source} alt="" />;
  }
  return (
    <span className="layer-thumb layer-thumb-icon">
      {asset.mime.startsWith('video/') ? <Film size={17} /> : <Code2 size={17} />}
    </span>
  );
}

function LayerPreview({ asset, source }: { asset: PlayableLayerAsset; source: string }) {
  if (asset.mime.startsWith('image/')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={source} alt={asset.name} />;
  }
  if (asset.mime.startsWith('video/')) return <video src={source} controls muted />;
  return (
    <div className="binary-preview">
      <ImageIcon size={24} />
      <span>{asset.mime}</span>
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function injectLayerSelectionBridge(html: string) {
  const script = `<script id="playable-layer-editor-bridge">
(function(){
  var selectedSource="";
  var selectMode=false;
  var overlay;
  function sameSource(left,right){return !!left&&!!right&&left.replace(/\\s/g,"")===right.replace(/\\s/g,"");}
  function sourceOf(node){
    if(!node)return "";
    if(node.tagName==="IMG")return node.currentSrc||node.src||"";
    if(node.tagName==="VIDEO")return node.currentSrc||node.src||"";
    var bg=getComputedStyle(node).backgroundImage||"";
    var match=bg.match(/url\\(["']?(data:[^"')]+)["']?\\)/);
    return match?match[1]:"";
  }
  function findNode(source){
    if(!source)return null;
    var nodes=document.querySelectorAll("img,*");
    for(var i=0;i<nodes.length;i++){if(sameSource(sourceOf(nodes[i]),source))return nodes[i];}
    return null;
  }
  function sourceOfObject(object){
    try{
      var image=object&&object.texture&&object.texture.source&&object.texture.source[0]&&object.texture.source[0].image;
      if(image)return image.currentSrc||image.src||"";
      image=object&&object.texture&&object.texture.baseTexture&&object.texture.baseTexture.source;
      if(image)return image.currentSrc||image.src||"";
      image=object&&object.texture&&object.texture.getSourceImage&&object.texture.getSourceImage();
      return image&&(image.currentSrc||image.src)||"";
    }catch(e){return "";}
  }
  function phaserObjects(){
    var output=[],games=window.Phaser&&Array.isArray(window.Phaser.GAMES)?window.Phaser.GAMES:[];
    function add(object){
      if(!object)return;
      output.push(object);
      var children=object.list||(Array.isArray(object.children)?object.children:object.children&&object.children.list);
      if(Array.isArray(children))children.forEach(add);
    }
    games.forEach(function(game){
      (game&&game.world&&game.world.children||[]).forEach(add);
      var scenes=game&&game.scene&&game.scene.scenes||[];
      scenes.forEach(function(scene){(scene&&scene.children&&scene.children.list||[]).forEach(add);});
    });
    return output;
  }
  function findPhaserObject(source){
    var objects=phaserObjects();
    for(var i=objects.length-1;i>=0;i--){if(sameSource(sourceOfObject(objects[i]),source))return objects[i];}
    return null;
  }
  function phaserBox(object){
    try{
      var bounds=object&&object.getBounds&&object.getBounds(),canvas=document.querySelector("canvas");
      if(!bounds||!canvas)return null;
      var rect=canvas.getBoundingClientRect(),sx=rect.width/(canvas.width||rect.width),sy=rect.height/(canvas.height||rect.height);
      return {left:rect.left+bounds.x*sx,top:rect.top+bounds.y*sy,width:bounds.width*sx,height:bounds.height*sy};
    }catch(e){return null;}
  }
  function captureFrame(requestId,targetSize){
    try{
      var size=Math.max(256,Math.min(1536,Number(targetSize)||916));
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
      if(source.tagName==="CANVAS"){
        sourceKind="canvas";sourceWidth=source.width;sourceHeight=source.height;
      }else if(source.tagName==="VIDEO"){
        sourceKind="video";sourceWidth=source.videoWidth;sourceHeight=source.videoHeight;
      }else{
        sourceKind="image";sourceWidth=source.naturalWidth||source.width;sourceHeight=source.naturalHeight||source.height;
      }
      if(!sourceWidth||!sourceHeight)throw new Error("Preview frame is not ready.");
      var canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
      canvas.width=size;canvas.height=size;
      ctx.fillStyle="#fff";ctx.fillRect(0,0,size,size);
      var scale=Math.min(size/sourceWidth,size/sourceHeight);
      var drawWidth=sourceWidth*scale,drawHeight=sourceHeight*scale;
      ctx.drawImage(source,(size-drawWidth)/2,(size-drawHeight)/2,drawWidth,drawHeight);
      window.parent.postMessage({type:"playable-layer-capture-result",requestId:requestId,dataUrl:canvas.toDataURL("image/jpeg",.9),sourceKind:sourceKind,width:size,height:size},"*");
    }catch(error){
      window.parent.postMessage({type:"playable-layer-capture-result",requestId:requestId,error:error&&error.message||String(error)},"*");
    }
  }
  function ensureOverlay(){
    if(overlay)return overlay;
    overlay=document.createElement("div");
    overlay.id="playable-layer-selection";
    overlay.innerHTML='<i></i><i></i><i></i><i></i><b>LAYER</b>';
    document.documentElement.appendChild(overlay);
    var style=document.createElement("style");
    style.textContent='#playable-layer-selection{position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #2563eb;box-shadow:0 0 0 1px rgba(255,255,255,.8);display:none}#playable-layer-selection i{position:absolute;width:9px;height:9px;border:2px solid #2563eb;background:#fff;border-radius:50%}#playable-layer-selection i:nth-child(1){left:-6px;top:-6px}#playable-layer-selection i:nth-child(2){right:-6px;top:-6px}#playable-layer-selection i:nth-child(3){left:-6px;bottom:-6px}#playable-layer-selection i:nth-child(4){right:-6px;bottom:-6px}#playable-layer-selection b{position:absolute;left:-2px;top:-22px;padding:2px 5px;background:#2563eb;color:#fff;font:700 10px/16px Arial,sans-serif}';
    document.head.appendChild(style);
    return overlay;
  }
  function update(){
    if(!selectMode){ if(overlay)overlay.style.display="none"; return; }
    var node=findNode(selectedSource),rect=node&&node.getBoundingClientRect(),box=ensureOverlay();
    if(!rect)rect=phaserBox(findPhaserObject(selectedSource));
    if(!rect){box.style.display="none";return;}
    box.style.display="block";
    box.style.left=rect.left+"px";box.style.top=rect.top+"px";
    box.style.width=rect.width+"px";box.style.height=rect.height+"px";
  }
  function selectFromEvent(event){
    if(!selectMode)return;
    var node=event.target, source="";
    while(node&&node!==document.documentElement&&!source){source=sourceOf(node);if(!source)node=node.parentElement;}
    if(!source&&event.target&&event.target.tagName==="CANVAS"){
      var point=event.touches&&event.touches[0]||event,canvas=event.target,rect=canvas.getBoundingClientRect(),x=(point.clientX-rect.left)*(canvas.width/rect.width),y=(point.clientY-rect.top)*(canvas.height/rect.height),objects=phaserObjects();
      for(var i=objects.length-1;i>=0&&!source;i--){
        var object=objects[i],bounds=object&&object.getBounds&&object.getBounds();
        if(bounds&&bounds.contains&&bounds.contains(x,y))source=sourceOfObject(object);
        else if(bounds&&x>=bounds.x&&x<=bounds.x+bounds.width&&y>=bounds.y&&y<=bounds.y+bounds.height)source=sourceOfObject(object);
      }
    }
    if(source){
      event.preventDefault();
      event.stopPropagation();
      if(event.stopImmediatePropagation)event.stopImmediatePropagation();
      window.parent.postMessage({type:"playable-layer-select",source:source},"*");
    }
  }
  ["pointerdown","mousedown","touchstart","click"].forEach(function(name){
    document.addEventListener(name,selectFromEvent,true);
  });
  addEventListener("message",function(event){
    if(event.data&&event.data.type==="playable-layer-highlight"){
      selectedSource=String(event.data.source||"");
      selectMode=event.data.selectMode===true;
      update();
    }
    if(event.data&&event.data.type==="playable-layer-capture"){
      captureFrame(event.data.requestId,event.data.targetSize);
    }
  });
  addEventListener("resize",update);
  addEventListener("scroll",update,true);
  new MutationObserver(update).observe(document.documentElement,{subtree:true,childList:true,attributes:true});
  setInterval(update,500);setTimeout(update,0);
})();
</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}</body>`) : `${html}${script}`;
}

function injectAiRemakeLayer(html: string, imageDataUrl: string, animation: Exclude<RemakeAnimation, 'auto'>) {
  if (!imageDataUrl) return html;
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

function buildPlayableRemakePrompt({
  prompt,
  size,
  animation,
  sourceKind,
}: {
  prompt: string;
  size: number;
  animation: Exclude<RemakeAnimation, 'auto'>;
  sourceKind: string;
}) {
  return [
    `Use the attached ${sourceKind} preview frame as the visual reference for a playable ad.`,
    `Create a new complete playable ad still image, exactly ${size} x ${size} pixels, square format.`,
    'Keep a similar layout logic and mobile-ad readability, but change the creative content according to the user request.',
    prompt ? `User request: ${prompt}` : '',
    `The runtime animation will be added separately as: ${remakeAnimationLabels[animation]}.`,
    'Do not include editor UI, device frames, selection boxes, hand cursors, scan boxes, timelines, or export controls inside the image.',
    'Do not copy competitor trademarks, app logos, or exact artwork; use a clean replacement brand mark if a logo is requested.',
    'Make the image full-bleed with no black bars, padding, borders, or empty margins.',
  ]
    .filter(Boolean)
    .join('\n');
}

function getEffectiveRemakeAnimation(animation: RemakeAnimation, prompt: string): Exclude<RemakeAnimation, 'auto'> {
  if (animation !== 'auto') return animation;
  const value = prompt.toLowerCase();
  if (/scan|quet|qu[eé]t|nhan dien|detect|camera|calorie|food|mon|m[oó]n/.test(value)) return 'scan';
  if (/swipe|keo|k[eé]o|drag|truot|tr[uư][oợ]t|slide/.test(value)) return 'swipe';
  if (/button|cta|install|play now|pulse|nhap nhay|nh[aấ]p nh[aá]y/.test(value)) return 'pulse';
  if (/none|khong animation|kh[oô]ng animation/.test(value)) return 'none';
  return 'tap';
}

function capturePlayableFrame(targetSize: number) {
  return new Promise<{ dataUrl: string; sourceKind: string; width: number; height: number }>((resolve, reject) => {
    const frame = document.querySelector<HTMLIFrameElement>('.layer-preview-frame');
    const win = frame?.contentWindow;
    if (!win) {
      reject(new Error('Preview chua san sang de capture.'));
      return;
    }

    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Capture preview qua thoi gian.'));
    }, 8000);

    function onMessage(event: MessageEvent) {
      if (event.source !== win || event.data?.type !== 'playable-layer-capture-result' || event.data?.requestId !== requestId) {
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
        sourceKind: String(event.data.sourceKind || 'preview'),
        width: Number(event.data.width || targetSize),
        height: Number(event.data.height || targetSize),
      });
    }

    window.addEventListener('message', onMessage);
    win.postMessage({ type: 'playable-layer-capture', requestId, targetSize }, '*');
  });
}

function resizeImageToSquare(dataUrl: string, size: number) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('Khong resize duoc anh AI.'));
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas resize khong kha dung.'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      drawCover(ctx, image, image.naturalWidth || image.width, image.naturalHeight || image.height, size, size);
      const qualities = [0.86, 0.78, 0.68, 0.58, 0.48];
      let output = canvas.toDataURL('image/jpeg', qualities[0]);
      for (const quality of qualities.slice(1)) {
        if (output.length <= 420000) break;
        output = canvas.toDataURL('image/jpeg', quality);
      }
      resolve(output);
    };
    image.src = dataUrl;
  });
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(source, (targetWidth - drawWidth) / 2, (targetHeight - drawHeight) / 2, drawWidth, drawHeight);
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 916;
  return Math.round(Math.min(max, Math.max(min, value)));
}

function replacementAccept(mime: string) {
  if (mime.startsWith('image/')) return 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
  if (mime.startsWith('video/')) return 'video/mp4,video/webm';
  if (mime.startsWith('audio/')) return 'audio/*';
  if (mime.includes('font') || mime.includes('woff')) return '.woff,.woff2';
  return '*/*';
}

function safeBaseName(name: string) {
  return name.replace(/\.html?$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function normalizeDataUrl(source: string) {
  return source.replace(/\s/g, '');
}
