const runBtn = document.getElementById('run');
const dlBtn = document.getElementById('download');
const out = document.getElementById('out');
const summary = document.getElementById('summary');

let lastResult = null;

runBtn.addEventListener('click', async () => {
  summary.textContent = '';
  out.textContent =
    '実行中...\n（Prime は全件をスクロール収集するため数十秒かかることがあります。' +
    'このポップアップを閉じないでください）';
  dlBtn.disabled = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    out.textContent = 'アクティブなタブが取得できませんでした。';
    return;
  }

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeMyList, // scraper.js で定義
    });
    lastResult = injection.result;
    const r = lastResult;
    summary.textContent =
      `サービス: ${r.service ?? '不明'}\n` +
      `取得件数: ${r.itemCount}\n` +
      `マッチしたリンク数: ${r.diagnostics.matchedLinks ?? '-'}`;
    out.textContent = JSON.stringify(r, null, 2);
    dlBtn.disabled = r.itemCount === 0 && !r.diagnostics.firstCardHTML;
  } catch (e) {
    out.textContent =
      'エラー: ' +
      (e && e.message ? e.message : String(e)) +
      '\n\nNetflix / Prime のページ上で実行しているか確認してください。';
  }
});

dlBtn.addEventListener('click', () => {
  if (!lastResult) return;
  const blob = new Blob([JSON.stringify(lastResult, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mylist-${lastResult.service || 'unknown'}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
