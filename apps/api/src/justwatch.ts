// JustWatch GraphQL クライアント。
// スパイク（spike-justwatch）で実証したクエリを本番用に移植したもの。

const JW_ENDPOINT = 'https://apis.justwatch.com/graphql';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SEARCH_QUERY = `
query Search($filter: TitleFilter!, $country: Country!, $language: Language!, $first: Int!, $offerFilter: OfferFilter!) {
  popularTitles(country: $country, filter: $filter, first: $first, sortBy: POPULAR) {
    edges { node {
      id
      objectId
      objectType
      content(country: $country, language: $language) {
        title
        originalReleaseYear
        posterUrl
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

export interface JwOffer {
  monetizationType: string;
  /** 配信終了日 'YYYY-MM-DD'。未設定なら null */
  availableTo: string | null;
  standardWebURL: string | null;
  package: { technicalName: string } | null;
}

export interface JwNode {
  /** GraphQL ノードID（再問い合わせに使える） */
  id: string;
  objectId: number;
  objectType: string;
  content: {
    title: string | null;
    originalReleaseYear: number | null;
    /** ポスター画像のテンプレパス（例 '/poster/123/{profile}/slug.{format}'）。
     *  実URL = 'https://images.justwatch.com' + posterUrl の {profile}/{format} を置換。 */
    posterUrl: string | null;
    fullPath: string | null;
  } | null;
  offers: JwOffer[] | null;
}

interface JwResponse {
  data?: { popularTitles?: { edges?: { node: JwNode }[] } };
  errors?: unknown;
}

/** タイトル文字列で JustWatch（日本リージョン）を検索する。 */
export async function searchTitles(query: string): Promise<JwNode[]> {
  const res = await fetch(JW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      query: SEARCH_QUERY,
      variables: {
        filter: { searchQuery: query },
        country: 'JP',
        language: 'ja',
        first: 6,
        offerFilter: {},
      },
    }),
  });
  if (!res.ok) throw new Error(`JustWatch HTTP ${res.status}`);
  const json = (await res.json()) as JwResponse;
  if (json.errors) {
    throw new Error(
      'JustWatch GraphQL error: ' + JSON.stringify(json.errors).slice(0, 200)
    );
  }
  return (json.data?.popularTitles?.edges ?? []).map((e) => e.node);
}
