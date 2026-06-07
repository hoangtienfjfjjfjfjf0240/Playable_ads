import { heuristicPlanFromHotspot, normalizePlayablePlan, playableIntentLabels } from './playable-plan';
import type { PlayableLayerAsset } from './playable-layers';
import type {
  ButtonAnimation,
  Hotspot,
  Orientation,
  PlayableIntent,
  PlayablePlan,
  ProjectSettings,
  StorePlatform,
  StoreRoutingMode,
  TextCueAnimation,
} from './types';

export interface PlayableCloneLayoutBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tag: string;
  className: string;
}

export interface PlayableCloneLayoutSnapshot {
  buttons: PlayableCloneLayoutBox[];
  texts: PlayableCloneLayoutBox[];
}

export interface PlayableCloneInference {
  ctaText: string;
  cueText: string;
  animationHints: string[];
  summary: string[];
  analysisMode: 'heuristic' | 'ai-vision' | 'hybrid';
  sourceKind: string;
  sourceLayout: PlayableCloneLayoutSnapshot | null;
  storeSettings: Pick<ProjectSettings, 'storeUrl' | 'appStoreUrl' | 'googlePlayUrl' | 'storePlatform' | 'storeRoutingMode'>;
  plan: PlayablePlan;
}

export function inferPlayableClonePlan({
  html,
  assets,
  hotspot,
  prompt,
  layout = null,
  sourceKind = 'image',
  visionPlan = null,
}: {
  html: string;
  assets: PlayableLayerAsset[];
  hotspot: Hotspot;
  prompt: string;
  layout?: PlayableCloneLayoutSnapshot | null;
  sourceKind?: string;
  visionPlan?: PlayablePlan | null;
}): PlayableCloneInference {
  const sanitizedHtml = sanitizeCloneHtml(html);
  const extractedTexts = extractTextCandidates(sanitizedHtml);
  const layoutTexts = collectLayoutTexts(layout);
  const allTexts = dedupeStrings([...layoutTexts, ...extractedTexts]);
  const ctaCandidate = pickCtaCandidate(layout, allTexts);
  const cueCandidate = pickCueCandidate(layout, allTexts, ctaCandidate?.text || '');
  const ctaText = ctaCandidate?.text || '';
  const cueText = cueCandidate?.text || '';
  const animationHints = collectAnimationHints({
    html: sanitizedHtml,
    cueText,
    ctaText,
    assets,
    layout,
  });
  const corpus = normalizeText([prompt, cueText, ctaText, allTexts.join(' '), animationHints.join(' ')].filter(Boolean).join('\n'));
  const inferredIntent = inferIntentFromSignals({
    prompt,
    cueText,
    ctaText,
    textCorpus: corpus,
    animationHints,
  });
  const heuristicPlan = heuristicPlanFromHotspot(hotspot, 1, buildIntentSeed(inferredIntent, prompt, cueText, ctaText, corpus));

  const ctaBox = ctaCandidate ? boxCenter(ctaCandidate) : null;
  const cueBox = cueCandidate ? boxCenter(cueCandidate) : null;
  const hintText = normalizeText(`${corpus}\n${sanitizedHtml}`);
  const preferredPlan = visionPlan || heuristicPlan;
  const intent = preferredPlan.intent;
  const plan = normalizePlayablePlan(
    {
      ...heuristicPlan,
      ...(visionPlan || {}),
      intent,
      reason: buildReason(intent, cueText || visionPlan?.cue.text || '', ctaText || visionPlan?.cta.text || '', animationHints),
      handMotion: visionPlan?.handMotion || inferHandMotionHint(intent, hintText, heuristicPlan.handMotion),
      scanStyle: visionPlan?.scanStyle || inferScanStyle(intent, hintText, heuristicPlan.scanStyle),
      cta: {
        ...heuristicPlan.cta,
        ...(visionPlan?.cta || {}),
        text: ctaText || visionPlan?.cta.text || heuristicPlan.cta.text,
        x: ctaBox?.x ?? visionPlan?.cta.x ?? heuristicPlan.cta.x,
        y: ctaBox?.y ?? visionPlan?.cta.y ?? heuristicPlan.cta.y,
        animation: visionPlan?.cta.animation || inferButtonAnimation(hintText, heuristicPlan.cta.animation),
      },
      cue: {
        ...heuristicPlan.cue,
        ...(visionPlan?.cue || {}),
        text: cueText || visionPlan?.cue.text || heuristicPlan.cue.text,
        x: cueBox?.x ?? visionPlan?.cue.x ?? heuristicPlan.cue.x,
        y: cueBox?.y ?? visionPlan?.cue.y ?? heuristicPlan.cue.y,
        animation: visionPlan?.cue.animation || inferCueAnimation(intent, hintText, heuristicPlan.cue.animation),
      },
      confidence: visionPlan
        ? Math.max(
            visionPlan.confidence,
            inferConfidence(intent, cueText || visionPlan.cue.text, ctaText || visionPlan.cta.text, animationHints, layout),
          )
        : inferConfidence(intent, cueText, ctaText, animationHints, layout),
      source: visionPlan ? 'ai' : 'heuristic',
    },
    hotspot,
    1,
    buildIntentSeed(intent, prompt, cueText, ctaText, corpus),
  );

  return {
    ctaText,
    cueText,
    animationHints,
    summary: buildSummary(allTexts, assets, layout, sourceKind, Boolean(visionPlan)),
    analysisMode: visionPlan ? (sourceKind === 'video' ? 'ai-vision' : 'hybrid') : 'heuristic',
    sourceKind,
    sourceLayout: layout,
    storeSettings: extractStoreSettings(html),
    plan,
  };
}

export function createPlayableClonePromptSeed(inference?: PlayableCloneInference) {
  const intentNote = inference
    ? `Preserve the same interaction intent: ${playableIntentLabels[inference.plan.intent]}.`
    : 'Preserve the same interaction intent and same product use case as the source playable.';
  const targetNote = inference
    ? `Keep the main focus area near ${Math.round(inference.plan.target.x)}% x ${Math.round(inference.plan.target.y)}% of the frame so runtime overlays land in the right place.`
    : 'Keep the main focus area clear for runtime overlays.';
  return [
    'Rebuild the same campaign scene from the source playable, not a different concept.',
    intentNote,
    targetNote,
    'Keep the same product context, same use case, and similar on-screen hierarchy.',
    'Fill the full 9:16 canvas with no white margins or empty lower padding.',
    'Do not draw hand cursors, scan boxes, CTA buttons, tap text, or editor UI into the image.',
  ].join(' ');
}

export function buildPlayableClonePrompt({
  userPrompt,
  inference,
  orientation,
}: {
  userPrompt: string;
  inference: PlayableCloneInference;
  orientation: Orientation;
}) {
  const aspectRatio = orientation === 'landscape' ? '16:9' : '9:16';
  const intentLabel = playableIntentLabels[inference.plan.intent];
  const scanNote =
    inference.plan.intent === 'scan_object' || inference.plan.intent === 'count_result'
      ? 'Leave the main product area clean so a runtime scan frame can sit on top of it.'
      : '';
  const copyNote = [
    inference.cueText ? `Source cue text for runtime overlay: ${inference.cueText}.` : '',
    inference.ctaText ? `Source CTA text for runtime overlay: ${inference.ctaText}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const sourceNote =
    inference.sourceKind === 'video'
      ? 'The source reference is a captured video playable frame. Keep the same composition, device mockup, mascot placement, and scene hierarchy unless the user prompt explicitly changes them.'
      : 'Keep the same composition hierarchy and visual structure as the source playable.';

  return [
    'Use the attached source playable frame as the layout and campaign reference.',
    `Generate a new complete ${aspectRatio} mobile ad background image.`,
    `Preserve the same interaction intent: ${intentLabel}.`,
    `Keep the interaction target around ${Math.round(inference.plan.target.x)}% x ${Math.round(inference.plan.target.y)}% of the frame.`,
    'Preserve the same product story, same feature use case, and a similar UI structure to the source playable.',
    sourceNote,
    copyNote,
    scanNote,
    userPrompt ? `Creative request: ${userPrompt}` : '',
    'Make the image full-bleed with no black bars, padding, borders, or white margins.',
    'Do not include runtime hand cursors, scan boxes, CTA buttons, tap text, timelines, or editor UI in the image. Keep phone or device mockups only when they are part of the original creative scene.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildReason(intent: PlayableIntent, cueText: string, ctaText: string, hints: string[]) {
  const tokens = [`clone ${playableIntentLabels[intent]}`];
  if (cueText) tokens.push(`cue ${cueText}`);
  if (ctaText) tokens.push(`cta ${ctaText}`);
  if (hints.length) tokens.push(hints.slice(0, 3).join('/'));
  return tokens.join(' · ').slice(0, 240);
}

function buildSummary(
  texts: string[],
  assets: PlayableLayerAsset[],
  layout: PlayableCloneLayoutSnapshot | null,
  sourceKind: string,
  usedVisionPlan: boolean,
) {
  const summary = texts.slice(0, 4);
  summary.unshift(`source ${sourceKind}`);
  if (usedVisionPlan) summary.unshift('ai vision plan');
  if (layout?.buttons.length) summary.push(`${layout.buttons.length} visible buttons`);
  if (layout?.texts.length) summary.push(`${layout.texts.length} visible texts`);
  const roleCounts = new Map<string, number>();
  for (const asset of assets) {
    roleCounts.set(asset.role, (roleCounts.get(asset.role) || 0) + 1);
  }
  for (const [role, count] of roleCounts) {
    if (count > 0 && (role === 'cta' || role === 'tutorial' || role === 'product' || role === 'effect')) {
      summary.push(`${count} ${role} asset${count > 1 ? 's' : ''}`);
    }
  }
  return dedupeStrings(summary).slice(0, 8);
}

function extractStoreSettings(html: string): Pick<
  ProjectSettings,
  'storeUrl' | 'appStoreUrl' | 'googlePlayUrl' | 'storePlatform' | 'storeRoutingMode'
> {
  const urls = [...new Set(html.match(/https?:\/\/[^\s"'<>`]+/gi) || [])];
  const appStoreUrl = urls.find((url) => /apps\.apple\.com|itunes\.apple\.com/i.test(url)) || '';
  const googlePlayUrl = urls.find((url) => /play\.google\.com|market:\/\//i.test(url)) || '';
  const storeUrl =
    urls.find((url) => !/apps\.apple\.com|itunes\.apple\.com|play\.google\.com|market:\/\//i.test(url)) || '';
  const storeRoutingMode: StoreRoutingMode = appStoreUrl && googlePlayUrl ? 'platform-auto' : 'single';
  const storePlatform: StorePlatform = appStoreUrl ? 'app-store' : googlePlayUrl ? 'google-play' : 'custom';
  return {
    storeUrl,
    appStoreUrl,
    googlePlayUrl,
    storePlatform,
    storeRoutingMode,
  };
}

function collectLayoutTexts(layout: PlayableCloneLayoutSnapshot | null) {
  if (!layout) return [];
  return dedupeStrings([
    ...layout.buttons.map((item) => item.text),
    ...layout.texts.map((item) => item.text),
  ]);
}

function sanitizeCloneHtml(html: string) {
  return html
    .replace(/data:(?:video|image|audio)\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi, ' ')
    .replace(/<\?xpacket[\s\S]*?\?>/gi, ' ')
    .replace(/\b(?:xmpmeta|rdf:description|after effects|videoframesize)\b/gi, ' ');
}

function extractTextCandidates(html: string) {
  const output: string[] = [];
  const push = (value: string) => {
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2 || text.length > 56) return;
    if (/^(script|style|function|return|null|true|false)$/i.test(text)) return;
    if (/^[#@._\-/:0-9 ]+$/.test(text)) return;
    if (!output.includes(text)) output.push(text);
  };

  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script,style,noscript').forEach((node) => node.remove());
      doc
        .querySelectorAll('button,a,[role="button"],h1,h2,h3,h4,p,span,strong,b,small,div')
        .forEach((node) => push(node.textContent || ''));
      doc.querySelectorAll('[aria-label],[title],[alt]').forEach((node) => {
        push(node.getAttribute('aria-label') || '');
        push(node.getAttribute('title') || '');
        push(node.getAttribute('alt') || '');
      });
      return output;
    } catch {
      // Fallback below.
    }
  }

  const plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');
  plain
    .split(' ')
    .reduce<string[]>((chunks, word) => {
      const last = chunks[chunks.length - 1] || '';
      if (!last || last.length > 34) chunks.push(word);
      else chunks[chunks.length - 1] = `${last} ${word}`;
      return chunks;
    }, [])
    .forEach(push);
  return output;
}

function pickCtaCandidate(layout: PlayableCloneLayoutSnapshot | null, texts: string[]) {
  const candidates: PlayableCloneLayoutBox[] = [];
  if (layout?.buttons.length) candidates.push(...layout.buttons);
  candidates.push(
    ...texts
      .map((text) => ({
        text,
        x: 50,
        y: 88,
        width: 46,
        height: 10,
        tag: 'text',
        className: '',
      }))
      .filter((item) => ctaKeywordScore(item.text) > 0),
  );

  let best: { box: PlayableCloneLayoutBox; score: number } | null = null;
  for (const candidate of candidates) {
    const score =
      ctaKeywordScore(candidate.text) +
      (candidate.y > 68 ? 4 : 0) +
      (candidate.width > 24 ? 2 : 0) +
      (candidate.tag === 'button' || candidate.tag === 'a' ? 4 : 0) +
      (candidate.text.length <= 28 ? 1 : 0);
    if (!best || score > best.score) best = { box: candidate, score };
  }
  return best?.box || null;
}

function pickCueCandidate(layout: PlayableCloneLayoutSnapshot | null, texts: string[], ctaText: string) {
  const candidates: PlayableCloneLayoutBox[] = [
    ...(layout?.texts || []),
    ...texts.map((text) => ({
      text,
      x: 50,
      y: 72,
      width: 48,
      height: 9,
      tag: 'text',
      className: '',
    })),
  ];

  let best: { box: PlayableCloneLayoutBox; score: number } | null = null;
  for (const candidate of candidates) {
    if (!candidate.text || candidate.text === ctaText) continue;
    const score =
      cueKeywordScore(candidate.text) +
      (candidate.y > 38 && candidate.y < 84 ? 2 : 0) +
      (candidate.width > 20 ? 1 : 0) +
      (candidate.text.length <= 42 ? 1 : 0);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { box: candidate, score };
  }
  return best?.box || null;
}

function collectAnimationHints({
  html,
  cueText,
  ctaText,
  assets,
  layout,
}: {
  html: string;
  cueText: string;
  ctaText: string;
  assets: PlayableLayerAsset[];
  layout: PlayableCloneLayoutSnapshot | null;
}) {
  const lower = normalizeText(
    `${html}\n${cueText}\n${ctaText}\n${assets.map((asset) => `${asset.role} ${asset.name}`).join('\n')}\n${collectLayoutTexts(layout).join('\n')}`,
  );
  const hints: string[] = [];
  if (/scan|camera|barcode|qr|detect|measure|pulse ring|reticle|frame box|finger|lens|flash/.test(lower)) hints.push('scan');
  if (/swipe|slide|before after|compare/.test(lower)) hints.push('swipe');
  if (/drag|match/.test(lower)) hints.push('drag');
  if (/tap|click|press|finger|hand|cursor|tutorial|touch/.test(lower)) hints.push('tap');
  if (/pulse|heartbeat|breath|glow/.test(lower)) hints.push('pulse');
  if (/bounce|pop/.test(lower)) hints.push('bounce');
  if (/shake|wiggle/.test(lower)) hints.push('shake');
  if (/blink|flash/.test(lower)) hints.push('blink');
  if (/shine|beam|sweep/.test(lower)) hints.push('shine');
  return hints.filter((hint, index) => hints.indexOf(hint) === index);
}

function inferIntentFromSignals({
  prompt,
  cueText,
  ctaText,
  textCorpus,
  animationHints,
}: {
  prompt: string;
  cueText: string;
  ctaText: string;
  textCorpus: string;
  animationHints: string[];
}): PlayableIntent {
  const lower = normalizeText([prompt, cueText, ctaText, textCorpus, animationHints.join(' ')].filter(Boolean).join('\n'));
  const scores: Record<PlayableIntent, number> = {
    tap_product: 0,
    tap_choice: 0,
    swipe_reveal: 0,
    drag_match: 0,
    scan_object: 0,
    before_after: 0,
    count_result: 0,
    hold_charge: 0,
    scratch_reveal: 0,
    cta_only: 0,
  };

  const hasScanWords = /(scan|camera|detect|measure|finger|lens|flash|heart|bpm|cardio|calorie|food|meal|face|barcode|qr|receipt|quet|nhan dien|do nhip tim|do calo)/.test(lower);
  const hasResultWords = /(count|counter|score|result|percent|progress|bpm|heart rate|calorie|kcal|steps|points|nova|eco score|nutri score|ket qua|chi so|measurement)/.test(lower);
  const hasTapWords = /(tap|click|touch|press|cham|nhan|bam)/.test(lower);
  const hasCompareWords = /(before after|before\/after|compare|comparison|so sanh|xem thay doi)/.test(lower);
  const hasSwipeWords = /(swipe|slide|scroll|vuot|truot|keo qua)/.test(lower);
  const hasDragWords = /(drag|drop|match|keo tha|tha vao|keo den)/.test(lower);
  const hasHoldWords = /(hold|press and hold|hold still|giu|nhan giu|an giu)/.test(lower);
  const hasChoiceWords = /(choose|choice|select|pick|option|lua chon|chon muc|chon dap an)/.test(lower);
  const hasScratchWords = /(scratch|reward|bonus|unlock|cao|mo thuong|reveal reward)/.test(lower);
  const hasCtaWords = /(install|download|play now|play|start|open|continue|shop now|design now|install now|cai ngay|mo ngay|choi ngay|scan now|check now)/.test(lower);

  if (hasScanWords) {
    scores.scan_object += 7;
    scores.count_result += 5;
  }
  if (hasResultWords) {
    scores.count_result += 7;
    scores.scan_object += 2;
  }
  if (hasTapWords) {
    scores.tap_product += 4;
    scores.scan_object += hasScanWords ? 2 : 0;
    scores.cta_only += hasCtaWords ? 2 : 0;
  }
  if (hasCompareWords) scores.before_after += 8;
  if (hasSwipeWords) {
    scores.swipe_reveal += 6;
    scores.before_after += hasCompareWords ? 2 : 0;
  }
  if (hasDragWords) scores.drag_match += 8;
  if (hasHoldWords) scores.hold_charge += 8;
  if (hasChoiceWords) scores.tap_choice += 8;
  if (hasScratchWords) scores.scratch_reveal += 8;
  if (hasCtaWords) scores.cta_only += 6;

  if (/tap the camera|place finger|camera lens|measurement area|measure heart|check product|tap to scan/.test(lower)) {
    scores.scan_object += 4;
    scores.count_result += 4;
  }
  if (/heart|bpm|pulse|cardio/.test(lower)) scores.count_result += 5;
  if (/calorie|kcal|nutri|eco score/.test(lower)) scores.count_result += 4;
  if (/before after/.test(lower)) scores.before_after += 4;
  if (/swipe/.test(lower) && !hasCompareWords) scores.swipe_reveal += 2;
  if (ctaText && !cueText && hasCtaWords && !hasScanWords) scores.cta_only += 3;
  if (cueText && /choose|select|option/.test(normalizeText(cueText))) scores.tap_choice += 4;
  if (cueText && /drag|match/.test(normalizeText(cueText))) scores.drag_match += 4;
  if (cueText && /hold|press/.test(normalizeText(cueText))) scores.hold_charge += 4;

  let bestIntent: PlayableIntent = 'cta_only';
  let bestScore = -Infinity;
  for (const intent of Object.keys(scores) as PlayableIntent[]) {
    if (scores[intent] > bestScore) {
      bestIntent = intent;
      bestScore = scores[intent];
    }
  }

  if (bestIntent === 'swipe_reveal' && hasScanWords) return hasResultWords ? 'count_result' : 'scan_object';
  if (bestIntent === 'before_after' && hasScanWords) return hasResultWords ? 'count_result' : 'scan_object';
  if (bestIntent === 'cta_only' && hasScanWords) return hasResultWords ? 'count_result' : 'scan_object';
  return bestIntent;
}

function buildIntentSeed(intent: PlayableIntent, prompt: string, cueText: string, ctaText: string, corpus: string) {
  const seeds: Record<PlayableIntent, string> = {
    tap_product: 'tap product tap product area view result',
    tap_choice: 'choose option tap choice select the best option',
    swipe_reveal: 'swipe reveal swipe up or swipe across to explore',
    drag_match: 'drag item to match the correct slot',
    scan_object: 'scan object camera detect tap to scan target area',
    before_after: 'swipe left right compare before after',
    count_result: 'measure result heart rate bpm score tap to scan camera result',
    hold_charge: 'press and hold hold to measure',
    scratch_reveal: 'scratch to reveal reward bonus',
    cta_only: 'tap install button cta only',
  };
  return [prompt, cueText, ctaText, seeds[intent], corpus].filter(Boolean).join('\n');
}

function inferButtonAnimation(lower: string, fallback: ButtonAnimation): ButtonAnimation {
  if (/shine|beam|sweep/.test(lower)) return 'shine';
  if (/bounce|pop/.test(lower)) return 'bounce';
  if (/shake|wiggle/.test(lower)) return 'shake';
  if (/breath|breathe|heartbeat/.test(lower)) return 'breath';
  if (/none/.test(lower)) return 'none';
  if (/pulse|glow|flash/.test(lower)) return 'pulse';
  return fallback;
}

function inferCueAnimation(intent: PlayableIntent, lower: string, fallback: TextCueAnimation): TextCueAnimation {
  if (intent === 'before_after' || intent === 'swipe_reveal') return 'float';
  if (intent === 'hold_charge' || intent === 'count_result') return 'breath';
  if (intent === 'drag_match') return 'bounce';
  if (/typewriter|typing/.test(lower)) return 'typewriter';
  if (/blink|flash/.test(lower)) return 'blink';
  if (/shake|wiggle/.test(lower)) return 'shake';
  if (/bounce|pop/.test(lower)) return 'bounce';
  if (/breath|breathe|heartbeat/.test(lower)) return 'breath';
  if (/float|hover/.test(lower)) return 'float';
  if (/none/.test(lower)) return 'none';
  if (/pulse|glow/.test(lower)) return 'pulse';
  return fallback;
}

function inferHandMotionHint(
  intent: PlayableIntent,
  lower: string,
  fallback: PlayablePlan['handMotion'],
): PlayablePlan['handMotion'] {
  if (intent === 'drag_match') return 'drag';
  if (intent === 'before_after' || intent === 'swipe_reveal' || intent === 'scratch_reveal') return 'swipeX';
  if (intent === 'hold_charge' || intent === 'count_result') return 'press';
  if (intent === 'tap_choice') return 'doubleTap';
  if (intent === 'scan_object') return /press and hold|hold/.test(lower) ? 'press' : 'tap';
  if (/drag|match/.test(lower)) return 'drag';
  if (/swipe up|swipe down|scroll|vuot len|vuot xuong/.test(lower)) return 'swipeY';
  if (/swipe|slide|compare|before after|scratch|vuot|truot|keo/.test(lower)) return 'swipeX';
  if (/hold|press and hold|press|nhan giu|giu/.test(lower)) return 'press';
  if (/choose|pick|option|double tap|double click/.test(lower)) return 'doubleTap';
  if (/shake|wiggle/.test(lower)) return 'shake';
  if (/wave/.test(lower)) return 'wave';
  if (/tap|click|touch|scan|camera|quet|cham|nhan/.test(lower)) return 'tap';
  return fallback;
}

function inferScanStyle(intent: PlayableIntent, lower: string, fallback: PlayablePlan['scanStyle']) {
  if (intent === 'cta_only') return 'none';
  if (intent === 'scan_object' || intent === 'count_result') return 'frame';
  if (/ring|pulse ring|halo/.test(lower)) return 'ring';
  if (/sweep|beam/.test(lower)) return 'sweep';
  if (/border/.test(lower)) return 'border';
  return fallback === 'none' ? 'frame' : fallback;
}

function inferConfidence(
  intent: PlayableIntent,
  cueText: string,
  ctaText: string,
  animationHints: string[],
  layout: PlayableCloneLayoutSnapshot | null,
) {
  let score = 0.54;
  if (cueText) score += 0.1;
  if (ctaText) score += 0.08;
  if (animationHints.length) score += Math.min(0.12, animationHints.length * 0.03);
  if (layout?.buttons.length) score += 0.06;
  if (layout?.texts.length) score += 0.04;
  if (intent === 'scan_object' || intent === 'count_result') score += 0.04;
  return Math.max(0.52, Math.min(0.92, score));
}

function ctaKeywordScore(text: string) {
  const lower = normalizeText(text);
  let score = 0;
  if (/(install|download|play now|play|start|open|continue|shop now|design now|try now|cai ngay|choi ngay|mo ngay|scan now|check now)/.test(lower)) score += 8;
  if (/now|today|free|install/.test(lower)) score += 2;
  if (text.length <= 28) score += 1;
  return score;
}

function cueKeywordScore(text: string) {
  const lower = normalizeText(text);
  let score = 0;
  if (/(tap|click|touch|swipe|drag|hold|press|scan|choose|match|compare|scratch|vuot|cham|nhan|keo|quet|so sanh|place finger|camera lens|measurement area)/.test(lower)) score += 8;
  if (/(heart|bpm|measure|detect|result)/.test(lower)) score += 2;
  if (text.length <= 42) score += 1;
  return score;
}

function boxCenter(box: PlayableCloneLayoutBox) {
  return {
    x: clamp(box.x + box.width / 2, 8, 92),
    y: clamp(box.y + box.height / 2, 16, 90),
  };
}

function dedupeStrings(values: string[]) {
  const output: string[] = [];
  for (const value of values) {
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text || output.includes(text)) continue;
    output.push(text);
  }
  return output;
}

function normalizeText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
