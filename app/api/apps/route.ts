import { NextResponse } from 'next/server';
import { createApp, getDashboardPayload, requireStudioUser } from '../../../lib/studio-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const ctx = await requireStudioUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
    const name = typeof body.name === 'string' ? body.name : '';
    if (!workspaceId) throw new Error('workspaceId is required.');

    await createApp(ctx, workspaceId, name);
    const payload = await getDashboardPayload(ctx);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cannot create app.' },
      { status: 400 },
    );
  }
}
