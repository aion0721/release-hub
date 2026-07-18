# Release Hub

リリース作業のタイムチャート、当日の対応体制、申請物、手順書リンクを社内で共有するWebアプリです。

最初に親となる「リリース作業」を登録し、作業ごとにタイムチャート、当日の体制、申請物、関連リンクを明細として管理します。
タイムチャートは従来のリスト表示と、開始・終了日時を横軸にしたガント表示を切り替えられます。本線とコンチプランを区分し、リストではドラッグ＆ドロップで順序を変更できます。
当日体制では、メンバーごとの対応開始・終了日時、電話番号、現地拠点やオンコールなどの場所・待機形態を共通の時間軸で確認できます。日跨ぎや複数日の予定にも対応します。
タイムチャートの「統合」表示では、作業と当日体制を同じ時間軸に並べ、各作業を誰がカバーできるか確認できます。
申請物と手順書・関連リンクは、一覧から詳細モーダルを開き、内容を確認してから対象リンクへ移動できます。
ブラウザセッションの初回表示時には、Release Hubのスプラッシュ画像を短時間表示します。

## 構成

- フロントエンド: React + Vite + TypeScript のSPA
- 共有API: Node.js標準モジュールのみ
- データ保存: `DATA_DIR/release.json`
- CI: GitLab CIで型検査、テスト、SPAビルド

## ローカル開発

Node.js 20以上が必要です。

```bash
npm ci
npm run dev:api
```

別のターミナルで以下を実行します。

```bash
npm run dev
```

画面は `http://localhost:5173`、APIは `http://localhost:4174` で起動します。Viteの開発サーバーが `/api` を自動転送します。

## 本番起動

```bash
npm ci
npm run build
npm start
```

既定では `http://0.0.0.0:3000` でSPAとAPIをまとめて配信します。

## 環境変数

| 変数 | 既定値 | 用途 |
| --- | --- | --- |
| `PORT` | `3000` | 本番サーバーのポート |
| `HOST` | `0.0.0.0` | Listenアドレス |
| `DATA_DIR` | `./data` | 共有データの保存先 |
| `CORS_ORIGIN` | 未設定 | APIを別ドメイン公開する場合の許可Origin |
| `VITE_API_BASE_URL` | 未設定 | APIをSPAと別ドメインへ置く場合のURL |
| `VITE_BASE_PATH` | `/` | サブパス配信時のベースパス |

`DATA_DIR` は永続ボリュームへ割り当ててください。認証は社内のリバースプロキシまたはSSOで行い、認証済みメールを `x-auth-request-email` に渡すと最終更新者へ記録されます。

## GitLab

`.gitlab-ci.yml` は型検査とテストを行い、`dist/`、`server/`、`package.json` を7日間の成果物として保存します。社内サーバー固有の配置先が決まったら、既存のデプロイジョブへこの成果物を渡してください。

## GitHub Pagesデモ

`.github/workflows/pages.yml` は `main` 更新時にテストとビルドを実行し、GitHub Pagesへデモ版を公開します。デモ版はサンプルデータを使用し、変更はブラウザを再読み込みするまでの一時的なものです。共有データを永続化する本番運用では、引き続きNode APIと `DATA_DIR` を使用してください。

## コンテナ

```bash
docker build -t release-hub .
docker run --rm -p 3000:3000 -v release-hub-data:/app/data release-hub
```
