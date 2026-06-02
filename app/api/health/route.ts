import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const coreAiConfigured = Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
  return NextResponse.json({
    ok: true,
    aiConfigured: coreAiConfigured,
    openAiConfigured: coreAiConfigured,
    geminiConfigured: coreAiConfigured,
    supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
}
