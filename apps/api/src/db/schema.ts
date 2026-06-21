import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';

/** ユーザー。Google ログインで作成され、通知設定もここに持つ。 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  /** Google OAuth の subject（ユーザー一意キー） */
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull(),
  name: text('name'),
  /** 拡張機能 ↔ API のペアリングトークン */
  extensionToken: text('extension_token').notNull().unique(),
  /** ダイジェスト通知の宛先メール */
  notifyEmail: text('notify_email').notNull(),
  /** ダイジェスト送信曜日（0=日 .. 6=土、既定 1=月） */
  digestWeekday: integer('digest_weekday').notNull().default(1),
  /** 「終了まで残り N 日以内」の閾値（既定 14 日） */
  thresholdDays: integer('threshold_days').notNull().default(14),
  // --- 通知チャンネルの有効/無効 ---
  /** メール通知を有効にするか（既定 true） */
  notifyEmailEnabled: integer('notify_email_enabled', { mode: 'boolean' })
    .notNull()
    .default(true),
  /** LINE 通知を有効にするか（lineUserId が紐付いていれば送る） */
  notifyLineEnabled: integer('notify_line_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  /** Alexa 通知（Proactive Events）を有効にするか */
  notifyAlexaEnabled: integer('notify_alexa_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  // --- LINE Messaging API 連携 ---
  /** LINE のユーザーID（Push 先）。webhook の follow + 連携コードで紐付ける */
  lineUserId: text('line_user_id'),
  /** 連携コード（ユーザーが LINE bot に送って紐付ける 6 桁数値） */
  lineLinkCode: text('line_link_code'),
  /** 連携コードの有効期限 unix ms */
  lineLinkExpiresAt: integer('line_link_expires_at'),
  // --- Alexa Proactive Events 連携 ---
  /** Alexa のユーザーID（amzn1.ask.account.XXX）。スキル経由のアカウントリンクで取得 */
  alexaUserId: text('alexa_user_id'),
  /** 連携コード（Alexa スキルが「コード言ってください」で受け取り、API に送って紐付け） */
  alexaLinkCode: text('alexa_link_code'),
  /** Alexa 連携コードの有効期限 unix ms */
  alexaLinkExpiresAt: integer('alexa_link_expires_at'),
  createdAt: integer('created_at').notNull(),
});

/** マイリスト作品。拡張機能の同期で登録され、JustWatch 突き合わせ結果も持つ。 */
export const watchlistItems = sqliteTable(
  'watchlist_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    service: text('service', { enum: ['netflix', 'prime'] }).notNull(),
    /** Netflix の数値ID または Prime の ASIN */
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    entityType: text('entity_type'),
    // --- JustWatch 突き合わせ結果 ---
    jwObjectId: text('jw_object_id'),
    jwTitle: text('jw_title'),
    jwPath: text('jw_path'),
    /** 配信終了日 'YYYY-MM-DD'。未判明なら null */
    expiresAt: text('expires_at'),
    matchStatus: text('match_status', {
      enum: ['pending', 'matched', 'confirmed', 'unmatched'],
    })
      .notNull()
      .default('pending'),
    // --- 同期管理 ---
    addedAt: integer('added_at').notNull(),
    lastSyncedAt: integer('last_synced_at').notNull(),
    expiryCheckedAt: integer('expiry_checked_at'),
  },
  (t) => [
    uniqueIndex('uq_watchlist_user_service_external').on(
      t.userId,
      t.service,
      t.externalId
    ),
    index('idx_watchlist_user').on(t.userId),
  ]
);

export type User = typeof users.$inferSelect;
export type WatchlistItem = typeof watchlistItems.$inferSelect;
