import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';
import { dataUrlToBuffer } from '../../../lib/server-data';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BUCKET = 'playable-assets';

export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ projects: [], configured: false });

  const { data, error } = await supabase
    .from('playable_projects')
    .select('id,name,prompt,source_image_path,variants,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ projects: [], configured: true, error: error.message }, { status: 500 });
  return NextResponse.json({ projects: data || [], configured: true });
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) throw new Error('Supabase server env is not configured.');

    const body = await request.json();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const name = String(body.name || `Playable ${now.slice(0, 10)}`);
    const prompt = String(body.prompt || '');

    await ensureBucket(supabase);

    const sourcePath =
      typeof body.sourceImageDataUrl === 'string'
        ? await uploadDataUrl(supabase, `projects/${id}/source.${guessExtension(body.sourceImageDataUrl)}`, body.sourceImageDataUrl)
        : null;

    const rawVariants = Array.isArray(body.variants) ? body.variants.slice(0, 4) : [];
    const variants = [];

    for (const [index, variant] of rawVariants.entries()) {
      const dataUrl = typeof variant.dataUrl === 'string' ? variant.dataUrl : '';
      const imagePath = dataUrl
        ? await uploadDataUrl(supabase, `projects/${id}/variant-${index + 1}.${guessExtension(dataUrl)}`, dataUrl)
        : null;

      variants.push({
        id: variant.id || crypto.randomUUID(),
        index: index + 1,
        name: variant.name || `Variant ${index + 1}`,
        width: variant.width || null,
        height: variant.height || null,
        image_path: imagePath,
        hotspot: variant.hotspot || null,
        settings: variant.settings || null,
        revised_prompt: variant.revisedPrompt || '',
      });
    }

    const { data, error } = await supabase
      .from('playable_projects')
      .insert({
        id,
        name,
        prompt,
        settings: body.settings || {},
        source_image_path: sourcePath,
        variants,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, id: data?.id || id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cannot save project.' },
      { status: 500 },
    );
  }
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>) {
  if (!supabase) return;
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (data) return;

  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 25 * 1024 * 1024,
  });

  if (error && !/already exists/i.test(error.message)) throw error;
}

async function uploadDataUrl(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, path: string, dataUrl: string) {
  const { buffer, mime } = dataUrlToBuffer(dataUrl);
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mime,
    upsert: true,
  });

  if (error) throw error;
  return path;
}

function guessExtension(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/([a-z0-9.+-]+);/i);
  if (!match) return 'png';
  return match[1].toLowerCase().includes('jpeg') ? 'jpg' : match[1].replace(/[^a-z0-9]/g, '') || 'png';
}
