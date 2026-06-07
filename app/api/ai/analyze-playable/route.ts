import { NextResponse } from 'next/server';
import {
  heuristicPlanFromHotspot,
  normalizePlayablePlan,
  playablePlanJsonSchema,
  playablePlanRegistry,
} from '../../../../lib/playable-plan';
import type { Hotspot } from '../../../../lib/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
const AI_ANALYZE_MODEL = process.env.AI_ANALYZE_MODEL || process.env.AI_MODEL || 'gpt-5.4';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      imageDataUrl?: string;
      prompt?: string;
      index?: number;
      count?: number;
      hotspot?: Hotspot;
      mode?: 'default' | 'clone-source';
      sourceKind?: string;
      preserveVisibleCopy?: boolean;
    };
    const prompt = String(body.prompt || '');
    const index = Math.max(1, Math.round(Number(body.index || 1)));
    const hotspot = normalizeHotspot(body.hotspot);
    const fallback = heuristicPlanFromHotspot(hotspot, index, prompt);
    const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
    const imageDataUrl = String(body.imageDataUrl || '');

    if (!apiKey || !imageDataUrl.startsWith('data:image/')) {
      return NextResponse.json({ plan: fallback, source: 'heuristic', warning: 'AI analyze is not configured.' });
    }

    try {
      const rawPlan = await analyzeWithVision({
        apiKey,
        imageDataUrl,
        prompt,
        index,
        count: Number(body.count || 1),
        hotspot,
        mode: body.mode || 'default',
        sourceKind: String(body.sourceKind || 'image'),
        preserveVisibleCopy: Boolean(body.preserveVisibleCopy),
      });
      const plan = normalizePlayablePlan(rawPlan, hotspot, index, prompt);
      return NextResponse.json({ plan: { ...plan, source: 'ai' }, source: 'ai' });
    } catch (error) {
      return NextResponse.json({
        plan: fallback,
        source: 'heuristic',
        warning: error instanceof Error ? error.message : 'AI analyze failed.',
      });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cannot analyze playable image.' },
      { status: 500 },
    );
  }
}

async function analyzeWithVision({
  apiKey,
  imageDataUrl,
  prompt,
  index,
  count,
  hotspot,
  mode,
  sourceKind,
  preserveVisibleCopy,
}: {
  apiKey: string;
  imageDataUrl: string;
  prompt: string;
  index: number;
  count: number;
  hotspot: Hotspot;
  mode: 'default' | 'clone-source';
  sourceKind: string;
  preserveVisibleCopy: boolean;
}) {
  const response = await fetch(`${AI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_ANALYZE_MODEL,
      temperature: 0.2,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'playable_plan',
          strict: true,
          schema: playablePlanJsonSchema,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You are a mobile playable-ad interaction planner. Return only valid JSON matching the provided schema. Do not write HTML, CSS, markdown, or explanations.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildAnalyzerPrompt({ prompt, index, count, hotspot, mode, sourceKind, preserveVisibleCopy }),
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
    throw new Error(`AI analyze failed: ${detail}`);
  }

  const content = extractMessageContent(payload);
  if (!content) throw new Error('AI analyze returned no JSON content.');

  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI analyze returned invalid JSON.');
    return JSON.parse(match[0]);
  }
}

function buildAnalyzerPrompt({
  prompt,
  index,
  count,
  hotspot,
  mode,
  sourceKind,
  preserveVisibleCopy,
}: {
  prompt: string;
  index: number;
  count: number;
  hotspot: Hotspot;
  mode: 'default' | 'clone-source';
  sourceKind: string;
  preserveVisibleCopy: boolean;
}) {
  return [
    `Analyze variant ${index} of ${count}.`,
    mode === 'clone-source' ? `You are analyzing a source playable frame for clone reconstruction. Source kind: ${sourceKind}.` : '',
    prompt ? `Campaign prompt: ${prompt}` : '',
    `Fallback hotspot: x=${Math.round(hotspot.x)}, y=${Math.round(hotspot.y)}, confidence=${hotspot.confidence.toFixed(2)}.`,
    'Choose exactly one intent that best matches the visual.',
    'Interaction priority from prompt: button/CTA/install/download means cta_only with hand tapping the CTA; tap/click area means tap_product; choose/select/option means tap_choice; drag means drag_match; before/after comparison means before_after with horizontal hand movement; swipe up/down or scroll up/down means swipe_reveal with vertical hand movement; scratch/reward/bonus/unlock means scratch_reveal; scan/camera/detect/measure means scan_object; result/count/score/percent/BPM/calorie means count_result.',
    'Use English for CTA text and cue text by default. If the campaign prompt says "Language: <language>" or asks for another language, write both CTA text and cue text in that language.',
    'If the campaign prompt explicitly gives cue text or CTA copy, preserve that wording verbatim instead of inventing a generic replacement.',
    'Return cue as a short on-screen instruction, separate from the CTA button. Examples: "Tap to view", "Swipe to explore", "Drag to compare", "Press and hold". Do not duplicate the CTA button text inside cue.',
    'Choose cue.animation from the registry. Use pulse or float for tap, float for swipe, bounce for drag, breath for hold, shake for scratch or urgent reveal.',
    'Only use scan-frame-box as a scan visual asset. Do not choose reticle, grid, beam, barcode, food card, calorie chip, or other scan asset IDs.',
    'Place target coordinates in normalized 0-100 values at the object or UI element the user should interact with. If the prompt asks to scan a product, put the target directly on that product area so the scan frame can sit there.',
    'Keep CTA in the lower safe area unless the image clearly reserves another clean area.',
    'Avoid covering important text, faces, logos, or the main product with hand/scan/asset overlays.',
    'If the visual is already dominated by a CTA or confidence is low, choose cta_only.',
    mode === 'clone-source'
      ? 'For clone-source analysis, prioritize what is visibly shown in the frame. If this looks like a static video endcard or there is no visible tutorial gesture, do not invent drag or swipe behavior. Prefer cta_only or tap_product unless scanning, measuring, or camera targeting is clearly shown.'
      : '',
    mode === 'clone-source' && preserveVisibleCopy
      ? 'When readable, preserve visible CTA copy and instruction copy from the frame itself instead of inventing new wording.'
      : '',
    mode === 'clone-source'
      ? 'If a phone mockup, mascot, or product card is part of the scene, treat it as core creative content rather than a runtime overlay.'
      : '',
    `Allowed registry: ${JSON.stringify(playablePlanRegistry)}`,
    'Set source to "ai".',
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeHotspot(value: unknown): Hotspot {
  if (!value || typeof value !== 'object') return { x: 50, y: 72, confidence: 0.28, reason: 'api fallback' };
  const record = value as Record<string, unknown>;
  return {
    x: clampNumber(Number(record.x), 0, 100, 50),
    y: clampNumber(Number(record.y), 0, 100, 72),
    confidence: clampNumber(Number(record.confidence), 0, 1, 0.28),
    reason: typeof record.reason === 'string' ? record.reason : 'client hotspot',
  };
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

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
