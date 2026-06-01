import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'assets', 'hands');

const poses = [
  ['tap-blue', 'Tap Hand Blue', 'tap', -28, '#13a8df', '#ffc5ad', 'tap'],
  ['tap-orange', 'Tap Hand Orange', 'tap', -18, '#ff7a1a', '#ffc0a7', 'tap'],
  ['tap-green', 'Tap Hand Green', 'tap', -8, '#10b981', '#ffd0b8', 'tap'],
  ['tap-purple', 'Tap Hand Purple', 'tap', 5, '#7c3aed', '#f7b69f', 'tap'],
  ['tap-red', 'Tap Hand Red', 'tap', 16, '#ef4444', '#f6b49a', 'tap'],
  ['double-tap', 'Double Tap Hand', 'tap', -24, '#2563eb', '#ffd3bd', 'double'],
  ['long-press', 'Long Press Hand', 'tap', -12, '#0f766e', '#ffc2aa', 'hold'],
  ['cta-click', 'CTA Click Hand', 'tap', 0, '#f59e0b', '#ffd0bc', 'spark'],
  ['drag-center', 'Drag Center Hand', 'drag', -20, '#0891b2', '#ffc8af', 'drag'],
  ['drag-target', 'Drag Target Hand', 'drag', -4, '#475569', '#f4ad95', 'target'],
  ['swipe-left', 'Swipe Left Hand', 'swipe-left', -58, '#0ea5e9', '#ffc7ae', 'trail-left'],
  ['swipe-right', 'Swipe Right Hand', 'swipe-right', 32, '#22c55e', '#ffd1bd', 'trail-right'],
  ['swipe-up', 'Swipe Up Hand', 'swipe-up', -3, '#8b5cf6', '#ffc8b1', 'trail-up'],
  ['swipe-down', 'Swipe Down Hand', 'swipe-down', 180, '#f97316', '#f7baa2', 'trail-down'],
  ['swipe-loop', 'Swipe Loop Hand', 'swipe', -30, '#06b6d4', '#ffd2c1', 'loop'],
  ['point-left', 'Point Left Hand', 'tap', -88, '#1d4ed8', '#ffc6ad', 'plain'],
  ['point-right', 'Point Right Hand', 'tap', 82, '#dc2626', '#f7b59f', 'plain'],
  ['point-up', 'Point Up Hand', 'tap', 0, '#0284c7', '#ffd0ba', 'plain'],
  ['point-down', 'Point Down Hand', 'tap', 180, '#65a30d', '#ffc4ad', 'plain'],
  ['soft-press', 'Soft Press Hand', 'tap', -12, '#ec4899', '#ffd4c0', 'soft'],
  ['pinch-in', 'Pinch In Hand', 'pinch', -22, '#14b8a6', '#ffc8b0', 'pinch-in'],
  ['pinch-out', 'Pinch Out Hand', 'pinch', 18, '#6366f1', '#ffc3aa', 'pinch-out'],
  ['small-tap', 'Small Tap Hand', 'tap', -24, '#0ea5e9', '#ffd1bd', 'small'],
  ['big-tap', 'Big Tap Hand', 'tap', -24, '#fb7185', '#f5b299', 'big'],
  ['hold-target', 'Hold Target Hand', 'hold', -16, '#334155', '#ffcab5', 'hold-target'],
  ['grab-drag', 'Grab Drag Hand', 'drag', -38, '#0284c7', '#ffd0bb', 'grab'],
  ['neon-swipe', 'Neon Swipe Hand', 'swipe-right', 28, '#06b6d4', '#ffc8ad', 'neon'],
  ['store-click', 'Store Click Hand', 'tap', -8, '#ff6b00', '#ffd2be', 'store'],
  ['tutorial-hand', 'Tutorial Hand', 'tap', -32, '#00a3d8', '#ffc6ae', 'tutorial'],
  ['success-tap', 'Success Tap Hand', 'tap', -18, '#16a34a', '#ffd0b9', 'success'],
];

function handSvg({ id, label, motion, angle, cuff, skin, effect }, index) {
  const flip = id.includes('right') ? -1 : 1;
  const scale = effect === 'small' ? 0.86 : effect === 'big' ? 1.12 : 1;
  const stroke = '#7b3b2e';
  const nail = '#fff1ea';
  const shade = '#ef9f89';
  const darkCuff = darken(cuff, 22);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="#0f172a" flood-opacity=".22"/>
    </filter>
    <radialGradient id="skinGrad" cx="38%" cy="22%" r="82%">
      <stop offset="0" stop-color="#ffe0d2"/>
      <stop offset=".58" stop-color="${skin}"/>
      <stop offset="1" stop-color="${shade}"/>
    </radialGradient>
    <linearGradient id="cuffGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${lighten(cuff, 14)}"/>
      <stop offset="1" stop-color="${darkCuff}"/>
    </linearGradient>
  </defs>
  ${effectLayer(effect, cuff)}
  <g filter="url(#shadow)" transform="translate(128 132) scale(${scale}) rotate(${angle}) scale(${flip} 1) translate(-128 -132)">
    <path d="M80 185 C87 166 104 157 124 160 C149 164 168 183 170 207 L75 211 C73 201 75 192 80 185Z" fill="url(#skinGrad)" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
    <rect x="112" y="34" width="34" height="134" rx="17" fill="url(#skinGrad)" stroke="${stroke}" stroke-width="4"/>
    <ellipse cx="129" cy="54" rx="10" ry="15" fill="${nail}" stroke="${stroke}" stroke-width="2.4"/>
    <rect x="82" y="96" width="31" height="96" rx="15.5" transform="rotate(-6 97.5 144)" fill="url(#skinGrad)" stroke="${stroke}" stroke-width="4"/>
    <ellipse cx="96" cy="113" rx="9" ry="14" transform="rotate(-7 96 113)" fill="${nail}" stroke="${stroke}" stroke-width="2.2"/>
    <path d="M91 160 C107 150 124 151 139 160" fill="none" stroke="#b86759" stroke-width="3" stroke-linecap="round"/>
    <path d="M151 118 C171 119 184 134 184 153 C184 174 169 192 148 194 C132 196 121 188 118 176 C115 162 124 153 138 155 C148 156 154 162 158 170" fill="url(#skinGrad)" stroke="${stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M68 211 L174 211 L190 244 L54 244 Z" fill="url(#cuffGrad)" stroke="#073c50" stroke-width="4" stroke-linejoin="round"/>
    <path d="M73 213 C104 224 139 224 169 213" fill="none" stroke="${lighten(cuff, 26)}" stroke-width="5" stroke-linecap="round" opacity=".65"/>
  </g>
  <text x="128" y="248" text-anchor="middle" font-family="Arial, sans-serif" font-size="0" fill="transparent">${escapeXml(label)} ${motion} ${index}</text>
</svg>`;
}

function effectLayer(effect, color) {
  const soft = lighten(color, 26);
  if (effect === 'double') {
    return `<g fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" opacity=".72">
      <circle cx="119" cy="31" r="18"/><circle cx="119" cy="31" r="31" opacity=".42"/>
    </g>`;
  }
  if (effect === 'hold' || effect === 'soft' || effect === 'hold-target') {
    return `<g fill="none" stroke="${color}" stroke-width="5" opacity=".55">
      <circle cx="128" cy="46" r="24"/><circle cx="128" cy="46" r="42" opacity=".34"/>
    </g>`;
  }
  if (effect === 'spark' || effect === 'store' || effect === 'success') {
    return `<g stroke="${color}" stroke-width="7" stroke-linecap="round">
      <path d="M179 42 L193 28"/><path d="M190 73 L211 72"/><path d="M163 24 L164 6"/>
    </g>`;
  }
  if (effect === 'drag' || effect === 'target' || effect === 'grab') {
    return `<g fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="10 9" opacity=".62">
      <path d="M53 57 C86 31 126 27 164 42"/>
      <path d="M165 42 L149 30 M165 42 L148 55"/>
    </g>`;
  }
  if (effect === 'trail-left') {
    return `<g fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" opacity=".58">
      <path d="M211 91 C163 73 114 73 65 92"/><path d="M66 92 L88 74 M66 92 L92 106"/>
    </g>`;
  }
  if (effect === 'trail-right' || effect === 'neon') {
    return `<g fill="none" stroke="${effect === 'neon' ? '#22d3ee' : color}" stroke-width="7" stroke-linecap="round" opacity=".62">
      <path d="M48 91 C96 73 145 73 194 92"/><path d="M194 92 L172 74 M194 92 L168 106"/>
    </g>`;
  }
  if (effect === 'trail-up') {
    return `<g fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" opacity=".58">
      <path d="M61 182 C89 136 126 100 174 72"/><path d="M174 72 L167 101 M174 72 L146 78"/>
    </g>`;
  }
  if (effect === 'trail-down') {
    return `<g fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" opacity=".58">
      <path d="M183 50 C154 97 116 136 67 184"/><path d="M67 184 L96 176 M67 184 L77 155"/>
    </g>`;
  }
  if (effect === 'loop') {
    return `<g fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" opacity=".56">
      <path d="M65 91 C96 43 168 44 193 92 C212 131 176 164 139 145 C111 131 119 96 150 98"/>
      <path d="M150 98 L132 88 M150 98 L133 111"/>
    </g>`;
  }
  if (effect === 'pinch-in' || effect === 'pinch-out') {
    return `<g fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" opacity=".62">
      <path d="M76 70 L107 91"/><path d="M181 70 L150 91"/>
      <path d="${effect === 'pinch-in' ? 'M96 91 L111 90 M160 91 L145 90' : 'M111 90 L96 91 M145 90 L160 91'}"/>
    </g>`;
  }
  if (effect === 'tutorial') {
    return `<g fill="${soft}" opacity=".32"><circle cx="129" cy="42" r="39"/></g>`;
  }
  return '';
}

function lighten(hex, amount) {
  return adjust(hex, amount);
}

function darken(hex, amount) {
  return adjust(hex, -amount);
}

function adjust(hex, amount) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16));
  return `#${channels.map((channel) => Math.max(0, Math.min(255, channel + amount)).toString(16).padStart(2, '0')).join('')}`;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

await fs.mkdir(outputDir, { recursive: true });

for (const entry of await fs.readdir(outputDir)) {
  if (entry.endsWith('.png')) await fs.unlink(path.join(outputDir, entry));
}

const assets = [];

for (const [index, [slug, label, motion, angle, cuff, skin, effect]] of poses.entries()) {
  const id = `hand-${String(index + 1).padStart(2, '0')}-${slug}`;
  const fileName = `${id}.png`;
  const svg = handSvg({ id, label, motion, angle, cuff, skin, effect }, index + 1);
  const outPath = path.join(outputDir, fileName);

  await sharp(Buffer.from(svg))
    .resize(256, 256, { fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  const png = await fs.readFile(outPath);
  assets.push({
    id,
    label,
    motion,
    file: `assets/hands/${fileName}`,
    source: 'Custom local cartoon hand illustration',
    license: 'Project asset',
    src: `data:image/png;base64,${png.toString('base64')}`,
  });
}

const js = `// Generated by scripts/generate-hand-assets.mjs.
// Custom local cartoon hand PNG assets. Local PNG files are in assets/hands.
window.PS_HAND_LIBRARY = ${JSON.stringify(assets, null, 2)};
window.PS_HAND_ASSETS = Object.fromEntries(window.PS_HAND_LIBRARY.map((asset) => [asset.id, asset.src]));
`;

await fs.writeFile(path.join(root, 'hand-assets.js'), js, 'utf8');

console.log(`Generated ${assets.length} cartoon hand PNG assets in ${outputDir}`);
