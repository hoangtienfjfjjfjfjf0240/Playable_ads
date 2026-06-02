import { NextResponse } from 'next/server';
import { asDataUrl, dataUrlToBuffer } from '../../../../lib/server-data';

export const runtime = 'nodejs';
export const maxDuration = 300;

const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
const AI_MODEL = process.env.AI_MODEL || 'gpt-5.4';
const AI_IMAGE_MODEL = process.env.AI_IMAGE_MODEL || 'gpt-image-2';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const startedAt = Date.now();
    const { variants, errors } = await generateVariants(body);
    return NextResponse.json({ variants, errors, durationMs: Date.now() - startedAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI generation failed.' },
      { status: 500 },
    );
  }
}

async function generateVariants(body: Record<string, unknown>) {
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('AI_API_KEY is not configured on the server.');

  const imageDataUrl = String(body.imageDataUrl || '');
  if (!imageDataUrl.startsWith('data:image/')) throw new Error('A base64 image data URL is required.');

  const count = Math.max(1, Math.min(4, Number(body.count || 4)));
  const model = String(body.model || AI_MODEL);
  const prompt = String(body.prompt || '');
  const aspectRatio = String(body.aspectRatio || '9:16');
  const startedAt = Date.now();
  console.log(`[ai] generating ${count} variants in parallel`);

  const results = await Promise.allSettled(
    Array.from({ length: count }, (_, index) =>
      generateOneVariant({ apiKey, model, imageDataUrl, prompt, aspectRatio, index, count }),
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

async function generateOneVariant({
  apiKey,
  model,
  imageDataUrl,
  prompt,
  aspectRatio,
  index,
  count,
}: {
  apiKey: string;
  model: string;
  imageDataUrl: string;
  prompt: string;
  aspectRatio: string;
  index: number;
  count: number;
}) {
  const variantPrompt = buildVariantPrompt(prompt, index, count, aspectRatio);
  const startedAt = Date.now();
  let generated: { dataUrl: string; revisedPrompt?: string };

  try {
    generated = await callImageEditGeneration({
      apiKey,
      model: AI_IMAGE_MODEL,
      imageDataUrl,
      prompt: variantPrompt,
    });
  } catch (editError) {
    try {
      generated = await callResponsesImageGeneration({ apiKey, model, imageDataUrl, prompt: variantPrompt });
    } catch (responsesError) {
      throw new Error(
        `${getErrorMessage(editError)}; responses fallback failed: ${getErrorMessage(responsesError)}`,
      );
    }
  }

  console.log(`[ai] variant ${index + 1}/${count} done in ${Date.now() - startedAt}ms`);
  return {
    name: `ai_variant_${index + 1}.png`,
    dataUrl: generated.dataUrl,
    revisedPrompt: generated.revisedPrompt || '',
  };
}

function buildVariantPrompt(prompt: string, index: number, count: number, aspectRatio: string) {
  const directions = [
    'fresh composition, same product intent, stronger visual hierarchy',
    'new color balance and layout, same core message and mobile readability',
    'alternate background and content arrangement, with a clean lower CTA-safe zone',
    'more polished ad creative, same aspect ratio and product category',
  ];

  return [
    `Create variant ${index + 1} of ${count} from the reference playable ad image.`,
    `Target aspect ratio: ${aspectRatio}.`,
    prompt,
    directions[index % directions.length],
    'Return a complete mobile ad creative image only.',
    'Do not include phone frames, editor UI, hand cursor, scan target boxes, timelines, or export controls.',
    'Leave a clean area near the lower third/lower quarter for a real CTA button and animation overlay.',
  ]
    .filter(Boolean)
    .join('\n');
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
