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

## LINE 通知（任意）

LINE Messaging API で公式アカウントを作り、ダイジェストを LINE にも送れるようにする手順。

### 1. LINE 公式アカウントとチャネルを作る

1. <https://developers.line.biz/console/> にログイン。
2. プロバイダーを新規作成（自分の名前など）。
3. プロバイダー配下に **Messaging API チャネル** を作成。
   - チャネル名・アイコン・基本情報を入力。
4. 「Messaging API 設定」タブで:
   - **チャネルアクセストークン（長期）** を発行 → 値をコピー。
   - **応答メッセージ**を OFF、**Webhook** を ON。
   - **Webhook URL** に
     `https://netflix-deadline-api.<your-subdomain>.workers.dev/api/line/webhook` を設定。
   - 「Verify」ボタンで 200 が返ることを確認。
5. 「チャネル基本設定」タブで **チャネルシークレット** をコピー。

### 2. シークレットを Worker に投入

```bash
cd apps/api
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
# → 1. で発行した「チャネルアクセストークン（長期）」を貼る
npx wrangler secret put LINE_CHANNEL_SECRET
# → 1. でコピーした「チャネルシークレット」を貼る
cd ../..
npm run deploy -w @netflix-deadline/api
```

### 3. （任意）公式アカウントの ID を Web に表示

設定画面の手順説明に bot の Basic ID（例 `@123abcde`）を載せたい場合は、
ビルド時に `VITE_LINE_BOT_BASIC_ID` を渡す:

```bash
VITE_LINE_BOT_BASIC_ID="@123abcde" npm run build -w @netflix-deadline/web
```

未設定でも動く（説明文に「ID は管理者にご確認ください」と表示）。

### 4. ユーザー側の手順

1. Web 設定画面の「LINE 連携」で **連携コード** を発行。
2. LINE で公式アカウントを友だち追加 → 案内メッセージが届く。
3. トークに 6 桁コードを送信 → 「連携しました」と返れば完了。
4. 「通知チャンネル」で LINE を ON にする（連携済みになれば自動 ON）。

---

## Alexa 通知（任意・現在は保留）

Alexa の Proactive Events API で「通知センター」にダイジェストを届ける。
Alexa スキル本体（VUI と Lambda）は **このリポジトリ外** で管理する前提。
ここでは Worker 側（送信元）の手順だけ書く。

> **ステータス（2026-07-19 時点）: 保留。**
> Worker 側の送信コード・6桁コード連携・DB・設定 UI は完成し、スキル作成〜
> アカウント連携（LinkCodeIntent）まで動作確認済み。ただし Proactive Events の
> 送信は LWA トークン取得で `invalid_scope` になる。原因は **スキルのマニフェスト
> （skill.json）に Proactive Events の宣言が無い**こと。有効化には以下が必要:
>
> - マニフェストに権限 `alexa::devices:all:notifications:write` を追加
> - `events.publications` に `AMAZON.MessageAlert.Activated`、`endpoint`（Lambda ARN）、
>   `subscriptions`（`SKILL_PROACTIVE_SUBSCRIPTION_CHANGED`）を追加
> - Alexa アプリでスキルの通知を ON
> - 原則としてスキルの認定（certification）申請（開発ステージの自己テストは条件次第）
>
> Alexa-hosted スキルのマニフェストは Console から編集できず ASK CLI が必要。
> 再開時は「ASK CLI セットアップ → skill.json 編集 → 再デプロイ」から。
> 参考: <https://developer.amazon.com/en-US/docs/alexa/smapi/proactive-events-api.html>
>
> 保留中は各ユーザーの `notify_alexa_enabled` を 0 にして週次 cron の無駄な失敗を
> 止めている（メール・LINE の送信には影響しない）。

### 1. Alexa スキルを作る（概要）

詳細は Amazon の Alexa 開発者コンソール（<https://developer.amazon.com/alexa/console/ask>）で。

- カスタムスキルを新規作成。日本語ロケール（ja-JP）。
- 起動名: 例「ネットフリックスデッドライン」。
- 「Proactive Events」のパーミッションを有効化。
- スキルからエンドポイント（Lambda or HTTPS）を設定して、
  ユーザーが発話した 6 桁コードを受け、下の `/api/alexa/link` に転送する。

Lambda（Node.js）例（核となる発話ハンドラだけ）:

```js
async function handleCodeIntent(handlerInput) {
  const code = handlerInput.requestEnvelope.request.intent.slots.code.value;
  const alexaUserId = handlerInput.requestEnvelope.context.System.user.userId;
  await fetch('https://netflix-deadline-api.<your-subdomain>.workers.dev/api/alexa/link', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.ALEXA_LINK_SECRET}`,
    },
    body: JSON.stringify({ code, alexaUserId }),
  });
  return handlerInput.responseBuilder.speak('連携しました').getResponse();
}
```

### 2. クライアント認証情報を取得

開発者コンソールの **「アクセス権限」 → 「Alexa Skill Messaging」** で
`Alexa Client ID` / `Alexa Client Secret` を取得 → コピー。
これは Proactive Events 送信に必要な LWA トークンを取るために使う。

### 3. シークレットを Worker に投入

```bash
cd apps/api
npx wrangler secret put ALEXA_CLIENT_ID
npx wrangler secret put ALEXA_CLIENT_SECRET

# Alexa スキル → API へのリンク要求を認証する共有鍵（強い乱数）
openssl rand -base64 32
npx wrangler secret put ALEXA_LINK_SECRET
# ↑ Lambda 側の env にも同じ値を入れる

cd ../..
npm run deploy -w @netflix-deadline/api
```

### 4. 開発ステージで試したい場合

スキル公開前は `wrangler.jsonc` の `vars` に以下を追加して再デプロイ:

```jsonc
"ALEXA_API_BASE": "https://api.amazonalexa.com/v1/proactiveEvents/stages/development"
```

本番ステージなら未設定のままで OK（既定は `https://api.amazonalexa.com/v1/proactiveEvents`）。

### 5. ユーザー側の手順

1. Web 設定画面の「Alexa 連携」で **連携コード** を発行。
2. Alexa デバイスに「アレクサ、Netflix デッドラインを開いて」（起動名は自分のスキル名）。
3. スキルが「コードを言ってください」と応答。
4. 6 桁コードを発話 → 「連携しました」と返れば完了。
5. 以後ダイジェストが Alexa の通知センターに届く。

> 注: Proactive Events は事前定義スキーマでしか送れないため、現在は
> `AMAZON.MessageAlert.Activated`（新着メッセージ通知）で「○件あります」と通知している。
> 詳細本文を読み上げたい場合はスキル側で別途データ取得 → 発話する設計が必要。

---

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
