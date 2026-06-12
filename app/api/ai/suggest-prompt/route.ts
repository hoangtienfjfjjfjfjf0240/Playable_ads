import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
const AI_SUGGEST_MODEL = process.env.AI_SUGGEST_MODEL || process.env.AI_ANALYZE_MODEL || process.env.AI_MODEL || 'gpt-5.4';

type PromptSuggestion = {
  title: string;
  prompt: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      imageDataUrl?: string;
      sourceKind?: string;
      sourceName?: string;
      language?: string;
    };
    const imageDataUrl = String(body.imageDataUrl || '');
    if (!imageDataUrl.startsWith('data:image/')) {
      return NextResponse.json({ error: 'A base64 image data URL is required.' }, { status: 400 });
    }

    const sourceKind = body.sourceKind === 'html' ? 'html' : 'image';
    const sourceName = String(body.sourceName || 'reference');
    const language = String(body.language || 'vi').toLowerCase();
    const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({
        prompt: buildFallbackPrompt(sourceKind),
        title: buildFallbackTitle(sourceName),
        source: 'fallback',
        warning: 'AI prompt suggestion is not configured.',
      });
    }

    try {
      const suggestion = await suggestPromptWithVision({ apiKey, imageDataUrl, sourceKind, language });
      return NextResponse.json({ ...suggestion, source: 'ai' });
    } catch (error) {
      return NextResponse.json({
        prompt: buildFallbackPrompt(sourceKind),
        title: buildFallbackTitle(sourceName),
        source: 'fallback',
        warning: error instanceof Error ? error.message : 'AI prompt suggestion failed.',
      });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cannot suggest prompt from image.' },
      { status: 500 },
    );
  }
}

async function suggestPromptWithVision({
  apiKey,
  imageDataUrl,
  sourceKind,
  language,
}: {
  apiKey: string;
  imageDataUrl: string;
  sourceKind: 'image' | 'html';
  language: string;
}) {
  const response = await fetch(`${AI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_SUGGEST_MODEL,
      temperature: 0.35,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'prompt_suggestion',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              prompt: { type: 'string' },
            },
            required: ['title', 'prompt'],
          },
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You generate one production-ready image-generation prompt from a reference image for a mobile playable ad editor. Return only valid JSON matching the provided schema.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildSuggestionInstruction(sourceKind, language),
            },
            {
              type: 'image_url',
              image_url: { url: imageDataUrl },
            },
          ],
        },
      ],
    }),
  });

  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const detail = getNestedString(payload, ['error', 'message']) || text.slice(0, 240);
    throw new Error(`Prompt suggestion failed: ${detail}`);
  }

  const content = extractMessageContent(payload);
  if (!content) throw new Error('Prompt suggestion returned no JSON content.');

  let parsed: PromptSuggestion;
  try {
    parsed = JSON.parse(content) as PromptSuggestion;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Prompt suggestion returned invalid JSON.');
    parsed = JSON.parse(match[0]) as PromptSuggestion;
  }

  return {
    title: String(parsed.title || 'Prompt gợi ý').trim() || 'Prompt gợi ý',
    prompt: String(parsed.prompt || '').trim() || buildFallbackPrompt(sourceKind),
  };
}

function buildSuggestionInstruction(sourceKind: 'image' | 'html', language: string) {
  const prefersEnglish = language.startsWith('en');
  const outputLanguage = prefersEnglish ? 'English' : 'Vietnamese';
  const copyLanguageRule = prefersEnglish
    ? 'Write the entire prompt in English.'
    : 'Write the entire prompt in Vietnamese.';

  return [
    `Analyze this ${sourceKind === 'html' ? 'playable frame snapshot' : 'reference creative image'} and write one direct prompt for generating mobile playable background variants.`,
    copyLanguageRule,
    'Return a short title plus one production-ready prompt string.',
    'The prompt must be immediately usable in an image-generation editor and should ask for 4 variants in 9:16.',
    'Describe the main subject, visual style, app/UI pattern, product framing, scene mood, composition anchor, and any repeated design motifs actually visible in the image.',
    'Preserve the same visual family as the reference instead of drifting to a different art direction.',
    'Tell the generator to keep the canvas full-bleed, avoid white margins, avoid obvious blank bands, and rebuild any removed text areas with natural integrated detail.',
    'Tell the generator not to render runtime overlays into the bitmap: no hand cursor, no CTA button, no scan box, no tap/click cue text, no editor chrome.',
    `Output language for both title and prompt: ${outputLanguage}.`,
    'Do not explain your reasoning.',
  ].join(' ');
}

function buildFallbackTitle(sourceName: string) {
  return `Gợi ý từ ${sourceName}`;
}

function buildFallbackPrompt(sourceKind: 'image' | 'html') {
  return [
    'Tạo 4 biến thể mobile ad 9:16 tương tự ảnh reference.',
    sourceKind === 'html'
      ? 'Giữ phong cách UI/playable của frame gốc, bố cục app rõ ràng và cùng visual family.'
      : 'Giữ cùng visual family, mood ánh sáng, bố cục chính và phong cách app/UI của ảnh gốc.',
    'Ảnh phải full-bleed, kín khung, không margin trắng, không dải trống rõ rệt ở đáy.',
    'Nếu bỏ text hoặc nhãn từ ảnh gốc thì thay bằng detail nền/UI tự nhiên, không để ô trắng hoặc placeholder rỗng.',
    'Không vẽ hand cursor, CTA button, scan box hoặc text hướng dẫn vào ảnh nền.',
  ].join(' ');
}

function extractMessageContent(payload: unknown) {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const record = item as Record<string, unknown>;
        return typeof record.text === 'string' ? record.text : '';
      })
      .join('');
  }
  return '';
}

function getNestedString(value: unknown, keys: string[]) {
  let cursor: unknown = value;
  for (const key of keys) {
    if (!cursor || typeof cursor !== 'object') return '';
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'string' ? cursor : '';
}
