import type {
  CandidatesResponse,
  ConfirmMatchRequest,
  GetWatchlistResponse,
  UpdateSettingsRequest,
} from '@netflix-deadline/shared';

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

/** 通知設定の更新。返り値は最新ユーザー情報。 */
export async function updateSettings(patch: UpdateSettingsRequest): Promise<UserInfo> {
  const res = await fetch('/auth/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`設定の更新に失敗（${res.status}）: ${text.slice(0, 120)}`);
  }
  return res.json();
}

/** 指定作品の JustWatch 候補を取得する。query で再検索可能。 */
export async function fetchCandidates(itemId: string, query?: string): Promise<CandidatesResponse> {
  const url = `/api/watchlist/items/${encodeURIComponent(itemId)}/candidates` +
    (query && query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`候補取得に失敗（${res.status}）`);
  return res.json();
}

/** 手動マッチを確定する。 */
export async function confirmMatch(itemId: string, jwObjectId: string): Promise<void> {
  const body: ConfirmMatchRequest = { jwObjectId };
  const res = await fetch(`/api/watchlist/items/${encodeURIComponent(itemId)}/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`マッチ確定に失敗（${res.status}）`);
}

/** 「該当作品なし」として確定する。 */
export async function markUnmatched(itemId: string): Promise<void> {
  const res = await fetch(`/api/watchlist/items/${encodeURIComponent(itemId)}/unmatch`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`未マッチ設定に失敗（${res.status}）`);
}

/** 未突き合わせ作品の再マッチを走らせる（既存 cron と同じロジックを on-demand 起動）。 */
export async function runMatch(): Promise<{ processed: number; matched: number; unmatched: number; errors: number; remaining: number }> {
  const res = await fetch('/api/watchlist/match', { method: 'POST' });
  if (!res.ok) throw new Error(`再マッチに失敗（${res.status}）`);
  return res.json();
}
