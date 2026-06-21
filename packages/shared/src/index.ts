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

/** JustWatch 突き合わせの状態 */
export type MatchStatus = 'pending' | 'matched' | 'confirmed' | 'unmatched';

/** Web 画面に渡すマイリスト1作品 */
export interface WatchlistEntry {
  id: string;
  service: StreamingService;
  externalId: string;
  title: string;
  entityType: string | null;
  /** JustWatch 側のタイトル（突き合わせ結果） */
  jwTitle: string | null;
  /** 配信終了日 'YYYY-MM-DD'。未判明なら null */
  expiresAt: string | null;
  matchStatus: MatchStatus;
}

/** GET /api/watchlist のレスポンス */
export interface GetWatchlistResponse {
  items: WatchlistEntry[];
}

/** PATCH /auth/me のリクエスト（通知設定） */
export interface UpdateSettingsRequest {
  notifyEmail?: string;
  /** 0=日 .. 6=土 */
  digestWeekday?: number;
  /** 残り日数の閾値 */
  thresholdDays?: number;
  notifyEmailEnabled?: boolean;
  notifyLineEnabled?: boolean;
  notifyAlexaEnabled?: boolean;
}

/** GET /auth/me と PATCH /auth/me のレスポンス */
export interface UserInfoResponse {
  id: string;
  email: string;
  name: string | null;
  extensionToken: string;
  notifyEmail: string;
  digestWeekday: number;
  thresholdDays: number;
  notifyEmailEnabled: boolean;
  notifyLineEnabled: boolean;
  notifyAlexaEnabled: boolean;
  /** LINE bot と紐付け済みか */
  lineLinked: boolean;
  /** Alexa スキルと紐付け済みか */
  alexaLinked: boolean;
}

/** POST /api/line/link-code および /api/alexa/link-code のレスポンス */
export interface LinkCodeResponse {
  /** 6 桁の数値コード */
  code: string;
  /** 有効期限 unix ms */
  expiresAt: number;
}

/** JustWatch 候補（マッチ確認UIで提示する1件） */
export interface MatchCandidate {
  /** JustWatch のノードID（手動マッチ確定時に渡す） */
  jwObjectId: string;
  title: string;
  originalReleaseYear: number | null;
  jwPath: string | null;
  /** このサービスでの配信終了日 'YYYY-MM-DD'。無ければ null */
  expiresAt: string | null;
}

/** GET /api/watchlist/items/:id/candidates のレスポンス */
export interface CandidatesResponse {
  itemId: string;
  query: string;
  candidates: MatchCandidate[];
}

/** POST /api/watchlist/items/:id/match のリクエスト（手動マッチ確定） */
export interface ConfirmMatchRequest {
  jwObjectId: string;
}
