import { NextResponse } from 'next/server';
import { packPlayableHtml } from '../../../../lib/playable-layers';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      html?: string;
      replacements?: Array<{ hash: string; dataUrl: string }>;
      remake?: { imageDataUrl: string; animation: 'tap' | 'scan' | 'swipe' | 'pulse' | 'none' } | null;
    };
    if (!body.html) {
      return NextResponse.json({ error: 'Thiếu HTML nguồn.' }, { status: 400 });
    }

    const packed = packPlayableHtml(body.html, body.replacements || [], body.remake || null);
    return new Response(packed.html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Playable-Bytes': String(packed.audit.bytes),
        'X-Playable-Size-Mib': String(packed.audit.sizeMiB),
        'X-Playable-External-Refs': String(packed.audit.externalRefCount),
        'X-Playable-Ready': packed.audit.appLovinReady ? '1' : '0',
        'X-Playable-Warnings': encodeURIComponent(packed.warnings.join(' | ')),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Không đóng gói được playable.' },
      { status: 500 },
    );
  }
}
