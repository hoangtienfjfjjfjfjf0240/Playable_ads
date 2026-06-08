import type { User } from '@supabase/supabase-js';
import { asDataUrl, dataUrlToBuffer } from './server-data';
import { getSupabaseAdmin } from './supabase-admin';
import type {
  Orientation,
  PlayableVariant,
  ProjectSettings,
  StudioAppSummary,
  StudioDashboardPayload,
  StudioProjectDetail,
  StudioProjectGalleryItem,
  StudioProjectGalleryPayload,
  StudioProjectSummary,
  StudioUserRole,
  StudioUserSummary,
  StudioWorkspaceSummary,
  WorkspaceMemberRole,
} from './types';

const BUCKET = 'playable-assets';
const DEFAULT_APP_NAME = 'Playable Studio';
const APP_ACCENT_COLORS = ['#2563eb', '#14b8a6', '#f59e0b', '#8b5cf6', '#ec4899', '#10b981'];
const PRESET_APP_NAMES = [DEFAULT_APP_NAME];

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

type ProfileRow = {
  user_id: string;
  email: string;
  display_name: string;
  role: StudioUserRole;
  created_at: string;
  updated_at: string;
};

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
};

type MembershipRow = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceMemberRole;
  created_at: string;
};

type AppRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  accent_color: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

type ProjectRow = {
  id: string;
  workspace_id: string;
  app_id: string;
  owner_user_id: string;
  owner_email: string;
  name: string;
  prompt: string;
  settings: ProjectSettings;
  source_image_path: string | null;
  variants: unknown;
  created_at: string;
  updated_at: string;
};

export type StudioRequestContext = {
  supabase: AdminClient;
  token: string;
  user: User;
  profile: ProfileRow;
  isManager: boolean;
};

export async function requireStudioUser(request: Request): Promise<StudioRequestContext> {
  const token = readBearerToken(request);
  if (!token) throw new Error('Authentication required.');

  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error('Supabase server env is not configured.');

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error('Invalid Supabase session.');

  const profile = await ensureStudioIdentity(supabase, data.user);
  return {
    supabase,
    token,
    user: data.user,
    profile,
    isManager: profile.role === 'manager',
  };
}

export async function getDashboardPayload(ctx: StudioRequestContext): Promise<StudioDashboardPayload> {
  const workspaces = await getAccessibleWorkspaceSummaries(ctx);
  const apps = workspaces.flatMap((workspace) => workspace.apps);
  const projectCount = workspaces.reduce((total, workspace) => total + workspace.projectCount, 0);
  const myProjects = await countOwnedProjects(ctx.supabase, ctx.user.id, ctx.isManager);

  return {
    user: {
      id: ctx.user.id,
      email: ctx.profile.email,
      displayName: ctx.profile.display_name,
      role: ctx.profile.role,
    },
    stats: {
      workspaceCount: workspaces.length,
      appCount: apps.length,
      projectCount,
      myProjectCount: myProjects,
    },
    workspaces,
  };
}

export async function getProjectGalleryPayload(ctx: StudioRequestContext): Promise<StudioProjectGalleryPayload> {
  const workspaces = await getAccessibleWorkspaceRows(ctx);
  const apps = await listAppsForWorkspaces(ctx.supabase, workspaces.map((workspace) => workspace.id));
  const projects = await listProjectRowsForWorkspaces(ctx.supabase, workspaces.map((workspace) => workspace.id));
  const workspaceMap = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const appMap = new Map(apps.map((app) => [app.id, app]));

  const items = projects.flatMap((project) => {
    const workspace = workspaceMap.get(project.workspace_id);
    const app = appMap.get(project.app_id);
    if (!workspace || !app) return [];

    return [
      {
        id: String(project.id),
        name: String(project.name || 'Untitled Project'),
        workspaceId: String(project.workspace_id),
        appId: String(project.app_id),
        appName: String(app.name || DEFAULT_APP_NAME),
        workspaceName: String(workspace.name || 'Workspace'),
        ownerUserId: String(project.owner_user_id),
        ownerEmail: String(project.owner_email || ''),
        variantCount: Array.isArray(project.variants) ? project.variants.length : 0,
        orientation: resolveProjectOrientation(project.settings),
        createdAt: String(project.created_at),
        updatedAt: String(project.updated_at),
      } satisfies StudioProjectGalleryItem,
    ];
  });

  return {
    user: {
      id: ctx.user.id,
      email: ctx.profile.email,
      displayName: ctx.profile.display_name,
      role: ctx.profile.role,
    },
    defaultAppId: pickDefaultAppId(apps, workspaces, ctx.user.id),
    projects: items,
  };
}

export async function createWorkspace(ctx: StudioRequestContext, rawName: string, rawDefaultAppName = DEFAULT_APP_NAME) {
  const name = normalizeEntityName(rawName, 'New Workspace');
  const now = new Date().toISOString();
  const workspaceId = crypto.randomUUID();
  const defaultAppName = normalizeEntityName(rawDefaultAppName, DEFAULT_APP_NAME);

  const { error: workspaceError } = await ctx.supabase.from('playable_workspaces').insert({
    id: workspaceId,
    name,
    slug: `${slugify(name)}-${workspaceId.slice(0, 8)}`,
    owner_user_id: ctx.user.id,
    created_at: now,
    updated_at: now,
  });
  if (workspaceError) throw workspaceError;

  const { error: memberError } = await ctx.supabase.from('playable_workspace_members').insert({
    workspace_id: workspaceId,
    user_id: ctx.user.id,
    role: 'manager',
    created_at: now,
  });
  if (memberError) throw memberError;

  await createAppInWorkspace(ctx, workspaceId, defaultAppName, now);
  return workspaceId;
}

export async function createApp(ctx: StudioRequestContext, workspaceId: string, rawName: string) {
  await assertWorkspaceWriteAccess(ctx, workspaceId);
  return createAppInWorkspace(ctx, workspaceId, rawName);
}

export async function deleteAppRecord(ctx: StudioRequestContext, appId: string) {
  const app = await assertAppAccess(ctx, appId);
  await assertAppDeleteAccess(ctx, app);

  const { data, error } = await ctx.supabase.from('playable_projects').select('*').eq('app_id', app.id);
  if (error) throw error;

  const projects = (data as ProjectRow[]) || [];
  for (const project of projects) {
    await removeProjectAssets(ctx.supabase, project);
  }

  const { error: deleteProjectsError } = await ctx.supabase.from('playable_projects').delete().eq('app_id', app.id);
  if (deleteProjectsError) throw deleteProjectsError;

  const { error: deleteAppError } = await ctx.supabase.from('playable_apps').delete().eq('id', app.id);
  if (deleteAppError) throw deleteAppError;
}

export async function listProjectsForApp(ctx: StudioRequestContext, appId: string): Promise<StudioProjectSummary[]> {
  const app = await assertAppAccess(ctx, appId);
  const { data, error } = await ctx.supabase
    .from('playable_projects')
    .select('id,name,workspace_id,app_id,owner_user_id,owner_email,variants,created_at,updated_at')
    .eq('app_id', app.id)
    .order('updated_at', { ascending: false });
  if (error) throw error;

  return (data || []).map((item) => ({
    id: String(item.id),
    name: String(item.name || 'Untitled Project'),
    workspaceId: String(item.workspace_id),
    appId: String(item.app_id),
    ownerUserId: String(item.owner_user_id),
    ownerEmail: String(item.owner_email || ''),
    variantCount: Array.isArray(item.variants) ? item.variants.length : 0,
    createdAt: String(item.created_at),
    updatedAt: String(item.updated_at),
  }));
}

export async function loadProjectDetail(ctx: StudioRequestContext, projectId: string): Promise<StudioProjectDetail> {
  const { data, error } = await ctx.supabase.from('playable_projects').select('*').eq('id', projectId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Project not found.');

  const row = data as unknown as ProjectRow;
  await assertWorkspaceAccess(ctx, row.workspace_id);

  const sourceImageDataUrl = row.source_image_path ? await downloadStorageAsDataUrl(ctx.supabase, row.source_image_path) : '';
  const sourceId = `source-${row.id}`;
  const savedVariants = Array.isArray(row.variants) ? (row.variants as Array<Record<string, unknown>>) : [];
  const variants = await Promise.all(
    savedVariants.map(async (variant, index) => {
      const imagePath = typeof variant.image_path === 'string' ? variant.image_path : '';
      const dataUrl = imagePath ? await downloadStorageAsDataUrl(ctx.supabase, imagePath) : sourceImageDataUrl;
      return {
        id: typeof variant.id === 'string' ? variant.id : crypto.randomUUID(),
        sourceId,
        index: Number(variant.index) || index + 1,
        name: typeof variant.name === 'string' ? variant.name : `Variant ${index + 1}`,
        dataUrl,
        width: Number(variant.width) || 0,
        height: Number(variant.height) || 0,
        revisedPrompt: typeof variant.revised_prompt === 'string' ? variant.revised_prompt : '',
        hotspot: isRecord(variant.hotspot) ? (variant.hotspot as unknown as PlayableVariant['hotspot']) : { x: 50, y: 72, confidence: 0.28 },
        plan: undefined,
        settings: isRecord(variant.settings) ? (variant.settings as unknown as PlayableVariant['settings']) : ({} as PlayableVariant['settings']),
      } satisfies PlayableVariant;
    }),
  );

  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    workspaceId: row.workspace_id,
    appId: row.app_id,
    ownerUserId: row.owner_user_id,
    ownerEmail: row.owner_email || '',
    settings: row.settings || ({} as ProjectSettings),
    sourceImageDataUrl,
    variants,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function saveProjectRecord(ctx: StudioRequestContext, body: Record<string, unknown>) {
  const appId = typeof body.appId === 'string' ? body.appId : '';
  if (!appId) throw new Error('appId is required.');

  const app = await assertAppAccess(ctx, appId);
  const now = new Date().toISOString();
  const requestedId = typeof body.id === 'string' && body.id ? body.id : '';
  const projectId = requestedId || crypto.randomUUID();
  const existing = requestedId ? await getProjectRow(ctx.supabase, requestedId) : null;

  if (existing) {
    await assertWorkspaceAccess(ctx, existing.workspace_id);
  }

  await ensureBucket(ctx.supabase);

  const sourceImageDataUrl = typeof body.sourceImageDataUrl === 'string' ? body.sourceImageDataUrl : '';
  const sourcePath = sourceImageDataUrl
    ? await uploadDataUrl(ctx.supabase, `projects/${projectId}/source.${guessExtension(sourceImageDataUrl)}`, sourceImageDataUrl)
    : existing?.source_image_path || null;

  const rawVariants = Array.isArray(body.variants) ? body.variants : [];
  const variants = [];
  for (const [index, rawVariant] of rawVariants.entries()) {
    const variant = isRecord(rawVariant) ? rawVariant : {};
    const dataUrl = typeof variant.dataUrl === 'string' ? variant.dataUrl : '';
    const imagePath = dataUrl
      ? await uploadDataUrl(ctx.supabase, `projects/${projectId}/variant-${index + 1}.${guessExtension(dataUrl)}`, dataUrl)
      : '';

    variants.push({
      id: typeof variant.id === 'string' ? variant.id : crypto.randomUUID(),
      index: Number(variant.index) || index + 1,
      name: typeof variant.name === 'string' ? variant.name : `Variant ${index + 1}`,
      width: Number(variant.width) || null,
      height: Number(variant.height) || null,
      image_path: imagePath,
      hotspot: isRecord(variant.hotspot) ? variant.hotspot : null,
      settings: isRecord(variant.settings) ? variant.settings : null,
      revised_prompt: typeof variant.revisedPrompt === 'string' ? variant.revisedPrompt : '',
    });
  }

  const projectPayload = {
    id: projectId,
    workspace_id: app.workspace_id,
    app_id: app.id,
    owner_user_id: existing?.owner_user_id || ctx.user.id,
    owner_email: existing?.owner_email || ctx.profile.email,
    name: normalizeProjectName(
      typeof body.name === 'string' ? body.name : '',
      existing?.name || '',
      app.name,
      now,
    ),
    prompt: String(body.prompt || existing?.prompt || ''),
    settings: isRecord(body.settings) ? body.settings : existing?.settings || {},
    source_image_path: sourcePath,
    variants,
    updated_at: now,
  };

  if (existing) {
    const { error } = await ctx.supabase.from('playable_projects').update(projectPayload).eq('id', projectId);
    if (error) throw error;
  } else {
    const { error } = await ctx.supabase.from('playable_projects').insert({ ...projectPayload, created_at: now });
    if (error) throw error;
  }

  return projectId;
}

export async function deleteProjectRecord(ctx: StudioRequestContext, projectId: string) {
  const project = await getProjectRow(ctx.supabase, projectId);
  if (!project) throw new Error('Project not found.');

  await assertProjectDeleteAccess(ctx, project);
  await removeProjectAssets(ctx.supabase, project);

  const { error } = await ctx.supabase.from('playable_projects').delete().eq('id', projectId);
  if (error) throw error;
}

async function ensureStudioIdentity(supabase: AdminClient, user: User) {
  const email = (user.email || '').trim().toLowerCase();
  const displayName =
    String(user.user_metadata?.display_name || user.user_metadata?.full_name || user.user_metadata?.name || email.split('@')[0] || 'Studio User').trim() || 'Studio User';
  const existing = await getProfileRow(supabase, user.id);
  const role = existing?.role || (await resolveInitialRole(supabase, email));
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('playable_profiles')
    .upsert(
      {
        user_id: user.id,
        email,
        display_name: displayName,
        role,
        created_at: existing?.created_at || now,
        updated_at: now,
      },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single();

  if (error) throw error;

  await ensureDefaultWorkspace(supabase, data as ProfileRow);
  return data as ProfileRow;
}

async function resolveInitialRole(supabase: AdminClient, email: string): Promise<StudioUserRole> {
  if (getManagerEmails().includes(email)) return 'manager';

  const { count, error } = await supabase
    .from('playable_profiles')
    .select('user_id', { head: true, count: 'exact' })
    .eq('role', 'manager');
  if (error) throw error;
  return !count ? 'manager' : 'editor';
}

async function ensureDefaultWorkspace(supabase: AdminClient, profile: ProfileRow) {
  const ownedWorkspace = await supabase.from('playable_workspaces').select('id').eq('owner_user_id', profile.user_id).limit(1).maybeSingle();
  if (ownedWorkspace.data?.id) return;

  const membership = await supabase.from('playable_workspace_members').select('workspace_id').eq('user_id', profile.user_id).limit(1).maybeSingle();
  if (membership.data?.workspace_id) return;

  const workspaceId = crypto.randomUUID();
  const now = new Date().toISOString();
  const workspaceName = `${profile.display_name || 'My'} Workspace`;
  const { error: workspaceError } = await supabase.from('playable_workspaces').insert({
    id: workspaceId,
    name: workspaceName,
    slug: buildDefaultWorkspaceSlug(profile),
    owner_user_id: profile.user_id,
    created_at: now,
    updated_at: now,
  });
  if (workspaceError && !isUniqueViolation(workspaceError)) throw workspaceError;
  if (workspaceError) return;

  const { error: memberError } = await supabase.from('playable_workspace_members').insert({
    workspace_id: workspaceId,
    user_id: profile.user_id,
    role: 'manager',
    created_at: now,
  });
  if (memberError && !isUniqueViolation(memberError)) throw memberError;

  for (const name of PRESET_APP_NAMES) {
    const appId = crypto.randomUUID();
    await insertPresetAppRow(supabase, {
      id: appId,
      workspace_id: workspaceId,
      name,
      slug: buildSeededAppSlug(workspaceId, name),
      accent_color: pickAccentColor(appId),
      created_by_user_id: profile.user_id,
      created_at: now,
      updated_at: now,
    });
  }
}

async function getAccessibleWorkspaceSummaries(ctx: StudioRequestContext): Promise<StudioWorkspaceSummary[]> {
  const workspaces = await getAccessibleWorkspaceRows(ctx);
  if (!workspaces.length) return [];

  const workspaceIds = workspaces.map((workspace) => workspace.id);
  const memberships = ctx.isManager
    ? []
    : ((await ctx.supabase
        .from('playable_workspace_members')
        .select('workspace_id,role')
        .eq('user_id', ctx.user.id)
        .in('workspace_id', workspaceIds)).data as Array<Pick<MembershipRow, 'workspace_id' | 'role'>>) || [];

  const apps = await listAppsForWorkspaces(ctx.supabase, workspaceIds);
  const projects = await listProjectRowsForWorkspaces(ctx.supabase, workspaceIds, 'id,workspace_id,app_id,owner_user_id,updated_at');

  const appProjectCount = new Map<string, number>();
  const appMyProjectCount = new Map<string, number>();
  const appUpdatedTodayCount = new Map<string, number>();
  const appLastUpdated = new Map<string, string>();
  const workspaceProjectCount = new Map<string, number>();
  const workspaceLastUpdated = new Map<string, string>();
  const todayKey = new Date().toISOString().slice(0, 10);

  for (const project of projects) {
    appProjectCount.set(project.app_id, (appProjectCount.get(project.app_id) || 0) + 1);
    workspaceProjectCount.set(project.workspace_id, (workspaceProjectCount.get(project.workspace_id) || 0) + 1);
    appLastUpdated.set(project.app_id, maxTimestamp(appLastUpdated.get(project.app_id), project.updated_at));
    workspaceLastUpdated.set(project.workspace_id, maxTimestamp(workspaceLastUpdated.get(project.workspace_id), project.updated_at));
    if (project.owner_user_id === ctx.user.id) {
      appMyProjectCount.set(project.app_id, (appMyProjectCount.get(project.app_id) || 0) + 1);
    }
    if ((project.updated_at || '').startsWith(todayKey)) {
      appUpdatedTodayCount.set(project.app_id, (appUpdatedTodayCount.get(project.app_id) || 0) + 1);
    }
  }

  const workspaceAppMap = new Map<string, StudioAppSummary[]>();
  for (const app of apps) {
    const summary: StudioAppSummary = {
      id: app.id,
      workspaceId: app.workspace_id,
      name: app.name,
      slug: app.slug,
      accentColor: app.accent_color || pickAccentColor(app.id),
      projectCount: appProjectCount.get(app.id) || 0,
      myProjectCount: appMyProjectCount.get(app.id) || 0,
      updatedTodayCount: appUpdatedTodayCount.get(app.id) || 0,
      lastUpdatedAt: appLastUpdated.get(app.id) || app.updated_at || null,
      createdAt: app.created_at,
      updatedAt: app.updated_at,
    };
    const current = workspaceAppMap.get(app.workspace_id) || [];
    current.push(summary);
    workspaceAppMap.set(app.workspace_id, current);
  }

  return workspaces.map((workspace) => {
    const membership = memberships.find((item) => item.workspace_id === workspace.id);
    const workspaceApps = (workspaceAppMap.get(workspace.id) || []).sort(compareStudioApps);
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      ownerUserId: workspace.owner_user_id,
      memberRole: workspace.owner_user_id === ctx.user.id || ctx.isManager ? 'manager' : membership?.role || 'viewer',
      projectCount: workspaceProjectCount.get(workspace.id) || 0,
      appCount: workspaceApps.length,
      lastUpdatedAt: workspaceLastUpdated.get(workspace.id) || workspace.updated_at || null,
      createdAt: workspace.created_at,
      updatedAt: workspace.updated_at,
      apps: workspaceApps,
    } satisfies StudioWorkspaceSummary;
  });
}

async function getAccessibleWorkspaceRows(ctx: StudioRequestContext): Promise<WorkspaceRow[]> {
  if (ctx.isManager) {
    return (((await ctx.supabase
      .from('playable_workspaces')
      .select('id,name,slug,owner_user_id,created_at,updated_at')
      .order('updated_at', { ascending: false })).data as WorkspaceRow[]) || []);
  }

  const owned =
    ((await ctx.supabase
      .from('playable_workspaces')
      .select('id,name,slug,owner_user_id,created_at,updated_at')
      .eq('owner_user_id', ctx.user.id)).data as WorkspaceRow[]) || [];
  const membershipIds =
    ((await ctx.supabase.from('playable_workspace_members').select('workspace_id').eq('user_id', ctx.user.id)).data as Array<{ workspace_id: string }>) || [];
  const extraIds = membershipIds.map((row) => row.workspace_id).filter((id) => !owned.some((workspace) => workspace.id === id));
  if (!extraIds.length) return owned.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const extra =
    ((await ctx.supabase
      .from('playable_workspaces')
      .select('id,name,slug,owner_user_id,created_at,updated_at')
      .in('id', extraIds)).data as WorkspaceRow[]) || [];
  return [...owned, ...extra].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

async function listAppsForWorkspaces(supabase: AdminClient, workspaceIds: string[]) {
  if (!workspaceIds.length) return [];
  return (
    ((await supabase
      .from('playable_apps')
      .select('id,workspace_id,name,slug,accent_color,created_by_user_id,created_at,updated_at')
      .in('workspace_id', workspaceIds)
      .order('updated_at', { ascending: false })).data as AppRow[]) || []
  );
}

async function listProjectRowsForWorkspaces(
  supabase: AdminClient,
  workspaceIds: string[],
  columns = 'id,name,workspace_id,app_id,owner_user_id,owner_email,variants,settings,created_at,updated_at',
) {
  if (!workspaceIds.length) return [];
  return (
    ((await supabase.from('playable_projects').select(columns).in('workspace_id', workspaceIds).order('updated_at', { ascending: false }))
      .data as unknown as ProjectRow[]) || []
  );
}

async function countOwnedProjects(supabase: AdminClient, userId: string, isManager: boolean) {
  if (isManager) {
    const { count, error } = await supabase.from('playable_projects').select('id', { head: true, count: 'exact' });
    if (error) throw error;
    return count || 0;
  }

  const { count, error } = await supabase
    .from('playable_projects')
    .select('id', { head: true, count: 'exact' })
    .eq('owner_user_id', userId);
  if (error) throw error;
  return count || 0;
}

async function assertAppAccess(ctx: StudioRequestContext, appId: string) {
  const { data, error } = await ctx.supabase
    .from('playable_apps')
    .select('id,workspace_id,name,slug,accent_color,created_by_user_id,created_at,updated_at')
    .eq('id', appId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('App not found.');
  await assertWorkspaceAccess(ctx, String(data.workspace_id));
  return data as AppRow;
}

async function assertWorkspaceAccess(ctx: StudioRequestContext, workspaceId: string) {
  if (ctx.isManager) return;

  const { data: owned } = await ctx.supabase
    .from('playable_workspaces')
    .select('id')
    .eq('id', workspaceId)
    .eq('owner_user_id', ctx.user.id)
    .maybeSingle();
  if (owned?.id) return;

  const { data: member } = await ctx.supabase
    .from('playable_workspace_members')
    .select('workspace_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', ctx.user.id)
    .maybeSingle();
  if (!member?.workspace_id) throw new Error('You do not have access to this workspace.');
}

async function assertWorkspaceWriteAccess(ctx: StudioRequestContext, workspaceId: string) {
  if (ctx.isManager) return;

  const { data: owned } = await ctx.supabase
    .from('playable_workspaces')
    .select('id')
    .eq('id', workspaceId)
    .eq('owner_user_id', ctx.user.id)
    .maybeSingle();
  if (owned?.id) return;

  const { data: member } = await ctx.supabase
    .from('playable_workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', ctx.user.id)
    .maybeSingle();
  if (!member?.role || member.role === 'viewer') throw new Error('You do not have edit access to this workspace.');
}

async function assertAppDeleteAccess(ctx: StudioRequestContext, app: AppRow) {
  if (ctx.isManager) return;

  const role = await getWorkspaceUserRole(ctx, app.workspace_id);
  if (role === 'owner' || role === 'manager' || app.created_by_user_id === ctx.user.id) return;
  throw new Error('You do not have permission to delete this app.');
}

async function assertProjectDeleteAccess(ctx: StudioRequestContext, project: ProjectRow) {
  if (ctx.isManager) return;

  const role = await getWorkspaceUserRole(ctx, project.workspace_id);
  if (role === 'owner' || role === 'manager' || project.owner_user_id === ctx.user.id) return;
  throw new Error('You do not have permission to delete this project.');
}

async function getWorkspaceUserRole(ctx: StudioRequestContext, workspaceId: string): Promise<'owner' | WorkspaceMemberRole | 'none'> {
  const { data: owned } = await ctx.supabase
    .from('playable_workspaces')
    .select('id')
    .eq('id', workspaceId)
    .eq('owner_user_id', ctx.user.id)
    .maybeSingle();
  if (owned?.id) return 'owner';

  const { data: member } = await ctx.supabase
    .from('playable_workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', ctx.user.id)
    .maybeSingle();
  return (member?.role as WorkspaceMemberRole | undefined) || 'none';
}

async function createAppInWorkspace(ctx: StudioRequestContext, workspaceId: string, rawName: string, now = new Date().toISOString()) {
  const appId = crypto.randomUUID();
  const name = normalizeEntityName(rawName, DEFAULT_APP_NAME);
  const row: AppRow = {
    id: appId,
    workspace_id: workspaceId,
    name,
    slug: `${slugify(name)}-${appId.slice(0, 8)}`,
    accent_color: pickAccentColor(appId),
    created_by_user_id: ctx.user.id,
    created_at: now,
    updated_at: now,
  };
  await insertAppRow(ctx.supabase, row);
  return appId;
}

async function insertAppRow(supabase: AdminClient, row: AppRow) {
  const { error } = await supabase.from('playable_apps').insert(row);
  if (error) throw error;
}

async function insertPresetAppRow(supabase: AdminClient, row: AppRow) {
  const { error } = await supabase.from('playable_apps').insert(row);
  if (error && !isUniqueViolation(error)) throw error;
}

async function getProfileRow(supabase: AdminClient, userId: string) {
  const { data, error } = await supabase.from('playable_profiles').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return (data as ProfileRow | null) || null;
}

async function getProjectRow(supabase: AdminClient, projectId: string) {
  const { data, error } = await supabase.from('playable_projects').select('*').eq('id', projectId).maybeSingle();
  if (error) throw error;
  return (data as ProjectRow | null) || null;
}

async function ensureBucket(supabase: AdminClient) {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (data) return;

  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 25 * 1024 * 1024,
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function uploadDataUrl(supabase: AdminClient, path: string, dataUrl: string) {
  const { buffer, mime } = dataUrlToBuffer(dataUrl);
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mime,
    upsert: true,
  });
  if (error) throw error;
  return path;
}

async function downloadStorageAsDataUrl(supabase: AdminClient, path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error;
  const mime = data.type || guessMimeFromPath(path);
  const buffer = Buffer.from(await data.arrayBuffer());
  return asDataUrl(buffer.toString('base64'), mime);
}

async function removeProjectAssets(supabase: AdminClient, project: ProjectRow) {
  const paths = collectProjectStoragePaths(project);
  if (!paths.length) return;

  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error && !/not found/i.test(error.message)) throw error;
}

function collectProjectStoragePaths(project: ProjectRow) {
  const paths = new Set<string>();
  if (project.source_image_path) paths.add(project.source_image_path);

  if (Array.isArray(project.variants)) {
    for (const variant of project.variants as Array<Record<string, unknown>>) {
      const imagePath = typeof variant.image_path === 'string' ? variant.image_path : '';
      if (imagePath) paths.add(imagePath);
    }
  }

  return [...paths];
}

function readBearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function guessExtension(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/([a-z0-9.+-]+);/i);
  if (!match) return 'png';
  return match[1].toLowerCase().includes('jpeg') ? 'jpg' : match[1].replace(/[^a-z0-9]/g, '') || 'png';
}

function guessMimeFromPath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() || 'png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  return 'image/png';
}

function getManagerEmails() {
  return String(process.env.PLAYABLE_MANAGER_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEntityName(value: string, fallback: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean || fallback;
}

function slugify(value: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'studio';
}

function buildDefaultWorkspaceSlug(profile: Pick<ProfileRow, 'user_id' | 'display_name'>) {
  return `${slugify(profile.display_name || 'studio')}-${profile.user_id.slice(0, 8)}`;
}

function buildSeededAppSlug(workspaceId: string, name: string) {
  return `${slugify(name)}-${workspaceId.slice(0, 8)}`;
}

function pickAccentColor(seed: string) {
  let sum = 0;
  for (const char of seed) sum += char.charCodeAt(0);
  return APP_ACCENT_COLORS[sum % APP_ACCENT_COLORS.length];
}

function compareStudioApps(left: StudioAppSummary, right: StudioAppSummary) {
  const leftPresetIndex = PRESET_APP_NAMES.findIndex((name) => name.toLowerCase() === left.name.toLowerCase());
  const rightPresetIndex = PRESET_APP_NAMES.findIndex((name) => name.toLowerCase() === right.name.toLowerCase());
  const leftRank = leftPresetIndex === -1 ? Number.MAX_SAFE_INTEGER : leftPresetIndex;
  const rightRank = rightPresetIndex === -1 ? Number.MAX_SAFE_INTEGER : rightPresetIndex;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return right.updatedAt.localeCompare(left.updatedAt);
}

function maxTimestamp(current?: string | null, next?: string | null) {
  if (!current) return next || '';
  if (!next) return current;
  return current > next ? current : next;
}

function isUniqueViolation(error: { code?: string | null; message?: string | null }) {
  const code = String(error.code || '');
  const message = String(error.message || '');
  return code === '23505' || /duplicate key value|unique constraint/i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveProjectOrientation(settings: ProjectSettings | null | undefined): Orientation {
  return settings?.orientation === 'landscape' ? 'landscape' : 'portrait';
}

function pickDefaultAppId(apps: AppRow[], workspaces: WorkspaceRow[], userId: string) {
  if (!apps.length) return null;

  const workspacePriority = [
    ...workspaces.filter((workspace) => workspace.owner_user_id === userId).map((workspace) => workspace.id),
    ...workspaces.filter((workspace) => workspace.owner_user_id !== userId).map((workspace) => workspace.id),
  ];
  const workspaceRank = new Map(workspacePriority.map((workspaceId, index) => [workspaceId, index]));
  const sorted = [...apps].sort((left, right) => {
    const leftRank = workspaceRank.get(left.workspace_id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = workspaceRank.get(right.workspace_id) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;

    const leftDefault = left.name.toLowerCase() === DEFAULT_APP_NAME.toLowerCase() ? 0 : 1;
    const rightDefault = right.name.toLowerCase() === DEFAULT_APP_NAME.toLowerCase() ? 0 : 1;
    if (leftDefault !== rightDefault) return leftDefault - rightDefault;

    return right.updated_at.localeCompare(left.updated_at);
  });

  return sorted[0]?.id || null;
}

function normalizeProjectName(rawName: string, existingName: string, appName: string, nowIso: string) {
  const preferredFallback = buildDateProjectName(nowIso);
  const candidate = normalizeEntityName(rawName || existingName || preferredFallback, preferredFallback);
  const lower = candidate.trim().toLowerCase();
  const legacyNames = new Set([
    'playable batch',
    'playable project',
    `${appName} project`.trim().toLowerCase(),
  ]);
  return legacyNames.has(lower) ? preferredFallback : candidate;
}

function buildDateProjectName(nowIso: string) {
  const stamp = String(nowIso || '')
    .replace('T', ' ')
    .slice(0, 16)
    .replace(/:/g, '-');
  return `Project ${stamp || 'draft'}`;
}
