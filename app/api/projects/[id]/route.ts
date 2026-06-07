import { NextResponse } from 'next/server';
import { deleteProjectRecord, loadProjectDetail, requireStudioUser } from '../../../../lib/studio-server';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireStudioUser(request);
    const { id } = await params;
    const project = await loadProjectDetail(ctx, id);
    return NextResponse.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cannot load project.';
    const status = /auth|session/i.test(message) ? 401 : /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireStudioUser(request);
    const { id } = await params;
    await deleteProjectRecord(ctx, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cannot delete project.';
    const status = /auth|session/i.test(message) ? 401 : /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
