/**
 * 日めくりカレンダー「31」ロゴ。
 * サイズ比率は 36px ヘッダー版を基準に等比でスケールする。
 * 大サイズ（>=64px）は角丸 20px＋ソフトシャドウのヒーロー表示。
 */
export function Logo({ size = 36, hero = false }: { size?: number; hero?: boolean }) {
  const radius = size >= 64 ? 20 : 8;
  const band = (size * 10) / 36;
  const fold = (size * 11) / 36;
  const font = (size * 17) / 36;
  return (
    <div
      className={`logo${hero ? ' logo--hero' : ''}`}
      style={{ width: size, height: size, borderRadius: radius }}
      aria-hidden
    >
      <div className="logo__band" style={{ height: band }} />
      <div className="logo__num" style={{ height: size - band, fontSize: font }}>
        31
      </div>
      <div className="logo__fold" style={{ width: fold, height: fold }} />
    </div>
  );
}
