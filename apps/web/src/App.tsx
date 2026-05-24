import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WatchlistEntry } from '@netflix-deadline/shared';
import { fetchMe, fetchWatchlist, logout, type UserInfo } from './api';
import { WatchlistList } from './components/WatchlistList';
import { WatchlistCalendar } from './components/WatchlistCalendar';
import { SettingsPanel } from './components/SettingsPanel';
import { MatchReview } from './components/MatchReview';
import { daysUntil } from './lib/date';
import { MYLIST_URLS } from './lib/services';

type Tab = 'list' | 'calendar' | 'review' | 'settings';
type AuthState =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'user'; user: UserInfo };

const TABS: { id: Tab; label: string }[] = [
  { id: 'list', label: '一覧' },
  { id: 'calendar', label: 'カレンダー' },
  { id: 'review', label: 'マッチ確認' },
  { id: 'settings', label: '設定' },
];

export function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });
  const [items, setItems] = useState<WatchlistEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('list');

  // 起動時に認証状態を確認
  useEffect(() => {
    fetchMe()
      .then((u) => setAuth(u ? { kind: 'user', user: u } : { kind: 'guest' }))
      .catch(() => setAuth({ kind: 'guest' }));
  }, []);

  const loadWatchlist = useCallback(async () => {
    try {
      const r = await fetchWatchlist();
      setItems(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // ログイン済みになったらマイリストを取りに行く
  useEffect(() => {
    if (auth.kind !== 'user') return;
    void loadWatchlist();
  }, [auth.kind, loadWatchlist]);

  const summary = useMemo(() => {
    if (!items) return null;
    const withExpiry = items.filter((i) => i.expiresAt);
    const urgent = withExpiry.filter((i) => daysUntil(i.expiresAt!) <= 7).length;
    const soon = withExpiry.filter((i) => {
      const d = daysUntil(i.expiresAt!);
      return d > 7 && d <= 14;
    }).length;
    const unmatched = items.filter((i) => i.matchStatus === 'unmatched').length;
    return { total: items.length, withExpiry: withExpiry.length, urgent, soon, unmatched };
  }, [items]);

  if (auth.kind === 'loading') {
    return (
      <main className="app">
        <div className="loading">読み込み中…</div>
      </main>
    );
  }

  if (auth.kind === 'guest') {
    return (
      <main className="app landing">
        <div className="landing-card">
          <div className="brand">
            <span className="brand-dot brand-dot-1" />
            <span className="brand-dot brand-dot-2" />
            <h1 className="brand-title">netflix-deadline</h1>
          </div>
          <p className="lead">
            Netflix / Prime Video のマイリスト作品のうち、
            <br />
            <strong>配信終了が近いもの</strong>を見逃さないためのツール。
          </p>
          <ul className="features">
            <li>一覧・カレンダーで終了予定を可視化</li>
            <li>週1回のメールダイジェスト</li>
            <li>Chrome 拡張でマイリストを自動取り込み</li>
          </ul>
          <a className="btn-primary btn-lg" href="/auth/google/start">
            Google でログイン
          </a>
        </div>
      </main>
    );
  }

  const user = auth.user;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand brand-sm">
            <span className="brand-dot brand-dot-1" />
            <span className="brand-dot brand-dot-2" />
            <h1 className="brand-title">netflix-deadline</h1>
          </div>
          <div className="user-info">
            <span className="user-email">{user.email}</span>
            <button
              className="btn-ghost"
              onClick={async () => {
                await logout();
                setAuth({ kind: 'guest' });
                setItems(null);
              }}
            >
              ログアウト
            </button>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          <div className="tabs-inner">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === 'review' && summary && summary.unmatched > 0 && (
                  <span className="tab-badge">{summary.unmatched}</span>
                )}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main className="app">
        {(tab === 'list' || tab === 'calendar') && (
          <div className="mylist-bar">
            <span className="mylist-bar-label">マイリストを編集</span>
            <a
              className="mylist-link netflix"
              href={MYLIST_URLS.netflix}
              target="_blank"
              rel="noreferrer"
            >
              <span className="badge netflix">Netflix</span>
              <span>マイリストを開く</span>
              <span className="ext-arrow">↗</span>
            </a>
            <a
              className="mylist-link prime"
              href={MYLIST_URLS.prime}
              target="_blank"
              rel="noreferrer"
            >
              <span className="badge prime">Prime</span>
              <span>ウォッチリストを開く</span>
              <span className="ext-arrow">↗</span>
            </a>
            <span className="mylist-bar-hint muted">
              編集後、拡張機能の「同期」を押すと反映されます
            </span>
          </div>
        )}

        {summary && (tab === 'list' || tab === 'calendar') && (
          <div className="summary">
            <StatCard label="登録作品" value={summary.total} />
            <StatCard label="終了予定あり" value={summary.withExpiry} />
            <StatCard label="残り7日以内" value={summary.urgent} accent="urgent" />
            <StatCard label="残り8〜14日" value={summary.soon} accent="soon" />
          </div>
        )}

        {error && <p className="msg-error">読み込みエラー: {error}</p>}
        {!items && !error && <div className="loading">読み込み中…</div>}

        {items && tab === 'list' && <WatchlistList items={items} />}
        {items && tab === 'calendar' && <WatchlistCalendar items={items} />}
        {items && tab === 'review' && (
          <MatchReview items={items} onChanged={loadWatchlist} />
        )}
        {tab === 'settings' && (
          <SettingsPanel
            user={user}
            onUpdate={(u) => setAuth({ kind: 'user', user: u })}
          />
        )}
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'urgent' | 'soon';
}) {
  return (
    <div className={`stat${accent ? ' stat-' + accent : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
