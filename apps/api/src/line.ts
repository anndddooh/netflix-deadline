// LINE Messaging API クライアントと webhook ハンドリング。
//
// 連携フロー:
//   1. Web 設定画面で「LINE 連携」ボタン → /api/line/link-code で 6 桁コード発行
//      （users.line_link_code に保存、10 分有効）
//   2. ユーザーが LINE で公式アカウントを友だち追加
//      → webhook に follow イベント → 案内メッセージを reply
//   3. ユーザーが 6 桁コードを bot に送信
//      → webhook に message イベント → コードを検索 → users.line_user_id を埋める
//   4. 以降ダイジェスト送信時に LINE Push API で配信
//
// 署名検証: x-line-signature ヘッダ = base64(HMAC-SHA256(channelSecret, rawBody))

import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { and, eq, gt } from 'drizzle-orm';
import { users } from './db/schema';

export interface LineConfig {
  channelAccessToken: string;
  channelSecret: string;
}

export function lineConfigFromEnv(env: {
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
}): LineConfig | null {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_CHANNEL_SECRET) return null;
  return {
    channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: env.LINE_CHANNEL_SECRET,
  };
}

const PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

export interface LinePushMessage {
  to: string;
  text: string;
}

/** LINE Push API で 1 ユーザーにテキストメッセージを送る */
export async function pushText(
  cfg: LineConfig,
  msg: LinePushMessage
): Promise<void> {
  const res = await fetch(PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.channelAccessToken}`,
    },
    body: JSON.stringify({
      to: msg.to,
      messages: [{ type: 'text', text: msg.text }],
    }),
  });
  if (!res.ok) {
    throw new Error(`LINE push ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

/** webhook の reply（応答トークンは 1 回限り、即時返す） */
async function replyText(
  cfg: LineConfig,
  replyToken: string,
  text: string
): Promise<void> {
  await fetch(REPLY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });
}

/** x-line-signature ヘッダ検証（定数時間比較） */
export async function verifySignature(
  channelSecret: string,
  rawBody: string,
  signature: string | undefined
): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  let sig: Uint8Array;
  try {
    const bin = atob(signature);
    sig = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) sig[i] = bin.charCodeAt(i);
  } catch {
    return false;
  }
  return crypto.subtle.verify(
    'HMAC',
    key,
    sig,
    new TextEncoder().encode(rawBody)
  );
}

/** 6 桁のランダム数値コード（ペアリング用、人がスマホで打てる長さ） */
export function generateLinkCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return String(n % 1_000_000).padStart(6, '0');
}

export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

interface LineWebhookEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string; type?: string };
  message?: { type: string; text?: string };
}

interface LineWebhookBody {
  events: LineWebhookEvent[];
}

/**
 * webhook イベントを処理する。LINE の仕様で 200 を即座に返す必要があるので
 * 例外を呑んで握りつぶし、内部エラーはログに出すだけにする。
 */
export async function handleWebhook(
  cfg: LineConfig,
  db: DrizzleD1Database,
  body: LineWebhookBody
): Promise<void> {
  for (const ev of body.events ?? []) {
    try {
      if (ev.type === 'follow' && ev.replyToken) {
        await replyText(
          cfg,
          ev.replyToken,
          'netflix-deadline へようこそ。\n' +
            'Web の設定画面で発行した 6 桁のコードを、そのままトークに送ってください。'
        );
      } else if (
        ev.type === 'message' &&
        ev.message?.type === 'text' &&
        ev.replyToken &&
        ev.source?.userId
      ) {
        const text = (ev.message.text ?? '').trim();
        const codeMatch = text.match(/\b(\d{6})\b/);
        if (!codeMatch) {
          await replyText(
            cfg,
            ev.replyToken,
            '6 桁のコードを送ってください。\nWeb の設定画面「LINE 連携」から発行できます。'
          );
          continue;
        }
        const code = codeMatch[1]!;
        const user = await db
          .select()
          .from(users)
          .where(
            and(
              eq(users.lineLinkCode, code),
              gt(users.lineLinkExpiresAt, Date.now())
            )
          )
          .get();
        if (!user) {
          await replyText(
            cfg,
            ev.replyToken,
            'コードが見つからないか期限切れです。Web で再発行してください。'
          );
          continue;
        }
        await db
          .update(users)
          .set({
            lineUserId: ev.source.userId,
            lineLinkCode: null,
            lineLinkExpiresAt: null,
            notifyLineEnabled: true,
          })
          .where(eq(users.id, user.id));
        await replyText(
          cfg,
          ev.replyToken,
          '連携しました。次回のダイジェストからここにも通知します。'
        );
      } else if (ev.type === 'unfollow' && ev.source?.userId) {
        // ユーザーがブロック / 友だち解除した場合、line_user_id を外して送信を止める
        await db
          .update(users)
          .set({
            lineUserId: null,
            notifyLineEnabled: false,
          })
          .where(eq(users.lineUserId, ev.source.userId));
      }
    } catch (e) {
      console.error('[line webhook] event failed:', e);
    }
  }
}
