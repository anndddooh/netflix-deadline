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

function daysLabel(d: number): string {
  if (d < 0) return '終了済み';
  if (d === 0) return '本日終了';
  return `あと ${d} 日`;
}

export function WatchlistList({ items }: { items: WatchlistEntry[] }) {
  const withExpiry = items.filter((i) => i.expiresAt);
  const noExpiry = items.filter((i) => !i.expiresAt);

  return (
    <div>
      <section className="list-section">
        <h2 className="list-section-title">
          配信終了予定あり（{withExpiry.length}）
        </h2>
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
                <span className="days">{daysLabel(d)}</span>
                <span className="date">{i.expiresAt}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="list-section">
        <h2 className="list-section-title">
          配信終了予定なし（{noExpiry.length}）
        </h2>
        <ul className="entries">
          {noExpiry.map((i) => (
            <li key={i.id} className="entry">
              <span className={`badge ${i.service}`}>
                {SERVICE_LABEL[i.service]}
              </span>
              <span className="title">{i.title}</span>
              {i.matchStatus === 'unmatched' && (
                <span className="entry-meta">未マッチ</span>
              )}
              {i.matchStatus === 'pending' && (
                <span className="entry-meta">マッチ保留中</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
