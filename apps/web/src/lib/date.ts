/** 曜日ラベル（0=日 .. 6=土） */
export const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 今日から isoDate（'YYYY-MM-DD'）までの残り日数。過去なら負の数。 */
export function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** 'YYYY-MM-DD' の曜日インデックス（0=日 .. 6=土） */
export function weekdayIndex(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).getDay();
}

/** '2026-07-09' → '7月9日（木）' */
export function formatJaDate(isoDate: string): string {
  const [, m, d] = isoDate.split('-').map(Number);
  return `${m}月${d}日（${WEEKDAYS_JA[weekdayIndex(isoDate)]}）`;
}

/** '2026-07-09' → '7.09'（日付ティッカー用） */
export function tickerDate(isoDate: string): string {
  const [, m, d] = isoDate.split('-').map(Number);
  return `${m}.${String(d).padStart(2, '0')}`;
}
