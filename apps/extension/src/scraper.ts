// chrome.scripting.executeScript({ func }) でページ側に注入されるスクレイパー。
// **完全に自己完結させること**（モジュール外への参照禁止）。
// スパイク（spike-extension/scraper.js）で実証済みのロジックを TypeScript に移植。

import type { ScrapedItem, StreamingService } from '@netflix-deadline/shared';

export interface ScrapeResult {
  service: StreamingService | null;
  scrapedAt: string;
  items: ScrapedItem[];
  diagnostics: {
    matchedLinks?: number;
    scrollIterations?: number;
    note?: string;
  };
}

export async function scrapeMyList(): Promise<ScrapeResult> {
  const host = location.hostname;
  const result: ScrapeResult = {
    service: null,
    scrapedAt: new Date().toISOString(),
    items: [],
    diagnostics: {},
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // リンクからタイトルを推定（aria-label → img alt → .fallback-text → textContent）
  const titleOf = (a: Element): string => {
    const aria = a.getAttribute('aria-label');
    if (aria) return aria.trim();
    const img = a.querySelector('img[alt]');
    if (img) {
      const alt = (img as HTMLImageElement).alt;
      if (alt) return alt.trim();
    }
    const fb = a.querySelector('.fallback-text');
    if (fb && fb.textContent) return fb.textContent.trim();
    return (a.textContent ?? '').trim();
  };

  // ================= Netflix =================
  if (host.includes('netflix.com')) {
    result.service = 'netflix';
    const links = Array.from(
      document.querySelectorAll('a[href*="/watch/"], a[href*="/title/"]')
    );
    const map = new Map<string, ScrapedItem>();
    for (const a of links) {
      const m = (a.getAttribute('href') ?? '').match(/\/(?:watch|title)\/(\d+)/);
      if (!m || !m[1]) continue;
      const id = m[1];
      if (!map.has(id)) {
        map.set(id, {
          service: 'netflix',
          externalId: id,
          title: titleOf(a),
        });
      }
    }
    result.items = Array.from(map.values());
    result.diagnostics.matchedLinks = links.length;
    return result;
  }

  // ============ Amazon Prime Video ============
  // ウォッチリストは仮想スクロール（DOM 上は常時 ~50 件）。
  // 最上部から少しずつスクロールしながら、カードが破棄される前に逐次収集する。
  if (host.includes('primevideo.com') || host.includes('amazon.')) {
    result.service = 'prime';
    const map = new Map<string, ScrapedItem>();

    const collect = () => {
      for (const a of document.querySelectorAll('a[href*="/detail/"]')) {
        const m = (a.getAttribute('href') ?? '').match(
          /\/detail\/([0-9A-Za-z]{8,})/
        );
        if (!m || !m[1]) continue;
        const id = m[1];
        if (map.has(id)) continue;
        const card = a.closest('article[data-testid="card"], article');
        const titleAttr = card?.getAttribute('data-card-title');
        const title = (titleAttr && titleAttr.trim()) || titleOf(a);
        const entityType = card?.getAttribute('data-card-entity-type') ?? null;
        map.set(id, {
          service: 'prime',
          externalId: id,
          title,
          entityType,
        });
      }
    };

    // 描画が落ち着くまで待つ適応待ち（最大 maxMs）
    const waitForRender = async (maxMs = 2500) => {
      const deadline = Date.now() + maxMs;
      let prev = -1;
      while (Date.now() < deadline) {
        await sleep(150);
        const n = document.querySelectorAll('a[href*="/detail/"]').length;
        const h = document.documentElement.scrollHeight;
        const sig = n * 100000 + h;
        if (sig === prev) return;
        prev = sig;
      }
    };

    const startY = window.scrollY;
    window.scrollTo(0, 0);
    await waitForRender();

    let iterations = 0;
    let stable = 0;
    for (let i = 0; i < 500; i++) {
      iterations = i + 1;
      collect();
      const before = map.size;
      window.scrollBy(0, Math.round(window.innerHeight * 0.85));
      await waitForRender();
      collect();
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 150;
      if (map.size === before && atBottom) {
        stable++;
        if (stable >= 3) break;
        await sleep(400);
      } else {
        stable = 0;
      }
    }
    collect();
    window.scrollTo(0, startY);

    result.items = Array.from(map.values());
    result.diagnostics.scrollIterations = iterations;
    return result;
  }

  result.diagnostics.note =
    'Netflix でも Prime でもないページです。マイリストページで実行してください。';
  return result;
}
