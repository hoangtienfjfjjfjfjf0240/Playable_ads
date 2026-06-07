create extension if not exists pgcrypto;

create table if not exists public.playable_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  role text not null default 'editor' check (role in ('manager', 'editor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.playable_workspaces (
  id uuid primary key,
  name text not null,
  slug text not null unique,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.playable_workspace_members (
  workspace_id uuid not null references public.playable_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('manager', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.playable_apps (
  id uuid primary key,
  workspace_id uuid not null references public.playable_workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  accent_color text not null default '#2563eb',
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table if not exists public.playable_projects (
  id uuid primary key,
  workspace_id uuid references public.playable_workspaces(id) on delete cascade,
  app_id uuid references public.playable_apps(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  owner_email text not null default '',
  name text not null,
  prompt text not null default '',
  settings jsonb not null default '{}'::jsonb,
  source_image_path text,
  variants jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.playable_projects add column if not exists workspace_id uuid references public.playable_workspaces(id) on delete cascade;
alter table public.playable_projects add column if not exists app_id uuid references public.playable_apps(id) on delete cascade;
alter table public.playable_projects add column if not exists owner_user_id uuid references auth.users(id) on delete set null;
alter table public.playable_projects add column if not exists owner_email text not null default '';

create index if not exists playable_profiles_role_idx
  on public.playable_profiles (role);

create index if not exists playable_workspaces_owner_idx
  on public.playable_workspaces (owner_user_id);

create index if not exists playable_workspace_members_user_idx
  on public.playable_workspace_members (user_id);

create index if not exists playable_apps_workspace_idx
  on public.playable_apps (workspace_id, updated_at desc);

create index if not exists playable_projects_workspace_idx
  on public.playable_projects (workspace_id, updated_at desc);

create index if not exists playable_projects_app_idx
  on public.playable_projects (app_id, updated_at desc);

create index if not exists playable_projects_owner_idx
  on public.playable_projects (owner_user_id, updated_at desc);

create index if not exists playable_projects_created_at_idx
  on public.playable_projects (created_at desc);

create or replace function public.playable_is_manager(check_user uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.playable_profiles profile
    where profile.user_id = check_user
      and profile.role = 'manager'
  );
$$;

create or replace function public.playable_has_workspace_access(check_user uuid, check_workspace uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.playable_workspaces workspace
    where workspace.id = check_workspace
      and workspace.owner_user_id = check_user
  )
  or exists (
    select 1
    from public.playable_workspace_members member
    where member.workspace_id = check_workspace
      and member.user_id = check_user
  );
$$;

alter table public.playable_profiles enable row level security;
alter table public.playable_workspaces enable row level security;
alter table public.playable_workspace_members enable row level security;
alter table public.playable_apps enable row level security;
alter table public.playable_projects enable row level security;

drop policy if exists "profiles_select" on public.playable_profiles;
create policy "profiles_select"
on public.playable_profiles
for select
using (
  auth.uid() = user_id
  or public.playable_is_manager(auth.uid())
);

drop policy if exists "profiles_insert" on public.playable_profiles;
create policy "profiles_insert"
on public.playable_profiles
for insert
with check (
  auth.uid() = user_id
  or public.playable_is_manager(auth.uid())
);

drop policy if exists "profiles_update" on public.playable_profiles;
create policy "profiles_update"
on public.playable_profiles
for update
using (
  auth.uid() = user_id
  or public.playable_is_manager(auth.uid())
)
with check (
  auth.uid() = user_id
  or public.playable_is_manager(auth.uid())
);

drop policy if exists "workspaces_select" on public.playable_workspaces;
create policy "workspaces_select"
on public.playable_workspaces
for select
using (
  public.playable_is_manager(auth.uid())
  or public.playable_has_workspace_access(auth.uid(), id)
);

drop policy if exists "workspaces_insert" on public.playable_workspaces;
create policy "workspaces_insert"
on public.playable_workspaces
for insert
with check (
  auth.uid() = owner_user_id
  or public.playable_is_manager(auth.uid())
);

drop policy if exists "workspaces_update" on public.playable_workspaces;
create policy "workspaces_update"
on public.playable_workspaces
for update
using (
  public.playable_is_manager(auth.uid())
  or auth.uid() = owner_user_id
)
with check (
  public.playable_is_manager(auth.uid())
  or auth.uid() = owner_user_id
);

drop policy if exists "workspace_members_select" on public.playable_workspace_members;
create policy "workspace_members_select"
on public.playable_workspace_members
for select
using (
  public.playable_is_manager(auth.uid())
  or auth.uid() = user_id
  or public.playable_has_workspace_access(auth.uid(), workspace_id)
);

drop policy if exists "workspace_members_insert" on public.playable_workspace_members;
create policy "workspace_members_insert"
on public.playable_workspace_members
for insert
with check (
  public.playable_is_manager(auth.uid())
  or exists (
    select 1
    from public.playable_workspaces workspace
    where workspace.id = workspace_id
      and workspace.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.playable_workspace_members member
    where member.workspace_id = workspace_id
      and member.user_id = auth.uid()
      and member.role = 'manager'
  )
);

drop policy if exists "workspace_members_update" on public.playable_workspace_members;
create policy "workspace_members_update"
on public.playable_workspace_members
for update
using (
  public.playable_is_manager(auth.uid())
  or exists (
    select 1
    from public.playable_workspaces workspace
    where workspace.id = workspace_id
      and workspace.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.playable_workspace_members member
    where member.workspace_id = workspace_id
      and member.user_id = auth.uid()
      and member.role = 'manager'
  )
)
with check (
  public.playable_is_manager(auth.uid())
  or exists (
    select 1
    from public.playable_workspaces workspace
    where workspace.id = workspace_id
      and workspace.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.playable_workspace_members member
    where member.workspace_id = workspace_id
      and member.user_id = auth.uid()
      and member.role = 'manager'
  )
);

drop policy if exists "apps_select" on public.playable_apps;
create policy "apps_select"
on public.playable_apps
for select
using (
  public.playable_is_manager(auth.uid())
  or public.playable_has_workspace_access(auth.uid(), workspace_id)
);

drop policy if exists "apps_insert" on public.playable_apps;
create policy "apps_insert"
on public.playable_apps
for insert
with check (
  public.playable_is_manager(auth.uid())
  or public.playable_has_workspace_access(auth.uid(), workspace_id)
);

drop policy if exists "apps_update" on public.playable_apps;
create policy "apps_update"
on public.playable_apps
for update
using (
  public.playable_is_manager(auth.uid())
  or public.playable_has_workspace_access(auth.uid(), workspace_id)
)
with check (
  public.playable_is_manager(auth.uid())
  or public.playable_has_workspace_access(auth.uid(), workspace_id)
);

drop policy if exists "projects_select" on public.playable_projects;
create policy "projects_select"
on public.playable_projects
for select
using (
  public.playable_is_manager(auth.uid())
  or public.playable_has_workspace_access(auth.uid(), workspace_id)
);

drop policy if exists "projects_insert" on public.playable_projects;
create policy "projects_insert"
on public.playable_projects
for insert
with check (
  public.playable_is_manager(auth.uid())
  or (
    auth.uid() = owner_user_id
    and public.playable_has_workspace_access(auth.uid(), workspace_id)
  )
);

drop policy if exists "projects_update" on public.playable_projects;
create policy "projects_update"
on public.playable_projects
for update
using (
  public.playable_is_manager(auth.uid())
  or (
    auth.uid() = owner_user_id
    and public.playable_has_workspace_access(auth.uid(), workspace_id)
  )
)
with check (
  public.playable_is_manager(auth.uid())
  or (
    auth.uid() = owner_user_id
    and public.playable_has_workspace_access(auth.uid(), workspace_id)
  )
);

comment on table public.playable_profiles is
  'Studio identities mirrored from Supabase Auth with a global manager/editor role.';

comment on table public.playable_workspaces is
  'Top-level containers for each user or team. Each workspace owns multiple playable apps.';

comment on table public.playable_apps is
  'Dashboard cards that open an isolated playable editor context and contain scoped projects.';

comment on table public.playable_projects is
  'Playable Studio projects scoped to a workspace/app pair with saved variants and overlay settings.';

comment on column public.playable_projects.variants is
  'Array of generated playable variants with storage paths, hotspot metadata, and layer settings.';
