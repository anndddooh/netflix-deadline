# 拡張機能スパイク（使い捨て検証用）

netflix-deadline v1 設計のリスク検証①。「Chrome 拡張で Netflix / Prime の
マイリストから 作品名・ID・残り視聴期間 が取れるか」だけを確かめる使い捨てコード。
本番のモノレポとは無関係。

## 使い方

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパーモード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」→ この `spike-extension` フォルダを選択
4. Netflix のマイリストページを開く: <https://www.netflix.com/browse/my-list>
5. ツールバーの拡張機能アイコンをクリック → 「スクレイピング実行」
6. 結果を確認し、「JSON ダウンロード」で保存
7. Prime Video も同様に、ウォッチリストページを開いて実行
   （<https://www.primevideo.com/> のウォッチリスト）

## 検証の見かた

- `itemCount` … 取れた作品数。マイリストの実件数と一致するか
- `items[].title` … 作品名が正しく取れているか（空・文字化けが無いか）
- `items[].id` … Netflix の数値 ID / Prime の ASIN が取れているか
- `items[].expiryText` … Netflix の「残り視聴期間」表示を拾えたか（無ければ空）
- `diagnostics.firstCardHTML` … selector が外れて 0 件のとき、これを共有すれば
  実 DOM に合わせて selector を調整できる

## 判定

- 作品名と ID が概ね取れる → 設計どおり拡張機能方式（質問1の B）で進められる
- まったく取れない／DOM が複雑すぎる → 手動登録方式（質問1の A）へフォールバック検討
