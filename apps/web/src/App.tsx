import { useEffect, useState } from 'react';
import type { WatchlistEntry } from '@netflix-deadline/shared';
import { fetchMe, fetchWatchlist, logout, type UserInfo } from './api';
import { WatchlistList } from './components/WatchlistList';
import { WatchlistCalendar } from './components/WatchlistCalendar';

type Tab = 'list' | 'calendar';
type AuthState =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'user'; user: UserInfo };

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

  // ログイン済みになったらマイリストを取りに行く
  useEffect(() => {
    if (auth.kind !== 'user') return;
    fetchWatchlist()
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(String(e)));
  }, [auth.kind]);

  if (auth.kind === 'loading') {
    return (
      <main className="app">
        <p className="muted">読み込み中…</p>
      </main>
    );
  }

  if (auth.kind === 'guest') {
    return (
      <main className="app">
        <header>
          <h1>netflix-deadline</h1>
        </header>
        <p>マイリスト作品の配信終了予定を一覧・カレンダー・週次メールでお知らせします。</p>
        <p>
          <a className="login-btn" href="/auth/google/start">
            Google でログイン
          </a>
        </p>
      </main>
    );
  }

  return (
    <main className="app">
      <header>
        <h1>netflix-deadline</h1>
        <div className="user-info">
          <span className="muted">{auth.user.email}</span>
          <button
            onClick={async () => {
              await logout();
              setAuth({ kind: 'guest' });
              setItems(null);
            }}
          >
            ログアウト
          </button>
        </div>
        <nav className="tabs">
          <button
            className={tab === 'list' ? 'active' : ''}
            onClick={() => setTab('list')}
          >
            一覧
          </button>
          <button
            className={tab === 'calendar' ? 'active' : ''}
            onClick={() => setTab('calendar')}
          >
            カレンダー
          </button>
        </nav>
      </header>

      {error && <p className="error">読み込みエラー: {error}</p>}
      {!items && !error && <p className="muted">読み込み中…</p>}
      {items &&
        (tab === 'list' ? (
          <WatchlistList items={items} />
        ) : (
          <WatchlistCalendar items={items} />
        ))}
    </main>
  );
}
