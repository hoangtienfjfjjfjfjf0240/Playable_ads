import { NextResponse } from 'next/server';
import { getDashboardPayload, requireStudioUser } from '../../../../lib/studio-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const ctx = await requireStudioUser(request);
    const payload = await getDashboardPayload(ctx);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cannot load authenticated user.' },
      { status: 401 },
    );
  }
}
