import { NextResponse } from 'next/server';
import { getContentLocaleOption } from '../../../../lib/content-locales';
import type { ContentLocale } from '../../../../lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
const AI_TRANSLATE_MODEL = process.env.AI_OVERLAY_TRANSLATE_MODEL || process.env.AI_MODEL || 'gpt-5.4';

type OverlayLocalizationEntry = {
  key: string;
  text: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      locale?: ContentLocale;
      entries?: OverlayLocalizationEntry[];
    };
    const locale = typeof body.locale === 'string' ? body.locale : 'auto';
    const entries = Array.isArray(body.entries)
      ? body.entries
          .filter((entry) => entry && typeof entry.key === 'string' && typeof entry.text === 'string')
          .map((entry) => ({ key: entry.key.trim(), text: entry.text.trim() }))
          .filter((entry) => entry.key && entry.text)
      : [];

    if (!entries.length) {
      return NextResponse.json({ translations: {} });
    }

    if (locale === 'auto') {
      return NextResponse.json({
        translations: Object.fromEntries(entries.map((entry) => [entry.key, entry.text])),
      });
    }

    const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI_API_KEY is not configured on the server.' }, { status: 503 });
    }

    const option = getContentLocaleOption(locale);
    const translations = await translateEntries({
      apiKey,
      locale,
      language: option.promptName,
      market: option.marketName,
      entries,
    });

    return NextResponse.json({ translations });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cannot localize overlay copy.' },
      { status: 500 },
    );
  }
}

async function translateEntries({
  apiKey,
  locale,
  language,
  market,
  entries,
}: {
  apiKey: string;
  locale: ContentLocale;
  language: string;
  market: string;
  entries: OverlayLocalizationEntry[];
}) {
  const response = await fetch(`${AI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_TRANSLATE_MODEL,
      temperature: 0.2,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'overlay_copy_localization',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              translations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string' },
                    text: { type: 'string' },
                  },
                  required: ['key', 'text'],
                  additionalProperties: false,
                },
              },
            },
            required: ['translations'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You localize very short mobile playable overlay copy. Translate naturally for the requested market, keep CTA text concise and tappable, keep cue text concise and instructional, do not add quotes, and return only valid JSON matching the schema.',
        },
        {
          role: 'user',
          content: [
            `Target locale code: ${locale}.`,
            `Target language: ${language}.`,
            `Target market: ${market}.`,
            'Translate each entry. Keep the meaning and tone, keep the copy short enough for a mobile CTA or cue bubble, and avoid expanding the line length unless the target language requires it.',
            JSON.stringify(entries),
          ].join('\n'),
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
    const detail = getNestedString(payload, ['error', 'message']) || text.slice(0, 280);
    throw new Error(`Overlay copy localization failed: ${detail}`);
  }

  const content = extractMessageContent(payload);
  if (!content) {
    throw new Error('Overlay copy localization returned no JSON content.');
  }

  let parsed: { translations?: OverlayLocalizationEntry[] } = {};
  try {
    parsed = JSON.parse(content) as { translations?: OverlayLocalizationEntry[] };
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Overlay copy localization returned invalid JSON.');
    parsed = JSON.parse(match[0]) as { translations?: OverlayLocalizationEntry[] };
  }

  const translatedMap = new Map<string, string>();
  for (const entry of parsed.translations || []) {
    if (!entry || typeof entry.key !== 'string' || typeof entry.text !== 'string') continue;
    const key = entry.key.trim();
    const value = entry.text.replace(/\s+/g, ' ').trim();
    if (!key || !value) continue;
    translatedMap.set(key, value);
  }

  return Object.fromEntries(
    entries.map((entry) => [entry.key, translatedMap.get(entry.key) || entry.text]),
  );
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
