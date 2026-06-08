'use client';

import type { Session } from '@supabase/supabase-js';
import { ArrowUpRight, CalendarDays, LayoutGrid, Loader2, LogOut, Plus, Search, ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowser } from '../lib/supabase-browser';
import type { StudioProjectGalleryItem, StudioProjectGalleryPayload } from '../lib/types';

type AuthMode = 'login' | 'signup';

export function StudioDashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [gallery, setGallery] = useState<StudioProjectGalleryPayload | null>(null);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [query, setQuery] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const accessToken = session?.access_token || '';

  const loadGallery = useCallback(
    async (token: string, options?: { silent?: boolean }) => {
      if (!token) {
        setGallery(null);
        setGalleryLoading(false);
        return;
      }

      const silent = options?.silent ?? false;
      if (!silent) setGalleryLoading(true);
      setError('');

      try {
        const response = await fetch('/api/projects/gallery', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.error === 'string' ? payload.error : 'Cannot load projects.');
        }
        setGallery(payload as StudioProjectGalleryPayload);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Cannot load projects.');
      } finally {
        if (!silent) setGalleryLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!supabase) {
      setSessionLoading(false);
      setError('Missing Supabase browser config.');
      return;
    }

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session || null);
      setSessionLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession || null);
      setSessionLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!accessToken) {
      setGallery(null);
      setGalleryLoading(false);
      return;
    }

    void loadGallery(accessToken);
  }, [accessToken, loadGallery]);

  useEffect(() => {
    if (!accessToken || typeof window === 'undefined') return;

    const refreshGallery = () => {
      void loadGallery(accessToken, { silent: true });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshGallery();
    };

    const shouldRefresh = window.sessionStorage.getItem('playable-dashboard-refresh');
    if (shouldRefresh) {
      window.sessionStorage.removeItem('playable-dashboard-refresh');
      window.setTimeout(refreshGallery, 150);
    }

    window.addEventListener('focus', refreshGallery);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshGallery);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [accessToken, loadGallery]);

  const filteredProjects = useMemo(() => {
    if (!gallery) return [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return gallery.projects;
    return gallery.projects.filter((project) =>
      `${project.name} ${project.appName} ${project.workspaceName}`.toLowerCase().includes(normalizedQuery),
    );
  }, [gallery, query]);

  const submitAuth = async () => {
    if (!supabase) return;
    setAuthBusy(true);
    setError('');
    setMessage('');

    try {
      if (authMode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) throw signUpError;
        setMessage(data.session ? 'Account created. Redirecting to projects.' : 'Account created. Confirm email if required, then log in.');
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (loginError) throw loginError;
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authentication failed.');
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setGallery(null);
    setMessage('');
    setError('');
  };

  if (sessionLoading) {
    return (
      <main className="dashboard-page-state">
        <Loader2 className="spin" size={18} />
        <span>Checking session...</span>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-brand">
            <div className="brand-mark">
              <LayoutGrid size={20} />
            </div>
            <div>
              <strong>Playable Studio</strong>
              <span>Sign in to open a simple list of saved projects.</span>
            </div>
          </div>

          <div className="auth-mode-row">
            <button className={authMode === 'login' ? 'active' : ''} type="button" onClick={() => setAuthMode('login')}>
              Sign In
            </button>
            <button className={authMode === 'signup' ? 'active' : ''} type="button" onClick={() => setAuthMode('signup')}>
              Create Account
            </button>
          </div>

          <label className="field">
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="........" />
          </label>

          {error ? <div className="field-status warn">{error}</div> : null}
          {message ? <div className="field-status ok">{message}</div> : null}

          <button className="primary-button wide" type="button" onClick={submitAuth} disabled={authBusy || !email.trim() || !password.trim()}>
            {authBusy ? <Loader2 className="spin" size={16} /> : <ArrowUpRight size={16} />}
            {authMode === 'signup' ? 'Create Account' : 'Open Projects'}
          </button>
        </section>
      </main>
    );
  }

  if (galleryLoading || !gallery) {
    return (
      <main className="dashboard-page-state">
        <section className="dashboard-loading-card">
          <div className="dashboard-brand">
            <div className="brand-mark">
              <LayoutGrid size={20} />
            </div>
            <div>
              <strong>Playable Studio</strong>
              <span>Loading your saved projects...</span>
            </div>
          </div>

          <div className="dashboard-state">
            <Loader2 className="spin" size={18} />
            <span>{error || 'Loading projects...'}</span>
          </div>

          <button className="secondary-button" type="button" onClick={signOut}>
            <LogOut size={15} />
            Sign Out
          </button>
        </section>
      </main>
    );
  }

  const newProjectHref = gallery.defaultAppId
    ? `/apps/${gallery.defaultAppId}?new=1&name=${encodeURIComponent(buildDateProjectName(new Date()))}`
    : '';

  return (
    <main className="dashboard-shell project-hub-shell">
      <header className="dashboard-header project-hub-header">
        <div className="project-hub-copy">
          <span className="eyebrow">Project Library</span>
          <h1>Your Projects</h1>
          <p className="dashboard-subtitle">One simple list. New projects start with the current date and open directly in Studio.</p>
        </div>

        <div className="dashboard-userbar project-hub-actions">
          <span className={`dashboard-role-chip ${gallery.user.role === 'manager' ? 'manager' : ''}`}>
            {gallery.user.role === 'manager' ? <ShieldCheck size={14} /> : <UserRound size={14} />}
            {gallery.user.displayName}
          </span>

          {newProjectHref ? (
            <Link href={newProjectHref} className="primary-button">
              <Plus size={16} />
              New Project
            </Link>
          ) : (
            <button className="primary-button" type="button" disabled>
              <Plus size={16} />
              New Project
            </button>
          )}

          <button className="secondary-button" type="button" onClick={signOut}>
            <LogOut size={15} />
            Sign Out
          </button>
        </div>
      </header>

      {error ? <div className="dashboard-banner warn">{error}</div> : null}
      {message ? <div className="dashboard-banner ok">{message}</div> : null}

      <section className="project-hub-toolbar">
        <div className="project-hub-summary">
          <strong>{gallery.projects.length}</strong>
          <span>{gallery.projects.length === 1 ? 'saved project' : 'saved projects'}</span>
        </div>

        <label className="project-hub-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects..." />
        </label>
      </section>

      <section className="project-grid">
        {filteredProjects.length ? (
          filteredProjects.map((project) => {
            const href = `/apps/${project.appId}?projectId=${encodeURIComponent(project.id)}`;
            return (
              <Link key={project.id} href={href} className="project-card">
                <div className={`project-card-preview ${project.orientation}`}>
                  <span className="project-card-badge">{project.orientation === 'portrait' ? '9:16' : '16:9'}</span>
                  <div className="project-card-canvas">
                    <span>{buildPreviewText(project)}</span>
                  </div>
                </div>

                <div className="project-card-body">
                  <strong>{getDisplayProjectName(project)}</strong>
                  <span className="project-card-date">
                    <CalendarDays size={14} />
                    Edited {formatProjectDate(project.updatedAt)}
                  </span>
                  <div className="project-card-meta">
                    <span>{project.variantCount} {project.variantCount === 1 ? 'variant' : 'variants'}</span>
                    <span>{project.orientation === 'portrait' ? 'Portrait' : 'Landscape'}</span>
                  </div>
                </div>

                <div className="project-card-footer">
                  <span>Open Studio</span>
                  <ArrowUpRight size={15} />
                </div>
              </Link>
            );
          })
        ) : (
          <div className="project-empty-state">
            <strong>{query.trim() ? 'No matching projects' : 'No saved projects yet'}</strong>
            <p>{query.trim() ? 'Try a different keyword.' : 'Create a new project and it will appear here sorted by the latest update.'}</p>
            {newProjectHref ? (
              <Link href={newProjectHref} className="primary-button">
                <Plus size={16} />
                New Project
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}

function buildDateProjectName(date: Date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `Project ${year}-${month}-${day} ${hour}-${minute}`;
}

function getDisplayProjectName(project: StudioProjectGalleryItem) {
  const normalized = project.name.trim().toLowerCase();
  if (normalized === 'playable batch' || normalized === 'playable project') {
    return buildDateProjectName(new Date(project.createdAt));
  }
  return project.name;
}

function buildPreviewText(project: StudioProjectGalleryItem) {
  const date = formatProjectDate(project.updatedAt);
  return date === '--' ? 'Draft' : date;
}

function formatProjectDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}
