'use client';

import type { Session } from '@supabase/supabase-js';
import {
  ArrowRight,
  FolderKanban,
  LayoutGrid,
  Loader2,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowser } from '../lib/supabase-browser';
import type { StudioDashboardPayload, StudioWorkspaceSummary } from '../lib/types';

type AuthMode = 'login' | 'signup';

export function StudioDashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [dashboard, setDashboard] = useState<StudioDashboardPayload | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [appBusy, setAppBusy] = useState(false);
  const [deleteAppId, setDeleteAppId] = useState('');
  const [newAppName, setNewAppName] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [appQuery, setAppQuery] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const accessToken = session?.access_token || '';

  useEffect(() => {
    if (!supabase) {
      setSessionLoading(false);
      setError('Thiếu cấu hình Supabase trên trình duyệt.');
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
      setDashboard(null);
      setDashboardLoading(false);
      return;
    }

    let active = true;
    setDashboardLoading(true);
    setError('');

    fetch('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Không thể tải trang tổng quan.');
        if (active) setDashboard(payload as StudioDashboardPayload);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Không thể tải trang tổng quan.');
      })
      .finally(() => {
        if (active) setDashboardLoading(false);
      });

    return () => {
      active = false;
    };
  }, [accessToken]);

  const workspaceList = useMemo(() => {
    if (!dashboard) return [];
    return [...dashboard.workspaces].sort(compareWorkspacePriority);
  }, [dashboard]);

  const primaryWorkspace = useMemo(() => {
    if (!dashboard || !workspaceList.length) return null;
    const ownedWorkspaces = workspaceList.filter((workspace) => workspace.ownerUserId === dashboard.user.id);
    const candidates = ownedWorkspaces.length ? ownedWorkspaces : dashboard.workspaces;
    return [...candidates].sort(compareWorkspacePriority)[0] || null;
  }, [dashboard, workspaceList]);

  useEffect(() => {
    if (!workspaceList.length) {
      setSelectedWorkspaceId('');
      return;
    }
    if (workspaceList.some((workspace) => workspace.id === selectedWorkspaceId)) return;
    setSelectedWorkspaceId(primaryWorkspace?.id || workspaceList[0]?.id || '');
  }, [primaryWorkspace, selectedWorkspaceId, workspaceList]);

  const selectedWorkspace = useMemo(() => {
    if (!workspaceList.length) return null;
    return workspaceList.find((workspace) => workspace.id === selectedWorkspaceId) || primaryWorkspace || workspaceList[0] || null;
  }, [primaryWorkspace, selectedWorkspaceId, workspaceList]);

  const createWorkspaceTarget = selectedWorkspace || primaryWorkspace;

  const scopedApps = useMemo(() => {
    if (!dashboard) return [];
    const sourceWorkspaces = selectedWorkspace ? [selectedWorkspace] : workspaceList;
    return sourceWorkspaces
      .flatMap((workspace) => workspace.apps.map((app) => ({ app, workspace })))
      .sort((left, right) => compareAppPriority(left.app, right.app));
  }, [dashboard, selectedWorkspace, workspaceList]);

  const filteredApps = useMemo(() => {
    const query = appQuery.trim().toLowerCase();
    if (!query) return scopedApps;
    return scopedApps.filter(({ app, workspace }) =>
      `${app.name} ${app.slug} ${workspace.name}`.toLowerCase().includes(query),
    );
  }, [appQuery, scopedApps]);

  const selectedWorkspaceStats = useMemo(() => {
    if (!selectedWorkspace) return null;
    return {
      appCount: selectedWorkspace.appCount,
      projectCount: selectedWorkspace.projectCount,
      myProjectCount: selectedWorkspace.apps.reduce((total, app) => total + app.myProjectCount, 0),
      updatedTodayCount: selectedWorkspace.apps.reduce((total, app) => total + app.updatedTodayCount, 0),
      lastUpdatedAt: getWorkspaceLastUpdated(selectedWorkspace),
    };
  }, [selectedWorkspace]);

  const recentApps = useMemo(() => scopedApps.filter(({ app }) => Boolean(app.lastUpdatedAt || app.updatedAt)).slice(0, 4), [scopedApps]);

  const canWriteSelectedWorkspace = Boolean(
    dashboard && createWorkspaceTarget && canWriteWorkspace(dashboard.user.id, dashboard.user.role, createWorkspaceTarget),
  );

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
        if (!data.session) {
          setMessage('Đã tạo tài khoản. Nếu Supabase bật xác nhận email, hãy xác nhận email rồi đăng nhập.');
        } else {
          setMessage('Đăng ký thành công. Đang chuyển vào trang tổng quan.');
        }
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (loginError) throw loginError;
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Auth failed.');
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setDashboard(null);
    setMessage('');
    setError('');
  };

  const createApp = async () => {
    if (!accessToken) return;
    const workspaceId = createWorkspaceTarget?.id || '';
    if (!workspaceId) {
      setError('Không tìm thấy không gian hợp lệ để tạo ứng dụng.');
      return;
    }

    setAppBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/apps', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          workspaceId,
          name: newAppName,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Không thể tạo ứng dụng.');
      setDashboard(payload as StudioDashboardPayload);
      setNewAppName('');
      setMessage(`Đã tạo ứng dụng mới trong ${compactWorkspaceName(createWorkspaceTarget?.name || 'không gian đã chọn')}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tạo ứng dụng.');
    } finally {
      setAppBusy(false);
    }
  };

  const deleteApp = async (appId: string, appName: string, projectCount: number) => {
    if (!accessToken || !appId) return;
    const confirmed = window.confirm(
      projectCount
        ? `Xóa ứng dụng "${appName}" và ${projectCount} dự án bên trong?`
        : `Xóa ứng dụng "${appName}"?`,
    );
    if (!confirmed) return;

    setDeleteAppId(appId);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/apps/${appId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Không thể xóa ứng dụng.');
      setDashboard(payload as StudioDashboardPayload);
      setMessage(`Đã xóa ứng dụng ${appName}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể xóa ứng dụng.');
    } finally {
      setDeleteAppId('');
    }
  };

  if (sessionLoading) {
    return (
      <main className="dashboard-page-state">
        <Loader2 className="spin" size={18} />
        <span>Đang kiểm tra phiên đăng nhập...</span>
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
              <span>Đăng nhập để mở trang tổng quan ứng dụng theo từng tài khoản.</span>
            </div>
          </div>

          <div className="auth-mode-row">
            <button className={authMode === 'login' ? 'active' : ''} type="button" onClick={() => setAuthMode('login')}>
              Đăng nhập
            </button>
            <button className={authMode === 'signup' ? 'active' : ''} type="button" onClick={() => setAuthMode('signup')}>
              Tạo tài khoản
            </button>
          </div>

          <label className="field">
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" />
          </label>
          <label className="field">
            <span>Mật khẩu</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="........" />
          </label>

          {error ? <div className="field-status warn">{error}</div> : null}
          {message ? <div className="field-status ok">{message}</div> : null}

          <button className="primary-button wide" type="button" onClick={submitAuth} disabled={authBusy || !email.trim() || !password.trim()}>
            {authBusy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}
            {authMode === 'signup' ? 'Tạo tài khoản' : 'Vào trang tổng quan'}
          </button>
        </section>
      </main>
    );
  }

  if (dashboardLoading || !dashboard) {
    return (
      <main className="dashboard-page-state">
        <section className="dashboard-loading-card">
          <div className="dashboard-brand">
            <div className="brand-mark">
              <LayoutGrid size={20} />
            </div>
            <div>
              <strong>Playable Studio</strong>
              <span>Đang tải trang tổng quan và trình chỉnh sửa ứng dụng...</span>
            </div>
          </div>

          <div className="dashboard-state">
            <Loader2 className="spin" size={18} />
            <span>{error || 'Đang tải trang tổng quan...'}</span>
          </div>

          <button className="secondary-button" type="button" onClick={signOut}>
            <LogOut size={15} />
            Đăng xuất
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <div className="dashboard-frame">
        <aside className="dashboard-sidebar">
          <div className="dashboard-brand">
            <div className="brand-mark">
              <LayoutGrid size={20} />
            </div>
            <div>
              <strong>Playable Studio</strong>
              <span>Trang quản lý ứng dụng, quyền truy cập và tiến độ làm việc theo từng không gian.</span>
            </div>
          </div>

          <section className="dashboard-sidebar-section">
            <div className="dashboard-panel-head">
              <span>Tổng quan</span>
              <strong>{dashboard.stats.workspaceCount} không gian</strong>
            </div>

            <div className="dashboard-overview-grid">
              <article className="dashboard-mini-stat">
                <span>Ứng dụng</span>
                <strong>{dashboard.stats.appCount}</strong>
                <small>Tổng trình chỉnh sửa</small>
              </article>
              <article className="dashboard-mini-stat">
                <span>Dự án</span>
                <strong>{dashboard.stats.projectCount}</strong>
                <small>Toàn bộ</small>
              </article>
              <article className="dashboard-mini-stat">
                <span>Của tôi</span>
                <strong>{dashboard.stats.myProjectCount}</strong>
                <small>Dự án sở hữu</small>
              </article>
              <article className="dashboard-mini-stat">
                <span>Đang xem</span>
                <strong>{selectedWorkspaceStats?.appCount ?? 0}</strong>
                <small>Ứng dụng trong không gian</small>
              </article>
            </div>
          </section>

          <section className="dashboard-sidebar-section">
            <div className="dashboard-panel-head">
              <span>Không gian</span>
              <strong>{workspaceList?.length || 0}</strong>
            </div>

            <div className="dashboard-scope-list">
              {workspaceList.map((workspace) => {
                const active = workspace.id === selectedWorkspace?.id;
                const roleTone = getWorkspaceRoleTone(workspace, dashboard.user.id);
                const lastUpdatedAt = getWorkspaceLastUpdated(workspace);
                return (
                  <button
                    key={workspace.id}
                    className={`dashboard-scope-item ${active ? 'active' : ''}`}
                    type="button"
                    onClick={() => setSelectedWorkspaceId(workspace.id)}
                  >
                    <div className="dashboard-scope-top">
                      <strong>{compactWorkspaceName(workspace.name)}</strong>
                      <span className={`dashboard-role-badge ${roleTone}`}>{formatWorkspaceRole(roleTone)}</span>
                    </div>
                    <div className="dashboard-scope-meta">
                      <span>{workspace.appCount} ứng dụng</span>
                      <span>{workspace.projectCount} dự án</span>
                    </div>
                    <small className="dashboard-scope-note">
                      {lastUpdatedAt ? `Cập nhật ${formatDate(lastUpdatedAt)}` : 'Chưa có cập nhật'}
                    </small>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        <section className="dashboard-main">
          <header className="dashboard-main-head">
            <div>
              <span className="eyebrow">Dự án</span>
              <h1>Không gian dự án</h1>
              <p className="dashboard-subtitle">Chọn không gian ở thanh bên, lọc ứng dụng nhanh và mở trình chỉnh sửa riêng cho từng ứng dụng.</p>
            </div>
            <div className="dashboard-userbar">
              <span className={`dashboard-role-chip ${dashboard.user.role === 'manager' ? 'manager' : ''}`}>
                {dashboard.user.role === 'manager' ? <ShieldCheck size={14} /> : <UserRound size={14} />}
                {dashboard.user.displayName}
              </span>
              <button className="secondary-button" type="button" onClick={signOut}>
                <LogOut size={15} />
                Đăng xuất
              </button>
            </div>
          </header>

          {error ? <div className="dashboard-banner warn">{error}</div> : null}
          {message ? <div className="dashboard-banner ok">{message}</div> : null}

          <section className="dashboard-main-toolbar">
            <div className="dashboard-main-summary">
              <span className="eyebrow">Không gian đang xem</span>
              <strong>{selectedWorkspace ? compactWorkspaceName(selectedWorkspace.name) : 'Ứng dụng Studio'}</strong>
              <p>
                {selectedWorkspace
                  ? `${selectedWorkspace.appCount} ứng dụng / ${selectedWorkspace.projectCount} dự án trong không gian đang chọn.`
                  : 'Danh sách ứng dụng theo quyền truy cập hiện có của bạn.'}
              </p>
              <div className="dashboard-summary-chips">
                <span className="dashboard-chip">{selectedWorkspace ? formatWorkspaceRole(getWorkspaceRoleTone(selectedWorkspace, dashboard.user.id)) : 'Tổng quan'}</span>
                <span className="dashboard-chip soft">{selectedWorkspaceStats?.updatedTodayCount ?? 0} cập nhật hôm nay</span>
                <span className={`dashboard-chip ${canWriteSelectedWorkspace ? 'success' : 'warning'}`}>
                  {canWriteSelectedWorkspace ? 'Có thể tạo ứng dụng' : 'Chỉ đọc'}
                </span>
              </div>
            </div>

            <label className="dashboard-search">
              <Search size={16} />
              <input
                value={appQuery}
                onChange={(event) => setAppQuery(event.target.value)}
                placeholder="Tìm theo tên ứng dụng..."
              />
            </label>
          </section>

          <section className="dashboard-stats">
            <article className="dashboard-stat-card active">
              <span>Ứng dụng hiển thị</span>
              <strong>{filteredApps.length}</strong>
              <small>{appQuery.trim() ? `Lọc từ ${scopedApps.length} ứng dụng` : 'Sẵn sàng mở Studio'}</small>
            </article>
            <article className="dashboard-stat-card">
              <span>Dự án</span>
              <strong>{selectedWorkspaceStats?.projectCount ?? dashboard.stats.projectCount}</strong>
              <small>{selectedWorkspace ? 'Trong không gian đang chọn' : 'Tổng số dự án'}</small>
            </article>
            <article className="dashboard-stat-card">
              <span>Của tôi</span>
              <strong>{selectedWorkspaceStats?.myProjectCount ?? dashboard.stats.myProjectCount}</strong>
              <small>Dự án bạn sở hữu</small>
            </article>
            <article className="dashboard-stat-card success">
              <span>Hôm nay</span>
              <strong>{selectedWorkspaceStats?.updatedTodayCount ?? 0}</strong>
              <small>Ứng dụng có thay đổi trong ngày</small>
            </article>
          </section>

          <section className="workspace-dashboard-section">
            <header className="workspace-dashboard-head">
              <div>
                <span className="eyebrow">Ứng dụng</span>
                <h2>{selectedWorkspace ? `Ứng dụng trong ${compactWorkspaceName(selectedWorkspace.name)}` : 'Tất cả ứng dụng'}</h2>
                <p>
                  {filteredApps.length
                    ? `${filteredApps.length} ứng dụng đang hiển thị. Mở Studio để vào trình chỉnh sửa riêng của từng ứng dụng.`
                    : appQuery.trim()
                      ? 'Không có ứng dụng nào khớp với bộ lọc hiện tại.'
                      : 'Không gian này chưa có ứng dụng nào.'}
                </p>
              </div>
              <span className="workspace-dashboard-date">
                {selectedWorkspaceStats?.lastUpdatedAt ? `Cập nhật ${formatDate(selectedWorkspaceStats.lastUpdatedAt)}` : 'Chưa có cập nhật'}
              </span>
            </header>

            <div className="workspace-app-grid">
              {filteredApps.length ? (
                filteredApps.map(({ app, workspace }) => (
                  <article key={app.id} className="workspace-app-card" style={{ ['--app-accent' as string]: app.accentColor }}>
                    <div className="workspace-app-top">
                      <span className="workspace-app-icon">
                        <FolderKanban size={16} />
                      </span>
                      <div className="workspace-app-actions">
                        <Link href={`/apps/${app.id}`} className="workspace-app-open">
                          Mở Studio
                          <ArrowRight size={14} />
                        </Link>
                        {canDeleteDashboardApp(dashboard.user.id, dashboard.user.role, workspace) ? (
                          <button
                            className="ghost-button slim workspace-app-delete"
                            type="button"
                            onClick={() => void deleteApp(app.id, app.name, app.projectCount)}
                            disabled={deleteAppId === app.id}
                            title="Xóa ứng dụng"
                          >
                            {deleteAppId === app.id ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <Link href={`/apps/${app.id}`} className="workspace-app-bodylink">
                      <div className="workspace-app-heading">
                        <strong>{app.name}</strong>
                        <p>{buildAppContext(app.projectCount, workspace, workspaceList.length)}</p>
                      </div>

                      <div className="workspace-app-statgrid">
                        <span className="workspace-app-statpill">
                          <b>{app.projectCount}</b>
                          <small>Tổng</small>
                        </span>
                        <span className="workspace-app-statpill success">
                          <b>{app.myProjectCount}</b>
                          <small>Của tôi</small>
                        </span>
                        <span className="workspace-app-statpill danger">
                          <b>{app.updatedTodayCount}</b>
                          <small>Hôm nay</small>
                        </span>
                      </div>

                      <div className="workspace-app-progress">
                        <span>Hoạt động hôm nay</span>
                        <b>{formatActivityPercent(app.updatedTodayCount, app.projectCount)}%</b>
                      </div>
                      <div className="workspace-app-progressbar">
                        <span style={{ width: `${formatActivityPercent(app.updatedTodayCount, app.projectCount)}%`, background: app.accentColor }} />
                      </div>

                      <div className="workspace-app-footer">
                        <small>{app.lastUpdatedAt ? `Cập nhật ${formatDate(app.lastUpdatedAt)}` : 'Chưa có cập nhật'}</small>
                        <span className="workspace-app-launch">Mở Studio</span>
                      </div>
                    </Link>
                  </article>
                ))
              ) : (
                <div className="workspace-app-empty">
                  {appQuery.trim() ? 'Không tìm thấy ứng dụng phù hợp. Hãy bỏ bộ lọc hoặc đổi không gian.' : 'Chưa có ứng dụng nào trong không gian này.'}
                </div>
              )}
            </div>
          </section>
        </section>

        <aside className="dashboard-inspector">
          <section className="dashboard-inspector-card">
            <div className="dashboard-panel-head">
              <span>Tạo ứng dụng</span>
              <strong>{createWorkspaceTarget ? compactWorkspaceName(createWorkspaceTarget.name) : 'Chưa có không gian'}</strong>
            </div>
            <p className="dashboard-panel-copy">
              {createWorkspaceTarget
                ? `Ứng dụng mới sẽ được tạo trong không gian ${compactWorkspaceName(createWorkspaceTarget.name)}.`
                : 'Cần có một không gian hợp lệ mới có thể tạo ứng dụng mới.'}
            </p>

            <label className="field">
              <span>Tên ứng dụng</span>
              <input
                value={newAppName}
                onChange={(event) => setNewAppName(event.target.value)}
                placeholder={createWorkspaceTarget ? 'Ví dụ: Heart Rate iOS' : 'Chưa có không gian để tạo ứng dụng'}
                disabled={!createWorkspaceTarget || !canWriteSelectedWorkspace || appBusy}
              />
            </label>

            <button
              className="primary-button wide"
              type="button"
              onClick={createApp}
              disabled={appBusy || !newAppName.trim() || !createWorkspaceTarget || !canWriteSelectedWorkspace}
            >
              {appBusy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              Tạo ứng dụng mới
            </button>

            <p className={`field-help ${canWriteSelectedWorkspace ? '' : 'warn'}`}>
              {createWorkspaceTarget
                ? canWriteSelectedWorkspace
                  ? 'Bạn có quyền tạo ứng dụng trong không gian đang chọn.'
                  : 'Không gian này đang ở chế độ chỉ đọc với tài khoản hiện tại.'
                : 'Chưa tìm thấy không gian có quyền ghi.'}
            </p>
          </section>

          <section className="dashboard-inspector-card">
            <div className="dashboard-panel-head">
              <span>Chi tiết không gian</span>
              <strong>{selectedWorkspace ? formatWorkspaceRole(getWorkspaceRoleTone(selectedWorkspace, dashboard.user.id)) : 'Tổng quan'}</strong>
            </div>

            <dl className="dashboard-detail-list">
              <div>
                <dt>Không gian</dt>
                <dd>{selectedWorkspace ? compactWorkspaceName(selectedWorkspace.name) : 'Tất cả'}</dd>
              </div>
              <div>
                <dt>Ứng dụng</dt>
                <dd>{selectedWorkspaceStats?.appCount ?? dashboard.stats.appCount}</dd>
              </div>
              <div>
                <dt>Dự án</dt>
                <dd>{selectedWorkspaceStats?.projectCount ?? dashboard.stats.projectCount}</dd>
              </div>
              <div>
                <dt>Cập nhật</dt>
                <dd>{selectedWorkspaceStats?.lastUpdatedAt ? formatDate(selectedWorkspaceStats.lastUpdatedAt) : 'Chưa có'}</dd>
              </div>
            </dl>

            <div className="dashboard-status-list">
              <div className={`dashboard-status-item ${canWriteSelectedWorkspace ? 'ok' : 'warn'}`}>
                <span className="dashboard-status-dot" />
                <span>{canWriteSelectedWorkspace ? 'Có quyền tạo và chỉnh sửa ứng dụng trong không gian này.' : 'Không gian này không cho phép ghi với tài khoản hiện tại.'}</span>
              </div>
              <div className={`dashboard-status-item ${selectedWorkspace && canDeleteDashboardApp(dashboard.user.id, dashboard.user.role, selectedWorkspace) ? 'ok' : 'neutral'}`}>
                <span className="dashboard-status-dot" />
                <span>
                  {selectedWorkspace && canDeleteDashboardApp(dashboard.user.id, dashboard.user.role, selectedWorkspace)
                    ? 'Bạn có thể xóa ứng dụng trong không gian này nếu cần.'
                    : 'Chỉ xóa được ứng dụng do bạn tạo hoặc khi bạn có quyền quản lý.'}
                </span>
              </div>
            </div>
          </section>

          <section className="dashboard-inspector-card">
            <div className="dashboard-panel-head">
              <span>Gần đây</span>
              <strong>{recentApps.length} ứng dụng</strong>
            </div>

            <div className="dashboard-recent-list">
              {recentApps.length ? (
                recentApps.map(({ app, workspace }) => (
                  <Link key={app.id} href={`/apps/${app.id}`} className="dashboard-recent-item">
                    <div>
                      <strong>{app.name}</strong>
                      <small>{buildScopeHint(workspace, workspaceList.length)}</small>
                    </div>
                    <span>{app.lastUpdatedAt ? formatDate(app.lastUpdatedAt) : '--'}</span>
                  </Link>
                ))
              ) : (
                <div className="dashboard-empty-note">Chưa có ứng dụng nào được cập nhật gần đây.</div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function compactWorkspaceName(value: string) {
  const stripped = value.replace(/\s+workspace$/i, '').trim();
  return stripped || value;
}

function buildScopeHint(workspace: StudioWorkspaceSummary, workspaceCount: number) {
  if (workspaceCount <= 1) return 'Trình chỉnh sửa riêng cho từng dự án';
  return `Không gian ${compactWorkspaceName(workspace.name)}`;
}

function buildAppContext(projectCount: number, workspace: StudioWorkspaceSummary, workspaceCount: number) {
  return `${buildScopeHint(workspace, workspaceCount)} | ${projectCount} dự án`;
}

function canDeleteDashboardApp(userId: string, role: StudioDashboardPayload['user']['role'], workspace: StudioWorkspaceSummary) {
  return role === 'manager' || workspace.ownerUserId === userId || workspace.memberRole === 'manager';
}

function canWriteWorkspace(userId: string, role: StudioDashboardPayload['user']['role'], workspace: StudioWorkspaceSummary) {
  return role === 'manager' || workspace.ownerUserId === userId || workspace.memberRole !== 'viewer';
}

function getWorkspaceRoleTone(workspace: StudioWorkspaceSummary, userId: string) {
  if (workspace.ownerUserId === userId) return 'owner';
  return workspace.memberRole;
}

function formatWorkspaceRole(role: ReturnType<typeof getWorkspaceRoleTone>) {
  if (role === 'owner') return 'Chủ sở hữu';
  if (role === 'manager') return 'Quản lý';
  if (role === 'viewer') return 'Chỉ xem';
  return 'Biên tập viên';
}

function formatActivityPercent(updatedTodayCount: number, projectCount: number) {
  if (!projectCount) return 0;
  return Math.max(0, Math.min(100, Math.round((updatedTodayCount / projectCount) * 100)));
}

function compareWorkspacePriority(left: StudioWorkspaceSummary, right: StudioWorkspaceSummary) {
  if (left.appCount !== right.appCount) return right.appCount - left.appCount;
  if (left.projectCount !== right.projectCount) return right.projectCount - left.projectCount;
  return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
}

function compareAppPriority(left: StudioWorkspaceSummary['apps'][number], right: StudioWorkspaceSummary['apps'][number]) {
  const dateCompare = String(right.lastUpdatedAt || right.updatedAt || '').localeCompare(String(left.lastUpdatedAt || left.updatedAt || ''));
  if (dateCompare !== 0) return dateCompare;
  if (left.projectCount !== right.projectCount) return right.projectCount - left.projectCount;
  return left.name.localeCompare(right.name);
}

function getWorkspaceLastUpdated(workspace: StudioWorkspaceSummary) {
  const appDates = workspace.apps
    .map((app) => app.lastUpdatedAt || app.updatedAt || '')
    .filter(Boolean)
    .sort((left, right) => String(right).localeCompare(String(left)));
  return workspace.lastUpdatedAt || appDates[0] || '';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}
