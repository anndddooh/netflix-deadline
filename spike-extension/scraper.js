// このファイルの関数は chrome.scripting.executeScript の `func` として
// ページ側のコンテキストに注入されて実行される。完全に自己完結させること
// （外部変数を参照しない）。async 関数なので Promise の解決値が結果になる。

async function scrapeMyList() {
  const host = location.hostname;
  const result = {
    scrapedAt: new Date().toISOString(),
    url: location.href,
    host,
    service: null,
    itemCount: 0,
    items: [],
    diagnostics: {},
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // リンクからタイトル文字列を推定（共通）
  const titleOf = (a) => {
    const cand =
      a.getAttribute('aria-label') ||
      (a.querySelector('img[alt]') && a.querySelector('img[alt]').alt) ||
      (a.querySelector('.fallback-text') &&
        a.querySelector('.fallback-text').textContent) ||
      a.textContent ||
      '';
    return cand.trim();
  };

  // ================= Netflix =================
  if (host.includes('netflix.com')) {
    result.service = 'netflix';
    const links = Array.from(
      document.querySelectorAll('a[href*="/watch/"], a[href*="/title/"]')
    );
    const map = new Map();
    for (const a of links) {
      const m = (a.getAttribute('href') || '').match(/\/(?:watch|title)\/(\d+)/);
      if (!m) continue;
      const id = m[1];
      const card =
        a.closest('.title-card, .slider-item, .title-card-container') ||
        a.parentElement;
      let expiryText = '';
      if (card) {
        const em = (card.textContent || '').match(
          /(配信終了|視聴期限|残り|あと)[^\n]{0,24}/
        );
        if (em) expiryText = em[0].trim();
      }
      if (!map.has(id)) {
        map.set(id, { id, title: titleOf(a), href: a.href, expiryText });
      }
    }
    result.items = Array.from(map.values());
    result.diagnostics.matchedLinks = links.length;

  // ============ Amazon Prime Video ============
  // ウォッチリストは仮想スクロール（DOM 上は常時 ~50 件）。
  // 少しずつスクロールしながら、カードが消える前に逐次収集する。
  } else if (host.includes('primevideo.com') || host.includes('amazon.')) {
    result.service = 'prime';
    const map = new Map();

    const collect = () => {
      for (const a of document.querySelectorAll('a[href*="/detail/"]')) {
        const m = (a.getAttribute('href') || '').match(
          /\/detail\/([0-9A-Za-z]{8,})/
        );
        if (!m) continue;
        const id = m[1];
        if (map.has(id)) continue;
        const card = a.closest('article[data-testid="card"], article');
        const title =
          (card && card.getAttribute('data-card-title')) || titleOf(a);
        const entityType = card
          ? card.getAttribute('data-card-entity-type')
          : null;
        map.set(id, { id, title: (title || '').trim(), entityType, href: a.href });
      }
    };

    // スクロール後、描画が落ち着く（DOM が安定する）まで待つ適応待ち。
    // 固定待ちより低速環境に強い。最大 maxMs まで。
    const waitForRender = async (maxMs = 2500) => {
      const deadline = Date.now() + maxMs;
      let prev = -1;
      while (Date.now() < deadline) {
        await sleep(150);
        const n = document.querySelectorAll('a[href*="/detail/"]').length;
        const h = document.documentElement.scrollHeight;
        const sig = n * 100000 + h;
        if (sig === prev) return; // 2 連続で変化なし → 安定
        prev = sig;
      }
    };

    let iterations = 0;
    let stable = 0;
    const startY = window.scrollY; // 実行後に元の位置へ戻すため記録

    // 現在地がページ途中でも取りこぼさないよう、まず最上部へ移動
    window.scrollTo(0, 0);
    await waitForRender();

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
        await sleep(400); // 取りこぼし対策に少し待って再収集
      } else {
        stable = 0;
      }
    }
    collect();
    window.scrollTo(0, startY); // 元のスクロール位置へ戻す

    result.items = Array.from(map.values());
    result.diagnostics.scrollIterations = iterations;
    result.diagnostics.finalScrollHeight =
      document.documentElement.scrollHeight;
  } else {
    result.diagnostics.note =
      'Netflix でも Prime でもないページです。マイリストページで実行してください。';
  }

  result.itemCount = result.items.length;
  return result;
}
