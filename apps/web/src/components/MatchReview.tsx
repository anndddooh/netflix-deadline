import { useState } from 'react';
import type { MatchCandidate, WatchlistEntry } from '@netflix-deadline/shared';
import {
  confirmMatch,
  fetchCandidates,
  markUnmatched,
  runMatch,
} from '../api';
import { SERVICE_LABEL } from '../lib/services';
import { hidePosterOnError, posterImageUrl } from '../lib/poster';

interface Props {
  items: WatchlistEntry[];
  onChanged: () => void;
}

/**
 * 「未マッチ」「マッチ済み（自動）」の作品を一覧し、
 * 各行から JustWatch 候補を引いて手動で選び直せる UI。
 * 同時に開く行は1件のみ（openId を親で保持）。
 */
export function MatchReview({ items, onChanged }: Props) {
  const unmatched = items.filter((i) => i.matchStatus === 'unmatched');
  const matched = items.filter((i) => i.matchStatus === 'matched');

  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));

  const onRunMatch = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const r = await runMatch();
      setRunResult(
        `処理 ${r.processed} 件: マッチ ${r.matched} / 未マッチ ${r.unmatched} / エラー ${r.errors}（残 ${r.remaining}）`
      );
      onChanged();
    } catch (e) {
      setRunResult(`再マッチ失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="review-head">
        <h1 className="page-title">MATCH REVIEW</h1>
        <button
          className="btn-ghost review-rematch"
          onClick={onRunMatch}
          disabled={running}
        >
          {running ? '再マッチ実行中…' : '保留中の作品を再マッチ'}
        </button>
      </div>
      <p className="review-lead">
        JustWatch との照合状況。未マッチのままだと配信終了日を追跡できません。
      </p>
      {runResult && <p className="review-run">{runResult}</p>}

      <div className="review-section-head section-head--accent">
        UNMATCHED — 未マッチ（{unmatched.length}）
      </div>
      {unmatched.length === 0 ? (
        <p className="review-empty">未マッチの作品はありません。</p>
      ) : (
        <ul className="review-list">
          {unmatched.map((i) => (
            <ReviewRow
              key={i.id}
              item={i}
              open={openId === i.id}
              onToggle={() => toggle(i.id)}
              onChanged={onChanged}
              onClose={() => setOpenId(null)}
            />
          ))}
        </ul>
      )}

      <div className="review-section-head section-head">
        AUTO MATCHED — マッチ済みの見直し（{matched.length}）
      </div>
      {matched.length === 0 ? (
        <p className="review-empty">マッチ済みの作品はありません。</p>
      ) : (
        <ul className="review-list review-list--matched">
          {matched.map((i) => (
            <ReviewRow
              key={i.id}
              item={i}
              open={openId === i.id}
              onToggle={() => toggle(i.id)}
              onChanged={onChanged}
              onClose={() => setOpenId(null)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function ReviewRow({
  item,
  open,
  onToggle,
  onChanged,
  onClose,
}: {
  item: WatchlistEntry;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const isUnmatched = item.matchStatus === 'unmatched';
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCandidates(item.id, q);
      setCandidates(res.candidates);
      setQuery(res.query);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async () => {
    const willOpen = !open;
    onToggle();
    if (willOpen && candidates === null) await load();
  };

  const choose = async (c: MatchCandidate) => {
    setBusyId(c.jwObjectId);
    setError(null);
    try {
      await confirmMatch(item.id, c.jwObjectId);
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const noneMatches = async () => {
    setBusyId('__none__');
    setError(null);
    try {
      await markUnmatched(item.id);
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const toggleLabel = open ? '閉じる' : isUnmatched ? '候補を見る' : '選び直す';

  return (
    <li
      className={`review-row ${
        isUnmatched ? 'review-row--unmatched' : 'review-row--matched'
      }`}
    >
      <div className="review-row__head">
        <span className={`badge ${item.service}`}>
          {SERVICE_LABEL[item.service]}
        </span>
        <div className="review-row__body">
          <div className="review-row__title">{item.title}</div>
          {isUnmatched ? (
            <div className="review-row__sub review-row__sub--flag">未マッチ</div>
          ) : (
            <div className="review-row__sub">
              {item.jwTitle ? `自動: ${item.jwTitle}` : '自動マッチ済'}
            </div>
          )}
        </div>
        <button className="btn-ghost review-row__toggle" onClick={handleToggle}>
          {toggleLabel}
        </button>
      </div>

      {open && (
        <div className="review-panel">
          <div className="review-search">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="検索ワード"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void load(query);
              }}
            />
            <button
              className="btn-ghost"
              onClick={() => load(query)}
              disabled={loading}
            >
              {loading ? '検索中…' : '再検索'}
            </button>
          </div>

          {error && <p className="msg-error">{error}</p>}

          {candidates && candidates.length === 0 && (
            <p className="muted" style={{ fontSize: 12.5 }}>
              候補が見つかりませんでした。検索ワードを変えて再検索してください。
            </p>
          )}

          {candidates && candidates.length > 0 && (
            <ul className="cand-list">
              {candidates.map((c) => {
                const busy = busyId === c.jwObjectId;
                const url = c.jwPath ? `https://www.justwatch.com${c.jwPath}` : null;
                return (
                  <li key={c.jwObjectId} className="cand">
                    <div className="cand-thumb">
                      {posterImageUrl(c.posterPath, 's166') && (
                        <img
                          className="thumb-img"
                          src={posterImageUrl(c.posterPath, 's166')!}
                          alt=""
                          loading="lazy"
                          onError={hidePosterOnError}
                        />
                      )}
                    </div>
                    <div className="cand-main">
                      <span className="cand-title">{c.title}</span>
                      {c.originalReleaseYear && (
                        <span className="cand-year">（{c.originalReleaseYear}）</span>
                      )}
                      {c.expiresAt && (
                        <div className="cand-expiry">配信終了 {c.expiresAt}</div>
                      )}
                    </div>
                    {url && (
                      <a
                        className="cand-link"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        JustWatch ↗
                      </a>
                    )}
                    <button
                      className="btn-accent cand-confirm"
                      onClick={() => choose(c)}
                      disabled={busy}
                    >
                      {busy ? '確定中…' : 'これに確定'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="review-panel__foot">
            <button
              className="btn-ghost review-none"
              onClick={noneMatches}
              disabled={busyId === '__none__'}
            >
              {busyId === '__none__' ? '更新中…' : '該当なし（未マッチ確定）'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
