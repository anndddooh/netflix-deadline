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
