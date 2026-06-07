import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const coreAiConfigured = Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const supabaseStatus = supabaseConfigured ? await checkSupabaseHealth() : { ready: false, error: '' };
  return NextResponse.json({
    ok: true,
    aiConfigured: coreAiConfigured,
    openAiConfigured: coreAiConfigured,
    geminiConfigured: coreAiConfigured,
    supabaseConfigured,
    supabaseReady: supabaseConfigured && supabaseStatus.ready,
    supabaseError: supabaseStatus.error,
  });
}

async function checkSupabaseHealth() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ready: false, error: 'Supabase server env is not configured.' };

  try {
    const probe = supabase.from('playable_projects').select('id', { head: true, count: 'exact' }).limit(1);
    const timeout = new Promise<{ timedOut: true }>((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), 1500),
    );
    const result = await Promise.race([probe, timeout]);
    if ('timedOut' in result) {
      return { ready: false, error: 'Supabase health check timed out.' };
    }
    if (!result.error) return { ready: true, error: '' };
    return { ready: false, error: result.error.message || 'Supabase health check failed.' };
  } catch (error) {
    return { ready: false, error: error instanceof Error ? error.message : 'Supabase health check failed.' };
  }
}
