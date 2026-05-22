import type { GetWatchlistResponse } from '@netflix-deadline/shared';

export interface UserInfo {
  id: string;
  email: string;
  name: string | null;
  extensionToken: string;
  notifyEmail: string;
  digestWeekday: number;
  thresholdDays: number;
}

/** /auth/me を呼ぶ。未認証なら null。 */
export async function fetchMe(): Promise<UserInfo | null> {
  const res = await fetch('/auth/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/auth/me ${res.status}`);
  return res.json();
}

export async function fetchWatchlist(): Promise<GetWatchlistResponse> {
  const res = await fetch('/api/watchlist');
  if (!res.ok) throw new Error(`/api/watchlist ${res.status}`);
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST' });
}
