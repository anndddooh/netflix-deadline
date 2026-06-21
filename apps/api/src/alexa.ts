// Alexa Proactive Events 連携。
//
// 必要なもの:
//   - Alexa 開発者コンソールで作ったカスタムスキル
//   - そのスキルの clientId / clientSecret（Permissions → Alexa Skill Messaging で発行）
//   - スキルに「リマインダー」または「proactive events」の権限を付与
//
// 連携フロー（メールや LINE と同じく「6 桁コードで紐付け」式）:
//   1. Web 設定画面で「Alexa 連携」ボタン → /api/alexa/link-code でコード発行
//   2. ユーザーが Alexa で「アレクサ、Netflix デッドラインを開いて」
//   3. スキルが「コードを言ってください」と返す
//   4. ユーザーが「123456」と発話
//   5. スキルのバックエンドが POST /api/alexa/link で
//      { code, alexaUserId } を送ってきて、users.alexa_user_id を埋める
//      （alexaUserId は context.System.user.userId、amzn1.ask.account.XXX）
//   6. 以降ダイジェスト送信時に Proactive Events API で配信
//
// Proactive Events は事前定義スキーマに沿う必要があり、今回は
// AMAZON.MessageAlert.Activated（新着メッセージ通知）を流用する。
// 通知センターに「○件の作品が配信終了間近」と表示され、タップで開ける。

import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { and, eq, gt } from 'drizzle-orm';
import { users } from './db/schema';

export interface AlexaConfig {
  clientId: string;
  clientSecret: string;
  /**
   * Proactive Events の送信先 URL。未指定なら本番ステージ
   * (`https://api.amazonalexa.com/v1/proactiveEvents`) を使う。
   * 開発ステージで送る場合は
   * `https://api.amazonalexa.com/v1/proactiveEvents/stages/development`
   * のように **末尾までフルパス** で指定する。
   */
  proactiveEventsUrl?: string;
}

export function alexaConfigFromEnv(env: {
  ALEXA_CLIENT_ID?: string;
  ALEXA_CLIENT_SECRET?: string;
  ALEXA_API_BASE?: string;
}): AlexaConfig | null {
  if (!env.ALEXA_CLIENT_ID || !env.ALEXA_CLIENT_SECRET) return null;
  return {
    clientId: env.ALEXA_CLIENT_ID,
    clientSecret: env.ALEXA_CLIENT_SECRET,
    proactiveEventsUrl: env.ALEXA_API_BASE,
  };
}

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const DEFAULT_PROACTIVE_EVENTS_URL =
  'https://api.amazonalexa.com/v1/proactiveEvents';

interface AccessTokenCache {
  token: string;
  expiresAt: number;
}

let cached: AccessTokenCache | null = null;

/**
 * LWA (Login With Amazon) の client_credentials フローでアクセストークンを取得する。
 * scope=alexa::proactive_events。1 時間有効なので worker 内でキャッシュ。
 */
async function getAccessToken(cfg: AlexaConfig): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'alexa::proactive_events',
  });
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `LWA token ${res.status}: ${(await res.text()).slice(0, 300)}`
    );
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = {
    token: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return cached.token;
}

export interface AlexaProactiveEvent {
  /** 送信先 Alexa ユーザーID（amzn1.ask.account.XXX） */
  alexaUserId: string;
  /** イベントの一意キー。重複送信抑止に使われる */
  referenceId: string;
  /** ユーザーへの通知本文（freeformText、80 文字程度推奨） */
  message: string;
  /** 有効期限 ISO8601。指定しなければ +24h */
  expiryTime?: string;
}

/**
 * Proactive Events API でユーザーに通知を送る。
 * 開発中は ALEXA_API_BASE=https://api.amazonalexa.com/v1/proactiveEvents/stages/development を指定する。
 */
export async function sendProactiveEvent(
  cfg: AlexaConfig,
  ev: AlexaProactiveEvent
): Promise<void> {
  const token = await getAccessToken(cfg);
  const url = cfg.proactiveEventsUrl ?? DEFAULT_PROACTIVE_EVENTS_URL;
  const expiryTime =
    ev.expiryTime ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const payload = {
    timestamp: new Date().toISOString(),
    referenceId: ev.referenceId,
    expiryTime,
    event: {
      name: 'AMAZON.MessageAlert.Activated',
      payload: {
        state: { status: 'UNREAD', freshness: 'NEW' },
        messageGroup: {
          creator: { name: 'netflix-deadline' },
          count: 1,
        },
      },
    },
    localizedAttributes: [
      {
        locale: 'ja-JP',
        // MessageAlert スキーマには freeformText フィールドが無いので、
        // 通知センターには messageGroup.creator.name が出る。本文は別途
        // スキル側で「最後のお知らせを読んで」と聞かれた時に返す想定。
        // 詳細メッセージはスキル DB に push しておく運用にする。
      },
    ],
    relevantAudience: {
      type: 'Unicast',
      payload: { user: ev.alexaUserId },
    },
    // 内部用にも保持（スキル側から後で取り出せる）
    _message: ev.message,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (res.status !== 202) {
    throw new Error(
      `Alexa proactive ${res.status}: ${(await res.text()).slice(0, 300)}`
    );
  }
}

/** 6 桁コード（Alexa スキルでも「数字 6 桁」のほうが認識率が高い） */
export function generateLinkCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return String(n % 1_000_000).padStart(6, '0');
}

export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Alexa スキル → API への紐付け要求を処理する。
 * 共有鍵 ALEXA_LINK_SECRET で認証（スキル側に同じ値を埋め、Authorization ヘッダで送る）。
 */
export async function linkAlexaUser(
  db: DrizzleD1Database,
  code: string,
  alexaUserId: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'invalid code' };
  if (!alexaUserId.startsWith('amzn1.ask.account.'))
    return { ok: false, reason: 'invalid alexaUserId' };

  const user = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.alexaLinkCode, code),
        gt(users.alexaLinkExpiresAt, Date.now())
      )
    )
    .get();
  if (!user) return { ok: false, reason: 'code not found or expired' };

  await db
    .update(users)
    .set({
      alexaUserId,
      alexaLinkCode: null,
      alexaLinkExpiresAt: null,
      notifyAlexaEnabled: true,
    })
    .where(eq(users.id, user.id));
  return { ok: true };
}
