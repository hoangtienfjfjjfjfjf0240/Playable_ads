export type SourceKind = 'image' | 'html';

export type SourceStatus = 'ready' | 'queued' | 'generating' | 'done' | 'error';

export type NetworkTarget = 'applovin' | 'mintegral' | 'mraid';

export type Orientation = 'portrait' | 'landscape';

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

export type ScanStyle = 'sweep' | 'ring' | 'spotlight' | 'border' | 'spark' | 'none';

export type ButtonAnimation = 'pulse' | 'bounce' | 'shine' | 'shake' | 'breath' | 'none';

export type LayerTarget = 'hand' | 'scan' | 'cta';

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

export interface LayerSettings {
  handId: string;
  handMotion: HandMotion;
  handX: number;
  handY: number;
  handSize: number;
  injectHand: boolean;
  scanStyle: ScanStyle;
  scanX: number;
  scanY: number;
  scanSize: number;
  scanSpeed: number;
  injectScan: boolean;
  ctaText: string;
  ctaX: number;
  ctaY: number;
  ctaWidth: number;
  showCta: boolean;
  buttonAnimation: ButtonAnimation;
}

export interface ProjectSettings {
  name: string;
  prompt: string;
  storeUrl: string;
  network: NetworkTarget;
  orientation: Orientation;
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
