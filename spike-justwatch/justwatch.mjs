// JustWatch 突き合わせ検証スパイク（使い捨て）
//
// netflix-deadline v1 設計のリスク検証②。マイリストのサンプル作品を
// JustWatch GraphQL に投げ、(1) タイトル検索のヒット率、(2) Netflix/Prime
// offer の取得可否、(3) 配信終了日 availableTo の充足率、(4) ID 照合の可否
// を実測する。本番のモノレポとは無関係。
//
// 実行: node justwatch.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENDPOINT = 'https://apis.justwatch.com/graphql';

// JustWatch GraphQL（公式の検索クエリを最小限に削ったもの）
const QUERY = `
query Search(
  $filter: TitleFilter!
  $country: Country!
  $language: Language!
  $first: Int!
  $offerFilter: OfferFilter!
) {
  popularTitles(country: $country, filter: $filter, first: $first, sortBy: POPULAR) {
    edges {
      node {
        ...T
      }
    }
  }
}
fragment T on MovieOrShowOrSeasonOrEpisode {
  objectType
  content(country: $country, language: $language) {
    title
    originalReleaseYear
    ... on MovieOrShowOrSeasonContent {
      fullPath
    }
  }
  offers(country: $country, platform: WEB, filter: $offerFilter) {
    monetizationType
    availableTo
    standardWebURL
    package {
      clearName
      technicalName
    }
  }
}
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 比較用のタイトル正規化（括弧・シーズン表記・字幕版などのノイズを除去）
function normalize(s) {
  return (s || '')
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[-‐－―]\s*シーズン.*$/g, '')
    .replace(/\s*第[0-9０-９一二三四五六七八九十]+期.*$/g, '')
    .replace(/字幕版|吹替版|デジタルリマスター版|オンエア版/g, '')
    .replace(/[\s　・･:：/／-]/g, '')
    .toLowerCase()
    .trim();
}

// 検索クエリ用にノイズを軽く落とす
function stripForQuery(title) {
  return title
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[-‐－―]\s*シーズン.*$/g, '')
    .trim();
}

async function search(title) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
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
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error('GraphQL: ' + JSON.stringify(json.errors).slice(0, 400));
  }
  return (json.data?.popularTitles?.edges || []).map((e) => e.node);
}

// service に対応する JustWatch の package technicalName 判定
function isServicePackage(service, tech) {
  tech = (tech || '').toLowerCase();
  if (service === 'netflix') return tech === 'netflix';
  // Prime Video（レンタル/購入の amazonvideo は除外し、見放題のみ対象）
  return tech === 'amazonprimevideo' || tech === 'amazonprime';
}

const sample = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'sample.json'), 'utf8')
);

const results = [];

for (const item of sample) {
  const queryTitle =
    item.service === 'prime' ? stripForQuery(item.title) : item.title;

  const row = {
    service: item.service,
    scrapedId: item.id,
    scrapedTitle: item.title,
    queryTitle,
    error: null,
    jwTitle: null,
    jwYear: null,
    jwPath: null,
    titleExact: false,
    platformOffer: false,
    availableTo: null,
    idMatched: false,
    allOffers: [],
  };

  try {
    const nodes = await search(queryTitle);
    const wantN = normalize(item.title);

    // 正規化タイトル一致のノードを優先、無ければ先頭（人気順）
    let match =
      nodes.find((n) => normalize(n.content?.title) === wantN) || nodes[0];

    if (match) {
      row.jwTitle = match.content?.title ?? null;
      row.jwYear = match.content?.originalReleaseYear ?? null;
      row.jwPath = match.content?.fullPath ?? null;
      row.titleExact = normalize(match.content?.title) === wantN;

      const offers = match.offers || [];
      row.allOffers = offers.map((o) => ({
        package: o.package?.technicalName,
        monet: o.monetizationType,
        availableTo: o.availableTo,
      }));

      const svcOffers = offers.filter((o) =>
        isServicePackage(item.service, o.package?.technicalName)
      );
      row.platformOffer = svcOffers.length > 0;

      // availableTo は見放題(FLATRATE)優先で拾う
      const flat = svcOffers.find((o) => o.monetizationType === 'FLATRATE');
      const pick = flat || svcOffers[0];
      if (pick) {
        row.availableTo = pick.availableTo ?? null;
        const url = pick.standardWebURL || '';
        row.idMatched = url.includes(item.id);
      }
    }
  } catch (e) {
    row.error = e.message;
  }

  results.push(row);
  const mark = row.error
    ? '✗ ' + row.error
    : `match=${row.jwTitle ?? '(なし)'}` +
      ` exact=${row.titleExact ? 'Y' : 'n'}` +
      ` ${item.service}offer=${row.platformOffer ? 'Y' : 'n'}` +
      ` availableTo=${row.availableTo ?? '-'}` +
      ` idMatch=${row.idMatched ? 'Y' : 'n'}`;
  console.log(`[${item.service}] ${item.title}\n    ${mark}`);

  await sleep(350); // レート制限への配慮
}

// ---- サマリー ----
const n = results.length;
const ok = (f) => results.filter(f).length;
console.log('\n========== サマリー ==========');
console.log(`サンプル件数            : ${n}`);
console.log(`JustWatch でヒット      : ${ok((r) => r.jwTitle)} / ${n}`);
console.log(`タイトル完全一致        : ${ok((r) => r.titleExact)} / ${n}`);
console.log(
  `対象サービスの offer あり: ${ok((r) => r.platformOffer)} / ${n}`
);
console.log(`availableTo（終了日）あり: ${ok((r) => r.availableTo)} / ${n}`);
console.log(`ID 照合成立              : ${ok((r) => r.idMatched)} / ${n}`);
console.log(`エラー                  : ${ok((r) => r.error)} / ${n}`);
console.log(
  '\n注: availableTo は「もうすぐ配信終了」が判明している作品にしか入りません。' +
    '\n    マイリストの大半は終了予定が無いため null が多くて正常です。' +
    '\n    ここで見たいのは「offer が取れること＝終了日が入れば拾える配管」と' +
    '\n    「ID 照合の成立率」です。'
);

fs.writeFileSync(
  path.join(__dirname, 'result.json'),
  JSON.stringify(results, null, 2)
);
console.log('\n詳細を result.json に書き出しました。');
