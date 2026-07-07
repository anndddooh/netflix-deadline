import type { StreamingService } from '@netflix-deadline/shared';

/** サービスバッジの表記（大文字ワードマーク） */
export const SERVICE_LABEL: Record<StreamingService, string> = {
  netflix: 'NETFLIX',
  prime: 'PRIME',
};

/** サービスの正式名称（本文表示用） */
export const SERVICE_NAME: Record<StreamingService, string> = {
  netflix: 'Netflix',
  prime: 'Prime Video',
};

/** カレンダーチップ / ドットの地色 */
export const SERVICE_COLOR: Record<StreamingService, string> = {
  netflix: '#f2ede3',
  prime: '#2b62c4',
};

/** マイリスト編集の起点となる外部ページ */
export const MYLIST_URLS: Record<StreamingService, string> = {
  netflix: 'https://www.netflix.com/browse/my-list',
  prime: 'https://www.amazon.co.jp/gp/video/watchlist/',
};
