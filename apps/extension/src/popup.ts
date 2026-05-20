import type {
  SyncWatchlistRequest,
  SyncWatchlistResponse,
} from '@netflix-deadline/shared';
import { scrapeMyList, type ScrapeResult } from './scraper';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

const apiUrlInput = $<HTMLInputElement>('apiUrl');
const tokenInput = $<HTMLInputElement>('token');
const statusEl = $<HTMLPreElement>('status');

const setStatus = (msg: string) => {
  statusEl.textContent = msg;
};

// 初回ロード: 保存済みの設定を復元
chrome.storage.local.get(['apiUrl', 'token']).then((v: Record<string, unknown>) => {
  apiUrlInput.value = (v.apiUrl as string) ?? 'http://localhost:8787';
  tokenInput.value = (v.token as string) ?? '';
});

$<HTMLButtonElement>('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    apiUrl: apiUrlInput.value.trim(),
    token: tokenInput.value.trim(),
  });
  setStatus('設定を保存しました。');
});

$<HTMLButtonElement>('sync').addEventListener('click', async () => {
  const apiUrl = apiUrlInput.value.trim().replace(/\/$/, '');
  const token = tokenInput.value.trim();
  if (!apiUrl || !token) {
    setStatus('API URL とペアリングトークンを入力してください。');
    return;
  }

  setStatus(
    'スクレイピング中...\n（Prime は全件をスクロール収集するため数十秒かかることがあります。\nこのポップアップを閉じないでください）'
  );

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('アクティブなタブが取得できません。');
    return;
  }

  let result: ScrapeResult;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeMyList,
    });
    if (!injection) throw new Error('注入結果が空');
    result = injection.result as ScrapeResult;
  } catch (e) {
    setStatus(
      'スクレイピングに失敗: ' + (e instanceof Error ? e.message : String(e))
    );
    return;
  }

  if (!result.service) {
    setStatus(
      result.diagnostics.note ??
        'Netflix / Prime のマイリストページで実行してください。'
    );
    return;
  }
  if (result.items.length === 0) {
    setStatus(
      `${result.service}: 作品が0件でした。マイリストが空か selector が外れています。`
    );
    return;
  }

  setStatus(
    `スクレイピング: ${result.service} ${result.items.length} 件取得。API に送信中...`
  );

  const payload: SyncWatchlistRequest = {
    service: result.service,
    scrapedAt: result.scrapedAt,
    items: result.items,
  };

  try {
    const res = await fetch(`${apiUrl}/api/watchlist/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      setStatus(`同期エラー HTTP ${res.status}: ${text.slice(0, 300)}`);
      return;
    }
    const json = (await res.json()) as SyncWatchlistResponse;
    setStatus(
      `同期完了\n` +
        `サービス: ${json.service}\n` +
        `受信: ${json.received} 件 / 新規: ${json.added} 件 / 削除: ${json.removed} 件\n` +
        `\n新規がある場合は「突き合わせ」を押して JustWatch で配信終了日を取得してください。`
    );
  } catch (e) {
    setStatus('同期エラー: ' + (e instanceof Error ? e.message : String(e)));
  }
});

interface MatchResp {
  processed: number;
  matched: number;
  unmatched: number;
  errors: number;
  remaining: number;
}

/**
 * pending な作品を JustWatch に突き合わせる。
 * 1回の呼び出しは limit 件までなので、remaining が 0 になるまで繰り返す。
 */
$<HTMLButtonElement>('match').addEventListener('click', async () => {
  const apiUrl = apiUrlInput.value.trim().replace(/\/$/, '');
  const token = tokenInput.value.trim();
  if (!apiUrl || !token) {
    setStatus('API URL とペアリングトークンを入力してください。');
    return;
  }

  let matched = 0;
  let unmatched = 0;
  let errors = 0;
  let calls = 0;

  while (calls < 30) {
    calls++;
    setStatus(
      `JustWatch と突き合わせ中... (バッチ ${calls})\n` +
        `これまで: マッチ ${matched} / 未マッチ ${unmatched} / エラー ${errors}`
    );
    let res: Response;
    try {
      res = await fetch(`${apiUrl}/api/watchlist/match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      setStatus(
        '突き合わせエラー: ' + (e instanceof Error ? e.message : String(e))
      );
      return;
    }
    if (!res.ok) {
      const text = await res.text();
      setStatus(`突き合わせエラー HTTP ${res.status}: ${text.slice(0, 300)}`);
      return;
    }
    const j = (await res.json()) as MatchResp;
    matched += j.matched;
    unmatched += j.unmatched;
    errors += j.errors;

    if (j.processed === 0 || j.remaining === 0) {
      setStatus(
        `突き合わせ完了（${calls} バッチ）\n` +
          `マッチ: ${matched}\n未マッチ: ${unmatched}\nエラー: ${errors}\n` +
          `残り: ${j.remaining}`
      );
      return;
    }
  }
  setStatus(
    `突き合わせ上限に達しました（${calls} バッチ）。` +
      `\nマッチ: ${matched} / 未マッチ: ${unmatched} / エラー: ${errors}\n` +
      `残りがあれば再度「突き合わせ」を押してください。`
  );
});
