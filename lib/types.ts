export type SourceKind = 'image' | 'html';

export type SourceStatus = 'ready' | 'queued' | 'generating' | 'done' | 'error';

export type NetworkTarget = 'unity' | 'applovin' | 'google' | 'mintegral' | 'moloco' | 'mraid';

export type Orientation = 'portrait' | 'landscape';

export type ImageFit = 'cover' | 'contain';

export type AiProvider = 'openai' | 'gemini-flash' | 'gemini-pro';
export type StorePlatform = 'app-store' | 'google-play' | 'custom';
export type StoreRoutingMode = 'single' | 'platform-auto';

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

export type TextCueAnimation = 'pulse' | 'bounce' | 'shake' | 'breath' | 'float' | 'blink' | 'typewriter' | 'none';

export type LayerTarget = 'image' | 'hand' | 'scan' | 'asset' | 'cta' | 'text';

export type AnimationLoopMode = 'once' | 'loop' | 'pingpong';

export type VisualAssetCategory = 'heart' | 'scan' | 'counter';

export type VisualAssetMotion = 'pulse' | 'sweep' | 'count' | 'blink' | 'wave';

export type PlayableIntent =
  | 'tap_product'
  | 'tap_choice'
  | 'swipe_reveal'
  | 'drag_match'
  | 'scan_object'
  | 'before_after'
  | 'count_result'
  | 'hold_charge'
  | 'scratch_reveal'
  | 'cta_only';

export interface Hotspot {
  x: number;
  y: number;
  confidence: number;
  reason?: string;
}

export interface PlayableTargetBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlayableCtaPlan {
  text: string;
  x: number;
  y: number;
  animation: ButtonAnimation;
  buttonId: string;
}

export interface PlayableCuePlan {
  text: string;
  x: number;
  y: number;
  animation: TextCueAnimation;
}

export interface PlayableTimingPlan {
  introDelayMs: number;
  actionDurationMs: number;
  ctaDelayMs: number;
}

export interface PlayablePlan {
  intent: PlayableIntent;
  reason: string;
  target: PlayableTargetBox;
  recipeId: string;
  handMotion: HandMotion;
  scanStyle: ScanStyle;
  visualAssetId: string;
  cta: PlayableCtaPlan;
  cue: PlayableCuePlan;
  timing: PlayableTimingPlan;
  confidence: number;
  source: 'ai' | 'heuristic';
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

export interface ButtonAsset {
  id: string;
  label: string;
  note: string;
  colorFrom: string;
  colorTo: string;
  textColor: string;
  shadowColor: string;
}

export interface LayerSettings {
  layerOrder: LayerTarget[];
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  imageRotation: number;
  imageLocked: boolean;
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
  ctaButtonId: string;
  ctaColorFrom: string;
  ctaColorTo: string;
  ctaTextColor: string;
  ctaShadowColor: string;
  ctaScanGrouped: boolean;
  cueText: string;
  cueX: number;
  cueY: number;
  cueWidth: number;
  cueSize: number;
  cueRotation: number;
  cueLocked: boolean;
  cueAnimation: TextCueAnimation;
  cueColor: string;
  cueBgColor: string;
  cueShadowColor: string;
  showCue: boolean;
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
  appStoreUrl: string;
  googlePlayUrl: string;
  storePlatform: StorePlatform;
  storeRoutingMode: StoreRoutingMode;
  network: NetworkTarget;
  orientation: Orientation;
  imageFit: ImageFit;
  aiProvider: AiProvider;
  variantCount: number;
  useAiAnalyze: boolean;
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
  plan?: PlayablePlan;
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

export type StudioUserRole = 'manager' | 'editor';
export type WorkspaceMemberRole = 'manager' | 'editor' | 'viewer';

export interface StudioUserSummary {
  id: string;
  email: string;
  displayName: string;
  role: StudioUserRole;
}

export interface StudioProjectSummary {
  id: string;
  name: string;
  workspaceId: string;
  appId: string;
  ownerUserId: string;
  ownerEmail: string;
  variantCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudioAppSummary {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  accentColor: string;
  projectCount: number;
  myProjectCount: number;
  updatedTodayCount: number;
  lastUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudioWorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
  memberRole: WorkspaceMemberRole;
  projectCount: number;
  appCount: number;
  lastUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  apps: StudioAppSummary[];
}

export interface StudioDashboardPayload {
  user: StudioUserSummary;
  stats: {
    workspaceCount: number;
    appCount: number;
    projectCount: number;
    myProjectCount: number;
  };
  workspaces: StudioWorkspaceSummary[];
}

export interface StudioProjectDetail {
  id: string;
  name: string;
  prompt: string;
  workspaceId: string;
  appId: string;
  ownerUserId: string;
  ownerEmail: string;
  settings: ProjectSettings;
  sourceImageDataUrl: string;
  variants: PlayableVariant[];
  createdAt: string;
  updatedAt: string;
}

export interface StudioCloneImportPayload {
  appId: string;
  importedAt: number;
  settings: ProjectSettings;
  source: SourceItem;
  variants: PlayableVariant[];
}
