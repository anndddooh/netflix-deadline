import { Hono, type Context } from 'hono';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { and, count, eq, inArray } from 'drizzle-orm';
import type {
  CandidatesResponse,
  ConfirmMatchRequest,
  GetWatchlistResponse,
  MatchCandidate,
  SyncWatchlistRequest,
  SyncWatchlistResponse,
  UpdateSettingsRequest,
  UserInfoResponse,
  WatchlistEntry,
} from '@netflix-deadline/shared';
import { users, watchlistItems, type User } from './db/schema';
import {
  buildSearchQuery,
  extractExpiry,
  matchItem,
  nodeToResult,
} from './matching';
import { searchTitles } from './justwatch';
import { refreshStalest } from './refresh';
import { buildDigestForUser, runWeeklyDigests } from './digest';
import { senderFromEnv } from './email';
import { dispatchDigest } from './notifier';
import {
  generateLinkCode as generateLineLinkCode,
  handleWebhook as handleLineWebhook,
  lineConfigFromEnv,
  LINK_CODE_TTL_MS as LINE_LINK_TTL_MS,
  verifySignature as verifyLineSignature,
} from './line';
import {
  alexaConfigFromEnv,
  generateLinkCode as generateAlexaLinkCode,
  linkAlexaUser,
  LINK_CODE_TTL_MS as ALEXA_LINK_TTL_MS,
} from './alexa';
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
  // LINE Messaging API
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
  // Alexa
  ALEXA_CLIENT_ID?: string;
  ALEXA_CLIENT_SECRET?: string;
  ALEXA_API_BASE?: string;
  /** Alexa スキル → /api/alexa/link の認証共有鍵 */
  ALEXA_LINK_SECRET?: string;
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

function toUserInfo(u: User): UserInfoResponse {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    extensionToken: u.extensionToken,
    notifyEmail: u.notifyEmail,
    digestWeekday: u.digestWeekday,
    thresholdDays: u.thresholdDays,
    notifyEmailEnabled: u.notifyEmailEnabled,
    notifyLineEnabled: u.notifyLineEnabled,
    notifyAlexaEnabled: u.notifyAlexaEnabled,
    lineLinked: !!u.lineUserId,
    alexaLinked: !!u.alexaUserId,
  };
}

/**
 * Google のユーザー情報から、既存ユーザーを引くか新規作成する。
 * googleSub のみで照合する（email は一致しても他人の可能性があるため使わない）。
 */
async function findOrCreateUser(
  db: Db,
  info: GoogleUserInfo
): Promise<User> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.googleSub, info.sub))
    .get();
  if (existing) return existing;

  const created: User = {
    id: crypto.randomUUID(),
    googleSub: info.sub,
    email: info.email,
    name: info.name ?? null,
    extensionToken: crypto.randomUUID(),
    notifyEmail: info.email,
    digestWeekday: 1,
    thresholdDays: 14,
    notifyEmailEnabled: true,
    notifyLineEnabled: false,
    notifyAlexaEnabled: false,
    lineUserId: null,
    lineLinkCode: null,
    lineLinkExpiresAt: null,
    alexaUserId: null,
    alexaLinkCode: null,
    alexaLinkExpiresAt: null,
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
  return c.json(toUserInfo(user));
});

/**
 * 通知設定の更新。送信曜日（0..6）・閾値日数（1..365）・通知先メール・
 * 各チャンネルの ON/OFF を差分更新する。
 */
app.patch('/auth/me', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<UpdateSettingsRequest>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'invalid body' }, 400);
  }

  const patch: Partial<
    Pick<
      User,
      | 'notifyEmail'
      | 'digestWeekday'
      | 'thresholdDays'
      | 'notifyEmailEnabled'
      | 'notifyLineEnabled'
      | 'notifyAlexaEnabled'
    >
  > = {};

  if (body.notifyEmail !== undefined) {
    if (typeof body.notifyEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.notifyEmail)) {
      return c.json({ error: 'invalid notifyEmail' }, 400);
    }
    patch.notifyEmail = body.notifyEmail;
  }
  if (body.digestWeekday !== undefined) {
    if (!Number.isInteger(body.digestWeekday) || body.digestWeekday < 0 || body.digestWeekday > 6) {
      return c.json({ error: 'digestWeekday must be 0..6' }, 400);
    }
    patch.digestWeekday = body.digestWeekday;
  }
  if (body.thresholdDays !== undefined) {
    if (!Number.isInteger(body.thresholdDays) || body.thresholdDays < 1 || body.thresholdDays > 365) {
      return c.json({ error: 'thresholdDays must be 1..365' }, 400);
    }
    patch.thresholdDays = body.thresholdDays;
  }
  if (body.notifyEmailEnabled !== undefined) {
    if (typeof body.notifyEmailEnabled !== 'boolean') {
      return c.json({ error: 'notifyEmailEnabled must be boolean' }, 400);
    }
    patch.notifyEmailEnabled = body.notifyEmailEnabled;
  }
  if (body.notifyLineEnabled !== undefined) {
    if (typeof body.notifyLineEnabled !== 'boolean') {
      return c.json({ error: 'notifyLineEnabled must be boolean' }, 400);
    }
    // LINE 未連携で ON にしようとしたら拒否（紛らわしいので）
    if (body.notifyLineEnabled && !user.lineUserId) {
      return c.json({ error: 'LINE が未連携です' }, 400);
    }
    patch.notifyLineEnabled = body.notifyLineEnabled;
  }
  if (body.notifyAlexaEnabled !== undefined) {
    if (typeof body.notifyAlexaEnabled !== 'boolean') {
      return c.json({ error: 'notifyAlexaEnabled must be boolean' }, 400);
    }
    if (body.notifyAlexaEnabled && !user.alexaUserId) {
      return c.json({ error: 'Alexa が未連携です' }, 400);
    }
    patch.notifyAlexaEnabled = body.notifyAlexaEnabled;
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'no fields to update' }, 400);
  }

  await db.update(users).set(patch).where(eq(users.id, user.id));
  return c.json(toUserInfo({ ...user, ...patch }));
});

/** ログアウト（セッションクッキーを失効させる） */
app.post('/auth/logout', (c) => {
  c.header(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
  return c.json({ ok: true });
});

// ====================== LINE 連携 ======================

/**
 * LINE 連携コード（6 桁）を発行する。10 分有効。
 * ユーザーは bot にこのコードを送ることで紐付けを完了する。
 */
app.post('/api/line/link-code', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (!lineConfigFromEnv(c.env)) {
    return c.json({ error: 'LINE が未設定（管理者が LINE_CHANNEL_* を設定してください）' }, 503);
  }

  const code = generateLineLinkCode();
  const expiresAt = Date.now() + LINE_LINK_TTL_MS;
  await db
    .update(users)
    .set({ lineLinkCode: code, lineLinkExpiresAt: expiresAt })
    .where(eq(users.id, user.id));
  return c.json({ code, expiresAt });
});

/** LINE 連携を解除する */
app.post('/api/line/unlink', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  await db
    .update(users)
    .set({
      lineUserId: null,
      lineLinkCode: null,
      lineLinkExpiresAt: null,
      notifyLineEnabled: false,
    })
    .where(eq(users.id, user.id));
  return c.json({ ok: true });
});

/**
 * LINE Messaging API の webhook。署名検証 → 6 桁コードで紐付け処理。
 * LINE 仕様: どんな場合でも 200 を返すこと（再送ループを避ける）。
 */
app.post('/api/line/webhook', async (c) => {
  const cfg = lineConfigFromEnv(c.env);
  if (!cfg) {
    // 未設定でも 200 を返しておく（運用前の検証コール想定）
    return c.body(null, 200);
  }
  const raw = await c.req.text();
  const signature = c.req.header('x-line-signature');
  const ok = await verifyLineSignature(cfg.channelSecret, raw, signature);
  if (!ok) {
    // 署名不一致は明示的に 401 を返す（LINE は再送しない）
    return c.json({ error: 'invalid signature' }, 401);
  }
  const body = JSON.parse(raw);
  const db = drizzle(c.env.DB);
  // 例外を呑んでも 200 を返す
  c.executionCtx.waitUntil(handleLineWebhook(cfg, db, body).catch((e) => {
    console.error('[line webhook] failed:', e);
  }));
  return c.body(null, 200);
});

// ====================== Alexa 連携 ======================

/**
 * Alexa 連携コード（6 桁）を発行する。10 分有効。
 * ユーザーは Alexa スキルでこのコードを発話し、スキル側が /api/alexa/link を叩く。
 */
app.post('/api/alexa/link-code', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (!alexaConfigFromEnv(c.env)) {
    return c.json({ error: 'Alexa が未設定（管理者が ALEXA_CLIENT_* を設定してください）' }, 503);
  }

  const code = generateAlexaLinkCode();
  const expiresAt = Date.now() + ALEXA_LINK_TTL_MS;
  await db
    .update(users)
    .set({ alexaLinkCode: code, alexaLinkExpiresAt: expiresAt })
    .where(eq(users.id, user.id));
  return c.json({ code, expiresAt });
});

/** Alexa 連携解除 */
app.post('/api/alexa/unlink', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  await db
    .update(users)
    .set({
      alexaUserId: null,
      alexaLinkCode: null,
      alexaLinkExpiresAt: null,
      notifyAlexaEnabled: false,
    })
    .where(eq(users.id, user.id));
  return c.json({ ok: true });
});

/**
 * Alexa スキル → API への紐付け要求受け口。
 * Authorization: Bearer <ALEXA_LINK_SECRET> で認証する（共有鍵方式）。
 * Body: { code: "123456", alexaUserId: "amzn1.ask.account.XXX" }
 */
app.post('/api/alexa/link', async (c) => {
  const secret = c.env.ALEXA_LINK_SECRET;
  if (!secret) return c.json({ error: 'not configured' }, 503);
  if (bearer(c.req.header('Authorization')) !== secret) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const body = await c.req.json<{ code?: string; alexaUserId?: string }>().catch(() => null);
  if (!body || !body.code || !body.alexaUserId) {
    return c.json({ error: 'code and alexaUserId required' }, 400);
  }
  const db = drizzle(c.env.DB);
  const r = await linkAlexaUser(db, body.code, body.alexaUserId);
  if (!r.ok) return c.json({ ok: false, reason: r.reason }, 400);
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
 * マッチ確認UI: 指定作品の JustWatch 候補を返す。
 * ?q= でクエリを上書き可（ユーザーが手入力で再検索したい場合）。
 */
app.get('/api/watchlist/items/:id/candidates', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  const item = await db
    .select()
    .from(watchlistItems)
    .where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, user.id)))
    .get();
  if (!item) return c.json({ error: 'not found' }, 404);

  const overrideQuery = c.req.query('q');
  const query = overrideQuery && overrideQuery.trim()
    ? overrideQuery.trim()
    : buildSearchQuery(item.service, item.title);

  const nodes = await searchTitles(query);
  const candidates: MatchCandidate[] = nodes.map((n) => ({
    jwObjectId: n.id,
    title: n.content?.title ?? '(タイトル不明)',
    originalReleaseYear: n.content?.originalReleaseYear ?? null,
    jwPath: n.content?.fullPath ?? null,
    expiresAt: extractExpiry(n, item.service),
  }));

  const res: CandidatesResponse = { itemId: item.id, query, candidates };
  return c.json(res);
});

/**
 * マッチ確認UI: 候補から1件選んで手動マッチを確定する。
 * 選んだ JustWatch ノードの情報で expires_at 等を上書きし、matchStatus='confirmed' にする。
 */
app.post('/api/watchlist/items/:id/match', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  const item = await db
    .select()
    .from(watchlistItems)
    .where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, user.id)))
    .get();
  if (!item) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json<ConfirmMatchRequest>().catch(() => null);
  if (!body || typeof body.jwObjectId !== 'string' || !body.jwObjectId) {
    return c.json({ error: 'jwObjectId required' }, 400);
  }

  // 候補リストを引き直し、jwObjectId が一致するノードを採用。
  // タイトル検索のヒット範囲から選ぶ前提なので、再検索クエリも item の元タイトル基準。
  const query = buildSearchQuery(item.service, item.title);
  const nodes = await searchTitles(query);
  const node = nodes.find((n) => n.id === body.jwObjectId);
  if (!node) {
    // 候補に無ければ別クエリで広く取り直す（ユーザーが手入力検索で確定したケース）。
    // 諦めて 404 にせず、ジェネリックなタイトル検索もう1度試す。
    const alt = await searchTitles(item.title);
    const fallback = alt.find((n) => n.id === body.jwObjectId);
    if (!fallback) return c.json({ error: 'candidate not found' }, 404);
    const r = nodeToResult(fallback, item.service);
    await db
      .update(watchlistItems)
      .set({ ...r, matchStatus: 'confirmed', expiryCheckedAt: Date.now() })
      .where(eq(watchlistItems.id, item.id));
    return c.json({ ok: true, matchStatus: 'confirmed', expiresAt: r.expiresAt });
  }

  const r = nodeToResult(node, item.service);
  await db
    .update(watchlistItems)
    .set({ ...r, matchStatus: 'confirmed', expiryCheckedAt: Date.now() })
    .where(eq(watchlistItems.id, item.id));
  return c.json({ ok: true, matchStatus: 'confirmed', expiresAt: r.expiresAt });
});

/**
 * マッチ確認UI: 手動で「該当作品なし」と確定する（unmatched 固定）。
 * cron の再マッチ対象から外したい場合に使う。
 */
app.post('/api/watchlist/items/:id/unmatch', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const id = c.req.param('id');
  const item = await db
    .select()
    .from(watchlistItems)
    .where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, user.id)))
    .get();
  if (!item) return c.json({ error: 'not found' }, 404);

  await db
    .update(watchlistItems)
    .set({
      jwObjectId: null,
      jwTitle: null,
      jwPath: null,
      expiresAt: null,
      matchStatus: 'unmatched',
      expiryCheckedAt: Date.now(),
    })
    .where(eq(watchlistItems.id, item.id));
  return c.json({ ok: true });
});

/**
 * ダイジェスト本文を返す（送信しない）。動作確認用。
 */
app.get('/api/digest/preview', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const payload = await buildDigestForUser(db, user, new Date());
  if (!payload) return c.json({ message: '配信終了予定の作品が無いため空' });
  return c.json(payload);
});

/**
 * 即時にダイジェストを生成・送信する（曜日は無視、全有効チャンネルへ）。動作確認用。
 */
app.post('/api/digest/run', async (c) => {
  const db = drizzle(c.env.DB);
  const user = await authenticate(c, db);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const payload = await buildDigestForUser(db, user, new Date());
  if (!payload) return c.json({ sent: false, reason: '配信終了予定の作品が無い' });
  const notifier = {
    email: senderFromEnv(c.env),
    line: lineConfigFromEnv(c.env),
    alexa: alexaConfigFromEnv(c.env),
  };
  const r = await dispatchDigest(notifier, user, payload);
  return c.json({ result: r });
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
    const notifier = {
      email: senderFromEnv(env),
      line: lineConfigFromEnv(env),
      alexa: alexaConfigFromEnv(env),
    };
    ctx.waitUntil(
      runWeeklyDigests(db, notifier, new Date())
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
