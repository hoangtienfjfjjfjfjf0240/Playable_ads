import { NextResponse } from 'next/server';
import { analyzePlayableHtml, resolvePlayableDocument } from '../../../../lib/playable-layers';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Cần chọn một file HTML.' }, { status: 400 });
    }
    if (!/\.html?$/i.test(file.name)) {
      return NextResponse.json({ error: 'Layer Editor chỉ nhận file HTML/HTM.' }, { status: 400 });
    }

    const sourceHtml = await file.text();
    const resolved = await resolvePlayableDocument(sourceHtml);
    const analysis = analyzePlayableHtml(resolved.html);
    return NextResponse.json({
      name: file.name,
      documentHtml: resolved.html,
      convertedFromWrapper: resolved.convertedFromWrapper,
      ...analysis,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Không phân tích được playable.' },
      { status: 500 },
    );
  }
}
