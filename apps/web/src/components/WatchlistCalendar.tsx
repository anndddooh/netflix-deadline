import { useMemo, useState } from 'react';
import type { WatchlistEntry } from '@netflix-deadline/shared';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

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
    <div className="calendar">
      <div className="cal-nav">
        <button onClick={prev} aria-label="前の月">
          ‹
        </button>
        <div className="cal-nav-center">
          <span>
            {view.y} 年 {view.m + 1} 月
          </span>{' '}
          <button
            className="btn-ghost"
            onClick={today}
            style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px' }}
          >
            今月
          </button>
        </div>
        <button onClick={next} aria-label="次の月">
          ›
        </button>
      </div>
      <div className="cal-grid">
        {WEEKDAYS.map((w, idx) => (
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
            className={`cal-cell${d === todayKey ? ' today' : ''}${
              d ? '' : ' empty'
            }`}
          >
            {d && <div className="cal-day">{d}</div>}
            {d &&
              (byDate.get(dateKey(d)) ?? []).map((i) => (
                <div
                  key={i.id}
                  className={`cal-item ${i.service}`}
                  title={`${i.title}（${i.service}）`}
                >
                  {i.title}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
