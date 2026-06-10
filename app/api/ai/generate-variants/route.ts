import { NextResponse } from 'next/server';
import pLimit from 'p-limit';
import sharp from 'sharp';
import { asDataUrl, dataUrlToBuffer } from '../../../../lib/server-data';
import { DEFAULT_VARIANT_COUNT, MAX_VARIANT_COUNT, normalizeVariantCount } from '../../../../lib/playable-plan';
import type { AiProvider } from '../../../../lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
const AI_MODEL = process.env.AI_MODEL || 'gpt-5.4';
const AI_IMAGE_MODEL = process.env.AI_IMAGE_MODEL || 'gpt-image-2';
const GEMINI_FLASH_IMAGE_MODEL = process.env.GEMINI_FLASH_IMAGE_MODEL || 'gemini/gemini-3.1-flash-image-preview';
const GEMINI_PRO_IMAGE_MODEL = process.env.GEMINI_PRO_IMAGE_MODEL || 'gemini/gemini-3-pro-image-preview';
const GEMINI_FALLBACK_IMAGE_MODEL = process.env.GEMINI_FALLBACK_IMAGE_MODEL || 'gemini/gemini-2.5-flash-image';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const startedAt = Date.now();
    if (body?.stream === true) return streamVariantResponse(body, startedAt);
    const { variants, errors } = await generateVariants(body);
    return NextResponse.json({ variants, errors, durationMs: Date.now() - startedAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI generation failed.' },
      { status: 500 },
    );
  }
}

type PreparedGeneration = {
  apiKey: string;
  provider: AiProvider;
  model: string;
  imageDataUrl: string;
  prompt: string;
  aspectRatio: string;
  count: number;
  hasBrandAssetOverlay: boolean;
  referenceMode: 'image' | 'playable-import';
  preferResponses: boolean;
  targetSize?: number;
};

function prepareGeneration(body: Record<string, unknown>): PreparedGeneration {
  const provider = parseAiProvider(body.provider);
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('AI_API_KEY is not configured on the server.');

  const imageDataUrl = String(body.imageDataUrl || '');
  if (!imageDataUrl.startsWith('data:image/')) throw new Error('A base64 image data URL is required.');

  return {
    apiKey,
    provider,
    model: String(body.model || getDefaultModel(provider)),
    imageDataUrl,
    prompt: String(body.prompt || ''),
    aspectRatio: String(body.aspectRatio || '9:16'),
    count: normalizeVariantCount(body.count || DEFAULT_VARIANT_COUNT),
    hasBrandAssetOverlay: body.hasBrandAssetOverlay === true,
    referenceMode: body.referenceMode === 'playable-import' ? 'playable-import' : 'image',
    preferResponses: body.preferResponses === true,
    targetSize: Number.isFinite(Number(body.targetSize)) ? Math.max(256, Math.min(2048, Math.round(Number(body.targetSize)))) : undefined,
  };
}

async function generateVariants(body: Record<string, unknown>) {
  const { apiKey, provider, model, imageDataUrl, prompt, aspectRatio, count, hasBrandAssetOverlay, referenceMode, preferResponses, targetSize } = prepareGeneration(body);
  const startedAt = Date.now();
  console.log(`[ai] generating ${count} variants in parallel with ${provider}:${model}`);

  const limit = pLimit(getImageConcurrency());
  const results = await Promise.allSettled(
    Array.from({ length: count }, (_, index) =>
      limit(() => generateOneVariant({ apiKey, provider, model, imageDataUrl, prompt, aspectRatio, hasBrandAssetOverlay, referenceMode, preferResponses, targetSize, index, count })),
    ),
  );

  const output = results
    .map((result) => (result.status === 'fulfilled' ? result.value : null))
    .filter((item): item is Awaited<ReturnType<typeof generateOneVariant>> => Boolean(item));
  const errors = results
    .map((result, index) => (result.status === 'rejected' ? `Variant ${index + 1}: ${getErrorMessage(result.reason)}` : ''))
    .filter(Boolean);

  console.log(`[ai] generated ${output.length}/${count} variants in ${Date.now() - startedAt}ms`);
  if (!output.length) throw new Error(errors.join('; ') || 'AI generation returned no images.');

  return { variants: output, errors };
}

function streamVariantResponse(body: Record<string, unknown>, startedAt: number) {
  const prepared = prepareGeneration(body);
  const encoder = new TextEncoder();
  let completed = 0;
  let produced = 0;
  const errors: string[] = [];

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      console.log(
        `[ai] streaming ${prepared.count} variants in parallel with ${prepared.provider}:${prepared.model}`,
      );
      send({ type: 'start', count: prepared.count });

      const limit = pLimit(getImageConcurrency());
      Array.from({ length: prepared.count }).forEach((_, index) => {
        limit(() => generateOneVariant({ ...prepared, index, count: prepared.count }))
          .then((variant) => {
            produced += 1;
            send({ type: 'variant', index, variant });
          })
          .catch((error) => {
            const message = `Variant ${index + 1}: ${getErrorMessage(error)}`;
            errors.push(message);
            send({ type: 'error', index, error: message });
          })
          .finally(() => {
            completed += 1;
            if (completed === prepared.count) {
              const durationMs = Date.now() - startedAt;
              console.log(`[ai] streamed ${produced}/${prepared.count} variants in ${durationMs}ms`);
              send({ type: 'done', count: produced, errors, durationMs });
              controller.close();
            }
          });
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

async function generateOneVariant({
  apiKey,
  provider,
  model,
  imageDataUrl,
  prompt,
  aspectRatio,
  hasBrandAssetOverlay,
  referenceMode,
  preferResponses,
  targetSize,
  index,
  count,
}: {
  apiKey: string;
  provider: AiProvider;
  model: string;
  imageDataUrl: string;
  prompt: string;
  aspectRatio: string;
  hasBrandAssetOverlay: boolean;
  referenceMode: 'image' | 'playable-import';
  preferResponses: boolean;
  targetSize?: number;
  index: number;
  count: number;
}) {
  const variantPrompt = buildVariantPrompt(prompt, index, count, aspectRatio, { hasBrandAssetOverlay, referenceMode });
  const startedAt = Date.now();
  let generated: { dataUrl: string; revisedPrompt?: string };

  try {
    if (provider === 'openai' && preferResponses) {
      generated = await callResponsesImageGeneration({ apiKey, model, imageDataUrl, prompt: variantPrompt });
      console.log(`[ai] variant ${index + 1}/${count} used responses-first`);
    } else {
      generated = await callImageEditGeneration({
        apiKey,
        model: provider === 'openai' ? AI_IMAGE_MODEL : model,
        imageDataUrl,
        prompt: variantPrompt,
      });
    }
  } catch (editError) {
    if (provider === 'openai' && preferResponses) {
      try {
        generated = await callImageEditGeneration({
          apiKey,
          model: AI_IMAGE_MODEL,
          imageDataUrl,
          prompt: variantPrompt,
          cause: editError instanceof Error ? editError : undefined,
        });
      } catch (editFallbackError) {
        throw new Error(`${getErrorMessage(editError)}; image edit fallback failed: ${getErrorMessage(editFallbackError)}`);
      }
    } else if (provider !== 'openai' && model !== GEMINI_FALLBACK_IMAGE_MODEL) {
      try {
        generated = await callImageEditGeneration({
          apiKey,
          model: GEMINI_FALLBACK_IMAGE_MODEL,
          imageDataUrl,
          prompt: variantPrompt,
          cause: editError instanceof Error ? editError : undefined,
        });
        console.log(`[ai] variant ${index + 1}/${count} used fallback ${GEMINI_FALLBACK_IMAGE_MODEL}`);
      } catch (fallbackError) {
        throw new Error(`${getErrorMessage(editError)}; gemini fallback failed: ${getErrorMessage(fallbackError)}`);
      }
    } else {
      try {
        generated = await callResponsesImageGeneration({ apiKey, model, imageDataUrl, prompt: variantPrompt });
      } catch (responsesError) {
        throw new Error(
          `${getErrorMessage(editError)}; responses fallback failed: ${getErrorMessage(responsesError)}`,
        );
      }
    }
  }

  console.log(`[ai] variant ${index + 1}/${count} done in ${Date.now() - startedAt}ms`);
  const normalized = await normalizeGeneratedImageToAspect(generated.dataUrl, aspectRatio, targetSize);

  return {
    name: `ai_variant_${index + 1}.png`,
    dataUrl: normalized,
    revisedPrompt: generated.revisedPrompt || '',
  };
}

async function normalizeGeneratedImageToAspect(dataUrl: string, aspectRatio: string, targetSize?: number) {
  const ratio = parseAspectRatio(aspectRatio);
  if (!ratio) return dataUrl;

  const target = getTargetDimensions(ratio, targetSize);
  const { buffer } = dataUrlToBuffer(dataUrl);
  const output = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(target.width, target.height, {
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();

  return asDataUrl(output.toString('base64'), 'png');
}

function parseAspectRatio(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!match) return 0;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  return width / height;
}

function getTargetDimensions(ratio: number, targetSize?: number) {
  if (Math.abs(ratio - 1) < 0.001) {
    const size = targetSize || 1024;
    return { width: size, height: size };
  }
  if (ratio > 1) {
    const height = 900;
    return { width: Math.round(height * ratio), height };
  }
  const width = 900;
  return { width, height: Math.round(width / ratio) };
}

function parseAiProvider(value: unknown): AiProvider {
  return value === 'gemini-flash' || value === 'gemini-pro' || value === 'openai' ? value : 'openai';
}

function getDefaultModel(provider: AiProvider) {
  if (provider === 'gemini-flash') return GEMINI_FLASH_IMAGE_MODEL;
  if (provider === 'gemini-pro') return GEMINI_PRO_IMAGE_MODEL;
  return AI_MODEL;
}

function buildVariantPrompt(
  prompt: string,
  index: number,
  count: number,
  aspectRatio: string,
  options?: { hasBrandAssetOverlay?: boolean; referenceMode?: 'image' | 'playable-import' },
) {
  const referenceMode = options?.referenceMode || 'image';
  const cleanPrompt = sanitizeBackgroundPrompt(prompt);
  const effectivePrompt = cleanPrompt || prompt.trim();
  const distinctnessRule = buildDistinctnessRule(effectivePrompt, count, referenceMode);
  const styleDirection = buildVariantStyleDirection(effectivePrompt, index, referenceMode);
  const textPolicyInstruction = buildInImageTextPolicyInstruction(prompt);
  const brandOverlayInstruction = buildBrandOverlayInstruction(options?.hasBrandAssetOverlay === true);
  const safeZoneInstruction = buildMobileSafeZoneInstruction(options?.hasBrandAssetOverlay === true);
  const referenceStyleInstruction = buildReferenceStyleInstruction(referenceMode);
  const directions = buildVariantCompositionDirection(index, referenceMode);

  return [
    `Create variant ${index + 1} of ${Math.min(count, MAX_VARIANT_COUNT)} from the reference playable ad image.`,
    `Target aspect ratio: ${aspectRatio}.`,
    `Use a full-bleed ${aspectRatio} mobile canvas that fills the entire image edge to edge.`,
    effectivePrompt,
    'Treat the campaign prompt as the main creative brief for the background image. Keep the requested scene, product category, and message instead of defaulting to the same room repeatedly.',
    referenceStyleInstruction,
    textPolicyInstruction,
    brandOverlayInstruction,
    distinctnessRule,
    styleDirection ? `Style direction for this specific variant: ${styleDirection}` : '',
    directions,
    'Return the static background creative image only; runtime hand, scan, text cue, click cue, and CTA button overlays will be added separately.',
    'Treat any prompt mention of hand, cue text, CTA text, tap instruction, or scan box as runtime overlay guidance, not bitmap content.',
    'Do not add letterboxing, pillarboxing, black bars, outer borders, padding, or empty margins.',
    'Do not include editor UI, hand cursor, tap finger, scan target boxes, CTA buttons, install buttons, tap/click cue text, timelines, or export controls.',
    safeZoneInstruction,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildBrandOverlayInstruction(hasBrandAssetOverlay: boolean) {
  if (!hasBrandAssetOverlay) return '';
  return 'A separate uploaded logo or icon overlay will be added later. Do not render any standalone logo, wordmark, app icon, mascot badge, corner branding, or brand sticker into the generated background image. Remove those brand marks from the reference instead of recreating them.';
}

function buildReferenceStyleInstruction(referenceMode: 'image' | 'playable-import') {
  if (referenceMode !== 'playable-import') {
    return 'Use the reference image as a strong visual guide for product framing, palette balance, and overall ad quality.';
  }
  return 'Use the imported playable frame as the primary style reference. Preserve the same visual language, palette family, contrast level, lighting mood, material treatment, device framing, background treatment, iconography feel, and overall ad-world style unless the prompt explicitly asks to change those things. Apply the user prompt inside that same creative system instead of drifting to a different art direction.';
}

function buildVariantCompositionDirection(index: number, referenceMode: 'image' | 'playable-import') {
  const directions =
    referenceMode === 'playable-import'
      ? [
          'Stay in the same creative family while varying crop, emphasis, or supporting scene details only slightly.',
          'Keep the same art direction and styling, but adjust composition rhythm and focal emphasis for a fresh variant.',
          'Preserve the source playable look and hierarchy, while introducing a modest alternate arrangement of secondary elements.',
          'Keep the same brand-world styling and rendering approach, but polish the layout for a clearer mobile read.',
        ]
      : [
          'fresh composition, same product intent, stronger visual hierarchy',
          'new color balance and layout, same core message and mobile readability',
          'alternate background and content arrangement, without leaving forced empty areas',
          'more polished ad creative, same aspect ratio and product category',
        ];
  return directions[index % directions.length];
}

function buildMobileSafeZoneInstruction(hasBrandAssetOverlay: boolean) {
  const topLeftRule = hasBrandAssetOverlay
    ? 'Keep the upper-left corner relatively clean and low-detail so the separate logo overlay can sit there without colliding with important content.'
    : '';
  return [
    'Respect mobile overlay safe zones. Keep the main subject, device, product, and any allowed headline comfortably inside the central composition instead of pushing them down to the bottom edge.',
    'Avoid placing important content, dense detail, faces, phones, or text inside the bottom 18% of the frame. That lower area should stay simpler for runtime CTA overlays, but not look like an obvious empty band.',
    'Do not crop or anchor the main subject too low. Keep enough breathing room above the bottom safe zone and away from the left and right edges.',
    topLeftRule,
  ]
    .filter(Boolean)
    .join(' ');
}

function sanitizeBackgroundPrompt(prompt: string) {
  let next = prompt.trim();
  const overlayOnlyPhrases = [
    /(?:^|[,\n.;])\s*(?:text\s*cue|cue\s*text|instruction\s*text|text\s*huong\s*dan|text\s*keu\s*goi)\s*(?:ghi\s*l[àa]|l[àa]|is|=|:)\s*["“']?[^"\n\r,.;]+["”']?/giu,
    /(?:^|[,\n.;])\s*(?:cta\s*text|button\s*text|cta\s*button|button\s*label)\s*(?:ghi\s*l[àa]|l[àa]|is|=|:)\s*["“']?[^"\n\r,.;]+["”']?/giu,
    /(?:^|[,\n.;])\s*(?:tay|hand(?:\s*cursor)?)(?:(?![,\n.;]).)*/giu,
    /(?:^|[,\n.;])\s*(?:scan\s*box|scan\s*target|khung\s*scan|tap\s*text|click\s*cue|tap\s*cue|cta\s*button|install\s*button)(?:(?![,\n.;]).)*/giu,
  ];

  for (const pattern of overlayOnlyPhrases) {
    next = next.replace(pattern, ' ');
  }

  const clauses = splitPromptClauses(next);
  const keptClauses = clauses.filter((clause) => !isOverlayOnlyClause(clause));
  if (keptClauses.length) {
    next = keptClauses.join(', ');
  }

  next = next
    .replace(/\s*([,.;])\s*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .replace(/^[,.;\s]+|[,.;\s]+$/g, '')
    .trim();

  return next || prompt.trim();
}

function splitPromptClauses(prompt: string) {
  return prompt
    .split(/\r?\n+|[.;]+|,(?=\s)/g)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function isOverlayOnlyClause(clause: string) {
  const value = normalizePromptText(clause);
  if (!value) return false;
  if (/(cue text|text cue|instruction text|cta text|button text|button label|text huong dan|text keu goi|text nut)/.test(value)) return true;
  if (/(bo|xoa|an|hide|remove).*(text|cta|cue|scan|tay|hand|button|install)/.test(value)) return true;

  const overlayWords =
    /(tay|hand|cursor|swipe|slide|tap|click|drag|double tap|press|press and hold|hold|scan|quet|nhan dien|animation|animated|loop|cta|button|install|download|cue|huong dan|goi y)/.test(
      value,
    );
  const creativeWords =
    /(living room|phong khach|bedroom|kitchen|interior|room|scene|style|layout|background|product|creative|composition|bo cuc|mau sac|color|lighting|sofa|wall|floor|furniture|environment|variant|canvas|headline|title|logo|avatar|phone|mockup|character|mascot)/.test(
      value,
    );

  if (overlayWords && !creativeWords) return true;
  return /(goc duoi|lower area|bottom area|safe area).*(text|cta|cue|button|scan|tay|hand)/.test(value);
}

function normalizePromptText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

type InImageTextPolicy = 'remove-all' | 'primary-only' | 'keep-all';

function buildInImageTextPolicyInstruction(prompt: string) {
  const policy = resolveInImageTextPolicy(prompt);
  if (policy === 'keep-all') {
    return 'In-image text policy: keep only the text explicitly requested in the prompt or clearly essential from the reference. Preserve the main headline and short supporting copy when needed, but still remove CTA buttons, scan labels, editor UI, disclaimers, and tiny filler text. If the prompt requests another language, use that language only for the kept text.';
  }
  if (policy === 'primary-only') {
    return 'In-image text policy: keep only one short primary headline when the prompt explicitly asks for text. Remove all secondary copy, badges, labels, pricing, stickers, paragraphs, CTA buttons, and fine print. If the prompt requests another language, use that language only for the single kept headline.';
  }
  return 'In-image text policy: remove all visible text from the generated image by default, including any text that appears in the reference image. Do not render headlines, subheads, labels, price tags, badges, CTA buttons, captions, disclaimers, or paragraph copy inside the image.';
}

function resolveInImageTextPolicy(prompt: string): InImageTextPolicy {
  const value = normalizePromptText(prompt);
  if (/(remove|without|no|xoa|bo|an|hide).*(text|headline|copy|chu|title)/.test(value)) return 'remove-all';
  if (/(keep all text|giu tat ca text|giu toan bo text|giu full text|giu nguyen text|keep full copy|preserve all text|all text)/.test(value)) return 'keep-all';
  if (/(main text only|primary text only|headline only|only one headline|one main headline|keep main text|keep primary headline|giu text chinh|chi giu text chinh|chi de text chinh|giu headline chinh|giu tieu de chinh|text chinh thoi|headline chinh thoi)/.test(value)) {
    return 'primary-only';
  }
  if (/(keep text|giu text|de text|headline|tieu de|title|copy trong anh|text trong anh|in-image text|text in image|viet text|viet headline|giu chu)/.test(value)) {
    return 'primary-only';
  }
  return 'remove-all';
}

function buildDistinctnessRule(prompt: string, count: number, referenceMode: 'image' | 'playable-import') {
  if (count <= 1) return '';
  if (referenceMode === 'playable-import') {
    return 'Each variant must remain in the same creative family as the source playable. Do not switch to a different art direction, different brand mood, or unrelated visual style. Variants can change scene details, crop, supporting props, or layout emphasis, but should still feel like the same campaign system.';
  }
  if (isInteriorPrompt(prompt)) {
    return 'Each variant must look like a genuinely different room concept, not a minor edit of the same room. Change furniture family, wall treatment, flooring or rug, decor, lighting mood, materials, and camera framing between variants. Do not reuse the same sofa/window layout with only small recolors.';
  }
  return 'Each variant must be clearly different from the others in composition, palette, styling, and mood. Do not return near-duplicates with only tiny edits.';
}

function buildVariantStyleDirection(prompt: string, index: number, referenceMode: 'image' | 'playable-import') {
  const pack =
    referenceMode === 'playable-import'
      ? playableImportStyleDirections
      : isInteriorPrompt(prompt)
        ? interiorStyleDirections
        : genericStyleDirections;
  const direction = pack[index % pack.length];
  return `${direction.label}: ${direction.brief}`;
}

function isInteriorPrompt(prompt: string) {
  const value = normalizePromptText(prompt);
  return /(living room|phong khach|interior|room design|room|sofa|bedroom|kitchen|furniture|home decor|decor room|noi that)/.test(value);
}

const interiorStyleDirections = [
  {
    label: 'Scandinavian Minimal',
    brief: 'bright daylight, pale oak, soft neutral palette, airy spacing, clean modern furniture lines',
  },
  {
    label: 'Japandi Calm',
    brief: 'warm wood, textured plaster, low-profile furniture, earthy beige tones, serene uncluttered styling',
  },
  {
    label: 'Modern Luxury',
    brief: 'stone or marble accents, sculptural lighting, premium materials, refined contrast, polished upscale finish',
  },
  {
    label: 'Eclectic Colorful',
    brief: 'layered textiles, statement art, richer accent colors, plants, collected personality, bolder decor mix',
  },
  {
    label: 'Classic Cozy',
    brief: 'traditional details, warm lamp light, darker wood, plush seating, timeless elegant decor',
  },
  {
    label: 'Contemporary Industrial',
    brief: 'architectural lines, black metal accents, concrete or stone textures, loft-inspired mood, cooler palette',
  },
] as const;

const genericStyleDirections = [
  {
    label: 'Premium Clean',
    brief: 'minimal clutter, strong hierarchy, bright polished lighting, crisp premium presentation',
  },
  {
    label: 'Playful Color Pop',
    brief: 'more vibrant palette, energetic accents, friendlier shapes, lively consumer-ad feel',
  },
  {
    label: 'Editorial Luxury',
    brief: 'refined composition, richer materials, softer dramatic light, upscale campaign mood',
  },
  {
    label: 'Bold High Contrast',
    brief: 'clear focal contrast, sharper geometry, stronger separation, more assertive visual impact',
  },
  {
    label: 'Lifestyle Soft Natural',
    brief: 'natural textures, human warmth, softer daylight, relaxed authentic atmosphere',
  },
  {
    label: 'Tech Forward',
    brief: 'sleek surfaces, cleaner geometry, futuristic polish, sharper highlights, more digital energy',
  },
] as const;

const playableImportStyleDirections = [
  {
    label: 'Source-Matched Balance',
    brief: 'keep the same palette family, styling language, and rendering feel; vary only the focal balance and spacing slightly',
  },
  {
    label: 'Source-Matched Emphasis',
    brief: 'preserve the same ad-world mood and device treatment while shifting emphasis between hero subject and supporting elements',
  },
  {
    label: 'Source-Matched Crop',
    brief: 'stay close to the original composition system, with a modest alternate crop and secondary arrangement in the same style',
  },
  {
    label: 'Source-Matched Polish',
    brief: 'retain the same creative direction, texture treatment, and visual hierarchy while refining readability for mobile',
  },
] as const;

async function callResponsesImageGeneration({
  apiKey,
  model,
  imageDataUrl,
  prompt,
}: {
  apiKey: string;
  model: string;
  imageDataUrl: string;
  prompt: string;
}) {
  const response = await fetch(`${AI_BASE_URL}/v1/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: imageDataUrl },
          ],
        },
      ],
      tools: [{ type: 'image_generation' }],
    }),
  });

  const payload = await parseAiResponse(response);
  const image = extractGeneratedImages(payload)[0];
  if (!image) throw new Error('Responses API returned no generated image.');
  return image;
}

async function callImageEditGeneration({
  apiKey,
  model,
  imageDataUrl,
  prompt,
  cause,
}: {
  apiKey: string;
  model: string;
  imageDataUrl: string;
  prompt: string;
  cause?: Error;
}) {
  const { buffer, mime, extension } = dataUrlToBuffer(imageDataUrl);
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('image', new Blob([buffer], { type: mime }), `reference.${extension}`);

  const response = await fetch(`${AI_BASE_URL}/v1/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const payload = await parseAiResponse(response, cause);
  const image = extractGeneratedImages(payload)[0];
  if (!image) throw new Error('Image edit API returned no generated image.');
  return image;
}

async function parseAiResponse(response: Response, cause?: Error) {
  const text = await response.text();
  let payload: unknown = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const detail =
      getNestedString(payload, ['error', 'message']) || getNestedString(payload, ['message']) || text.slice(0, 280);
    const prefix = cause ? `${cause.message}; fallback failed` : 'AI request failed';
    throw new Error(`${prefix}: ${detail}`);
  }

  return payload;
}

function extractGeneratedImages(payload: unknown) {
  const found: Array<{ dataUrl: string; revisedPrompt?: string }> = [];
  walk(payload, (node) => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;

    if (record.type === 'image_generation_call' && typeof record.result === 'string') {
      found.push({
        dataUrl: asDataUrl(record.result, String(record.output_format || 'png')),
        revisedPrompt: String(record.revised_prompt || record.revisedPrompt || ''),
      });
    }

    if (typeof record.b64_json === 'string') {
      found.push({
        dataUrl: asDataUrl(record.b64_json, String(record.output_format || 'png')),
        revisedPrompt: String(record.revised_prompt || record.revisedPrompt || ''),
      });
    }

    if (typeof record.url === 'string' && record.url.startsWith('data:image/')) {
      found.push({ dataUrl: record.url, revisedPrompt: String(record.revised_prompt || '') });
    }
  });
  return found;
}

function walk(value: unknown, visit: (value: unknown) => void) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }

  if (!value || typeof value !== 'object') return;
  visit(value);
  Object.values(value).forEach((item) => walk(item, visit));
}

function getNestedString(value: unknown, keys: string[]) {
  let cursor: unknown = value;
  for (const key of keys) {
    if (!cursor || typeof cursor !== 'object') return '';
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'string' ? cursor : '';
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function getImageConcurrency() {
  const value = Number(process.env.AI_IMAGE_CONCURRENCY || 4);
  return Number.isFinite(value) ? Math.max(1, Math.min(8, Math.round(value))) : 4;
}
