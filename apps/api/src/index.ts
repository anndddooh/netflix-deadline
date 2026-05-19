import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, notInArray } from 'drizzle-orm';
import type {
  SyncWatchlistRequest,
  SyncWatchlistResponse,
} from '@netflix-deadline/shared';
import { users, watchlistItems } from './db/schema';

type Bindings = { DB: D1Database };

const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', (c) => c.json({ ok: true, service: 'netflix-deadline-api' }));

/**
 * 拡張機能からのマイリスト同期。
 * 受け取った items を「そのサービスのマイリスト全体のスナップショット」とみなし、
 * upsert したうえで、payload に無い既存作品（＝マイリストから外された作品）を削除する。
 */
app.post('/api/watchlist/sync', async (c) => {
  // 1. 拡張機能トークンで認証
  const auth = c.req.header('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return c.json({ error: 'missing token' }, 401);

  const db = drizzle(c.env.DB);
  const user = await db
    .select()
    .from(users)
    .where(eq(users.extensionToken, token))
    .get();
  if (!user) return c.json({ error: 'invalid token' }, 401);

  // 2. ボディ検証
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

  // 3. 既存作品の externalId 集合（新規件数の判定用）
  const existing = await db
    .select({ externalId: watchlistItems.externalId })
    .from(watchlistItems)
    .where(
      and(eq(watchlistItems.userId, user.id), eq(watchlistItems.service, service))
    )
    .all();
  const existingIds = new Set(existing.map((r) => r.externalId));

  // 4. upsert
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

  // 5. マイリストから外された作品を削除
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

export default app;
