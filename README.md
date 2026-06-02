# Playable Studio

Next.js playable editor for batch AI creative work.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Create `.env.local` from `.env.example`. Keep `AI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` server-side only.

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=gpt-5.4
AI_IMAGE_MODEL=gpt-image-2
GEMINI_FLASH_IMAGE_MODEL=gemini/gemini-3.1-flash-image-preview
GEMINI_PRO_IMAGE_MODEL=gemini/gemini-3-pro-image-preview
GEMINI_FALLBACK_IMAGE_MODEL=gemini/gemini-2.5-flash-image
```

## Supabase

Run `supabase/schema.sql` in the Supabase SQL editor. The app writes project metadata through `/api/projects` with the service role key and stores images in a private `playable-assets` bucket.

## Workflow

- Import image or HTML playable.
- Generate 4 AI image variants from one image.
- Drag hand, scan, and CTA overlays in the 2x2 preview grid.
- Apply mixed animation presets and hand assets.
- Export one HTML or a ZIP containing all 4 playable HTML files.
