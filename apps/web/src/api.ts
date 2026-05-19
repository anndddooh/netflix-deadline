import type { GetWatchlistResponse } from '@netflix-deadline/shared';

// 開発用トークン。本番では Google ログインのセッションに置き換える。
const DEV_TOKEN = 'dev-token-abc123';

export async function fetchWatchlist(): Promise<GetWatchlistResponse> {
  const res = await fetch('/api/watchlist', {
    headers: { Authorization: `Bearer ${DEV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
