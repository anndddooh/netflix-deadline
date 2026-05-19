import { useEffect, useState } from 'react';
import type { WatchlistEntry } from '@netflix-deadline/shared';
import { fetchWatchlist } from './api';
import { WatchlistList } from './components/WatchlistList';
import { WatchlistCalendar } from './components/WatchlistCalendar';

type Tab = 'list' | 'calendar';

export function App() {
  const [items, setItems] = useState<WatchlistEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('list');

  useEffect(() => {
    fetchWatchlist()
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <main className="app">
      <header>
        <h1>netflix-deadline</h1>
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
