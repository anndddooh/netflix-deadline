# netflix-deadline 拡張機能

Netflix / Prime のマイリストを netflix-deadline の API に同期する Chrome 拡張機能。

## ビルド

リポジトリルートで:

```bash
npm install
npm run build -w @netflix-deadline/extension
```

`apps/extension/dist/` にビルド成果物が出力される。

## Chrome への読み込み

1. `chrome://extensions` を開く
2. 右上「デベロッパーモード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」→ `apps/extension/dist` フォルダを選択

## 使い方

1. 拡張アイコン → ポップアップを開く
2. API URL とペアリングトークンを入力して「設定保存」
   - 開発: `http://localhost:8787` / `dev-token-abc123`
3. Netflix マイリスト（`netflix.com/browse/my-list`）または
   Prime ウォッチリスト（`primevideo.com` のウォッチリスト）を開く
4. ポップアップの「マイリストを同期」を押す
   - Prime は仮想スクロールのため自動スクロールで全件収集する（数十秒）

## 開発

```bash
npm run dev -w @netflix-deadline/extension
```

ファイル変更を監視して自動で再ビルドする（ただし Chrome 側は「リロード」を手動で押す必要あり）。
