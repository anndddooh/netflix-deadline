import { useMemo, useState } from 'react';
import type { WatchlistEntry } from '@netflix-deadline/shared';
import { formatJaDate, WEEKDAYS_JA } from '../lib/date';
import { SERVICE_NAME } from '../lib/services';

export function WatchlistCalendar({ items }: { items: WatchlistEntry[] }) {
  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });

  // 配信終了日ごとに作品をまとめる
  const byDate = useMemo(() => {
    const map = new Map<string, WatchlistEntry[]>();
    for (const i of items) {
      if (!i.expiresAt) continue;
      const arr = map.get(i.expiresAt) ?? [];
      arr.push(i);
      map.set(i.expiresAt, arr);
    }
    return map;
  }, [items]);

  const startWeekday = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const dateKey = (d: number) =>
    `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const monthCount = useMemo(() => {
    let n = 0;
    for (let d = 1; d <= daysInMonth; d++) n += byDate.get(dateKey(d))?.length ?? 0;
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDate, view.y, view.m, daysInMonth]);

  const prev = () =>
    setView(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }));
  const next = () =>
    setView(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }));
  const today = () => setView({ y: now.getFullYear(), m: now.getMonth() });

  const todayKey =
    now.getFullYear() === view.y && now.getMonth() === view.m
      ? now.getDate()
      : -1;

  return (
    <>
      <div className="cal-head">
        <div className="cal-head__left">
          <div className="cal-month">
            {view.y}.{String(view.m + 1).padStart(2, '0')}
          </div>
          <div className="cal-summary">
            {monthCount > 0
              ? `この月に ${monthCount} 作品が配信終了`
              : 'この月の配信終了はありません'}
          </div>
        </div>
        <div className="cal-nav">
          <button className="cal-nav__arrow" onClick={prev} aria-label="前の月">
            ‹
          </button>
          <button className="cal-nav__today" onClick={today}>
            今月
          </button>
          <button className="cal-nav__arrow" onClick={next} aria-label="次の月">
            ›
          </button>
        </div>
      </div>

      <div className="cal-grid">
        {WEEKDAYS_JA.map((w, idx) => (
          <div
            key={w}
            className={`cal-wd${idx === 0 ? ' sun' : ''}${idx === 6 ? ' sat' : ''}`}
          >
            {w}
          </div>
        ))}
        {cells.map((d, idx) => (
          <div
            key={idx}
            className={`cal-cell${d === todayKey ? ' is-today' : ''}${
              d ? '' : ' is-empty'
            }`}
          >
            {d && <div className="cal-day">{d}</div>}
            {d &&
              (byDate.get(dateKey(d)) ?? []).map((i) => (
                <div
                  key={i.id}
                  className={`cal-chip ${i.service}`}
                  title={`${i.title}（${SERVICE_NAME[i.service]}）· ${formatJaDate(
                    i.expiresAt!
                  )}まで`}
                >
                  {i.title}
                </div>
              ))}
          </div>
        ))}
      </div>

      <div className="cal-legend">
        <span>
          <i className="netflix" />
          Netflix
        </span>
        <span>
          <i className="prime" />
          Prime Video
        </span>
      </div>
    </>
  );
}
