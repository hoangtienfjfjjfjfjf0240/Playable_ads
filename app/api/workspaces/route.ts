import { NextResponse } from 'next/server';
import { createWorkspace, getDashboardPayload, requireStudioUser } from '../../../lib/studio-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const ctx = await requireStudioUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name : '';
    const defaultAppName = typeof body.defaultAppName === 'string' ? body.defaultAppName : '';

    await createWorkspace(ctx, name, defaultAppName);
    const payload = await getDashboardPayload(ctx);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cannot create workspace.' },
      { status: 400 },
    );
  }
}
