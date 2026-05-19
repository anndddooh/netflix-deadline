// Netflix 配信終了日カバレッジ検証スパイク（使い捨て）
//
// 「animephilia の Netflix 配信終了カレンダー」に載っている＝確実に Netflix から
// 配信終了する作品を、JustWatch に問い合わせる。JustWatch の netflix offer に
// availableTo（終了日）が入っているかを実測し、JustWatch が日本の Netflix
// 配信終了日をどれだけ持っているかを判定する。
//
// 実行: node netflix-coverage.mjs

const JW_ENDPOINT = 'https://apis.justwatch.com/graphql';
const ANI_AJAX = 'https://animephilia.net/wp-admin/admin-ajax.php';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const QUERY = `
query Search($filter: TitleFilter!, $country: Country!, $language: Language!, $first: Int!, $offerFilter: OfferFilter!) {
  popularTitles(country: $country, filter: $filter, first: $first, sortBy: POPULAR) {
    edges { node {
      objectType
      content(country: $country, language: $language) {
        title
        originalReleaseYear
        ... on MovieOrShowOrSeasonContent { fullPath }
      }
      offers(country: $country, platform: WEB, filter: $offerFilter) {
        monetizationType
        availableTo
        standardWebURL
        package { technicalName }
      }
    } }
  }
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (s) =>
  (s || '')
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[\s　・･:：/／-]/g, '')
    .toLowerCase()
    .trim();

async function jwSearch(title) {
  const res = await fetch(JW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        filter: { searchQuery: title },
        country: 'JP',
        language: 'ja',
        first: 6,
        offerFilter: {},
      },
    }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 200));
  return (json.data?.popularTitles?.edges || []).map((e) => e.node);
}

// --- 1. animephilia から「Netflix 配信終了予定」を取得 ---
const aniRes = await fetch(ANI_AJAX, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': UA,
  },
  body: new URLSearchParams({
    action: 'get_svod_calendar_events',
    service: 'netflix',
    type: 'ex',
    genre: 'all',
    path: '/netflix-expiring-calendar/',
    nonce: 'edfa89cbde', // 失効したら animephilia のページから取り直す
  }),
});
const byDate = await aniRes.json();
const events = [];
for (const [date, list] of Object.entries(byDate)) {
  for (const e of list) {
    const m = (e.url || '').match(/title\/(\d+)/);
    events.push({ title: e.title, leaveDate: date, netflixId: m ? m[1] : null });
  }
}
console.log(`animephilia の Netflix 配信終了予定: ${events.length} 件取得\n`);

if (events.length === 0) {
  console.log('イベントが0件。nonce 失効の可能性。ページから取り直してください。');
  process.exit(1);
}

// 範囲全体に散るよう間引いて最大15件サンプル
const step = Math.max(1, Math.ceil(events.length / 15));
const sample = events.filter((_, i) => i % step === 0).slice(0, 15);

// --- 2. 各作品を JustWatch に問い合わせ ---
let hit = 0;
let netflixOfferFound = 0;
let availableToFound = 0;
let dateMatched = 0;

for (const ev of sample) {
  let line = `[終了 ${ev.leaveDate}] ${ev.title}`;
  try {
    const nodes = await jwSearch(ev.title);
    const want = normalize(ev.title);
    const match = nodes.find((n) => normalize(n.content?.title) === want) || nodes[0];
    if (!match) {
      console.log(line + '\n    JustWatch ヒットせず');
      await sleep(350);
      continue;
    }
    hit++;
    const nfOffers = (match.offers || []).filter(
      (o) => o.package?.technicalName === 'netflix'
    );
    const withDate = nfOffers.find((o) => o.availableTo);
    if (nfOffers.length) netflixOfferFound++;
    if (withDate) {
      availableToFound++;
      if (withDate.availableTo === ev.leaveDate) dateMatched++;
    }
    line +=
      `\n    JW: ${match.content?.title}` +
      ` / netflix offer=${nfOffers.length ? 'Y' : 'n'}` +
      ` / JWの終了日=${withDate ? withDate.availableTo : '(なし)'}` +
      (withDate
        ? withDate.availableTo === ev.leaveDate
          ? ' [一致]'
          : ' [日付ズレ]'
        : '');
    console.log(line);
  } catch (e) {
    console.log(line + '\n    エラー: ' + e.message);
  }
  await sleep(350);
}

console.log('\n========== Netflix カバレッジ判定 ==========');
console.log(`検証件数（確実に Netflix 終了予定）: ${sample.length}`);
console.log(`JustWatch でヒット                  : ${hit}`);
console.log(`netflix offer が存在                : ${netflixOfferFound}`);
console.log(`JustWatch が終了日を保持            : ${availableToFound} / ${sample.length}`);
console.log(`終了日が animephilia と一致         : ${dateMatched}`);
console.log(
  '\n→ 「JustWatch が終了日を保持」が低ければ、Netflix の配信終了日は' +
    '\n  JustWatch では取れず、animephilia 等の専用ソースが必要という結論になる。'
);
