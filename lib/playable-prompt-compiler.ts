import { getContentLocaleOption, searchContentLocaleOptions } from './content-locales';
import type { ContentLocale, SourceKind } from './types';

export type PlayablePromptCompilerInput = {
  prompt: string;
  locale: ContentLocale;
  sourceKind?: SourceKind;
  referenceCount?: number;
  variantCount?: number;
  hasBrandAsset?: boolean;
};

type PromptFacts = {
  baseClauses: string[];
  additions: string[];
  removals: string[];
  requestedLanguage: string;
  requestedHeadline: string;
  requestedWordmark: string;
  keepLayout: boolean;
  explicitLayoutChange: boolean;
  keepSameHero: boolean;
  centerHero: boolean;
  variantDiversity: boolean;
  allowShortText: boolean;
};

export function compilePlayableGenerationPrompt(input: PlayablePromptCompilerInput) {
  const rawPrompt = normalizeWhitespace(input.prompt);
  if (!rawPrompt) return '';
  if (looksLikeCompiledPlayablePrompt(rawPrompt)) return rawPrompt;

  const facts = extractPromptFacts(rawPrompt);
  const localePromptName = input.locale !== 'auto' ? getContentLocaleOption(input.locale).promptName : '';
  const requestedLanguage = localePromptName || facts.requestedLanguage;
  const sourceKind = input.sourceKind === 'html' ? 'html' : 'image';
  const referenceCount = Math.max(0, Number(input.referenceCount || 0));
  const variantCount = Math.max(1, Number(input.variantCount || 1));
  const compiled: string[] = [];

  compiled.push(`User creative brief: ${facts.baseClauses.join(' | ') || rawPrompt}`);
  compiled.push(
    sourceKind === 'html'
      ? 'Reference rule: keep the imported playable frame as the primary composition, visual system, and campaign family unless the brief explicitly asks to rebuild the scene.'
      : facts.explicitLayoutChange
        ? 'Reference rule: keep the same campaign family and visual quality as the reference, but allow the requested layout change where the brief explicitly asks for it.'
        : 'Reference rule: keep the same overall composition, layout hierarchy, framing, and subject placement as the reference unless the brief explicitly asks to change them.',
  );

  if (referenceCount > 0) {
    compiled.push(
      `Secondary references: use all ${referenceCount} uploaded reference images as mandatory guidance for subject accuracy, styling consistency, lighting, props, and brand-world fidelity.`,
    );
  }

  if (facts.keepLayout && !facts.explicitLayoutChange) {
    compiled.push('Layout priority: preserve the source layout very closely and avoid rebuilding the creative from scratch.');
  }
  if (facts.keepSameHero) {
    compiled.push('Hero rule: preserve the same main product, meal, room, or core hero subject from the reference unless the brief explicitly asks for a different hero.');
  }
  if (facts.centerHero) {
    compiled.push('Placement rule: keep the main hero subject centered or near-center in the composition.');
  }
  if (facts.requestedWordmark) {
    compiled.push(
      `Brand wordmark: include the exact text "${facts.requestedWordmark}" once as clean branding or a short headline, not as a CTA button, chip, or scan label.`,
    );
  }
  if (facts.requestedHeadline) {
    compiled.push(`Allowed in-image copy: keep only this short marketing line if text is needed: "${facts.requestedHeadline}".`);
  } else if (facts.allowShortText) {
    compiled.push('Allowed in-image copy: keep at most one short headline and at most one short supporting line when the brief explicitly asks for text.');
  }
  if (requestedLanguage) {
    compiled.push(`Language: ${requestedLanguage}.`);
  }
  if (facts.additions.length) {
    compiled.push(`Explicit additions: ${joinDirectiveList(facts.additions)}.`);
  }
  if (facts.removals.length) {
    compiled.push(`Explicit removals: ${joinDirectiveList(facts.removals)}.`);
  }
  compiled.push(
    'Lower quarter rule: keep the bottom quarter visually simple with normal background treatment only, not dense props, tiny icons, repeated detail, heavy UI panels, or extra text.',
  );
  if (variantCount > 1 && facts.variantDiversity) {
    compiled.push(
      'Variant diversity rule: every variant must stay in the same campaign family but differ clearly in hero subject, crop emphasis, supporting props, or accent balance. Do not return near-duplicates.',
    );
  }
  if (input.hasBrandAsset) {
    compiled.push(
      'Uploaded logo rule: a separate uploaded logo or icon overlay may be added later, so avoid duplicating standalone corner badges, mascot stickers, or extra app icons inside the bitmap unless the brief explicitly asks for a wordmark.',
    );
  }
  compiled.push('Bitmap rule: return only the static background creative. Do not draw CTA buttons, install bars, scan frames, hand cursors, tap text, click cues, or editor UI into the bitmap.');

  return compiled.join('\n');
}

function extractPromptFacts(prompt: string): PromptFacts {
  const clauses = splitPromptClauses(prompt);
  const facts: PromptFacts = {
    baseClauses: [],
    additions: [],
    removals: [],
    requestedLanguage: detectRequestedLanguage(prompt),
    requestedHeadline: '',
    requestedWordmark: extractRequestedWordmark(prompt),
    keepLayout: false,
    explicitLayoutChange: false,
    keepSameHero: false,
    centerHero: false,
    variantDiversity: false,
    allowShortText: false,
  };

  for (const clause of clauses) {
    const value = normalizeForMatch(clause);
    if (!value) continue;

    const labeled = parseStructuredClause(clause);
    if (labeled.handled) {
      mergeStructuredFacts(facts, labeled.key, labeled.value);
      continue;
    }

    if (isLayoutKeepClause(value)) {
      facts.keepLayout = true;
      continue;
    }
    if (isLayoutChangeClause(value)) {
      facts.explicitLayoutChange = true;
      facts.baseClauses.push(clause);
      continue;
    }
    if (isSameHeroClause(value)) {
      facts.keepSameHero = true;
      facts.baseClauses.push(clause);
      continue;
    }
    if (isCenterHeroClause(value)) {
      facts.centerHero = true;
      continue;
    }
    if (isVariantDiversityClause(value)) {
      facts.variantDiversity = true;
      facts.baseClauses.push(clause);
      continue;
    }
    if (!facts.requestedHeadline && isHeadlineClause(value)) {
      facts.requestedHeadline = cleanDirectiveValue(clause);
      facts.allowShortText = true;
      continue;
    }
    if (isTextAllowanceClause(value)) {
      facts.allowShortText = true;
      facts.baseClauses.push(clause);
      continue;
    }
    if (isRemovalClause(value)) {
      facts.removals.push(cleanDirectiveValue(clause));
      continue;
    }
    if (isAdditionClause(value)) {
      facts.additions.push(cleanDirectiveValue(clause));
      continue;
    }
    if (!facts.requestedLanguage) {
      const requestedLanguage = detectRequestedLanguage(clause);
      if (requestedLanguage) {
        facts.requestedLanguage = requestedLanguage;
        continue;
      }
    }

    facts.baseClauses.push(clause);
  }

  if (!facts.baseClauses.length) {
    facts.baseClauses = [prompt];
  }

  facts.baseClauses = uniqueStrings(facts.baseClauses);
  facts.additions = uniqueStrings(facts.additions).filter(Boolean);
  facts.removals = uniqueStrings(facts.removals).filter(Boolean);
  return facts;
}

function parseStructuredClause(clause: string) {
  const match = clause.match(/^([^:=]{2,40})\s*[:=]\s*(.+)$/);
  if (!match) {
    return { handled: false as const, key: '', value: '' };
  }
  return {
    handled: true as const,
    key: normalizeForMatch(match[1]),
    value: match[2].trim(),
  };
}

function mergeStructuredFacts(facts: PromptFacts, key: string, value: string) {
  if (!value) return;
  if (/(^|\s)(language|locale|ngon ngu|tieng)(\s|$)/.test(key)) {
    facts.requestedLanguage = detectRequestedLanguage(value) || value;
    return;
  }
  if (/(^|\s)(logo text|wordmark|brand text|text logo)(\s|$)/.test(key)) {
    facts.requestedWordmark = value;
    return;
  }
  if (/(^|\s)(headline|title|main text|text chinh|tieu de)(\s|$)/.test(key)) {
    facts.requestedHeadline = value;
    facts.allowShortText = true;
    return;
  }
  if (/(^|\s)(remove|xoa|bo|hide)(\s|$)/.test(key)) {
    facts.removals.push(value);
    return;
  }
  if (/(^|\s)(add|them|include|show)(\s|$)/.test(key)) {
    facts.additions.push(value);
    return;
  }
  if (/(^|\s)(layout|composition|bo cuc|framing)(\s|$)/.test(key)) {
    if (isLayoutChangeClause(normalizeForMatch(value))) {
      facts.explicitLayoutChange = true;
    } else {
      facts.keepLayout = true;
    }
    facts.baseClauses.push(value);
    return;
  }
  if (/(^|\s)(hero|subject|main subject|product|meal|nhan vat|vat the)(\s|$)/.test(key)) {
    facts.baseClauses.push(value);
    if (isCenterHeroClause(normalizeForMatch(value))) {
      facts.centerHero = true;
    }
    return;
  }
  if (/(^|\s)(variant|variants|diversity|batch)(\s|$)/.test(key)) {
    facts.variantDiversity = true;
    facts.baseClauses.push(value);
    return;
  }

  facts.baseClauses.push(`${matchStructuredKeyLabel(key)}: ${value}`);
}

function splitPromptClauses(prompt: string) {
  return prompt
    .split(/\r?\n+|[.;]+/g)
    .map((clause) => normalizeWhitespace(clause))
    .filter(Boolean);
}

function detectRequestedLanguage(value: string) {
  const direct = normalizeWhitespace(value);
  if (!direct) return '';

  const patterns = [
    /(?:language|locale|ngon ngu)\s*[:=-]?\s*([^\n,.;]+)/i,
    /(?:doi(?:\s+qua)?|localize|translate)\s+(?:sang|qua|to)?\s*(?:tieng\s+)?([^\n,.;]+)/i,
    /tieng\s+([^\n,.;]+)/i,
  ];
  for (const pattern of patterns) {
    const match = direct.match(pattern);
    const candidate = match?.[1]?.trim();
    if (!candidate) continue;
    const option = searchContentLocaleOptions(candidate, 1)[0];
    if (option && option.value !== 'auto') return option.promptName;
  }

  if (direct.length <= 32) {
    const option = searchContentLocaleOptions(direct, 1)[0];
    if (option && option.value !== 'auto') return option.promptName;
  }
  return '';
}

function extractRequestedWordmark(prompt: string) {
  const patterns = [
    /(?:text\s*logo|logo\s*text|brand\s*text|wordmark)\s*(?:la|là|is|=|:)?\s*["“']?([^\n\r,.;]+)["”']?/i,
    /(?:them|thêm|add|keep|show|viet|write)\s*(?:text\s*)?(?:logo|wordmark|brand\s*text)\s*(?:la|là|is|=|:)?\s*["“']?([^\n\r,.;]+)["”']?/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const value = normalizeWhitespace(match?.[1] || '');
    if (value) return value;
  }
  return '';
}

function looksLikeCompiledPlayablePrompt(prompt: string) {
  return (
    /User creative brief:/i.test(prompt) ||
    /Reference rule:/i.test(prompt) ||
    /Bitmap rule:/i.test(prompt) ||
    /Create high-converting mobile playable ad background variants similar to the reference image/i.test(prompt)
  );
}

function isLayoutKeepClause(value: string) {
  return /(giu|keep|same|preserve).*(bo cuc|layout|composition|framing|crop|hierarchy)|same layout|same composition|keep layout/.test(value);
}

function isLayoutChangeClause(value: string) {
  return /(doi|change|rebuild|lam moi|refresh).*(bo cuc|layout|composition|framing)|new layout|different layout/.test(value);
}

function isSameHeroClause(value: string) {
  return /(van vay|giu nguyen|same).*(mon an|hero|product|subject|nhan vat|room|scene)|keep same hero|same meal|same product/.test(value);
}

function isCenterHeroClause(value: string) {
  return /(giua man hinh|center(?:ed)?|o giua).*(hero|subject|product|meal|mon an)|hero.*center|main subject.*center/.test(value);
}

function isVariantDiversityClause(value: string) {
  return /(khac nhau|different|moi variant|each variant|4 anh 4|4 variant 4|diverse|da dang).*(variant|anh|meal|mon an|hero|subject)|each variant.*different/.test(value);
}

function isHeadlineClause(value: string) {
  return /(headline|title|tieu de|text chinh|main text)\s*[:=-]?/.test(value);
}

function isTextAllowanceClause(value: string) {
  return /(them|add|keep|show).*(text|headline|title|copy|chu|wordmark)|text trong anh|in image text|viet text|viet headline/.test(value);
}

function isRemovalClause(value: string) {
  return /(xoa|remove|hide|bo|an|without|no).*(logo|brand|foodvisor|cta|button|scan|tay|hand|cursor|text|headline|sticker|badge|icon)/.test(value);
}

function isAdditionClause(value: string) {
  return /(them|add|include|show|bo sung|insert).*(logo|wordmark|headline|text|meal|product|hero|sun|cloud|background|props|healthy|summer)/.test(value);
}

function cleanDirectiveValue(value: string) {
  return normalizeWhitespace(
    value
      .replace(/^(remove|xoa|xoá|hide|bo|bỏ|an|without|no)\s*/i, '')
      .replace(/^(them|thêm|add|include|show|keep|giu|giữ)\s*/i, '')
      .replace(/^(headline|title|text|main text|text chinh|tieu de)\s*[:=-]\s*/i, ''),
  );
}

function joinDirectiveList(items: string[]) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function uniqueStrings(items: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const normalized = normalizeForMatch(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(item);
  }
  return output;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchStructuredKeyLabel(value: string) {
  return value
    .split(/\s+/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
