// マイリスト作品を JustWatch のエントリに突き合わせ、配信終了日を求める。

import type { StreamingService } from '@netflix-deadline/shared';
import { searchTitles, type JwNode } from './justwatch';

/** 比較用のタイトル正規化（全角数字・括弧・記号・空白のゆれを吸収） */
export function normalizeTitle(s: string): string {
  return (s ?? '')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[\s　・･:：/／\-‐－―]/g, '')
    .toLowerCase()
    .trim();
}

/** 検索クエリ用にノイズ（括弧・シーズン表記）を軽く落とす */
function stripForQuery(s: string): string {
  return s
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[-‐－―]\s*シーズン.*$/g, '')
    .trim();
}

/** サービスごとの「配信終了日を見るべき package」判定 */
const isServicePackage: Record<StreamingService, (tech: string) => boolean> = {
  // 通常版・広告つき版は同じ作品＝同じ終了日
  netflix: (t) => t === 'netflix' || t === 'netflixbasicwithads',
  // Prime 本体および Amazon の各チャンネル（アニメタイムズ等）
  prime: (t) => t.startsWith('amazon'),
};

export interface MatchResult {
  jwObjectId: string | null;
  jwTitle: string | null;
  jwPath: string | null;
  /** 配信終了日 'YYYY-MM-DD'。未判明なら null */
  expiresAt: string | null;
  matchStatus: 'matched' | 'unmatched';
}

const UNMATCHED: MatchResult = {
  jwObjectId: null,
  jwTitle: null,
  jwPath: null,
  expiresAt: null,
  matchStatus: 'unmatched',
};

/** JustWatch ノードから、対象サービスの配信終了日（最も早いもの）を取り出す */
function extractExpiry(node: JwNode, service: StreamingService): string | null {
  const matches = isServicePackage[service];
  const dates = (node.offers ?? [])
    .filter(
      (o) =>
        o.monetizationType === 'FLATRATE' &&
        o.package != null &&
        matches(o.package.technicalName)
    )
    .map((o) => o.availableTo)
    .filter((d): d is string => d != null)
    .sort();
  return dates[0] ?? null;
}

/** 1作品を JustWatch に突き合わせる */
export async function matchItem(input: {
  service: StreamingService;
  title: string;
}): Promise<MatchResult> {
  const queryTitle =
    input.service === 'prime' ? stripForQuery(input.title) : input.title;
  const nodes = await searchTitles(queryTitle);
  if (nodes.length === 0) return UNMATCHED;

  const want = normalizeTitle(input.title);
  const node =
    nodes.find((n) => normalizeTitle(n.content?.title ?? '') === want) ??
    nodes[0]!;

  return nodeToResult(node, input.service);
}

/** 検索クエリ用にタイトルを整える（マッチ確認UIから利用） */
export function buildSearchQuery(service: StreamingService, title: string): string {
  return service === 'prime' ? stripForQuery(title) : title;
}

/** 1ノードをサービス文脈の MatchResult に変換 */
export function nodeToResult(node: JwNode, service: StreamingService): MatchResult {
  return {
    jwObjectId: node.id,
    jwTitle: node.content?.title ?? null,
    jwPath: node.content?.fullPath ?? null,
    expiresAt: extractExpiry(node, service),
    matchStatus: 'matched',
  };
}

export { extractExpiry };
