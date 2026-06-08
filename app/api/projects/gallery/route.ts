import { NextResponse } from 'next/server';
import { getProjectGalleryPayload, requireStudioUser } from '../../../../lib/studio-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const ctx = await requireStudioUser(request);
    const payload = await getProjectGalleryPayload(ctx);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cannot load project gallery.';
    const status = /auth|session/i.test(message) ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
