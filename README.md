# netflix-deadline

Netflix / Amazon Prime Video の「マイリスト」に登録した作品のうち、
配信終了が近いものを **一覧・カレンダー・週次メール** で把握し、見逃しを防ぐ Web アプリ。

## 現在の状況

設計フェーズ完了 → リスク検証スパイク完了。本体実装はこれから。

### 検証済みのこと（スパイク）

- **`spike-extension/`** — Chrome 拡張でマイリストをスクレイピング取得。
  Netflix 159 件 / Prime 108 件、いずれも全件取得に成功。
  （Prime のウォッチリストは仮想スクロールのため、スクロールしながら逐次収集）
- **`spike-justwatch/`** — JustWatch GraphQL で作品を突き合わせ、配信終了日を取得。
  タイトル一致 ~98%、Netflix・Prime とも実際の配信終了日を取得できることを確認。

スパイクは使い捨ての検証用コード。本体実装時には作り直す。

## v1 アーキテクチャ（予定）

| 構成要素 | 技術 |
|---|---|
| Chrome 拡張機能 | マイリストを取得して Web アプリへ送信（Manifest V3） |
| Web アプリ | 一覧 / カレンダー / 設定（React + Vite + TypeScript） |
| バックエンド | Hono on Cloudflare Workers |
| DB | Cloudflare D1 + Drizzle ORM |
| 配信終了日データ | JustWatch GraphQL |
| 通知 | 週次メールダイジェスト（Cloudflare Cron Triggers + Resend） |

マルチユーザー対応・Google ログイン。詳細な設計判断は確定済み。

## 注意

個人利用・学習目的のプロジェクト。スクレイピングや非公式 API の利用は
各サービスの規約に留意すること。
