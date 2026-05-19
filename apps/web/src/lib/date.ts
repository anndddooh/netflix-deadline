/** 今日から isoDate（'YYYY-MM-DD'）までの残り日数。過去なら負の数。 */
export function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
