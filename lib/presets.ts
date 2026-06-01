import type { ButtonAnimation, HandMotion, LayerSettings, ScanStyle } from './types';

export const defaultLayerSettings: LayerSettings = {
  handId: 'hand-08-soft-3d-pointer',
  handMotion: 'tap',
  handX: 50,
  handY: 70,
  handSize: 112,
  injectHand: true,
  scanStyle: 'ring',
  scanX: 50,
  scanY: 70,
  scanSize: 136,
  scanSpeed: 1200,
  injectScan: true,
  ctaText: 'INSTALL NOW',
  ctaX: 50,
  ctaY: 88,
  ctaWidth: 72,
  showCta: true,
  buttonAnimation: 'pulse',
};

export const scanPresets: Array<{ id: ScanStyle; label: string; note: string }> = [
  { id: 'ring', label: 'Pulse Ring', note: 'tap target' },
  { id: 'sweep', label: 'Sweep Line', note: 'scan area' },
  { id: 'spotlight', label: 'Spotlight', note: 'focus item' },
  { id: 'border', label: 'Border Scan', note: 'object box' },
  { id: 'spark', label: 'Spark Hit', note: 'tap feedback' },
  { id: 'none', label: 'None', note: 'off' },
];

export const handMotionPresets: Array<{ id: HandMotion; label: string }> = [
  { id: 'tap', label: 'Tap' },
  { id: 'doubleTap', label: 'Double' },
  { id: 'press', label: 'Press' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'swipeX', label: 'Swipe X' },
  { id: 'swipeY', label: 'Swipe Y' },
  { id: 'drag', label: 'Drag' },
  { id: 'shake', label: 'Shake' },
  { id: 'wave', label: 'Wave' },
];

export const buttonPresets: Array<{ id: ButtonAnimation; label: string }> = [
  { id: 'pulse', label: 'Pulse' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'shine', label: 'Shine' },
  { id: 'shake', label: 'Shake' },
  { id: 'breath', label: 'Breath' },
  { id: 'none', label: 'None' },
];

export const recipePresets: Array<{
  id: string;
  label: string;
  note: string;
  layer: Partial<LayerSettings>;
}> = [
  {
    id: 'tap-target',
    label: 'Tap Target',
    note: 'ring + tap + pulse',
    layer: {
      handId: 'hand-08-soft-3d-pointer',
      handMotion: 'tap',
      scanStyle: 'ring',
      buttonAnimation: 'pulse',
      handSize: 112,
      scanSize: 140,
    },
  },
  {
    id: 'real-press',
    label: 'Real Press',
    note: 'real finger + shine',
    layer: {
      handId: 'hand-09-soft-real-tap',
      handMotion: 'press',
      scanStyle: 'spotlight',
      buttonAnimation: 'shine',
      handSize: 122,
      scanSize: 160,
    },
  },
  {
    id: 'swipe-reveal',
    label: 'Swipe Reveal',
    note: 'swipe hand + sweep',
    layer: {
      handId: 'hand-01-soft-swipe-hand',
      handMotion: 'swipeX',
      scanStyle: 'sweep',
      buttonAnimation: 'bounce',
      handSize: 118,
      scanSize: 148,
    },
  },
  {
    id: 'cta-push',
    label: 'CTA Push',
    note: 'lower CTA emphasis',
    layer: {
      handId: 'hand-06-bold-tap-hand',
      handMotion: 'bounce',
      scanStyle: 'spark',
      buttonAnimation: 'shake',
      handX: 50,
      handY: 82,
      scanX: 50,
      scanY: 82,
      ctaX: 50,
      ctaY: 88,
    },
  },
];
