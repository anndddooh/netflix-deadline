import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WatchlistEntry } from '@netflix-deadline/shared';
import { fetchMe, fetchWatchlist, logout, type UserInfo } from './api';
import { WatchlistList } from './components/WatchlistList';
import { WatchlistCalendar } from './components/WatchlistCalendar';
import { SettingsPanel } from './components/SettingsPanel';
import { MatchReview } from './components/MatchReview';
import { Logo } from './components/Logo';
import { TabIcon } from './components/NavIcons';

type Tab = 'list' | 'calendar' | 'review' | 'settings';

type AuthState =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'user'; user: UserInfo };

const TABS: { id: Tab; label: string }[] = [
  { id: 'list', label: '見納め間近' },
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

  const unmatchedCount = useMemo(
    () => (items ? items.filter((i) => i.matchStatus === 'unmatched').length : 0),
    [items]
  );

  if (auth.kind === 'loading') {
    return (
      <div className="landing">
        <div className="landing__glow" />
        <div className="loading">読み込み中…</div>
      </div>
    );
  }

  if (auth.kind === 'guest') {
    return <Landing />;
  }

  const user = auth.user;
  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase();

  const onLogout = async () => {
    await logout();
    setAuth({ kind: 'guest' });
    setItems(null);
  };

  return (
    <div className="shell">
      <header className="header">
        <div className="header__inner">
          <div className="brand">
            <Logo size={36} />
            <div>
              <div className="brand__wordmark">MIOSAME</div>
              <div className="brand__subtitle">見納め — 配信終了カレンダー</div>
            </div>
          </div>
          <div className="header__right">
            <nav className="topnav">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={`topnav__tab${tab === t.id ? ' is-active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  {t.id === 'review' && unmatchedCount > 0 && (
                    <span className="tab-badge">{unmatchedCount}</span>
                  )}
                </button>
              ))}
            </nav>
            <button
              className="avatar"
              onClick={onLogout}
              title={`ログアウト（${user.email}）`}
            >
              {initial}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="wrap" style={{ paddingBottom: 0 }}>
          <p className="msg-error">読み込みエラー: {error}</p>
        </div>
      )}

      {tab === 'list' &&
        (items ? (
          <WatchlistList items={items} />
        ) : (
          !error && <div className="loading">読み込み中…</div>
        ))}

      {tab === 'calendar' &&
        (items ? (
          <main className="wrap">
            <WatchlistCalendar items={items} />
          </main>
        ) : (
          !error && <div className="loading">読み込み中…</div>
        ))}

      {tab === 'review' &&
        (items ? (
          <main className="wrap wrap--narrow">
            <MatchReview items={items} onChanged={loadWatchlist} />
          </main>
        ) : (
          !error && <div className="loading">読み込み中…</div>
        ))}

      {tab === 'settings' && (
        <main className="wrap wrap--narrow">
          <SettingsPanel
            user={user}
            onUpdate={(u) => setAuth({ kind: 'user', user: u })}
          />
        </main>
      )}

      <nav className="bottombar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`bottombar__tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <TabIcon tab={t.id} className="bottombar__icon" />
            <span className="bottombar__label">
              {t.label}
              {t.id === 'review' && unmatchedCount > 0 && (
                <span className="bottombar__badge">{unmatchedCount}</span>
              )}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Landing() {
  return (
    <main className="landing">
      <div className="landing__glow" />
      <div className="landing__inner">
        <Logo size={88} hero />
        <div className="wordmark wordmark--hero">MIOSAME</div>
        <div className="subtitle subtitle--hero">見納め — 配信終了カレンダー</div>
        <p className="landing__lead">
          Netflix / Prime Video のマイリストから、
          <br />
          <strong>もうすぐ消える作品</strong>だけを教えてくれる。
          <br />
          一覧・カレンダー・週次ダイジェストで、見逃しをゼロに。
        </p>
        <a className="landing__cta btn-cream" href="/auth/google/start">
          Google でログイン
        </a>
        <div className="landing__features">
          <span>
            <i />
            一覧・カレンダー表示
          </span>
          <span>
            <i />
            週次メールダイジェスト
          </span>
          <span>
            <i />
            Chrome 拡張で自動同期
          </span>
        </div>
      </div>
    </main>
  );
}
