import { useMemo } from 'react';
import type { WatchlistEntry } from '@netflix-deadline/shared';
import {
  daysUntil,
  formatJaDate,
  tickerDate,
  weekdayIndex,
  WEEKDAYS_JA,
} from '../lib/date';
import {
  MYLIST_URLS,
  SERVICE_COLOR,
  SERVICE_LABEL,
  SERVICE_NAME,
} from '../lib/services';
import { hidePosterOnError, posterImageUrl } from '../lib/poster';

/**
 * ホーム（見納め間近）。
 * 日付ティッカー → フィーチャー（最短の1件）＋3セクションリスト → マイリスト編集フッター。
 */
export function WatchlistList({ items }: { items: WatchlistEntry[] }) {
  const { expiring, noExpiry } = useMemo(() => {
    // 配信終了日が過ぎた作品は「見納め間近」からは除外する（既に見られない）。
    const withExpiry = items
      .filter((i) => i.expiresAt && daysUntil(i.expiresAt) >= 0)
      .sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!));
    return {
      expiring: withExpiry,
      noExpiry: items.filter((i) => !i.expiresAt),
    };
  }, [items]);

  const feature = expiring[0] ?? null;
  const closingSoon = expiring
    .slice(1)
    .filter((i) => daysUntil(i.expiresAt!) <= 14);
  const later = expiring.filter((i) => daysUntil(i.expiresAt!) > 14);

  // 日付ティッカー（終了日が近い順に最大6件）
  // 日付ティッカー（終了日を近い順に最大6日付。同日複数作品は1セルにまとめ、
  // 下段に「N作品」を表示する）
  const ticker: { key: string; isToday: boolean; date: string; sub: string }[] = [];
  const seenDates = new Set<string>();
  for (const i of expiring) {
    const key = i.expiresAt!;
    if (seenDates.has(key)) continue;
    seenDates.add(key);
    const isToday = daysUntil(key) === 0;
    const count = expiring.filter((x) => x.expiresAt === key).length;
    ticker.push({
      key,
      isToday,
      date: tickerDate(key),
      sub: `${isToday ? '今夜' : WEEKDAYS_JA[weekdayIndex(key)]} · ${count}作品${isToday ? '終了' : ''}`,
    });
    if (ticker.length >= 6) break;
  }

  return (
    <>
      <div className="ticker">
        {ticker.map((tk) => (
          <div
            key={tk.key}
            className={`ticker__cell${tk.isToday ? ' is-today' : ''}`}
          >
            <div className="ticker__date">{tk.date}</div>
            <div className="ticker__sub">{tk.sub}</div>
          </div>
        ))}
      </div>

      <main className="wrap">
        <div className="home-grid">
          {/* フィーチャー */}
          <div>{feature ? <Feature item={feature} /> : <FeatureEmpty />}</div>

          {/* 3セクションリスト */}
          <div>
            <div className="section-head">CLOSING SOON — 見納め間近</div>
            <div className="close-list">
              {closingSoon.map((i) => {
                const d = daysUntil(i.expiresAt!);
                return (
                  <a
                    key={i.id}
                    className="close-row"
                    href={MYLIST_URLS[i.service]}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div className={`close-days${d <= 7 ? ' is-urgent' : ''}`}>
                      {d}
                      <small> 日</small>
                    </div>
                    <div className="close-thumb">
                      {posterImageUrl(i.posterPath, 's166') && (
                        <img
                          className="thumb-img"
                          src={posterImageUrl(i.posterPath, 's166')!}
                          alt=""
                          loading="lazy"
                          onError={hidePosterOnError}
                        />
                      )}
                    </div>
                    <div className="close-info">
                      <div className="close-title">{i.title}</div>
                      <div className="close-meta">
                        {SERVICE_NAME[i.service]} · {formatJaDate(i.expiresAt!)}まで
                      </div>
                    </div>
                    <span className="close-arrow">↗</span>
                  </a>
                );
              })}
              {closingSoon.length === 0 && (
                <p className="muted" style={{ fontSize: 12.5, margin: '4px 0' }}>
                  14日以内に見納めの作品はありません。
                </p>
              )}
            </div>

            <div
              className="section-head"
              style={{ margin: '30px 0 8px' }}
            >
              LATER — それ以降
            </div>
            <div className="later-list">
              {later.map((i) => (
                <a
                  key={i.id}
                  className="later-row"
                  href={MYLIST_URLS[i.service]}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="later-days">
                    {daysUntil(i.expiresAt!)}
                    <small> 日</small>
                  </span>
                  <span className={`badge ${i.service}`}>
                    {SERVICE_LABEL[i.service]}
                  </span>
                  <span className="later-title">{i.title}</span>
                  <span className="later-date">{formatJaDate(i.expiresAt!)}まで</span>
                </a>
              ))}
              {later.length === 0 && (
                <p className="muted" style={{ fontSize: 12.5, margin: '4px 0' }}>
                  該当なし
                </p>
              )}
            </div>

            <div className="noexp-head">
              <div className="section-head">NO DEADLINE — 終了予定なし</div>
              <span className="noexp-count">{noExpiry.length}作品</span>
            </div>
            <div className="pill-list">
              {noExpiry.map((i) => {
                const meta =
                  i.matchStatus === 'unmatched'
                    ? '未マッチ'
                    : i.matchStatus === 'pending'
                      ? '保留中'
                      : '';
                return (
                  <span key={i.id} className="pill" title={i.title}>
                    <span
                      className="pill__dot"
                      style={{ background: SERVICE_COLOR[i.service] }}
                    />
                    <span className="pill__title">{i.title}</span>
                    {meta && <span className="pill__meta">{meta}</span>}
                  </span>
                );
              })}
              {noExpiry.length === 0 && <span className="muted">なし</span>}
            </div>

            {/* マイリスト編集 */}
            <div className="mylist-edit">
              <span>マイリストを編集:</span>
              <a
                className="mylist-pill"
                href={MYLIST_URLS.netflix}
                target="_blank"
                rel="noreferrer"
              >
                <span className="badge netflix">NETFLIX</span>マイリスト ↗
              </a>
              <a
                className="mylist-pill"
                href={MYLIST_URLS.prime}
                target="_blank"
                rel="noreferrer"
              >
                <span className="badge prime">PRIME</span>ウォッチリスト ↗
              </a>
              <span>編集後、拡張機能の「同期」で反映</span>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

function Feature({ item }: { item: WatchlistEntry }) {
  const days = daysUntil(item.expiresAt!);
  const isToday = days === 0;
  const kicker = isToday ? 'TONIGHT — 本日で見納め' : 'NEXT UP — 最短の見納め';
  const bigLabel = isToday ? 'FINAL DAY' : `あと${days}日`;
  const dateLabel = isToday
    ? '本日 23:59 配信終了'
    : `${formatJaDate(item.expiresAt!)} 配信終了`;

  return (
    <>
      <div className="feature__kicker">{kicker}</div>
      <div className="poster">
        <span className="poster__ph">POSTER</span>
        {posterImageUrl(item.posterPath, 's592') && (
          <img
            className="poster__img"
            src={posterImageUrl(item.posterPath, 's592')!}
            alt={item.title}
            loading="lazy"
            onError={hidePosterOnError}
          />
        )}
        <span className={`badge ${item.service} feature__badge`}>
          {SERVICE_LABEL[item.service]}
        </span>
        <div className="poster__scrim">
          <div className="feature__big">{bigLabel}</div>
          <div className="feature__title">{item.title}</div>
          <div className="feature__meta">{dateLabel}</div>
        </div>
      </div>
      <a
        className="watch-cta btn-accent"
        href={MYLIST_URLS[item.service]}
        target="_blank"
        rel="noreferrer"
      >
        {SERVICE_NAME[item.service]} で今すぐ観る ↗
      </a>
    </>
  );
}

function FeatureEmpty() {
  return (
    <>
      <div className="feature__kicker" style={{ color: 'var(--text-muted)' }}>
        NEXT UP — 最短の見納め
      </div>
      <div className="feature-empty">
        配信終了予定の作品はまだありません。
        <br />
        マイリストを同期すると、ここに最短の見納めが表示されます。
      </div>
    </>
  );
}
