const JW_IMAGES = 'https://images.justwatch.com';

/** JustWatch のポスターサイズ（profile）。数値が大きいほど高解像度。 */
export type PosterSize = 's166' | 's276' | 's332' | 's592' | 's718';

/**
 * JustWatch の posterPath テンプレ（例 '/poster/123/{profile}/slug.{format}'）を
 * 実際の画像 URL に変換する。path が無ければ null。
 */
export function posterImageUrl(
  path: string | null | undefined,
  size: PosterSize = 's332'
): string | null {
  if (!path) return null;
  return JW_IMAGES + path.replace('{profile}', size).replace('{format}', 'jpg');
}

/** <img> の読み込み失敗時にプレースホルダー（親の斜線背景）へフォールバックする。 */
export function hidePosterOnError(
  e: React.SyntheticEvent<HTMLImageElement>
): void {
  e.currentTarget.style.display = 'none';
}
