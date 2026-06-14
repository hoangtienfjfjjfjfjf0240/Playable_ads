import type { ContentLocale, PlayableIntent } from './types';

export type ContentLocaleOption = {
  value: ContentLocale;
  label: string;
  promptName: string;
  marketName: string;
  aliases: string[];
};

type Direction = 'up' | 'down' | null;
type IntentCopyMap = Record<PlayableIntent, string>;
type StaticLocaleKey = 'en' | 'vi' | 'es' | 'fr' | 'de' | 'pt-br' | 'id';

const AUTO_LOCALE_OPTION: ContentLocaleOption = {
  value: 'auto',
  label: 'Auto from prompt',
  promptName: 'Auto',
  marketName: 'auto-selected market',
  aliases: ['auto', 'prompt', 'default'],
};

const popularLocaleValues = [
  'en',
  'en-us',
  'en-gb',
  'en-au',
  'en-ca',
  'en-in',
  'es',
  'es-es',
  'es-mx',
  'es-ar',
  'es-co',
  'fr',
  'fr-fr',
  'fr-ca',
  'fr-be',
  'de',
  'de-de',
  'de-at',
  'de-ch',
  'it',
  'it-it',
  'pt',
  'pt-pt',
  'pt-br',
  'nl',
  'nl-nl',
  'nl-be',
  'pl',
  'pl-pl',
  'ro',
  'ro-ro',
  'cs',
  'cs-cz',
  'sk',
  'sk-sk',
  'sl',
  'sl-si',
  'hr',
  'hr-hr',
  'sr',
  'sr-latn',
  'sr-rs',
  'bs',
  'hu',
  'bg',
  'mk',
  'sq',
  'el',
  'ru',
  'ru-ru',
  'uk',
  'uk-ua',
  'be',
  'lt',
  'lv',
  'et',
  'fi',
  'sv',
  'no',
  'nn',
  'da',
  'is',
  'ga',
  'cy',
  'gd',
  'br',
  'eu',
  'ca',
  'gl',
  'oc',
  'ast',
  'lb',
  'mt',
  'af',
  'fy',
  'yi',
  'ar',
  'ar-sa',
  'ar-eg',
  'ar-ae',
  'he',
  'fa',
  'ps',
  'ur',
  'hi',
  'hi-in',
  'bn',
  'pa',
  'gu',
  'mr',
  'ne',
  'si',
  'as',
  'or',
  'te',
  'ta',
  'kn',
  'ml',
  'kok',
  'sa',
  'mai',
  'bho',
  'sat',
  'doi',
  'sd',
  'ks',
  'ckb',
  'ku',
  'tr',
  'tr-tr',
  'az',
  'hy',
  'ka',
  'kk',
  'ky',
  'uz',
  'tk',
  'tg',
  'mn',
  'bo',
  'ug',
  'zh-cn',
  'zh-tw',
  'zh-hk',
  'zh-sg',
  'yue',
  'wuu',
  'gan',
  'nan',
  'ja',
  'ja-jp',
  'ko',
  'ko-kr',
  'vi',
  'vi-vn',
  'th',
  'th-th',
  'lo',
  'km',
  'my',
  'ms',
  'ms-my',
  'id',
  'id-id',
  'jv',
  'su',
  'ceb',
  'fil',
  'fil-ph',
  'tl',
  'mg',
  'sw',
  'so',
  'om',
  'ha',
  'yo',
  'ig',
  'am',
  'ti',
  'rw',
  'rn',
  'sn',
  'ny',
  'st',
  'tn',
  'ts',
  'ss',
  've',
  'xh',
  'zu',
  'lg',
  'ak',
  'bm',
  'ee',
  'ff',
  'wo',
  'ln',
  'kg',
  'sg',
  'nso',
  'dv',
  'qu',
  'ay',
  'gn',
  'mi',
  'sm',
  'to',
  'ty',
  'fj',
  'haw',
  'ht',
  'pap',
  'co',
  'la',
  'eo',
  'chr',
  'iu',
  'kl',
  'se',
  'na',
  'ch',
  'tet',
  'tpi',
  'war',
  'ilo',
  'pag',
  'bcl',
  'pam',
  'hil',
  'bik',
  'mad',
  'min',
  'ace',
  'ban',
  'sas',
  'bug',
  'mak',
  'gor',
  'mni',
  'lus',
  'kha',
  'dz',
  'kab',
  'kri',
  'tum',
  'luo',
  'mer',
  'arn',
  'hmn',
] as const;

const localeMeta: Record<string, Partial<Pick<ContentLocaleOption, 'label' | 'promptName' | 'marketName' | 'aliases'>>> = {
  'en-us': {
    label: 'English (United States)',
    promptName: 'English (United States)',
    aliases: ['american english', 'english us', 'us english', 'united states'],
  },
  'en-gb': {
    label: 'English (United Kingdom)',
    promptName: 'English (United Kingdom)',
    aliases: ['british english', 'english uk', 'uk english', 'united kingdom'],
  },
  'en-au': {
    label: 'English (Australia)',
    promptName: 'English (Australia)',
    aliases: ['australian english', 'english australia'],
  },
  'en-ca': {
    label: 'English (Canada)',
    promptName: 'English (Canada)',
    aliases: ['canadian english', 'english canada'],
  },
  'en-in': {
    label: 'English (India)',
    promptName: 'English (India)',
    aliases: ['indian english', 'english india'],
  },
  'es-es': {
    label: 'Spanish (Spain)',
    promptName: 'Spanish (Spain)',
    aliases: ['castilian', 'spanish spain'],
  },
  'es-mx': {
    label: 'Spanish (Mexico)',
    promptName: 'Spanish (Mexico)',
    aliases: ['mexican spanish', 'spanish mexico'],
  },
  'es-ar': {
    label: 'Spanish (Argentina)',
    promptName: 'Spanish (Argentina)',
    aliases: ['argentinian spanish', 'spanish argentina'],
  },
  'es-co': {
    label: 'Spanish (Colombia)',
    promptName: 'Spanish (Colombia)',
    aliases: ['colombian spanish', 'spanish colombia'],
  },
  'fr-fr': {
    label: 'French (France)',
    promptName: 'French (France)',
    aliases: ['french france'],
  },
  'fr-ca': {
    label: 'French (Canada)',
    promptName: 'French (Canada)',
    aliases: ['canadian french', 'quebec french', 'french canada'],
  },
  'fr-be': {
    label: 'French (Belgium)',
    promptName: 'French (Belgium)',
    aliases: ['belgian french', 'french belgium'],
  },
  'de-de': {
    label: 'German (Germany)',
    promptName: 'German (Germany)',
  },
  'de-at': {
    label: 'German (Austria)',
    promptName: 'German (Austria)',
    aliases: ['austrian german'],
  },
  'de-ch': {
    label: 'German (Switzerland)',
    promptName: 'German (Switzerland)',
    aliases: ['swiss german'],
  },
  'it-it': {
    label: 'Italian (Italy)',
    promptName: 'Italian (Italy)',
  },
  'pt-pt': {
    label: 'Portuguese (Portugal)',
    promptName: 'Portuguese (Portugal)',
    aliases: ['european portuguese', 'portuguese portugal'],
  },
  'pt-br': {
    label: 'Portuguese (Brazil)',
    promptName: 'Brazilian Portuguese',
    aliases: ['brazilian portuguese', 'portuguese brazil', 'brasil'],
  },
  'nl-nl': {
    label: 'Dutch (Netherlands)',
    promptName: 'Dutch (Netherlands)',
  },
  'nl-be': {
    label: 'Dutch (Belgium)',
    promptName: 'Dutch (Belgium)',
    aliases: ['flemish', 'belgian dutch'],
  },
  'pl-pl': {
    label: 'Polish (Poland)',
    promptName: 'Polish (Poland)',
  },
  'ro-ro': {
    label: 'Romanian (Romania)',
    promptName: 'Romanian (Romania)',
  },
  'cs-cz': {
    label: 'Czech (Czechia)',
    promptName: 'Czech (Czechia)',
  },
  'sk-sk': {
    label: 'Slovak (Slovakia)',
    promptName: 'Slovak (Slovakia)',
  },
  'sl-si': {
    label: 'Slovenian (Slovenia)',
    promptName: 'Slovenian (Slovenia)',
  },
  'hr-hr': {
    label: 'Croatian (Croatia)',
    promptName: 'Croatian (Croatia)',
  },
  'sr-latn': {
    label: 'Serbian (Latin)',
    promptName: 'Serbian (Latin)',
    aliases: ['serbian latin', 'latin serbian'],
  },
  'sr-rs': {
    label: 'Serbian (Serbia)',
    promptName: 'Serbian (Serbia)',
  },
  'ru-ru': {
    label: 'Russian (Russia)',
    promptName: 'Russian (Russia)',
  },
  'uk-ua': {
    label: 'Ukrainian (Ukraine)',
    promptName: 'Ukrainian (Ukraine)',
  },
  'ar-sa': {
    label: 'Arabic (Saudi Arabia)',
    promptName: 'Arabic (Saudi Arabia)',
    aliases: ['saudi arabic'],
  },
  'ar-eg': {
    label: 'Arabic (Egypt)',
    promptName: 'Arabic (Egypt)',
    aliases: ['egyptian arabic'],
  },
  'ar-ae': {
    label: 'Arabic (UAE)',
    promptName: 'Arabic (United Arab Emirates)',
    aliases: ['uae arabic', 'emirati arabic'],
  },
  fa: {
    label: 'Persian',
    promptName: 'Persian',
    aliases: ['farsi'],
  },
  'hi-in': {
    label: 'Hindi (India)',
    promptName: 'Hindi (India)',
  },
  ckb: {
    label: 'Central Kurdish',
    promptName: 'Central Kurdish',
    aliases: ['sorani'],
  },
  'tr-tr': {
    label: 'Turkish (Turkey)',
    promptName: 'Turkish (Turkey)',
  },
  'zh-cn': {
    label: 'Chinese (Simplified)',
    promptName: 'Simplified Chinese',
    aliases: ['simplified chinese', 'chinese simplified', 'mandarin simplified', 'china chinese'],
  },
  'zh-tw': {
    label: 'Chinese (Traditional)',
    promptName: 'Traditional Chinese',
    aliases: ['traditional chinese', 'chinese traditional', 'taiwan chinese'],
  },
  'zh-hk': {
    label: 'Chinese (Hong Kong)',
    promptName: 'Chinese (Hong Kong)',
    aliases: ['hong kong chinese', 'traditional chinese hong kong'],
  },
  'zh-sg': {
    label: 'Chinese (Singapore)',
    promptName: 'Chinese (Singapore)',
    aliases: ['singapore chinese'],
  },
  yue: {
    label: 'Cantonese',
    promptName: 'Cantonese',
  },
  wuu: {
    label: 'Wu Chinese',
    promptName: 'Wu Chinese',
  },
  gan: {
    label: 'Gan Chinese',
    promptName: 'Gan Chinese',
  },
  nan: {
    label: 'Min Nan Chinese',
    promptName: 'Min Nan Chinese',
    aliases: ['hokkien', 'taiwanese hokkien'],
  },
  'ja-jp': {
    label: 'Japanese (Japan)',
    promptName: 'Japanese (Japan)',
  },
  'ko-kr': {
    label: 'Korean (South Korea)',
    promptName: 'Korean (South Korea)',
  },
  'vi-vn': {
    label: 'Vietnamese (Vietnam)',
    promptName: 'Vietnamese (Vietnam)',
    aliases: ['tieng viet', 'viet'],
  },
  'th-th': {
    label: 'Thai (Thailand)',
    promptName: 'Thai (Thailand)',
  },
  'ms-my': {
    label: 'Malay (Malaysia)',
    promptName: 'Malay (Malaysia)',
  },
  'id-id': {
    label: 'Indonesian (Indonesia)',
    promptName: 'Indonesian (Indonesia)',
    aliases: ['bahasa indonesia'],
  },
  fil: {
    label: 'Filipino',
    promptName: 'Filipino',
  },
  'fil-ph': {
    label: 'Filipino (Philippines)',
    promptName: 'Filipino (Philippines)',
  },
  tl: {
    label: 'Tagalog',
    promptName: 'Tagalog',
  },
  nso: {
    label: 'Northern Sotho',
    promptName: 'Northern Sotho',
    aliases: ['sepedi'],
  },
  pap: {
    label: 'Papiamento',
    promptName: 'Papiamento',
  },
  iu: {
    label: 'Inuktitut',
    promptName: 'Inuktitut',
  },
  se: {
    label: 'Northern Sami',
    promptName: 'Northern Sami',
  },
  tpi: {
    label: 'Tok Pisin',
    promptName: 'Tok Pisin',
  },
  bcl: {
    label: 'Central Bikol',
    promptName: 'Central Bikol',
  },
  min: {
    label: 'Minangkabau',
    promptName: 'Minangkabau',
  },
  mni: {
    label: 'Manipuri',
    promptName: 'Manipuri',
  },
  lus: {
    label: 'Mizo',
    promptName: 'Mizo',
  },
  dz: {
    label: 'Dzongkha',
    promptName: 'Dzongkha',
  },
  kab: {
    label: 'Kabyle',
    promptName: 'Kabyle',
  },
  kri: {
    label: 'Krio',
    promptName: 'Krio',
  },
  luo: {
    label: 'Luo',
    promptName: 'Luo',
  },
  mer: {
    label: 'Meru',
    promptName: 'Meru',
  },
  arn: {
    label: 'Mapudungun',
    promptName: 'Mapudungun',
  },
  hmn: {
    label: 'Hmong',
    promptName: 'Hmong',
  },
};

const displayNames = createLanguageDisplayNames();

export const contentLocaleOptions: ContentLocaleOption[] = [AUTO_LOCALE_OPTION, ...popularLocaleValues.map(createLocaleOption)];

const contentLocaleOptionMap = new Map(contentLocaleOptions.map((option) => [option.value, option]));
const localeAliasMap = buildLocaleAliasMap(contentLocaleOptions);

const ctaByLocale: Record<StaticLocaleKey, IntentCopyMap> = {
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
};

const cueByLocale: Record<StaticLocaleKey, IntentCopyMap> = {
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
};

export function getContentLocaleOption(locale: ContentLocale): ContentLocaleOption {
  return contentLocaleOptionMap.get(locale) || createLocaleOption(locale);
}

export function searchContentLocaleOptions(query: string, limit = 36): ContentLocaleOption[] {
  const normalizedQuery = normalizePromptText(query);
  if (!normalizedQuery) return contentLocaleOptions.slice(0, Math.max(1, limit));

  const matches = contentLocaleOptions
    .map((option) => ({ option, score: scoreLocaleOption(option, normalizedQuery) }))
    .filter((entry) => entry.score < Number.POSITIVE_INFINITY)
    .sort((left, right) => left.score - right.score || left.option.label.localeCompare(right.option.label));

  return matches.slice(0, Math.max(1, limit)).map((entry) => entry.option);
}

export function hasStaticLocaleCopy(locale: ContentLocale) {
  return isStaticLocaleKey(locale);
}

export function applyContentLocaleToPrompt(prompt: string, locale: ContentLocale) {
  const base = prompt.trim();
  if (locale === 'auto') return base;
  const option = getContentLocaleOption(locale);
  const sanitizedBase = stripPromptLanguageInstructions(base);
  return [
    `Language: ${option.promptName}.`,
    `Selected localization target: ${option.promptName}. Ignore any conflicting language names or translation requests that may appear later in the raw prompt.`,
    `Localization mode: keep the same composition, layout hierarchy, framing, subject placement, and overall creative system as the source/reference.`,
    `Generate a very similar image first, then localize the market-facing copy and subtle cultural cues for the ${option.marketName} without rebuilding the layout.`,
    `Localize CTA text, cue text, and any preserved in-image text into ${option.promptName}.`,
    `If the reference contains headline or supporting copy, preserve roughly the same text block count, alignment, and visual footprint while translating it.`,
    `Only make subtle local-market adjustments in typography feel, props, atmosphere, or styling details when helpful. Do not switch to a different art direction unless the prompt explicitly asks for it.`,
    sanitizedBase,
  ]
    .filter(Boolean)
    .join('\n');
}

export function resolvePromptLocale(prompt: string): ContentLocale {
  const matches = prompt.match(/(?:language|ngon ngu)\s*:\s*([^\n.]+)/i);
  const requested = matches?.[1]?.trim() || '';
  if (!requested) return 'auto';
  return matchLocaleValue(requested) || 'auto';
}

export function localizeDefaultCtaText(intent: PlayableIntent, locale: ContentLocale) {
  if (!isStaticLocaleKey(locale)) return '';
  return ctaByLocale[locale][intent] || '';
}

export function localizeDefaultCueText(intent: PlayableIntent, locale: ContentLocale, direction: Direction) {
  if (!isStaticLocaleKey(locale)) return '';
  if (locale === 'en') {
    if (intent === 'swipe_reveal' && direction === 'up') return 'Swipe up to explore';
    if (intent === 'swipe_reveal' && direction === 'down') return 'Swipe down to explore';
  }
  if (locale === 'vi') {
    if (intent === 'swipe_reveal' && direction === 'up') return 'Vuot len de kham pha';
    if (intent === 'swipe_reveal' && direction === 'down') return 'Vuot xuong de kham pha';
  }
  return cueByLocale[locale][intent] || '';
}

function createLanguageDisplayNames() {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    return null;
  }
}

function createLocaleOption(value: string): ContentLocaleOption {
  const meta = localeMeta[value] || {};
  const promptName = meta.promptName || defaultLanguageLabel(value);
  const label = meta.label || promptName;
  const marketName = meta.marketName || `${promptName} market`;
  const aliases = uniqueAliases([
    value,
    value.replace(/-/g, ' '),
    label,
    promptName,
    ...(meta.aliases || []),
  ]);

  return {
    value,
    label,
    promptName,
    marketName,
    aliases,
  };
}

function defaultLanguageLabel(value: string) {
  const intlTag = toIntlLocaleTag(value);
  try {
    const displayLabel = displayNames?.of(intlTag);
    if (displayLabel && displayLabel !== intlTag) return displayLabel;
  } catch {
    // Fall back to a readable code label if Intl does not recognize the locale.
  }
  return humanizeLocaleCode(value);
}

function toIntlLocaleTag(value: string) {
  const parts = value.split('-').filter(Boolean);
  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index === 0) return lower;
      if (lower.length === 4) return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
      return lower.toUpperCase();
    })
    .join('-');
}

function humanizeLocaleCode(value: string) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.toUpperCase())
    .join(' ');
}

function uniqueAliases(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = normalizePromptText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(value);
  }
  return unique;
}

function buildLocaleAliasMap(options: ContentLocaleOption[]) {
  const aliasMap = new Map<string, ContentLocale>();
  for (const option of options) {
    for (const alias of option.aliases) {
      const normalized = normalizePromptText(alias);
      if (!normalized || aliasMap.has(normalized)) continue;
      aliasMap.set(normalized, option.value);
    }
  }
  return aliasMap;
}

function matchLocaleValue(value: string): ContentLocale | null {
  const normalized = normalizePromptText(value);
  if (!normalized) return null;
  const exact = localeAliasMap.get(normalized);
  if (exact) return exact;

  const partial = contentLocaleOptions.find((option) =>
    option.aliases.some((alias) => {
      const normalizedAlias = normalizePromptText(alias);
      return normalizedAlias.includes(normalized) || normalized.includes(normalizedAlias);
    }),
  );

  return partial?.value || null;
}

function scoreLocaleOption(option: ContentLocaleOption, normalizedQuery: string) {
  let best = Number.POSITIVE_INFINITY;
  for (const alias of option.aliases) {
    const normalizedAlias = normalizePromptText(alias);
    if (normalizedAlias === normalizedQuery) return 0;
    if (normalizedAlias.startsWith(normalizedQuery)) best = Math.min(best, 1);
    else if (normalizedAlias.includes(normalizedQuery)) best = Math.min(best, 2);
  }
  return best;
}

function isStaticLocaleKey(locale: ContentLocale): locale is StaticLocaleKey {
  return locale === 'en' || locale === 'vi' || locale === 'es' || locale === 'fr' || locale === 'de' || locale === 'pt-br' || locale === 'id';
}

function stripPromptLanguageInstructions(prompt: string) {
  let next = prompt;
  const patterns = [
    /(?:^|[\n.;])\s*(?:language|ngon ngu)\s*:\s*[^\n.;]+/giu,
    /(?:^|[\n.;])\s*(?:doi|đổi|translate|localize|switch|change)\b[^\n.;]*(?:tieng|tiếng|language)\b[^\n.;]*/giu,
    /(?:^|[\n.;])\s*(?:use|set|viet|write)\b[^\n.;]*(?:tieng|tiếng|language)\b[^\n.;]*/giu,
  ];

  for (const pattern of patterns) {
    next = next.replace(pattern, ' ');
  }

  return next
    .replace(/\s*([,.;])\s*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .replace(/^[,.;\s]+|[,.;\s]+$/g, '')
    .trim();
}

function normalizePromptText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
