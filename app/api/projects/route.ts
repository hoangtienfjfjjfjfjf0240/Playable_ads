import { NextResponse } from 'next/server';
import { listProjectsForApp, requireStudioUser, saveProjectRecord } from '../../../lib/studio-server';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const ctx = await requireStudioUser(request);
    const { searchParams } = new URL(request.url);
    const appId = searchParams.get('appId') || '';
    if (!appId) {
      return NextResponse.json({ projects: [], error: 'appId is required.' }, { status: 400 });
    }

    const projects = await listProjectsForApp(ctx, appId);
    return NextResponse.json({ projects });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cannot load projects.';
    const status = /auth|session/i.test(message) ? 401 : 400;
    return NextResponse.json({ projects: [], error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireStudioUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = await saveProjectRecord(ctx, body);
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cannot save project.';
    const status = /auth|session/i.test(message) ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
