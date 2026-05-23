# 本番デプロイ手順（Cloudflare Workers）

API（Hono）と Web SPA を**1つの Worker**で配信する構成:

- `/api/*`、`/auth/*` → Worker のハンドラ（Hono）
- それ以外 → 静的アセット（`apps/web/dist`、SPA フォールバックあり）
- D1（SQLite）と Cron Triggers を同 Worker に同居

## 前提

- Cloudflare アカウント（無料枠で OK）
- Node 22 以上、npm 10 以上
- `gh` / `wrangler` がインストール済み

## 手順

リポジトリのルートで実行する。

### 1. Cloudflare にログイン

```bash
npx wrangler login
```

ブラウザが開いて Cloudflare の OAuth 同意画面が出る。承認するとローカルに認証情報が保存される。

### 2. リモート D1 データベースを作成

```bash
npx wrangler --config apps/api/wrangler.jsonc d1 create netflix-deadline-db
```

出力に `database_id = "xxxxxxxx-..."` が含まれる。この値をコピー。

### 3. wrangler.jsonc に database_id を反映

`apps/api/wrangler.jsonc` の `d1_databases[0].database_id` を、上で得た本物の ID に書き換える（`local-placeholder-...` を置換）。

### 4. リモート D1 にマイグレーション適用

```bash
npm run db:migrate:remote -w @netflix-deadline/api
```

確認プロンプトには `y` で進む。

### 5. シークレットを設定

機密値を `wrangler secret put` で投入する（プロンプトで値を貼り付け）。

```bash
cd apps/api

# Resend API キー
npx wrangler secret put RESEND_API_KEY
# 値: .dev.vars にあるものと同じ（必要なら再生成）

# Google OAuth クライアントシークレット
npx wrangler secret put GOOGLE_CLIENT_SECRET
# 値: Google Cloud Console から取得した GOCSPX-... を貼る

# セッション署名鍵（本番は強い乱数を必ず使う）
openssl rand -base64 48
# ↑ で出力された値をコピーして:
npx wrangler secret put SESSION_SECRET

cd ../..
```

### 6. 初回デプロイ

```bash
npm run deploy -w @netflix-deadline/api
```

実行内容:
- `apps/web` の `npm run build` が走り `dist/` が生成される
- `wrangler deploy` で Worker がアップロードされる

出力例:
```
Uploaded netflix-deadline-api (1.23 sec)
Deployed netflix-deadline-api triggers (0.45 sec)
  https://netflix-deadline-api.<your-subdomain>.workers.dev
  schedule: 0 * * * *
  schedule: 0 23 * * *
```

**この URL（`https://netflix-deadline-api.<your-subdomain>.workers.dev`）をメモ。**

### 7. URL 依存の環境変数を追記して再デプロイ

`apps/api/wrangler.jsonc` の `vars` セクションに以下を追加:

```jsonc
"vars": {
  "EMAIL_FROM": "onboarding@resend.dev",
  "GOOGLE_CLIENT_ID": "...",
  "OAUTH_REDIRECT_URI": "https://netflix-deadline-api.<your-subdomain>.workers.dev/auth/google/callback",
  "WEB_BASE": "https://netflix-deadline-api.<your-subdomain>.workers.dev/"
}
```

再デプロイ:

```bash
npm run deploy -w @netflix-deadline/api
```

### 8. Google OAuth クライアントの Redirect URI を追加

<https://console.cloud.google.com/apis/credentials> → OAuth クライアント編集 → Authorized redirect URIs に追加:

```
https://netflix-deadline-api.<your-subdomain>.workers.dev/auth/google/callback
```

「Save」。

### 9. 動作確認

ブラウザで:

```
https://netflix-deadline-api.<your-subdomain>.workers.dev/
```

を開き、「Google でログイン」→ 認可 → 戻ってくることを確認。

初回は新規ユーザーになる（マイリスト 0 件）。

### 10. 拡張機能を本番接続

Chrome 拡張機能のポップアップで:

- **API URL**: `https://netflix-deadline-api.<your-subdomain>.workers.dev`
- **ペアリングトークン**: 本番 Web にログイン後、`/auth/me` の `extensionToken` を確認して貼る
  - 例: `curl https://netflix-deadline-api.<your-subdomain>.workers.dev/auth/me --cookie "nd_session=..."`
  - または将来的に Web の設定画面に表示するように追加する

「設定保存」→ Netflix / Prime のマイリストページで「同期」→「突き合わせ」（または cron 待ち）。

## 補足

### secrets を一度に確認

```bash
cd apps/api && npx wrangler secret list
```

### cron の発火確認（本番）

```bash
npx wrangler --config apps/api/wrangler.jsonc tail
```

毎時0分／毎日 23:00 UTC のログを観察。

### D1 の内容確認（本番）

```bash
npx wrangler --config apps/api/wrangler.jsonc d1 execute netflix-deadline-db --remote \
  --command "SELECT COUNT(*) FROM watchlist_items;"
```
