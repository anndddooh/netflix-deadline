import type { WatchlistEntry } from '@netflix-deadline/shared';
import { daysUntil } from '../lib/date';

const SERVICE_LABEL: Record<string, string> = {
  netflix: 'Netflix',
  prime: 'Prime',
};

/** 残り日数に応じた緊急度クラス */
function urgency(days: number): string {
  if (days <= 7) return 'urgent';
  if (days <= 14) return 'soon';
  return '';
}

export function WatchlistList({ items }: { items: WatchlistEntry[] }) {
  const withExpiry = items.filter((i) => i.expiresAt);
  const noExpiry = items.filter((i) => !i.expiresAt);

  return (
    <div>
      <section>
        <h2>配信終了予定あり（{withExpiry.length}）</h2>
        {withExpiry.length === 0 && <p className="muted">該当なし</p>}
        <ul className="entries">
          {withExpiry.map((i) => {
            const d = daysUntil(i.expiresAt!);
            return (
              <li key={i.id} className={`entry ${urgency(d)}`}>
                <span className={`badge ${i.service}`}>
                  {SERVICE_LABEL[i.service]}
                </span>
                <span className="title">{i.title}</span>
                <span className="days">
                  {d < 0 ? '終了済み' : d === 0 ? '本日終了' : `あと ${d} 日`}
                </span>
                <span className="date">{i.expiresAt}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2>配信終了予定なし（{noExpiry.length}）</h2>
        <ul className="entries">
          {noExpiry.map((i) => (
            <li key={i.id} className="entry">
              <span className={`badge ${i.service}`}>
                {SERVICE_LABEL[i.service]}
              </span>
              <span className="title">{i.title}</span>
              {i.matchStatus === 'unmatched' && (
                <span className="muted">未マッチ</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
