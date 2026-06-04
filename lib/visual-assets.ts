import type { VisualAsset } from './types';

export const visualAssets: VisualAsset[] = [
  {
    id: 'heart-pulse-badge',
    label: 'Heart Pulse',
    note: 'heart beat badge',
    category: 'heart',
    motion: 'pulse',
    value: '86',
  },
  {
    id: 'ecg-wave-line',
    label: 'ECG Wave',
    note: 'heartbeat line',
    category: 'heart',
    motion: 'wave',
  },
  {
    id: 'heart-live-dot',
    label: 'Live Dot',
    note: 'live tracking',
    category: 'heart',
    motion: 'blink',
  },
  {
    id: 'scan-frame-box',
    label: 'Frame Box',
    note: 'color handles',
    category: 'scan',
    motion: 'pulse',
  },
  {
    id: 'counter-bpm',
    label: 'BPM Counter',
    note: '86 bpm',
    category: 'counter',
    motion: 'count',
    value: '86',
  },
  {
    id: 'counter-percent',
    label: 'Percent Count',
    note: '94%',
    category: 'counter',
    motion: 'count',
    value: '94%',
  },
  {
    id: 'counter-countdown',
    label: 'Countdown',
    note: '3 2 1',
    category: 'counter',
    motion: 'count',
    value: '3',
  },
  {
    id: 'status-normal',
    label: 'Normal Badge',
    note: 'status chip',
    category: 'heart',
    motion: 'pulse',
    value: 'Normal',
  },
];

export function getVisualAsset(id: string) {
  return visualAssets.find((asset) => asset.id === id) || visualAssets[0];
}
