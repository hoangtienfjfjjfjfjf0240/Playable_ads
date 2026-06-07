import { NextResponse } from 'next/server';
import { deleteAppRecord, getDashboardPayload, requireStudioUser } from '../../../../lib/studio-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireStudioUser(request);
    const { id } = await params;
    await deleteAppRecord(ctx, id);
    const payload = await getDashboardPayload(ctx);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cannot delete app.';
    const status = /auth|session/i.test(message) ? 401 : /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
