// 週次ダイジェストの組み立てと送信。
// 毎日1回 cron から呼び出され、その曜日が digestWeekday に合うユーザーにだけ送る。

import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';
import {
  users,
  watchlistItems,
  type User,
  type WatchlistItem,
} from './db/schema';
import type { EmailSender, EmailMessage } from './email';

const SERVICE_LABEL: Record<string, string> = {
  netflix: 'Netflix',
  prime: 'Prime',
};

/** N 日後の 'YYYY-MM-DD'（ローカルタイム基準） */
function isoDateOffset(now: Date, days: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysUntil(now: Date, ymd: string): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** ダイジェスト本文を組み立てる。送る作品が無ければ null */
export function buildDigest(
  user: User,
  items: WatchlistItem[],
  now: Date
): EmailMessage | null {
  if (items.length === 0) return null;

  const lines = items.map((i) => {
    const d = daysUntil(now, i.expiresAt!);
    const left =
      d < 0 ? '終了済み' : d === 0 ? '本日終了' : `あと ${d} 日`;
    const svc = SERVICE_LABEL[i.service] ?? i.service;
    return `- [${svc}] ${i.title} — ${left}（${i.expiresAt}）`;
  });

  const intro = `今後 ${user.thresholdDays} 日以内に配信終了予定の作品が ${items.length} 件あります。\n`;
  const text = `${intro}\n${lines.join('\n')}\n\nnetflix-deadline からの週次ダイジェスト`;

  const liItems = items.map((i) => {
    const d = daysUntil(now, i.expiresAt!);
    const left =
      d < 0 ? '終了済み' : d === 0 ? '本日終了' : `あと ${d} 日`;
    const svc = SERVICE_LABEL[i.service] ?? i.service;
    const color = i.service === 'netflix' ? '#e50914' : '#1f6feb';
    return `<li style="margin:6px 0;"><span style="background:${color};color:#fff;font-size:11px;padding:2px 6px;border-radius:3px;">${svc}</span> ${escapeHtml(i.title)} <strong>${left}</strong>（${i.expiresAt}）</li>`;
  });
  const html =
    `<p>${escapeHtml(intro)}</p>` +
    `<ul style="list-style:none;padding:0;">${liItems.join('')}</ul>` +
    `<p style="color:#888;font-size:12px;">netflix-deadline からの週次ダイジェスト</p>`;

  return {
    to: user.notifyEmail,
    subject: `[netflix-deadline] 配信終了が近い作品 ${items.length} 件`,
    text,
    html,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 1人ぶんのダイジェストを生成（送信はしない）。閾値日数以内の作品を含む。 */
export async function buildDigestForUser(
  db: DrizzleD1Database,
  user: User,
  now: Date
): Promise<EmailMessage | null> {
  const threshold = isoDateOffset(now, user.thresholdDays);
  const items = await db
    .select()
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, user.id),
        isNotNull(watchlistItems.expiresAt),
        lte(watchlistItems.expiresAt, threshold)
      )
    )
    .orderBy(asc(watchlistItems.expiresAt))
    .all();
  return buildDigest(user, items, now);
}

export interface DigestRunStats {
  usersChecked: number;
  sent: number;
  skipped: number;
  errors: number;
}

/**
 * 全ユーザーをチェックし、今日が digestWeekday に当たるユーザーにダイジェストを送る。
 * 毎日1回 cron から呼ばれる想定。
 */
export async function runWeeklyDigests(
  db: DrizzleD1Database,
  sender: EmailSender,
  now: Date
): Promise<DigestRunStats> {
  const weekday = now.getDay(); // 0=日 .. 6=土
  const allUsers = await db.select().from(users).all();

  const stats: DigestRunStats = {
    usersChecked: allUsers.length,
    sent: 0,
    skipped: 0,
    errors: 0,
  };

  for (const u of allUsers) {
    if (u.digestWeekday !== weekday) {
      stats.skipped++;
      continue;
    }
    try {
      const msg = await buildDigestForUser(db, u, now);
      if (!msg) {
        stats.skipped++;
        continue;
      }
      await sender.send(msg);
      stats.sent++;
    } catch {
      stats.errors++;
    }
  }
  return stats;
}
