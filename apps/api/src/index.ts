import { Hono, type Context } from 'hono';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { and, count, eq, inArray } from 'drizzle-orm';
import type {
  GetWatchlistResponse,
  SyncWatchlistRequest,
  SyncWatchlistResponse,
  WatchlistEntry,
} from '@netflix-deadline/shared';
import { users, watchlistItems, type User } from './db/schema';
import { matchItem } from './matching';
import { refreshStalest } from './refresh';
import { buildDigestForUser, runWeeklyDigests } from './digest';
import { senderFromEnv } from './email';
import { randomString, readCookie, signSession, verifySession } from './auth';
import {
  exchangeCode,
  fetchUserInfo,
  googleAuthUrl,
  type GoogleUserInfo,
  type OAuthConfig,
} from './oauth';

type Bindings = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  // OAuth (Google)
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  OAUTH_REDIRECT_URI?: string;
  // セッション署名鍵
  SESSION_SECRET?: string;
  // ログイン後のリダイレクト先（Web アプリ）
  WEB_BASE?: string;
};
type Db = DrizzleD1Database;
type Ctx = Context<{ Bindings: Bindings }>;

const app = new Hono<{ Bindings: Bindings }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SESSION_COOKIE = 'nd_session';
const OAUTH_STATE_COOKIE = 'nd_oauth_state';
const SESSION_TTL_MS = 30 * 86_400_000; // 30 日

function bearer(header: string | undefined): string {
  const h = header ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

/**
 * リクエストを認証してユーザーを返す。
 * 優先順位: Authorization Bearer（拡張機能トークン）→ nd_session クッキー。
 */
async function authenticate(c: Ctx, db: Db): Promise<User | null> {
  // 1) 拡張機能のペアリングトークン
  const token = bearer(c.req.header('Authorization'));
  if (token) {
    const u = await db
      .select()
      .from(users)
      .where(eq(users.extensionToken, token))
      .get();
    if (u) return u;
  }
  // 2) Web のセッションクッキー
  const secret = c.env.SESSION_SECRET;
  if (secret) {
    const cookieVal = readCookie(c.req.header('Cookie'), SESSION_COOKIE);
    if (cookieVal) {
      const session = await verifySession(cookieVal, secret);
      if (session) {
        const u = await db
          .select()
          .from(users)
          .where(eq(users.id, session.userId))
          .get();
        if (u) return u;
      }
    }
  }
  return null;
}

/** Google のユーザー情報から、既存ユーザーを引くか新規作成する */
async function findOrCreateUser(
  db: Db,
  info: GoogleUserInfo
): Promise<User> {
  // 1) googleSub で一致
  let existing = await db
    .select()
    .from(users)
    .where(eq(users.googleSub, info.sub))
    .get();
  if (existing) return existing;

  // 2) email で一致（dev ユーザー等を Google アカウントに紐付けるパス）
  existing = await db.select().from(users).where(eq(users.email, info.email)).get();
  if (existing) {
    await db
      .update(users)
      .set({ googleSub: info.sub, name: info.name ?? existing.name })
      .where(eq(users.id, existing.id));
    return { ...existing, googleSub: info.sub, name: info.name ?? existing.name };
  }

  // 3) 新規作成
  const created: User = {
    id: crypto.randomUUID(),
    googleSub: info.sub,
    email: info.email,
    name: info.name ?? null,
    extensionToken: crypto.randomUUID(),
    notifyEmail: info.email,
    digestWeekday: 1,
    thresholdDays: 14,
    createdAt: Date.now(),
  };
  await db.insert(users).values(created);
  return created;
}

function oauthConfig(env: Bindings): OAuthConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.OAUTH_REDIRECT_URI) {
    return null;
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.OAUTH_REDIRECT_URI,
  };
}

app.get('/health', (c) => c.json({ ok: true, service: 'netflix-deadline-api' }));

// ====================== 認証 ======================

/** Google ログイン開始。state を cookie に保存して認可エンドポイントへリダイレクト。 */
app.get('/auth/google/start', (c) => {
  const cfg = oauthConfig(c.env);
  if (!cfg) return c.json({ error: 'OAuth が未設定' }, 500);
  const state = randomString(24);
  c.header(
    'Set-Cookie',
    `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`
  );
  return c.redirect(googleAuthUrl(cfg, state));
});

/** Google からのコールバック。code→token→userinfo→ユーザー解決→セッションクッキー発行。 */
app.get('/auth/google/callback', async (c) => {
  const cfg = oauthConfig(c.env);
  const secret = c.env.SESSION_SECRET;
  const webBase = c.env.WEB_BASE ?? '/';
  if (!cfg || !secret) return c.json({ error: 'OAuth/session が未設定' }, 500);

  const code = c.req.query('code');
  const state = c.req.query('state');
  const stateCookie = readCookie(c.req.header('Cookie'), OAUTH_STATE_COOKIE);
  if (!code || !state || !stateCookie || state !== stateCookie) {
    return c.json({ error: 'invalid state' }, 400);
  }

  let info: GoogleUserInfo;
  try {
    const tok = await exchangeCode(cfg, code);
    info = await fetchUserInfo(tok.access_token);
  } catch (e) {
    return c.json(
      { error: 'oauth_failed', detail: e instanceof Error ? e.message : String(e) },
      502
    );
  }
  if (!info.email) return c.json({ error: 'email scope not granted' }, 400);

  const db = drizzle(c.env.DB);
  const user = await findOrCreateUser(db, info);
  const token = await signSession(
    { userId: user.id, exp: Date.now() + SESSION_TTL_MS },
    secret
  );

  c.header(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
  c.header(
    'Set-Cookie',
    `${OAUTH_STATE_COOKIE}=; Path=/; Max-Age=0`,
    { append: true }
  );
  return c.redirect(webBase);
});

/** ログイン中のユーザー情報を返す（Web アプリの起動時チェックや設定画面で使用） */
app.get('/auth/me', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    extensionToken: user.extensionToken,
    notifyEmail: user.notifyEmail,
    digestWeekday: user.digestWeekday,
    thresholdDays: user.thresholdDays,
  });
});

/** ログアウト（セッションクッキーを失効させる） */
app.post('/auth/logout', (c) => {
  c.header(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
  return c.json({ ok: true });
});

// ====================== マイリスト ======================

/**
 * ユーザーのマイリストを返す。
 * 配信終了日の早い順、終了日が無いものは末尾（タイトル順）。
 */
app.get('/api/watchlist', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
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
  const user = await authenticate(c, db);
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

  // マイリストから外された作品を削除。
  // D1 は1ステートメントあたりバインド変数100個までなので NOT IN は使えない。
  // 差分を JS で計算し、80件ずつ IN で削除する。
  const incomingSet = new Set(items.map((i) => i.externalId));
  const toDelete = existing
    .map((r) => r.externalId)
    .filter((id) => !incomingSet.has(id));

  let removed = 0;
  const CHUNK = 80;
  for (let i = 0; i < toDelete.length; i += CHUNK) {
    const chunk = toDelete.slice(i, i + CHUNK);
    const rows = await db
      .delete(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, user.id),
          eq(watchlistItems.service, service),
          inArray(watchlistItems.externalId, chunk)
        )
      )
      .returning({ id: watchlistItems.id });
    removed += rows.length;
  }

  const res: SyncWatchlistResponse = {
    service,
    received: items.length,
    added,
    removed,
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
  const user = await authenticate(c, db);
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

/**
 * ダイジェスト本文を返す（送信しない）。動作確認用。
 */
app.get('/api/digest/preview', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const msg = await buildDigestForUser(db, user, new Date());
  if (!msg) return c.json({ message: '配信終了予定の作品が無いため空' });
  return c.json(msg);
});

/**
 * 即時にダイジェストを生成・送信する（曜日は無視）。動作確認用。
 */
app.post('/api/digest/run', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const msg = await buildDigestForUser(db, user, new Date());
  if (!msg) return c.json({ sent: false, reason: '配信終了予定の作品が無い' });
  const sender = senderFromEnv(c.env);
  try {
    await sender.send(msg);
    return c.json({ sent: true, to: msg.to, subject: msg.subject });
  } catch (e) {
    return c.json(
      { sent: false, error: e instanceof Error ? e.message : String(e) },
      500
    );
  }
});

/**
 * Cron Triggers から呼ばれる定期実行ハンドラ。
 * - "0 * * * *"     : 毎時0分 JustWatch リフレッシュ（25件ずつ）
 * - "0 23 * * *"    : 毎日 23:00 UTC = 08:00 JST 翌日、週次ダイジェスト判定・送信
 */
const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (
  event,
  env,
  ctx
) => {
  const db = drizzle(env.DB);
  if (event.cron === '0 * * * *') {
    ctx.waitUntil(
      refreshStalest(db, 25)
        .then((s) =>
          console.log(
            `[cron refresh] processed=${s.processed} matched=${s.matched} unmatched=${s.unmatched} errors=${s.errors}`
          )
        )
        .catch((e: unknown) => console.error('[cron refresh] failed:', e))
    );
  } else if (event.cron === '0 23 * * *') {
    const sender = senderFromEnv(env);
    ctx.waitUntil(
      runWeeklyDigests(db, sender, new Date())
        .then((s) =>
          console.log(
            `[cron digest] users=${s.usersChecked} sent=${s.sent} skipped=${s.skipped} errors=${s.errors}`
          )
        )
        .catch((e: unknown) => console.error('[cron digest] failed:', e))
    );
  }
};

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Bindings>;
