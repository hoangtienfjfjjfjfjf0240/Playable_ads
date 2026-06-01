create table if not exists public.playable_projects (
  id uuid primary key,
  name text not null,
  prompt text not null default '',
  settings jsonb not null default '{}'::jsonb,
  source_image_path text,
  variants jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists playable_projects_created_at_idx
  on public.playable_projects (created_at desc);

alter table public.playable_projects enable row level security;

comment on table public.playable_projects is
  'Playable Studio projects are written through the Next.js server API with the service role key. No public RLS policy is required before auth is added.';

comment on column public.playable_projects.variants is
  'Array of generated playable variants with storage paths, hotspot metadata, and layer settings.';
