import type { HandAsset } from './types';

type HandTapAnchor = {
  x: number;
  y: number;
  heightRatio: number;
};

export const handAssets: HandAsset[] = [
  {
    id: 'hand-01-soft-swipe-hand',
    label: 'Soft Swipe',
    file: 'hand-01-soft-swipe-hand.png',
    src: '/assets/hands/hand-01-soft-swipe-hand.png',
    motion: 'swipeX',
    category: 'swipe',
    source: 'Local PNG library',
    license: 'Review commercial rights before production',
  },
  {
    id: 'hand-02-outline-tap-hand',
    label: 'Outline Tap',
    file: 'hand-02-outline-tap-hand.png',
    src: '/assets/hands/hand-02-outline-tap-hand.png',
    motion: 'tap',
    category: 'outline',
    source: 'Local PNG library',
    license: 'Review commercial rights before production',
  },
  {
    id: 'hand-03-real-finger-nail',
    label: 'Real Finger Nail',
    file: 'hand-03-real-finger-nail.png',
    src: '/assets/hands/hand-03-real-finger-nail.png',
    motion: 'tap',
    category: 'real',
    source: 'Local PNG library',
    license: 'Review commercial rights before production',
  },
  {
    id: 'hand-04-small-pointer',
    label: 'Small Pointer',
    file: 'hand-04-small-pointer.png',
    src: '/assets/hands/hand-04-small-pointer.png',
    motion: 'tap',
    category: 'pointer',
    source: 'Local PNG library',
    license: 'Review commercial rights before production',
  },
  {
    id: 'hand-05-real-tap-finger',
    label: 'Real Tap Finger',
    file: 'hand-05-real-tap-finger.png',
    src: '/assets/hands/hand-05-real-tap-finger.png',
    motion: 'press',
    category: 'real',
    source: 'Local PNG library',
    license: 'Review commercial rights before production',
  },
  {
    id: 'hand-06-bold-tap-hand',
    label: 'Bold Tap',
    file: 'hand-06-bold-tap-hand.png',
    src: '/assets/hands/hand-06-bold-tap-hand.png',
    motion: 'tap',
    category: 'pointer',
    source: 'Local PNG library',
    license: 'Review commercial rights before production',
  },
  {
    id: 'hand-07-classic-pointer',
    label: 'Classic Pointer',
    file: 'hand-07-classic-pointer.png',
    src: '/assets/hands/hand-07-classic-pointer.png',
    motion: 'tap',
    category: 'pointer',
    source: 'Local PNG library',
    license: 'Review commercial rights before production',
  },
  {
    id: 'hand-08-soft-3d-pointer',
    label: 'Soft 3D Pointer',
    file: 'hand-08-soft-3d-pointer.png',
    src: '/assets/hands/hand-08-soft-3d-pointer.png',
    motion: 'tap',
    category: 'pointer',
    source: 'Local PNG library',
    license: 'Review commercial rights before production',
  },
  {
    id: 'hand-09-soft-real-tap',
    label: 'Soft Real Tap',
    file: 'hand-09-soft-real-tap.png',
    src: '/assets/hands/hand-09-soft-real-tap.png',
    motion: 'press',
    category: 'real',
    source: 'Local PNG library',
    license: 'Review commercial rights before production',
  },
  {
    id: 'hand-10-line-pointer',
    label: 'Line Pointer',
    file: 'hand-10-line-pointer.png',
    src: '/assets/hands/hand-10-line-pointer.png',
    motion: 'tap',
    category: 'outline',
    source: 'Local PNG library',
    license: 'Review commercial rights before production',
  },
  {
    id: 'hand-11-line-tap-hand',
    label: 'Line Tap',
    file: 'hand-11-line-tap-hand.png',
    src: '/assets/hands/hand-11-line-tap-hand.png',
    motion: 'tap',
    category: 'outline',
    source: 'Local PNG library',
    license: 'Review commercial rights before production',
  },
  {
    id: 'hand-12-tilt-pointer',
    label: 'Tilt Pointer',
    file: 'hand-12-tilt-pointer.png',
    src: '/assets/hands/hand-12-tilt-pointer.png',
    motion: 'bounce',
    category: 'pointer',
    source: 'Local PNG library',
    license: 'Review commercial rights before production',
  },
  {
    id: 'hand-13-real-vertical-finger',
    label: 'Vertical Finger',
    file: 'hand-13-real-vertical-finger.png',
    src: '/assets/hands/hand-13-real-vertical-finger.png',
    motion: 'press',
    category: 'real',
    source: 'Local PNG library',
    license: 'Review commercial rights before production',
  },
];

const defaultTapAnchor: HandTapAnchor = { x: 50, y: 14, heightRatio: 1 };

const handTapAnchors: Record<string, HandTapAnchor> = {
  'hand-01-soft-swipe-hand': { x: 28, y: 24, heightRatio: 1 },
  'hand-02-outline-tap-hand': { x: 17, y: 14, heightRatio: 1 },
  'hand-03-real-finger-nail': { x: 53, y: 2, heightRatio: 523 / 325 },
  'hand-04-small-pointer': { x: 25, y: 16, heightRatio: 1 },
  'hand-05-real-tap-finger': { x: 49, y: 4, heightRatio: 346 / 218 },
  'hand-06-bold-tap-hand': { x: 19, y: 14, heightRatio: 1 },
  'hand-07-classic-pointer': { x: 20, y: 16, heightRatio: 1 },
  'hand-08-soft-3d-pointer': { x: 22, y: 18, heightRatio: 1 },
  'hand-09-soft-real-tap': { x: 50, y: 8, heightRatio: 280 / 250 },
  'hand-10-line-pointer': { x: 22, y: 15, heightRatio: 1 },
  'hand-11-line-tap-hand': { x: 20, y: 15, heightRatio: 1 },
  'hand-12-tilt-pointer': { x: 22, y: 17, heightRatio: 1 },
  'hand-13-real-vertical-finger': { x: 45, y: 2, heightRatio: 1 },
};

export function getHandAsset(id: string) {
  return handAssets.find((asset) => asset.id === id) || handAssets[0];
}

export function getHandTapAnchor(id: string) {
  return handTapAnchors[id] || defaultTapAnchor;
}

export function getHandAnchorOffset(id: string, size: number) {
  const anchor = getHandTapAnchor(id);
  return {
    x: Math.round(((anchor.x - 50) / 100) * size),
    y: Math.round(((anchor.y - 50) / 100) * size * anchor.heightRatio),
  };
}
