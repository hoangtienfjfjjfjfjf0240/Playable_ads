'use client';

import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  ArrowUpRight,
  CalendarDays,
  LayoutGrid,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const [deletingProjectId, setDeletingProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');

  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const galleryRequestRef = useRef(0);
  const router = useRouter();
  const accessToken = session?.access_token || '';
  const normalizedNewProjectName = normalizeProjectNameInput(newProjectName);

  const loadGallery = useCallback(
    async (token: string, options?: { silent?: boolean }) => {
      if (!token) {
        setGallery(null);
        setGalleryLoading(false);
        return;
      }

      const silent = options?.silent ?? false;
      const requestId = galleryRequestRef.current + 1;
      galleryRequestRef.current = requestId;
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
          throw new Error(typeof payload?.error === 'string' ? payload.error : 'Không tải được thư viện project.');
        }
        if (galleryRequestRef.current === requestId) {
          setGallery(payload as StudioProjectGalleryPayload);
        }
      } catch (reason) {
        if (galleryRequestRef.current === requestId) {
          setError(reason instanceof Error ? reason.message : 'Không tải được thư viện project.');
        }
      } finally {
        if (!silent && galleryRequestRef.current === requestId) {
          setGalleryLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!supabase) {
      setSessionLoading(false);
      setError('Thiếu cấu hình Supabase ở trình duyệt.');
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

    const shouldRefresh = window.sessionStorage.getItem('playable-dashboard-refresh');
    if (!shouldRefresh) return;

    window.sessionStorage.removeItem('playable-dashboard-refresh');
    const timer = window.setTimeout(() => {
      void loadGallery(accessToken, { silent: true });
    }, 120);
    return () => window.clearTimeout(timer);
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
        setMessage(
          data.session
            ? 'Đã tạo tài khoản. Đang chuyển vào thư viện project.'
            : 'Đã tạo tài khoản. Kiểm tra email rồi đăng nhập.',
        );
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (loginError) throw loginError;
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Đăng nhập thất bại.');
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

  const retryGallery = useCallback(() => {
    if (!accessToken) return;
    void loadGallery(accessToken);
  }, [accessToken, loadGallery]);

  const startNamedProject = useCallback(() => {
    if (!gallery?.defaultAppId) {
      setError('Chưa có app mặc định để mở editor.');
      return;
    }
    if (!normalizedNewProjectName) {
      setError('Nhập tên project trước khi bắt đầu.');
      return;
    }
    setError('');
    setMessage('');
    router.push(`/apps/${gallery.defaultAppId}?new=1&name=${encodeURIComponent(normalizedNewProjectName)}`);
  }, [gallery?.defaultAppId, normalizedNewProjectName, router]);

  const deleteProject = useCallback(
    async (projectId: string) => {
      if (!accessToken || deletingProjectId) return;
      if (typeof window !== 'undefined' && !window.confirm('Xóa project này khỏi thư viện?')) return;

      setDeletingProjectId(projectId);
      setError('');
      setMessage('');

      try {
        const response = await fetch(`/api/projects/${projectId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.error === 'string' ? payload.error : 'Không xóa được project.');
        }

        setGallery((current) =>
          current
            ? {
                ...current,
                projects: current.projects.filter((project) => project.id !== projectId),
              }
            : current,
        );
        setMessage('Đã xóa project khỏi thư viện.');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Không xóa được project.');
      } finally {
        setDeletingProjectId('');
      }
    },
    [accessToken, deletingProjectId],
  );

  if (sessionLoading) {
    return (
      <LoginShell>
        <LoginCard
          eyebrow="Phiên làm việc"
          title="Đang kiểm tra đăng nhập"
          description="Hệ thống đang xác nhận tài khoản hiện tại trước khi mở thư viện project."
        >
          <LoginStatus
            icon={<Loader2 className="spin" size={18} />}
            title="Đang kiểm tra tài khoản"
            description="Thao tác này thường chỉ mất vài giây trên local."
          />
        </LoginCard>
      </LoginShell>
    );
  }

  if (!session) {
    return (
      <LoginShell>
        <LoginCard
          eyebrow="Đăng nhập"
          title={authMode === 'signup' ? 'Tạo tài khoản mới' : 'Vào Playable Studio'}
          description={
            authMode === 'signup'
              ? 'Tạo tài khoản để quản lý app, project và batch theo đúng phạm vi của bạn.'
              : 'Đăng nhập để mở project đã lưu và vào đúng editor của từng app.'
          }
          footer={
            <LoginFooterPrompt
              question={authMode === 'signup' ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'}
              actionLabel={authMode === 'signup' ? 'Đăng nhập' : 'Tạo tài khoản'}
              onClick={() => setAuthMode((current) => (current === 'login' ? 'signup' : 'login'))}
            />
          }
        >
          <div className="login-mode-row">
            <button className={authMode === 'login' ? 'active' : ''} type="button" onClick={() => setAuthMode('login')}>
              Đăng nhập
            </button>
            <button className={authMode === 'signup' ? 'active' : ''} type="button" onClick={() => setAuthMode('signup')}>
              Tạo tài khoản
            </button>
          </div>

          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitAuth();
            }}
          >
            <label className="field">
              <span>Email công việc</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" type="email" />
            </label>

            <label className="field">
              <span>Mật khẩu</span>
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Nhập mật khẩu" type="password" />
            </label>

            <p className="login-panel-note">Dùng đúng email đã được cấp để thấy app và project đã lưu của bạn.</p>

            {error ? <LoginStatus tone="warn" title="Không thể đăng nhập" description={error} /> : null}
            {message ? <LoginStatus tone="ok" title="Trạng thái tài khoản" description={message} /> : null}

            <button className="login-primary-button" type="submit" disabled={authBusy || !email.trim() || !password.trim()}>
              {authBusy ? <Loader2 className="spin" size={16} /> : <ArrowUpRight size={16} />}
              {authMode === 'signup' ? 'Tạo tài khoản và vào studio' : 'Vào thư viện project'}
            </button>
          </form>
        </LoginCard>
      </LoginShell>
    );
  }

  if (!gallery) {
    const hasLoadError = Boolean(error);

    return (
      <LoginShell>
        <LoginCard
          eyebrow="Project Library"
          title={hasLoadError ? 'Không tải được thư viện project' : 'Đang tải project của bạn'}
          description={
            hasLoadError
              ? 'Phiên đăng nhập vẫn còn, nhưng danh sách project chưa nạp xong.'
              : 'Hệ thống đang lấy danh sách project đã lưu và đồng bộ app mặc định cho tài khoản này.'
          }
          footer={
            <div className="login-card-actions">
              <button className="login-primary-button" type="button" onClick={retryGallery} disabled={galleryLoading}>
                {galleryLoading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
                {galleryLoading ? 'Đang tải...' : hasLoadError ? 'Thử tải lại' : 'Làm mới ngay'}
              </button>

              <button className="login-secondary-button" type="button" onClick={signOut}>
                <LogOut size={15} />
                Đăng xuất
              </button>
            </div>
          }
        >
          <LoginStatus
            tone={hasLoadError ? 'warn' : 'default'}
            icon={hasLoadError ? <RefreshCw size={18} /> : <Loader2 className="spin" size={18} />}
            title={hasLoadError ? 'Cần tải lại dữ liệu' : 'Đang đồng bộ thư viện'}
            description={error || 'Thư viện project sẽ xuất hiện ngay khi dữ liệu đã sẵn sàng.'}
          />

          <div className="login-inline-meta">
            <span className="login-meta-pill">Tài khoản: {session.user.email || 'Đang đăng nhập'}</span>
            <span className="login-meta-pill">Nguồn dữ liệu: Supabase</span>
          </div>
        </LoginCard>
      </LoginShell>
    );
  }

  return (
    <main className="dashboard-shell project-hub-shell">
      <header className="dashboard-header project-hub-header">
        <div className="project-hub-copy">
          <span className="eyebrow">Thư viện project</span>
          <h1>Project của bạn</h1>
          <p className="dashboard-subtitle">Mở lại project đã có và tiếp tục làm việc nhanh hơn.</p>
        </div>

        <div className="dashboard-userbar project-hub-actions">
          <span className={`dashboard-role-chip ${gallery.user.role === 'manager' ? 'manager' : ''}`}>
            {gallery.user.role === 'manager' ? <ShieldCheck size={14} /> : <UserRound size={14} />}
            {gallery.user.displayName}
          </span>

          <button className="secondary-button" type="button" onClick={signOut}>
            <LogOut size={15} />
            Đăng xuất
          </button>
        </div>
      </header>

      {error ? <div className="dashboard-banner warn">{error}</div> : null}
      {message ? <div className="dashboard-banner ok">{message}</div> : null}

      <section className="project-hub-toolbar">
        <div className="project-hub-summary">
          <strong>{gallery.projects.length}</strong>
          <span>project đã lưu</span>
        </div>

        <form
          className="project-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            startNamedProject();
          }}
        >
          <label className="project-create-input">
            <input
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="Nhập tên project rồi mở editor..."
            />
          </label>
          <button className="primary-button" type="submit" disabled={!gallery.defaultAppId || !normalizedNewProjectName}>
            <Plus size={16} />
            Tạo project
          </button>
        </form>

        <label className="project-hub-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên project hoặc app..." />
        </label>
      </section>

      <section className="project-grid">
        {filteredProjects.length ? (
          filteredProjects.map((project) => {
            const href = `/apps/${project.appId}?projectId=${encodeURIComponent(project.id)}`;
            return (
              <article
                key={project.id}
                className="project-card"
                role="link"
                tabIndex={0}
                onClick={() => router.push(href)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    router.push(href);
                  }
                }}
              >
                <div className="project-card-main">
                  <div className="project-card-preview" aria-hidden="true">
                    <div className="project-card-canvas">
                      <span>{buildPreviewMonogram(project)}</span>
                    </div>
                  </div>

                  <div className="project-card-body">
                    <div className="project-card-title-row">
                      <strong>{getDisplayProjectName(project)}</strong>
                      <span className="project-card-app">{project.appName}</span>
                    </div>
                    <span className="project-card-date">
                      <CalendarDays size={14} />
                      Cập nhật {formatProjectDate(project.updatedAt)}
                    </span>
                  </div>
                </div>

                <div className="project-card-side">
                  <span className="project-card-link">
                    Mở studio
                    <ArrowUpRight size={15} />
                  </span>
                  <button
                    className="danger-button slim project-card-delete"
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void deleteProject(project.id);
                    }}
                    disabled={deletingProjectId === project.id}
                    aria-label={`Xóa ${project.name}`}
                  >
                    {deletingProjectId === project.id ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />}
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <div className="project-empty-state">
            <strong>{query.trim() ? 'Không có project phù hợp' : 'Chưa có project đã lưu'}</strong>
            <p>{query.trim() ? 'Thử một từ khóa khác.' : 'Nhập tên project ở phía trên rồi mở editor để bắt đầu.'}</p>
          </div>
        )}
      </section>
    </main>
  );
}

function LoginShell({ children }: { children: ReactNode }) {
  return (
    <main className="login-shell">
      <section className="login-stage">{children}</section>

    </main>
  );
}

function LoginCard({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="login-card">
      <div className="login-card-head">
        <div className="login-card-icon">
          <LayoutGrid size={28} />
        </div>

        <div className="login-card-copy">
          <span className="login-card-kicker">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>

      <div className="login-card-body">{children}</div>

      {footer ? <div className="login-card-footer">{footer}</div> : null}
    </section>
  );
}

function LoginStatus({
  title,
  description,
  icon,
  tone = 'default',
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  tone?: 'default' | 'warn' | 'ok';
}) {
  return (
    <div className={`login-status ${tone}`}>
      <div className="login-status-icon">{icon || <LayoutGrid size={18} />}</div>
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    </div>
  );
}

function LoginFooterPrompt({
  question,
  actionLabel,
  onClick,
}: {
  question: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="login-card-actions">
      <span className="login-footer-note">{question}</span>
      <button className="login-link-button" type="button" onClick={onClick}>
        {actionLabel}
      </button>
    </div>
  );
}

function getDisplayProjectName(project: StudioProjectGalleryItem) {
  const normalized = project.name.trim().toLowerCase();
  if (normalized === 'playable batch' || normalized === 'playable project') {
    return project.appName;
  }
  return project.name;
}

function buildPreviewMonogram(project: StudioProjectGalleryItem) {
  const source = getDisplayProjectName(project) || project.appName || 'Project';
  const words = source
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const letters = words.slice(0, 2).map((part) => part[0]?.toUpperCase() || '');
  return (letters.join('') || source.slice(0, 2).toUpperCase()).slice(0, 2);
}

function normalizeProjectNameInput(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function formatProjectDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}
