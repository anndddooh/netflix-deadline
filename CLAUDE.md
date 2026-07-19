# CLAUDE.md

このリポジトリで作業する際の Claude 向けメモ。
配信終了期限の管理・通知アプリ。`apps/web`（React/Vite）+ `apps/api`（Cloudflare Workers + D1）のモノレポ。
詳細な知識は knowledge wiki の `wiki/projects/netflix-deadline.md` に累積している。

<!-- BEGIN claude-knowledge (distill 自動管理 / この外側は温存) -->
## 既知の決定・ハマり所（自動蒸留 / 2026-07-10 更新）

- **デプロイは main push で全自動**: GitHub Actions が typecheck（shared/api/web）→ vite build → Cloudflare Workers デプロイ（約30〜35秒）。手動 `wrangler deploy` は不要。
- **本番 D1 migration は push より先に適用**: 未適用のままコードを push すると、即デプロイされた Worker が存在しないカラムを SELECT して 500 になる。安全な順序: `npm run db:migrate:remote -w @netflix-deadline/api` → `git push`。
- **D1（SQLite）はバインド変数 100 個上限**: `NOT IN (?, ... ×100超)` は `too many SQL variables` で 500。JS 側で差分計算し **80 件ずつチャンク**して `inArray` で処理する。
- **`matchStatus='confirmed'` は自動マッチで上書きしない**: ユーザーが手動確定したマッチは、バッチ refresh で jwObjectId を保持し `expiresAt` のみ更新（`apps/api/src/refresh.ts` に分岐あり）。
- **通知は multi-channel notifier パターン**: `apps/api/src/notifier.ts` の `dispatchDigest` が email/LINE/Alexa を並列・独立 try/catch で実行。LINE/Alexa 連携は 6桁コード（10分有効）ペアリング。
- **LINE の2つの罠**: ① LINE Official Account Manager の「応答メッセージ」は **OFF 必須**（ON だと公式自動応答が先に返り webhook が機能しない）。② Verify は `LINE_CHANNEL_SECRET` 投入**後**に再実行（未設定でも 200 が返るが署名検証は走っていない）。
- **デザインは MIOSAME**（`claude_design/design_handoff_miosame/README.md`、`claude_design/` はコミットしない）: `--bg #111013` / `--accent #e8503f`、Bebas Neue + Zen Kaku Gothic New、モバイルは `@media (max-width:719px)`。
- **モバイル CSS の罠**: グリッドは `1fr` でなく `minmax(0,1fr)`（日本語長タイトルの min-content 汚染防止）。スクロールコンテナには `min-width: 0`、`html/body` に `overflow-x: clip`（iOS Safari の flex column width leak 対策）。
- **定数・ユーティリティの置き場**: サービス名/色 = `apps/web/src/lib/services.ts`、日付 = `apps/web/src/lib/date.ts`。App.tsx と SettingsPanel.tsx の共有定数は循環参照回避のため lib/ に切り出す。
<!-- END claude-knowledge -->

## ステージング環境（staging）

本番と **別 Worker / 別 D1 / 別 URL に完全分離**した検証環境。詳細手順は `docs/DEPLOY.md` の「ステージング環境」節。

- **ブランチ運用**: `develop` push → GitHub Actions（`.github/workflows/deploy-staging.yml`）が `wrangler deploy --env staging` を自動実行。本番は `main`。検証 → 本番昇格は `develop` → `main` マージ。
- **Worker**: `netflix-deadline-api-staging`（https://netflix-deadline-api-staging.annndddddooooooo.workers.dev）／**D1**: `netflix-deadline-db-staging`。本番データは export/import で複製済み。
- **設定は `apps/api/wrangler.jsonc` の `env.staging` ブロック**: wrangler の `vars` / `d1_databases` は**非継承キー**なので staging 側で再定義必須（書かないとバインドが空になる）。`assets` / `main` / `compatibility_date` は継承される。
- **staging は cron 無効**（`env.staging.triggers.crons` は空）＋**通知シークレット未投入**（メール/LINE/Alexa OFF）。staging から実ユーザーへの誤通知・JustWatch 過剰アクセスを防ぐ安全装置。通知まで検証したいときだけ `wrangler secret put <NAME> --env staging` で個別投入。
- **OAuth は本番と同じ Google クライアントを共用**（同じ `GOOGLE_CLIENT_ID`）。`GOOGLE_CLIENT_SECRET` は staging にも別途 `secret put --env staging` が必要で、未投入だと `/auth/google/start` が「OAuth が未設定」を返す。Google Console の Authorized redirect URIs に staging の `/auth/google/callback` 追加も必要。
- **staging 用コマンド**: `npm run deploy:staging` / `npm run db:migrate:remote:staging`（本番同様 migration は push 前に適用）。
