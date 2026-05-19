// 拡張機能 / Web アプリ / バックエンドで共有するドメイン型。
// 実装が進むにつれて拡張する。

/** 対応する配信サービス */
export type StreamingService = 'netflix' | 'prime';

/**
 * 拡張機能がマイリストから取得した1作品。
 * externalId は Netflix の数値ID（例 "81574118"）または
 * Prime の ASIN（例 "B0CVTWBB5T"）。
 */
export interface ScrapedItem {
  service: StreamingService;
  externalId: string;
  title: string;
  /** Prime のみ: カード種別（'Movie' | 'TV Show' 等） */
  entityType?: string | null;
}

/** 拡張機能 → API へ送るマイリスト同期ペイロード */
export interface SyncWatchlistRequest {
  service: StreamingService;
  /** スクレイピング実行時刻（ISO 8601） */
  scrapedAt: string;
  items: ScrapedItem[];
}

/** マイリスト同期のレスポンス */
export interface SyncWatchlistResponse {
  service: StreamingService;
  received: number;
  added: number;
  removed: number;
}
