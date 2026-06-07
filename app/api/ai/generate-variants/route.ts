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
    preferResponses: body.preferResponses === true,
    targetSize: Number.isFinite(Number(body.targetSize)) ? Math.max(256, Math.min(2048, Math.round(Number(body.targetSize)))) : undefined,
  };
}

async function generateVariants(body: Record<string, unknown>) {
  const { apiKey, provider, model, imageDataUrl, prompt, aspectRatio, count, preferResponses, targetSize } = prepareGeneration(body);
  const startedAt = Date.now();
  console.log(`[ai] generating ${count} variants in parallel with ${provider}:${model}`);

  const limit = pLimit(getImageConcurrency());
  const results = await Promise.allSettled(
    Array.from({ length: count }, (_, index) =>
      limit(() => generateOneVariant({ apiKey, provider, model, imageDataUrl, prompt, aspectRatio, preferResponses, targetSize, index, count })),
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
  preferResponses: boolean;
  targetSize?: number;
  index: number;
  count: number;
}) {
  const variantPrompt = buildVariantPrompt(prompt, index, count, aspectRatio);
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

function buildVariantPrompt(prompt: string, index: number, count: number, aspectRatio: string) {
  const cleanPrompt = sanitizeBackgroundPrompt(prompt);
  const directions = [
    'fresh composition, same product intent, stronger visual hierarchy',
    'new color balance and layout, same core message and mobile readability',
    'alternate background and content arrangement, without leaving forced empty areas',
    'more polished ad creative, same aspect ratio and product category',
  ];

  return [
    `Create variant ${index + 1} of ${Math.min(count, MAX_VARIANT_COUNT)} from the reference playable ad image.`,
    `Target aspect ratio: ${aspectRatio}.`,
    `Use a full-bleed ${aspectRatio} mobile canvas that fills the entire image edge to edge.`,
    cleanPrompt,
    'Language rule: use English for all in-ad text by default. If the prompt explicitly says "Language: <language>" or requests another language, use that language consistently for headlines and background text.',
    directions[index % directions.length],
    'Return the static background creative image only; runtime hand, scan, text cue, click cue, and CTA button overlays will be added separately.',
    'Treat any prompt mention of hand, cue text, CTA text, tap instruction, or scan box as runtime overlay guidance, not bitmap content.',
    'Do not add letterboxing, pillarboxing, black bars, outer borders, padding, or empty margins.',
    'Do not include editor UI, hand cursor, tap finger, scan target boxes, CTA buttons, install buttons, tap/click cue text, timelines, or export controls.',
    'Keep the composition full-frame and balanced; do not reserve a fake empty lower third just for overlays.',
  ]
    .filter(Boolean)
    .join('\n');
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

  next = next
    .replace(/\s*([,.;])\s*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .replace(/^[,.;\s]+|[,.;\s]+$/g, '')
    .trim();

  return next || prompt.trim();
}

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
