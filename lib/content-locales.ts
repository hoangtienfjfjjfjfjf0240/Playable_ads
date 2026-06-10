import type { ContentLocale, PlayableIntent } from './types';

export const contentLocaleOptions: Array<{ value: ContentLocale; label: string; promptName: string }> = [
  { value: 'auto', label: 'Auto from prompt', promptName: 'Auto' },
  { value: 'en', label: 'English', promptName: 'English' },
  { value: 'vi', label: 'Vietnamese', promptName: 'Vietnamese' },
  { value: 'es', label: 'Spanish', promptName: 'Spanish' },
  { value: 'fr', label: 'French', promptName: 'French' },
  { value: 'de', label: 'German', promptName: 'German' },
  { value: 'pt-br', label: 'Portuguese (BR)', promptName: 'Brazilian Portuguese' },
  { value: 'id', label: 'Indonesian', promptName: 'Indonesian' },
  { value: 'th', label: 'Thai', promptName: 'Thai' },
];

const localePromptNames = Object.fromEntries(
  contentLocaleOptions.map((item) => [item.value, item.promptName]),
) as Record<ContentLocale, string>;

type Direction = 'up' | 'down' | null;
type IntentCopyMap = Record<PlayableIntent, string>;

const ctaByLocale: Record<Exclude<ContentLocale, 'auto'>, IntentCopyMap> = {
  en: {
    tap_product: 'View now',
    tap_choice: 'Choose now',
    swipe_reveal: 'Explore now',
    drag_match: 'Try now',
    scan_object: 'Scan now',
    before_after: 'Compare',
    count_result: 'See result',
    hold_charge: 'Measure now',
    scratch_reveal: 'Unlock now',
    cta_only: 'Install now',
  },
  vi: {
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
  },
  es: {
    tap_product: 'Ver ahora',
    tap_choice: 'Elegir ahora',
    swipe_reveal: 'Explorar',
    drag_match: 'Probar ahora',
    scan_object: 'Escanear',
    before_after: 'Comparar',
    count_result: 'Ver resultado',
    hold_charge: 'Medir ahora',
    scratch_reveal: 'Desbloquear',
    cta_only: 'Instalar',
  },
  fr: {
    tap_product: 'Voir',
    tap_choice: 'Choisir',
    swipe_reveal: 'Explorer',
    drag_match: 'Essayer',
    scan_object: 'Scanner',
    before_after: 'Comparer',
    count_result: 'Voir resultat',
    hold_charge: 'Mesurer',
    scratch_reveal: 'Debloquer',
    cta_only: 'Installer',
  },
  de: {
    tap_product: 'Jetzt ansehen',
    tap_choice: 'Jetzt wahlen',
    swipe_reveal: 'Entdecken',
    drag_match: 'Jetzt testen',
    scan_object: 'Jetzt scannen',
    before_after: 'Vergleichen',
    count_result: 'Ergebnis sehen',
    hold_charge: 'Jetzt messen',
    scratch_reveal: 'Freischalten',
    cta_only: 'Installieren',
  },
  'pt-br': {
    tap_product: 'Ver agora',
    tap_choice: 'Escolher',
    swipe_reveal: 'Explorar',
    drag_match: 'Testar agora',
    scan_object: 'Escanear',
    before_after: 'Comparar',
    count_result: 'Ver resultado',
    hold_charge: 'Medir agora',
    scratch_reveal: 'Desbloquear',
    cta_only: 'Instalar',
  },
  id: {
    tap_product: 'Lihat sekarang',
    tap_choice: 'Pilih sekarang',
    swipe_reveal: 'Jelajahi',
    drag_match: 'Coba sekarang',
    scan_object: 'Pindai',
    before_after: 'Bandingkan',
    count_result: 'Lihat hasil',
    hold_charge: 'Ukur sekarang',
    scratch_reveal: 'Buka sekarang',
    cta_only: 'Instal',
  },
  th: {
    tap_product: 'View now',
    tap_choice: 'Choose now',
    swipe_reveal: 'Explore',
    drag_match: 'Try now',
    scan_object: 'Scan now',
    before_after: 'Compare',
    count_result: 'See result',
    hold_charge: 'Measure now',
    scratch_reveal: 'Unlock now',
    cta_only: 'Install now',
  },
};

const cueByLocale: Record<Exclude<ContentLocale, 'auto'>, IntentCopyMap> = {
  en: {
    tap_product: 'Tap to view',
    tap_choice: 'Tap to choose',
    swipe_reveal: 'Swipe to explore',
    drag_match: 'Drag to match',
    scan_object: 'Tap to scan',
    before_after: 'Swipe to compare',
    count_result: 'Tap to see result',
    hold_charge: 'Press and hold',
    scratch_reveal: 'Swipe to unlock',
    cta_only: 'Tap to start',
  },
  vi: {
    tap_product: 'Cham de xem',
    tap_choice: 'Cham de chon',
    swipe_reveal: 'Vuot de kham pha',
    drag_match: 'Keo de ghep',
    scan_object: 'Cham de quet',
    before_after: 'Vuot de so sanh',
    count_result: 'Cham de xem ket qua',
    hold_charge: 'Nhan giu de do',
    scratch_reveal: 'Vuot de mo khoa',
    cta_only: 'Cham de bat dau',
  },
  es: {
    tap_product: 'Toca para ver',
    tap_choice: 'Toca para elegir',
    swipe_reveal: 'Desliza para explorar',
    drag_match: 'Arrastra para unir',
    scan_object: 'Toca para escanear',
    before_after: 'Desliza para comparar',
    count_result: 'Toca para ver resultado',
    hold_charge: 'Manten pulsado',
    scratch_reveal: 'Desliza para desbloquear',
    cta_only: 'Toca para empezar',
  },
  fr: {
    tap_product: 'Touchez pour voir',
    tap_choice: 'Touchez pour choisir',
    swipe_reveal: 'Glissez pour explorer',
    drag_match: 'Faites glisser',
    scan_object: 'Touchez pour scanner',
    before_after: 'Glissez pour comparer',
    count_result: 'Touchez pour voir',
    hold_charge: 'Maintenez appuye',
    scratch_reveal: 'Glissez pour ouvrir',
    cta_only: 'Touchez pour commencer',
  },
  de: {
    tap_product: 'Tippen zum Ansehen',
    tap_choice: 'Tippen zum Wahlen',
    swipe_reveal: 'Wischen zum Entdecken',
    drag_match: 'Ziehen zum Zuordnen',
    scan_object: 'Tippen zum Scannen',
    before_after: 'Wischen zum Vergleichen',
    count_result: 'Tippen fur Ergebnis',
    hold_charge: 'Gedruckt halten',
    scratch_reveal: 'Wischen zum Offnen',
    cta_only: 'Tippen zum Starten',
  },
  'pt-br': {
    tap_product: 'Toque para ver',
    tap_choice: 'Toque para escolher',
    swipe_reveal: 'Deslize para explorar',
    drag_match: 'Arraste para combinar',
    scan_object: 'Toque para escanear',
    before_after: 'Deslize para comparar',
    count_result: 'Toque para ver resultado',
    hold_charge: 'Pressione e segure',
    scratch_reveal: 'Deslize para desbloquear',
    cta_only: 'Toque para comecar',
  },
  id: {
    tap_product: 'Ketuk untuk lihat',
    tap_choice: 'Ketuk untuk pilih',
    swipe_reveal: 'Geser untuk jelajah',
    drag_match: 'Seret untuk cocokkan',
    scan_object: 'Ketuk untuk pindai',
    before_after: 'Geser untuk bandingkan',
    count_result: 'Ketuk untuk hasil',
    hold_charge: 'Tekan dan tahan',
    scratch_reveal: 'Geser untuk buka',
    cta_only: 'Ketuk untuk mulai',
  },
  th: {
    tap_product: 'Tap to view',
    tap_choice: 'Tap to choose',
    swipe_reveal: 'Swipe to explore',
    drag_match: 'Drag to match',
    scan_object: 'Tap to scan',
    before_after: 'Swipe to compare',
    count_result: 'Tap to see result',
    hold_charge: 'Press and hold',
    scratch_reveal: 'Swipe to unlock',
    cta_only: 'Tap to start',
  },
};

export function applyContentLocaleToPrompt(prompt: string, locale: ContentLocale) {
  const base = prompt.trim();
  if (locale === 'auto') return base;
  const language = localePromptNames[locale];
  return [
    `Language: ${language}.`,
    `Localize CTA text, cue text, and any preserved in-image text into ${language}.`,
    base,
  ]
    .filter(Boolean)
    .join('\n');
}

export function resolvePromptLocale(prompt: string): ContentLocale {
  const value = normalizePromptText(prompt);
  if (/(language:\s*vietnamese|language:\s*viet|tieng viet|ngon ngu:\s*viet|ngon ngu vietnamese)/.test(value)) return 'vi';
  if (/(language:\s*spanish|language:\s*espanol|language:\s*espanol|ngon ngu:\s*spanish)/.test(value)) return 'es';
  if (/(language:\s*french|language:\s*francais|ngon ngu:\s*french)/.test(value)) return 'fr';
  if (/(language:\s*german|language:\s*deutsch|ngon ngu:\s*german)/.test(value)) return 'de';
  if (/(language:\s*portuguese|language:\s*brazilian portuguese|language:\s*pt-br|ngon ngu:\s*portuguese)/.test(value)) return 'pt-br';
  if (/(language:\s*indonesian|language:\s*bahasa indonesia|ngon ngu:\s*indonesian)/.test(value)) return 'id';
  if (/(language:\s*thai|ngon ngu:\s*thai)/.test(value)) return 'th';
  if (/(language:\s*english|ngon ngu:\s*english)/.test(value)) return 'en';
  return 'auto';
}

export function localizeDefaultCtaText(intent: PlayableIntent, locale: ContentLocale) {
  if (locale === 'auto') return '';
  return ctaByLocale[locale]?.[intent] || '';
}

export function localizeDefaultCueText(intent: PlayableIntent, locale: ContentLocale, direction: Direction) {
  if (locale === 'auto') return '';
  if (locale === 'en') {
    if (intent === 'swipe_reveal' && direction === 'up') return 'Swipe up to explore';
    if (intent === 'swipe_reveal' && direction === 'down') return 'Swipe down to explore';
  }
  if (locale === 'vi') {
    if (intent === 'swipe_reveal' && direction === 'up') return 'Vuot len de kham pha';
    if (intent === 'swipe_reveal' && direction === 'down') return 'Vuot xuong de kham pha';
  }
  return cueByLocale[locale]?.[intent] || '';
}

function normalizePromptText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
