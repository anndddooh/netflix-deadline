import { useState } from 'react';
import type { MatchCandidate, WatchlistEntry } from '@netflix-deadline/shared';
import {
  confirmMatch,
  fetchCandidates,
  markUnmatched,
  runMatch,
} from '../api';

const SERVICE_LABEL: Record<string, string> = {
  netflix: 'Netflix',
  prime: 'Prime',
};

interface Props {
  items: WatchlistEntry[];
  onChanged: () => void;
}

/**
 * 「未マッチ」「マッチ済み（自動）」の作品を一覧し、
 * 各行から JustWatch 候補を引いて手動で選び直せる UI。
 */
export function MatchReview({ items, onChanged }: Props) {
  const targets = items.filter(
    (i) => i.matchStatus === 'unmatched' || i.matchStatus === 'matched'
  );
  const unmatched = targets.filter((i) => i.matchStatus === 'unmatched');
  const matched = targets.filter((i) => i.matchStatus === 'matched');

  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

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
    <div className="review">
      <section className="card">
        <h2 className="card-title">未マッチの作品（{unmatched.length}）</h2>
        <p className="card-desc">
          JustWatch で配信終了日が判定できなかった作品です。候補から正しい作品を選ぶか、
          「該当なし」にしてください。
        </p>
        <div className="row-actions">
          <button className="btn-ghost" onClick={onRunMatch} disabled={running}>
            {running ? '再マッチ実行中…' : '保留中の作品を再マッチ'}
          </button>
          {runResult && <span className="muted">{runResult}</span>}
        </div>
        {unmatched.length === 0 ? (
          <p className="muted">該当なし</p>
        ) : (
          <ul className="review-list">
            {unmatched.map((i) => (
              <ReviewRow key={i.id} item={i} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">マッチ済み（自動）の見直し（{matched.length}）</h2>
        <p className="card-desc">
          自動マッチが行われた作品です。誤マッチが疑わしい場合は手動で選び直せます。
        </p>
        {matched.length === 0 ? (
          <p className="muted">該当なし</p>
        ) : (
          <ul className="review-list">
            {matched.map((i) => (
              <ReviewRow key={i.id} item={i} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReviewRow({
  item,
  onChanged,
}: {
  item: WatchlistEntry;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
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

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && candidates === null) await load();
  };

  const choose = async (c: MatchCandidate) => {
    setBusyId(c.jwObjectId);
    setError(null);
    try {
      await confirmMatch(item.id, c.jwObjectId);
      onChanged();
      setOpen(false);
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
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <li className="review-row">
      <div className="review-head">
        <span className={`badge ${item.service}`}>{SERVICE_LABEL[item.service]}</span>
        <span className="review-title" title={item.title}>{item.title}</span>
        <span className="review-current muted">
          {item.matchStatus === 'matched'
            ? item.jwTitle
              ? `自動: ${item.jwTitle}`
              : '自動マッチ済'
            : '未マッチ'}
        </span>
        <button className="btn-ghost" onClick={toggle}>
          {open ? '閉じる' : '候補を見る'}
        </button>
      </div>

      {open && (
        <div className="review-body">
          <div className="search-bar">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="検索ワード"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void load(query);
              }}
            />
            <button className="btn-ghost" onClick={() => load(query)} disabled={loading}>
              {loading ? '検索中…' : '再検索'}
            </button>
          </div>

          {error && <p className="msg-error">{error}</p>}

          {candidates && candidates.length === 0 && (
            <p className="muted">候補が見つかりませんでした。検索ワードを変えて再検索してください。</p>
          )}

          {candidates && candidates.length > 0 && (
            <ul className="candidate-list">
              {candidates.map((c) => {
                const busy = busyId === c.jwObjectId;
                const url = c.jwPath
                  ? `https://www.justwatch.com${c.jwPath}`
                  : null;
                return (
                  <li key={c.jwObjectId} className="candidate">
                    <div className="cand-main">
                      <span className="cand-title">{c.title}</span>
                      {c.originalReleaseYear && (
                        <span className="muted">（{c.originalReleaseYear}）</span>
                      )}
                      {c.expiresAt && (
                        <span className="cand-expiry">配信終了 {c.expiresAt}</span>
                      )}
                    </div>
                    {url && (
                      <a className="cand-link" href={url} target="_blank" rel="noreferrer">
                        JustWatch ↗
                      </a>
                    )}
                    <button
                      className="btn-primary"
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

          <div className="review-footer">
            <button
              className="btn-ghost danger"
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
