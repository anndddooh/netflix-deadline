import { Hono } from 'hono';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { and, count, eq, notInArray } from 'drizzle-orm';
import type {
  GetWatchlistResponse,
  SyncWatchlistRequest,
  SyncWatchlistResponse,
  WatchlistEntry,
} from '@netflix-deadline/shared';
import { users, watchlistItems, type User } from './db/schema';
import { matchItem } from './matching';

type Bindings = { DB: D1Database };
type Db = DrizzleD1Database;

const app = new Hono<{ Bindings: Bindings }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Authorization: Bearer <extensionToken> からユーザーを解決する */
async function authByToken(token: string, db: Db): Promise<User | null> {
  if (!token) return null;
  const user = await db
    .select()
    .from(users)
    .where(eq(users.extensionToken, token))
    .get();
  return user ?? null;
}

function bearer(header: string | undefined): string {
  const h = header ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

app.get('/health', (c) => c.json({ ok: true, service: 'netflix-deadline-api' }));

/**
 * ユーザーのマイリストを返す。
 * 配信終了日の早い順、終了日が無いものは末尾（タイトル順）。
 */
app.get('/api/watchlist', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authByToken(bearer(c.req.header('Authorization')), db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const rows = await db
    .select()
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, user.id))
    .all();

  rows.sort((a, b) => {
    if (a.expiresAt && b.expiresAt) return a.expiresAt.localeCompare(b.expiresAt);
    if (a.expiresAt) return -1;
    if (b.expiresAt) return 1;
    return a.title.localeCompare(b.title, 'ja');
  });

  const items: WatchlistEntry[] = rows.map((r) => ({
    id: r.id,
    service: r.service,
    externalId: r.externalId,
    title: r.title,
    entityType: r.entityType,
    jwTitle: r.jwTitle,
    expiresAt: r.expiresAt,
    matchStatus: r.matchStatus,
  }));

  return c.json({ items } satisfies GetWatchlistResponse);
});

/**
 * 拡張機能からのマイリスト同期。
 * 受け取った items を「そのサービスのマイリスト全体のスナップショット」とみなし、
 * upsert したうえで、payload に無い既存作品（＝マイリストから外された作品）を削除する。
 */
app.post('/api/watchlist/sync', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authByToken(bearer(c.req.header('Authorization')), db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<SyncWatchlistRequest>().catch(() => null);
  if (
    !body ||
    (body.service !== 'netflix' && body.service !== 'prime') ||
    !Array.isArray(body.items)
  ) {
    return c.json({ error: 'invalid body' }, 400);
  }
  const { service, items } = body;
  const now = Date.now();

  // 既存作品の externalId 集合（新規件数の判定用）
  const existing = await db
    .select({ externalId: watchlistItems.externalId })
    .from(watchlistItems)
    .where(
      and(eq(watchlistItems.userId, user.id), eq(watchlistItems.service, service))
    )
    .all();
  const existingIds = new Set(existing.map((r) => r.externalId));

  // upsert
  let added = 0;
  for (const item of items) {
    if (!existingIds.has(item.externalId)) added++;
    await db
      .insert(watchlistItems)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        service,
        externalId: item.externalId,
        title: item.title,
        entityType: item.entityType ?? null,
        addedAt: now,
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          watchlistItems.userId,
          watchlistItems.service,
          watchlistItems.externalId,
        ],
        set: {
          title: item.title,
          entityType: item.entityType ?? null,
          lastSyncedAt: now,
        },
      });
  }

  // マイリストから外された作品を削除
  const incomingIds = items.map((i) => i.externalId);
  const base = and(
    eq(watchlistItems.userId, user.id),
    eq(watchlistItems.service, service)
  );
  const removedRows = await db
    .delete(watchlistItems)
    .where(
      incomingIds.length > 0
        ? and(base, notInArray(watchlistItems.externalId, incomingIds))
        : base
    )
    .returning({ id: watchlistItems.id });

  const res: SyncWatchlistResponse = {
    service,
    received: items.length,
    added,
    removed: removedRows.length,
  };
  return c.json(res);
});

/**
 * 未突き合わせ（matchStatus='pending'）の作品を JustWatch に問い合わせ、
 * 配信終了日などを埋める。1リクエストあたり limit 件まで処理する
 * （Worker のサブリクエスト上限を考慮）。残りは再呼び出し or cron で消化する。
 */
app.post('/api/watchlist/match', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authByToken(bearer(c.req.header('Authorization')), db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const limitParam = Number(c.req.query('limit'));
  const limit = Math.min(
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 25,
    40
  );

  const pending = await db
    .select()
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, user.id),
        eq(watchlistItems.matchStatus, 'pending')
      )
    )
    .limit(limit)
    .all();

  let matched = 0;
  let unmatched = 0;
  let errors = 0;
  const now = Date.now();

  for (const item of pending) {
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
      if (r.matchStatus === 'matched') matched++;
      else unmatched++;
    } catch {
      errors++;
    }
    await sleep(150); // JustWatch への配慮
  }

  const [rest] = await db
    .select({ n: count() })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, user.id),
        eq(watchlistItems.matchStatus, 'pending')
      )
    );

  return c.json({
    processed: pending.length,
    matched,
    unmatched,
    errors,
    remaining: rest?.n ?? 0,
  });
});

export default app;
