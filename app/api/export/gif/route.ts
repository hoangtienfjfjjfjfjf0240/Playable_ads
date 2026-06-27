import { NextResponse } from 'next/server';
import sharp from 'sharp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 120;

type GifFramePayload = {
  frames?: string[];
  delay?: number;
  loop?: number;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as GifFramePayload;
    const frames = Array.isArray(payload.frames) ? payload.frames.filter((frame) => typeof frame === 'string' && frame.startsWith('data:image/')) : [];
    if (!frames.length) {
      return NextResponse.json({ error: 'GIF export requires at least one frame.' }, { status: 400 });
    }

    const delay = Number.isFinite(payload.delay) ? Math.max(40, Math.min(1000, Math.round(Number(payload.delay)))) : 90;
    const loop = Number.isFinite(payload.loop) ? Math.max(0, Math.min(100, Math.round(Number(payload.loop)))) : 0;
    const buffers = await Promise.all(frames.map((frame) => normalizeFrameBuffer(dataUrlToBuffer(frame))));

    const gif = await sharp(buffers, { join: { animated: true } })
      .gif({
        effort: 6,
        dither: 0.9,
        reuse: true,
        progressive: false,
        loop,
        delay,
      })
      .toBuffer();

    return new NextResponse(new Uint8Array(gif), {
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store',
        'Content-Length': String(gif.byteLength),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cannot export GIF.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match?.[1]) throw new Error('Invalid image frame payload.');
  return Buffer.from(match[1], 'base64');
}

async function normalizeFrameBuffer(frame: Buffer) {
  return sharp(frame).ensureAlpha().png().toBuffer();
}
