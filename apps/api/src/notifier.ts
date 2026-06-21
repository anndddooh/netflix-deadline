// 通知チャンネルの抽象。ダイジェスト 1 通を「メール / LINE / Alexa」に並行配信する。
//
// 各チャンネルは
//   - 設定で有効化されている (notifyXxxEnabled)
//   - 紐付け済み (lineUserId / alexaUserId が埋まっている、emailは常に)
// の両方を満たす場合のみ送信する。

import type { User } from './db/schema';
import {
  type EmailSender,
  type EmailMessage,
} from './email';
import {
  pushText as linePushText,
  type LineConfig,
} from './line';
import {
  sendProactiveEvent,
  type AlexaConfig,
} from './alexa';

/** チャンネルに依らない 1 通の通知ペイロード */
export interface DigestPayload {
  /** メール件名 / Alexa 通知タイトル */
  subject: string;
  /** プレーンテキスト本文（メール text 部 / LINE 本文 / Alexa の発話文） */
  text: string;
  /** メール HTML 本文 */
  html: string;
  /** 通知件数（バッジ表示などに使う） */
  count: number;
}

export interface NotifierContext {
  email: EmailSender;
  line: LineConfig | null;
  alexa: AlexaConfig | null;
}

export interface ChannelDispatchResult {
  email: 'sent' | 'skipped' | 'error';
  line: 'sent' | 'skipped' | 'error';
  alexa: 'sent' | 'skipped' | 'error';
  errors: Record<string, string>;
}

/**
 * 1 ユーザー宛にダイジェストを各チャンネルへ送る。
 * チャンネル単位で例外を吸収し、他のチャンネルに影響させない。
 */
export async function dispatchDigest(
  ctx: NotifierContext,
  user: User,
  payload: DigestPayload
): Promise<ChannelDispatchResult> {
  const result: ChannelDispatchResult = {
    email: 'skipped',
    line: 'skipped',
    alexa: 'skipped',
    errors: {},
  };

  // メール
  if (user.notifyEmailEnabled && user.notifyEmail) {
    try {
      const msg: EmailMessage = {
        to: user.notifyEmail,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      };
      await ctx.email.send(msg);
      result.email = 'sent';
    } catch (e) {
      result.email = 'error';
      result.errors.email = e instanceof Error ? e.message : String(e);
    }
  }

  // LINE
  if (user.notifyLineEnabled && user.lineUserId && ctx.line) {
    try {
      await linePushText(ctx.line, {
        to: user.lineUserId,
        text: `${payload.subject}\n\n${payload.text}`,
      });
      result.line = 'sent';
    } catch (e) {
      result.line = 'error';
      result.errors.line = e instanceof Error ? e.message : String(e);
    }
  }

  // Alexa
  if (user.notifyAlexaEnabled && user.alexaUserId && ctx.alexa) {
    try {
      await sendProactiveEvent(ctx.alexa, {
        alexaUserId: user.alexaUserId,
        referenceId: `nd-digest-${user.id}-${new Date().toISOString().slice(0, 10)}`,
        message: payload.subject,
      });
      result.alexa = 'sent';
    } catch (e) {
      result.alexa = 'error';
      result.errors.alexa = e instanceof Error ? e.message : String(e);
    }
  }

  return result;
}

/** result が「どこかのチャンネルに sent した」かどうか */
export function anySent(r: ChannelDispatchResult): boolean {
  return r.email === 'sent' || r.line === 'sent' || r.alexa === 'sent';
}
