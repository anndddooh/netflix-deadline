import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { asc, eq } from 'drizzle-orm';
import { watchlistItems } from './db/schema';
import { matchItem } from './matching';

export interface RefreshStats {
  processed: number;
  matched: number;
  unmatched: number;
  errors: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 配信終了日のチェックが最も古い（または未チェックの）作品を limit 件取って
 * JustWatch に再問い合わせし、expiresAt 等を更新する。
 *
 * - SQLite の ORDER BY ASC は NULL を先頭に置く規則（未チェック=NULL が最優先）。
 * - 既にマッチ済みでも再チェックする。JustWatch 側で後から登録される
 *   配信終了日を取りこぼさないため。
 * - 各作品で JustWatch に1リクエスト発生。Workers 無料枠の
 *   サブリクエスト上限 (50/req) に収まるよう limit は 40 以下推奨。
 */
export async function refreshStalest(
  db: DrizzleD1Database,
  limit: number
): Promise<RefreshStats> {
  const items = await db
    .select()
    .from(watchlistItems)
    .orderBy(asc(watchlistItems.expiryCheckedAt))
    .limit(limit)
    .all();

  const stats: RefreshStats = {
    processed: 0,
    matched: 0,
    unmatched: 0,
    errors: 0,
  };
  const now = Date.now();

  for (const item of items) {
    stats.processed++;
    try {
      const r = await matchItem({ service: item.service, title: item.title });
      await db
        .update(watchlistItems)
        .set({
          jwObjectId: r.jwObjectId,
          jwTitle: r.jwTitle,
          jwPath: r.jwPath,
          expiresAt: r.expiresAt,
          matchStatus: r.matchStatus,
          expiryCheckedAt: now,
        })
        .where(eq(watchlistItems.id, item.id));
      if (r.matchStatus === 'matched') stats.matched++;
      else stats.unmatched++;
    } catch {
      stats.errors++;
    }
    await sleep(150);
  }

  return stats;
}
