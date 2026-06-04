export type SourceKind = 'image' | 'html';

export type SourceStatus = 'ready' | 'queued' | 'generating' | 'done' | 'error';

export type NetworkTarget = 'unity' | 'applovin' | 'google' | 'mintegral' | 'moloco' | 'mraid';

export type Orientation = 'portrait' | 'landscape';

export type ImageFit = 'cover' | 'contain';

export type AiProvider = 'openai' | 'gemini-flash' | 'gemini-pro';

export type HandMotion =
  | 'tap'
  | 'doubleTap'
  | 'press'
  | 'bounce'
  | 'swipeX'
  | 'swipeY'
  | 'drag'
  | 'shake'
  | 'wave';

export type ScanStyle = 'ripple' | 'face' | 'sweep' | 'ring' | 'spotlight' | 'border' | 'frame' | 'spark' | 'none';

export type ButtonAnimation = 'pulse' | 'bounce' | 'shine' | 'shake' | 'breath' | 'none';

export type LayerTarget = 'hand' | 'scan' | 'asset' | 'cta';

export type AnimationLoopMode = 'once' | 'loop' | 'pingpong';

export type VisualAssetCategory = 'heart' | 'scan' | 'counter';

export type VisualAssetMotion = 'pulse' | 'sweep' | 'count' | 'blink' | 'wave';

export interface Hotspot {
  x: number;
  y: number;
  confidence: number;
  reason?: string;
}

export interface HandAsset {
  id: string;
  label: string;
  file: string;
  src: string;
  motion: HandMotion;
  category: 'real' | 'outline' | 'pointer' | 'swipe';
  source: string;
  license: string;
}

export interface VisualAsset {
  id: string;
  label: string;
  note: string;
  category: VisualAssetCategory;
  motion: VisualAssetMotion;
  value?: string;
}

export interface LayerSettings {
  layerOrder: LayerTarget[];
  handId: string;
  handMotion: HandMotion;
  handX: number;
  handY: number;
  handSize: number;
  handRotation: number;
  handLocked: boolean;
  injectHand: boolean;
  scanStyle: ScanStyle;
  scanX: number;
  scanY: number;
  scanSize: number;
  scanRotation: number;
  scanLocked: boolean;
  scanSpeed: number;
  scanDelay: number;
  scanLoop: AnimationLoopMode;
  scanAutoplay: boolean;
  scanAnimationName: string;
  scanColor: string;
  scanScaleStart: number;
  scanScaleEnd: number;
  scanOpacityStart: number;
  scanOpacityEnd: number;
  scanOffsetX: number;
  scanOffsetY: number;
  injectScan: boolean;
  ctaText: string;
  ctaX: number;
  ctaY: number;
  ctaWidth: number;
  ctaRotation: number;
  ctaLocked: boolean;
  showCta: boolean;
  buttonAnimation: ButtonAnimation;
  ctaScanGrouped: boolean;
  assetId: string;
  assetX: number;
  assetY: number;
  assetSize: number;
  assetRotation: number;
  assetLocked: boolean;
  assetSpeed: number;
  injectAsset: boolean;
}

export interface ProjectSettings {
  name: string;
  prompt: string;
  storeUrl: string;
  network: NetworkTarget;
  orientation: Orientation;
  imageFit: ImageFit;
  aiProvider: AiProvider;
  useClickTag: boolean;
  replaceLinks: boolean;
  ctaSelector: string;
  syncAllVariants: boolean;
}

export interface SourceItem {
  id: string;
  name: string;
  kind: SourceKind;
  status: SourceStatus;
  dataUrl?: string;
  html?: string;
  width?: number;
  height?: number;
  hotspot?: Hotspot;
  error?: string;
  createdAt: number;
}

export interface PlayableVariant {
  id: string;
  sourceId: string;
  index: number;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  revisedPrompt?: string;
  hotspot: Hotspot;
  settings: LayerSettings;
}

export interface AiVariantResponseItem {
  name: string;
  dataUrl: string;
  revisedPrompt?: string;
}

export interface ExportImageInput {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}
