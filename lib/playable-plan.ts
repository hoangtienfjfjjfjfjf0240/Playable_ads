import { z } from 'zod';
import { buttonAssets, getButtonAsset } from './button-assets';
import { getVisualAsset, visualAssets } from './visual-assets';
import { defaultLayerSettings, recipePresets } from './presets';
import type {
  ButtonAnimation,
  HandMotion,
  Hotspot,
  LayerSettings,
  PlayableIntent,
  PlayablePlan,
  PlayableTargetBox,
  ScanStyle,
  TextCueAnimation,
} from './types';

export const MAX_VARIANT_COUNT = 24;
export const DEFAULT_VARIANT_COUNT = 4;

export const playableIntentValues = [
  'tap_product',
  'tap_choice',
  'swipe_reveal',
  'drag_match',
  'scan_object',
  'before_after',
  'count_result',
  'hold_charge',
  'scratch_reveal',
  'cta_only',
] as const;

export const handMotionValues = ['tap', 'doubleTap', 'press', 'bounce', 'swipeX', 'swipeY', 'drag', 'shake', 'wave'] as const;
export const scanStyleValues = ['ripple', 'face', 'sweep', 'ring', 'spotlight', 'border', 'frame', 'spark', 'none'] as const;
export const buttonAnimationValues = ['pulse', 'bounce', 'shine', 'shake', 'breath', 'none'] as const;
export const textCueAnimationValues = ['pulse', 'bounce', 'shake', 'breath', 'float', 'blink', 'typewriter', 'none'] as const;

export const playableIntentLabels: Record<PlayableIntent, string> = {
  tap_product: 'Tap product',
  tap_choice: 'Tap choice',
  swipe_reveal: 'Swipe reveal',
  drag_match: 'Drag match',
  scan_object: 'Scan object',
  before_after: 'Before/after',
  count_result: 'Count result',
  hold_charge: 'Hold charge',
  scratch_reveal: 'Scratch reveal',
  cta_only: 'CTA only',
};

const targetBoxSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(1).max(100),
  height: z.number().min(1).max(100),
});

export const playablePlanSchema = z.object({
  intent: z.enum(playableIntentValues),
  reason: z.string().min(1).max(240),
  target: targetBoxSchema,
  recipeId: z.string().min(1).max(80),
  handMotion: z.enum(handMotionValues),
  scanStyle: z.enum(scanStyleValues),
  visualAssetId: z.string().min(1).max(80),
  cta: z.object({
    text: z.string().min(1).max(28),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    animation: z.enum(buttonAnimationValues),
    buttonId: z.string().min(1).max(80),
  }),
  cue: z.object({
    text: z.string().min(1).max(42),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    animation: z.enum(textCueAnimationValues),
  }),
  timing: z.object({
    introDelayMs: z.number().int().min(0).max(3000),
    actionDurationMs: z.number().int().min(400).max(5000),
    ctaDelayMs: z.number().int().min(0).max(5000),
  }),
  confidence: z.number().min(0).max(1),
  source: z.enum(['ai', 'heuristic']).default('ai'),
});

export const playablePlanRegistry = {
  intents: playableIntentValues.map((id) => ({ id, label: playableIntentLabels[id] })),
  recipes: recipePresets.map((recipe) => ({
    id: recipe.id,
    label: recipe.label,
    note: recipe.note,
    layer: recipe.layer,
  })),
  handMotions: handMotionValues,
  scanStyles: scanStyleValues,
  buttonAnimations: buttonAnimationValues,
  textCueAnimations: textCueAnimationValues,
  visualAssets: visualAssets.map((asset) => ({
    id: asset.id,
    label: asset.label,
    category: asset.category,
    motion: asset.motion,
    note: asset.note,
  })),
  buttonAssets: buttonAssets.map((button) => ({
    id: button.id,
    label: button.label,
    note: button.note,
  })),
};

export const playablePlanJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: playableIntentValues },
    reason: { type: 'string', maxLength: 240 },
    target: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'number', minimum: 0, maximum: 100 },
        y: { type: 'number', minimum: 0, maximum: 100 },
        width: { type: 'number', minimum: 1, maximum: 100 },
        height: { type: 'number', minimum: 1, maximum: 100 },
      },
      required: ['x', 'y', 'width', 'height'],
    },
    recipeId: { type: 'string' },
    handMotion: { type: 'string', enum: handMotionValues },
    scanStyle: { type: 'string', enum: scanStyleValues },
    visualAssetId: { type: 'string' },
    cta: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', maxLength: 28 },
        x: { type: 'number', minimum: 0, maximum: 100 },
        y: { type: 'number', minimum: 0, maximum: 100 },
        animation: { type: 'string', enum: buttonAnimationValues },
        buttonId: { type: 'string' },
      },
      required: ['text', 'x', 'y', 'animation', 'buttonId'],
    },
    cue: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', maxLength: 42 },
        x: { type: 'number', minimum: 0, maximum: 100 },
        y: { type: 'number', minimum: 0, maximum: 100 },
        animation: { type: 'string', enum: textCueAnimationValues },
      },
      required: ['text', 'x', 'y', 'animation'],
    },
    timing: {
      type: 'object',
      additionalProperties: false,
      properties: {
        introDelayMs: { type: 'integer', minimum: 0, maximum: 3000 },
        actionDurationMs: { type: 'integer', minimum: 400, maximum: 5000 },
        ctaDelayMs: { type: 'integer', minimum: 0, maximum: 5000 },
      },
      required: ['introDelayMs', 'actionDurationMs', 'ctaDelayMs'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    source: { type: 'string', enum: ['ai', 'heuristic'] },
  },
  required: [
    'intent',
    'reason',
    'target',
    'recipeId',
    'handMotion',
    'scanStyle',
    'visualAssetId',
    'cta',
    'cue',
    'timing',
    'confidence',
    'source',
  ],
} as const;

const intentDefaults: Record<
  PlayableIntent,
  {
    recipeId: string;
    handMotion: HandMotion;
    scanStyle: ScanStyle;
    visualAssetId: string;
    buttonAnimation: ButtonAnimation;
    buttonId: string;
    ctaText: string;
    cueText: string;
    cueAnimation: TextCueAnimation;
  }
> = {
  tap_product: {
    recipeId: 'tap-target',
    handMotion: 'tap',
    scanStyle: 'frame',
    visualAssetId: 'scan-frame-box',
    buttonAnimation: 'pulse',
    buttonId: 'orange-3d',
    ctaText: 'INSTALL NOW',
    cueText: 'Tap to view',
    cueAnimation: 'float',
  },
  tap_choice: {
    recipeId: 'double-tap',
    handMotion: 'doubleTap',
    scanStyle: 'frame',
    visualAssetId: 'scan-frame-box',
    buttonAnimation: 'bounce',
    buttonId: 'blue-3d',
    ctaText: 'PLAY NOW',
    cueText: 'Tap to choose',
    cueAnimation: 'pulse',
  },
  swipe_reveal: {
    recipeId: 'swipe-reveal',
    handMotion: 'swipeX',
    scanStyle: 'frame',
    visualAssetId: 'scan-frame-box',
    buttonAnimation: 'shine',
    buttonId: 'purple-3d',
    ctaText: 'TRY NOW',
    cueText: 'Swipe to explore',
    cueAnimation: 'float',
  },
  drag_match: {
    recipeId: 'drag-focus',
    handMotion: 'drag',
    scanStyle: 'frame',
    visualAssetId: 'scan-frame-box',
    buttonAnimation: 'shine',
    buttonId: 'gold-3d',
    ctaText: 'PLAY NOW',
    cueText: 'Drag to match',
    cueAnimation: 'bounce',
  },
  scan_object: {
    recipeId: 'scan-sweep',
    handMotion: 'press',
    scanStyle: 'frame',
    visualAssetId: 'scan-frame-box',
    buttonAnimation: 'pulse',
    buttonId: 'cyan-3d',
    ctaText: 'SCAN NOW',
    cueText: 'Tap to scan',
    cueAnimation: 'pulse',
  },
  before_after: {
    recipeId: 'wave-guide',
    handMotion: 'swipeX',
    scanStyle: 'frame',
    visualAssetId: 'scan-frame-box',
    buttonAnimation: 'shine',
    buttonId: 'pink-3d',
    ctaText: 'SEE RESULT',
    cueText: 'Swipe to compare',
    cueAnimation: 'float',
  },
  count_result: {
    recipeId: 'heart-pulse',
    handMotion: 'press',
    scanStyle: 'frame',
    visualAssetId: 'scan-frame-box',
    buttonAnimation: 'breath',
    buttonId: 'green-3d',
    ctaText: 'CHECK NOW',
    cueText: 'Tap to reveal',
    cueAnimation: 'breath',
  },
  hold_charge: {
    recipeId: 'real-press',
    handMotion: 'press',
    scanStyle: 'frame',
    visualAssetId: 'scan-frame-box',
    buttonAnimation: 'breath',
    buttonId: 'blue-3d',
    ctaText: 'HOLD NOW',
    cueText: 'Press and hold',
    cueAnimation: 'breath',
  },
  scratch_reveal: {
    recipeId: 'spark-hit',
    handMotion: 'swipeX',
    scanStyle: 'frame',
    visualAssetId: 'scan-frame-box',
    buttonAnimation: 'shake',
    buttonId: 'gold-3d',
    ctaText: 'REVEAL',
    cueText: 'Swipe to reveal',
    cueAnimation: 'shake',
  },
  cta_only: {
    recipeId: 'cta-push',
    handMotion: 'tap',
    scanStyle: 'none',
    visualAssetId: 'scan-frame-box',
    buttonAnimation: 'pulse',
    buttonId: 'orange-3d',
    ctaText: 'INSTALL NOW',
    cueText: 'Tap to start',
    cueAnimation: 'float',
  },
};

export function normalizeVariantCount(value: unknown) {
  return clampInt(Number(value || DEFAULT_VARIANT_COUNT), 1, MAX_VARIANT_COUNT);
}

export function heuristicPlanFromHotspot(hotspot: Hotspot, index = 1, prompt = ''): PlayablePlan {
  const intent = inferIntent(hotspot, prompt, index);
  const defaults = intentDefaults[intent];
  const handMotion = inferHandMotion(prompt, defaults.handMotion);
  const target = targetFromHotspot(hotspot);
  const ctaY = target.y > 78 ? 90 : 88;

  return normalizePlayablePlan(
    {
      intent,
      reason: `${hotspot.reason || 'visual hotspot'}; heuristic ${playableIntentLabels[intent]}`,
      target,
      recipeId: defaults.recipeId,
      handMotion,
      scanStyle: defaults.scanStyle,
      visualAssetId: defaults.visualAssetId,
      cta: {
        text: ctaTextForIntent(intent, prompt, defaults.ctaText),
        x: 50,
        y: ctaY,
        animation: defaults.buttonAnimation,
        buttonId: defaults.buttonId,
      },
      cue: {
        text: cueTextForIntent(intent, prompt, defaults.cueText),
        x: 50,
        y: cueYForCta(ctaY),
        animation: defaults.cueAnimation,
      },
      timing: {
        introDelayMs: 250,
        actionDurationMs: 1200,
        ctaDelayMs: 1450,
      },
      confidence: Math.max(0.28, Math.min(0.76, hotspot.confidence)),
      source: 'heuristic',
    },
    hotspot,
    index,
    prompt,
  );
}

export function normalizePlayablePlan(raw: unknown, hotspot: Hotspot, index = 1, prompt = ''): PlayablePlan {
  const parsed = playablePlanSchema.safeParse(raw);
  if (!parsed.success) return heuristicPlanFromHotspotFallback(hotspot, index, prompt);

  const plan = parsed.data;
  const defaults = intentDefaults[plan.intent] || intentDefaults.cta_only;
  const explicitCtaText = extractPromptCtaText(prompt);
  const explicitCueText = extractPromptCueText(prompt);
  const recipeId = recipePresets.some((recipe) => recipe.id === plan.recipeId) ? plan.recipeId : defaults.recipeId;
  const visualAssetId = visualAssets.some((asset) => asset.id === plan.visualAssetId) ? plan.visualAssetId : defaults.visualAssetId;
  const buttonId = buttonAssets.some((button) => button.id === plan.cta.buttonId) ? plan.cta.buttonId : defaults.buttonId;
  const scanStyle: ScanStyle = plan.intent === 'cta_only' || plan.scanStyle === 'none' ? 'none' : 'frame';

  return {
    ...plan,
    reason: plan.reason.trim().slice(0, 240) || defaults.recipeId,
    target: normalizeTarget(plan.target),
    recipeId,
    scanStyle,
    visualAssetId,
    cta: {
      ...plan.cta,
      text: normalizeCtaText(explicitCtaText || plan.cta.text, ctaTextForIntent(plan.intent, prompt, defaults.ctaText)),
      x: clampNumber(plan.cta.x, 8, 92),
      y: clampNumber(plan.cta.y, 74, 92),
      buttonId,
    },
    cue: {
      ...plan.cue,
      text: normalizeCueText(explicitCueText || plan.cue.text, cueTextForIntent(plan.intent, prompt, defaults.cueText)),
      x: clampNumber(plan.cue.x, 8, 92),
      y: clampNumber(plan.cue.y, 18, 88),
      animation: textCueAnimationValues.includes(plan.cue.animation) ? plan.cue.animation : defaults.cueAnimation,
    },
    timing: {
      introDelayMs: clampInt(plan.timing.introDelayMs, 0, 3000),
      actionDurationMs: clampInt(plan.timing.actionDurationMs, 400, 5000),
      ctaDelayMs: clampInt(plan.timing.ctaDelayMs, 0, 5000),
    },
    confidence: clampNumber(plan.confidence, 0, 1),
    source: plan.source,
  };
}

export function layerFromPlayablePlan(plan: PlayablePlan, prompt = ''): LayerSettings {
  const defaults = intentDefaults[plan.intent] || intentDefaults.cta_only;
  const recipe = recipePresets.find((item) => item.id === plan.recipeId) || recipePresets.find((item) => item.id === defaults.recipeId);
  const button = getButtonAsset(plan.cta.buttonId);
  const target = normalizeTarget(plan.target);
  const ctaOnly = plan.intent === 'cta_only' || plan.confidence < 0.45;
  const scanFocused = !ctaOnly && shouldInjectScanLayer(plan, prompt);
  const scanStyle = ctaOnly ? 'none' : plan.scanStyle;
  const scanSize = Math.round(clampNumber(Math.max(target.width, target.height) * 4.4, 108, 226));
  const handX = ctaOnly
    ? clampNumber(plan.cta.x + 15, 12, 92)
    : scanFocused
      ? clampNumber(target.x + Math.max(7, target.width * 0.34), 12, 92)
      : target.x;
  const handY = ctaOnly
    ? clampNumber(plan.cta.y - 1, 18, 90)
    : scanFocused
      ? clampNumber(target.y + Math.max(5, target.height * 0.28), 18, 90)
      : target.y;
  const scanX = target.x;
  const scanY = target.y;

  const layer: LayerSettings = {
    ...defaultLayerSettings,
    ...(recipe?.layer || {}),
    handMotion: plan.handMotion,
    handX,
    handY,
    handSize: recipe?.layer.handSize || (target.y > 76 ? 116 : 112),
    injectHand: true,
    scanStyle,
    scanAnimationName: scanStyle === 'none' ? 'None' : scanName(scanStyle),
    scanX,
    scanY,
    scanSize: recipe?.layer.scanSize || scanSize,
    scanSpeed: recipe?.layer.scanSpeed || plan.timing.actionDurationMs,
    scanDelay: plan.timing.introDelayMs,
    injectScan: scanFocused,
    ctaText: plan.cta.text,
    ctaX: plan.cta.x,
    ctaY: plan.cta.y,
    ctaButtonId: button.id,
    ctaColorFrom: button.colorFrom,
    ctaColorTo: button.colorTo,
    ctaTextColor: button.textColor,
    ctaShadowColor: button.shadowColor,
    buttonAnimation: plan.cta.animation,
    showCta: true,
    ctaScanGrouped: false,
    cueText: plan.cue.text,
    cueX: plan.cue.x,
    cueY: clampNumber(plan.cue.y || cueYForCta(plan.cta.y), 18, 88),
    cueWidth: plan.intent === 'hold_charge' ? 80 : 74,
    cueSize: target.y < 38 ? 20 : 22,
    cueAnimation: plan.cue.animation,
    showCue: true,
    assetId: 'scan-frame-box',
    assetX: clampNumber(target.x, 10, 90),
    assetY: clampNumber(target.y - (target.y > 55 ? 10 : -10), 16, 78),
    assetSize: plan.intent === 'count_result' ? 128 : 112,
    assetSpeed: plan.timing.actionDurationMs,
    injectAsset: false,
    layerOrder: ['text', 'cta', 'hand'],
  };

  return {
    ...layer,
    layerOrder: getLayerOrder(layer),
  };
}

export function hotspotFromPlayablePlan(plan: PlayablePlan): Hotspot {
  return {
    x: plan.target.x,
    y: plan.target.y,
    confidence: plan.confidence,
    reason: `${plan.source}: ${playableIntentLabels[plan.intent]} - ${plan.reason}`,
  };
}

function heuristicPlanFromHotspotFallback(hotspot: Hotspot, index: number, prompt: string): PlayablePlan {
  const intent = inferIntent(hotspot, prompt, index);
  const defaults = intentDefaults[intent];
  const handMotion = inferHandMotion(prompt, defaults.handMotion);
  const target = targetFromHotspot(hotspot);
  return {
    intent,
    reason: `${hotspot.reason || 'fallback'}; schema fallback`,
    target,
    recipeId: defaults.recipeId,
    handMotion,
    scanStyle: defaults.scanStyle,
    visualAssetId: defaults.visualAssetId,
    cta: {
      text: ctaTextForIntent(intent, prompt, defaults.ctaText),
      x: 50,
      y: target.y > 78 ? 90 : 88,
      animation: defaults.buttonAnimation,
      buttonId: defaults.buttonId,
    },
    cue: {
      text: cueTextForIntent(intent, prompt, defaults.cueText),
      x: 50,
      y: cueYForCta(target.y > 78 ? 90 : 88),
      animation: defaults.cueAnimation,
    },
    timing: {
      introDelayMs: 250,
      actionDurationMs: 1200,
      ctaDelayMs: 1450,
    },
    confidence: Math.max(0.28, Math.min(0.72, hotspot.confidence)),
    source: 'heuristic',
  };
}

function inferIntent(hotspot: Hotspot, prompt: string, index: number): PlayableIntent {
  const value = normalizeText(prompt);
  const hasScanWords = /(scan|camera|photo|detect|measure|heart|bpm|cardio|calorie|food|meal|face|barcode|qr|receipt|quet|nhan dien|do nhip tim|do calo)/.test(value);
  const hasResultWords = /(count|counter|countdown|score|result|percent|percentage|progress|bpm|heart rate|calorie|kcal|steps?|points?|chi so|ket qua|phan tram)/.test(value);
  if (/(tap choice|tap to choose|choose|choice|select|pick|option|lua chon|chon muc|chon dap an)/.test(value)) return 'tap_choice';
  if (/(tap region|tap area|tap product|click area|click product|hotspot|an vao vung|bam vao vung|nhan vao vung)/.test(value)) return 'tap_product';
  if (/(scratch|scratch off|scratch card|reward|bonus|unlock|cao de mo|cao de lo|mo khoa)/.test(value)) return 'scratch_reveal';
  if (/(swipe up|swipe down|scroll up|scroll down|vuot len|vuot xuong|keo len|keo xuong|truot len|truot xuong)/.test(value)) {
    return 'swipe_reveal';
  }
  if (/(swipe left|swipe right|swipe|slide|compare|comparison|before after|before\/after|keo qua|vuot ngang|truot ngang|xem thay doi)/.test(value)) {
    return 'before_after';
  }
  if (/(drag|drop|match|keo tha|tha vao|keo den)/.test(value)) return 'drag_match';
  if (/(hold|press and hold|giu|nhan giu|an giu)/.test(value)) return 'hold_charge';
  if (/(button|cta|install|download|try now|start|bam nut|nhan nut|an nut|\bnut\b)/.test(value)) {
    return 'cta_only';
  }
  if (hasScanWords && hasResultWords) return 'count_result';
  if (hasScanWords) return 'scan_object';
  if (hasResultWords) return 'count_result';
  if (/swipe|slide|reveal|before|after|truot|keo/.test(value)) return 'swipe_reveal';
  if (/scratch|reward|bonus|unlock|mo khoa/.test(value)) return 'scratch_reveal';
  if (/press|tap|click|bam|nhan|\ban\b/.test(value)) return 'cta_only';
  if (/charge|giu/.test(value)) return 'hold_charge';
  if (hotspot.confidence < 0.36 || hotspot.y > 80) return 'cta_only';
  if (hotspot.x < 32 || hotspot.x > 68) return index % 2 === 0 ? 'swipe_reveal' : 'tap_product';
  return 'cta_only';
}

function inferHandMotion(prompt: string, fallback: HandMotion): HandMotion {
  const value = normalizeText(prompt);
  if (/(swipe up|swipe down|scroll up|scroll down|vuot len|vuot xuong|keo len|keo xuong|truot len|truot xuong)/.test(value)) return 'swipeY';
  if (/(swipe left|swipe right|swipe|slide|keo qua|vuot ngang|truot ngang|before after|before\/after|xem thay doi)/.test(value)) return 'swipeX';
  if (/(scratch|scratch off|scratch card|reward|bonus|unlock|cao de mo|cao de lo|mo khoa)/.test(value)) return 'swipeX';
  if (/(drag|drop|match|keo tha|tha vao|keo den)/.test(value)) return 'drag';
  if (/(choose|choice|select|pick|option|lua chon|chon muc|chon dap an)/.test(value)) return 'doubleTap';
  if (/(double tap|double click|bam 2|nhan 2|an 2)/.test(value)) return 'doubleTap';
  if (/(hold|press and hold|giu|nhan giu|an giu)/.test(value)) return 'press';
  if (/(button|cta|install|download|tap|click|press|bam|nhan|\ban\b|nut)/.test(value)) return 'tap';
  return fallback;
}

function targetFromHotspot(hotspot: Hotspot): PlayableTargetBox {
  const y = clampNumber(hotspot.y, 18, 84);
  return {
    x: clampNumber(hotspot.x, 12, 88),
    y,
    width: y < 42 ? 24 : y > 72 ? 32 : 28,
    height: y < 42 ? 18 : y > 72 ? 16 : 24,
  };
}

function normalizeTarget(target: PlayableTargetBox): PlayableTargetBox {
  return {
    x: clampNumber(target.x, 8, 92),
    y: clampNumber(target.y, 12, 88),
    width: clampNumber(target.width, 6, 72),
    height: clampNumber(target.height, 6, 72),
  };
}

function normalizeCtaText(value: string, fallback: string) {
  const text = value.replace(/\s+/g, ' ').trim().toUpperCase();
  return (text || fallback).slice(0, 28);
}

function normalizeCueText(value: string, fallback: string) {
  const text = value.replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, 42);
}

function ctaTextForIntent(intent: PlayableIntent, prompt: string, fallback: string) {
  const explicit = extractPromptCtaText(prompt);
  if (explicit) return explicit;
  if (isVietnameseRequested(prompt)) {
    const values: Record<PlayableIntent, string> = {
      tap_product: 'Xem ngay',
      tap_choice: 'Chon ngay',
      swipe_reveal: 'Kham pha',
      drag_match: 'Thu ngay',
      scan_object: 'Quet ngay',
      before_after: 'So sanh',
      count_result: 'Xem ket qua',
      hold_charge: 'Do ngay',
      scratch_reveal: 'Mo ngay',
      cta_only: 'Cai ngay',
    };
    return values[intent];
  }
  return fallback;
}

function inferSwipeDirection(prompt: string) {
  const value = normalizeText(prompt);
  if (/(swipe up|scroll up|vuot len|keo len|truot len)/.test(value)) return 'up';
  if (/(swipe down|scroll down|vuot xuong|keo xuong|truot xuong)/.test(value)) return 'down';
  return null;
}

function localizedCueTextForIntent(intent: PlayableIntent, prompt: string) {
  const direction = inferSwipeDirection(prompt);
  if (isVietnameseRequested(prompt)) {
    const values: Record<PlayableIntent, string> = {
      tap_product: 'Cham de xem',
      tap_choice: 'Cham de chon',
      swipe_reveal: direction === 'up' ? 'Vuot len de kham pha' : direction === 'down' ? 'Vuot xuong de kham pha' : 'Vuot de kham pha',
      drag_match: 'Keo de ghep',
      scan_object: 'Cham de quet',
      before_after: 'Vuot de so sanh',
      count_result: 'Cham de xem ket qua',
      hold_charge: 'Nhan giu de do',
      scratch_reveal: 'Vuot de mo khoa',
      cta_only: 'Cham de bat dau',
    };
    return values[intent];
  }
  if (intent === 'swipe_reveal') {
    if (direction === 'up') return 'Swipe up to explore';
    if (direction === 'down') return 'Swipe down to explore';
  }
  return '';
}

function cueTextForIntent(intent: PlayableIntent, prompt: string, fallback: string) {
  const explicit = extractPromptCueText(prompt);
  if (explicit) return explicit;
  const localized = localizedCueTextForIntent(intent, prompt);
  if (localized) return localized;
  if (isVietnameseRequested(prompt)) {
    const values: Record<PlayableIntent, string> = {
      tap_product: 'Chạm để xem',
      tap_choice: 'Chạm để chọn',
      swipe_reveal: 'Vuốt để khám phá',
      drag_match: 'Kéo để ghép',
      scan_object: 'Chạm để quét',
      before_after: 'Vuốt để so sánh',
      count_result: 'Chạm để xem kết quả',
      hold_charge: 'Nhấn giữ để đo',
      scratch_reveal: 'Vuốt để mở khóa',
      cta_only: 'Chạm để bắt đầu',
    };
    return values[intent];
  }
  return fallback;
}

function cueYForCta(ctaY: number) {
  return clampNumber(ctaY - 12, 18, 82);
}

function shouldInjectScanLayer(plan: PlayablePlan, prompt: string) {
  if (plan.intent === 'scan_object') return true;
  return plan.intent === 'count_result' && hasScanWords(prompt);
}

function hasScanWords(prompt: string) {
  const value = normalizeText(prompt);
  return /(scan|camera|photo|detect|measure|heart|bpm|cardio|calorie|food|meal|face|barcode|qr|receipt|quet|nhan dien|do nhip tim|do calo)/.test(value);
}

function extractPromptCueText(prompt: string) {
  return extractPromptDirectiveText(prompt, [
    /(?:text\s*cue|cue\s*text|instruction\s*text|text\s*huong\s*dan|text\s*keu\s*goi)\s*(?:ghi\s*l[àa]|l[àa]|is|=|:)\s*["“']?([^"\n\r]+?)["”']?(?=$|[,\n\r.!?])/iu,
    /(?:text\s*cue|cue\s*text|instruction\s*text)\s*["“']([^"”'\n\r]+)["”']/iu,
  ]);
}

function extractPromptCtaText(prompt: string) {
  return extractPromptDirectiveText(prompt, [
    /(?:cta\s*text|button\s*text|cta\s*button|cta|button\s*label|text\s*nut|nut)\s*(?:ghi\s*l[àa]|l[àa]|is|=|:)\s*["“']?([^"\n\r]+?)["”']?(?=$|[,\n\r.!?])/iu,
    /(?:cta\s*text|button\s*text|cta\s*button|button\s*label)\s*["“']([^"”'\n\r]+)["”']/iu,
  ]);
}

function extractPromptDirectiveText(prompt: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match?.[1]) continue;
    const value = match[1]
      .replace(/\s+/g, ' ')
      .replace(/^[\s"'“”]+|[\s"'“”]+$/g, '')
      .replace(/[.,!?;:]+$/g, '')
      .trim();
    if (value) return value.slice(0, 42);
  }
  return '';
}

function isVietnameseRequested(prompt: string) {
  const value = normalizeText(prompt);
  return /language:\s*vietnamese|vietnamese|tieng viet|ngon ngu:\s*viet|ngon ngu vietnamese/.test(value);
}

function scanName(scanStyle: ScanStyle) {
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

function getLayerOrder(layer: LayerSettings) {
  const raw = layer.layerOrder || defaultLayerSettings.layerOrder;
  const valid = raw.filter((target) => target === 'hand' || target === 'scan' || target === 'asset' || target === 'cta' || target === 'text');
  const next = valid.filter((target, index) => valid.indexOf(target) === index);
  if (layer.injectScan && layer.scanStyle !== 'none' && !next.includes('scan')) next.push('scan');
  if (layer.injectAsset && !next.includes('asset')) next.push('asset');
  if (layer.showCue && !next.includes('text')) next.push('text');
  if (layer.showCta && !next.includes('cta')) next.push('cta');
  if (layer.injectHand && !next.includes('hand')) next.push('hand');
  return next;
}

function normalizeText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number) {
  return Math.round(clampNumber(value, min, max));
}
