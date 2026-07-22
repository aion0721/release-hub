# Release Hub

リリース作業のタイムチャート、当日の対応体制、申請物、手順書リンクを社内で共有するWebアプリです。

最初にSystemID、プロジェクト番号、作業日時を持つ親の「リリース作業」を登録し、作業ごとにタイムチャート、当日の体制、申請物、関連リンクを明細として管理します。プロジェクト番号は任意です。入口ではリストと月間カレンダーを切り替え、SystemIDとプロジェクト番号は候補選択またはテキスト入力、作業状態はすべて・未完了・完了で絞り込めます。リストはプロジェクト番号ごとのグループ表示にも切り替えられます。「一覧を更新」でAPIの最新状態を再取得でき、不要なリリース作業は確認モーダルから配下明細ごと削除できます。
作業詳細はID付きの共有URLで直接開けます。同種の作業は、実施日時を指定して工程・体制・申請物・関連リンクをまとめてコピーできます。
タイムチャートはガントを既定表示とし、リスト表示へ切り替えられます。本線とコンチプラン、作業と申請物を区分し、リストではドラッグ＆ドロップで順序を変更できます。作業明細はタイトルと内容を分けて管理し、種別が申請物の場合は申請物、種別が作業の場合は手順書・関連リンクへ任意に紐づけられます。紐づけ名から対象の詳細を直接開け、ガント左側の作業・体制名からも明細モーダルを開けます。担当者は当日体制のメンバーから選択でき、一覧・ガントの開始／完了ボタンでモーダルを開かずに状態と実績日時を更新できます。作業明細の追加時は親作業の作業日と予定時刻を初期表示し、専用の時刻入力と15分・30分・60分の所要時間ボタンで予定を設定できます。各作業には予定開始・終了と実績開始・終了を記録でき、リストとガントで予実を比較できます。ガントには現在時刻を赤い縦線で表示し、タイムチャート内をスクロールしても時間軸ヘッダーを上端へ固定します。
当日体制では、メンバーごとの対応開始・終了日時、電話番号、現地拠点やオンコールなどの場所・待機形態を共通の時間軸で確認できます。新規追加時は親作業の開始日時から8時間を初期表示します。日跨ぎや複数日の予定にも対応し、作業と同様にバーの移動や両端のドラッグで時間を変更できます。フォームの日時矛盾はモーダル内に理由を表示します。
オールインワンのガント表示では、作業と当日体制を同じ時間軸に並べ、各作業を誰がカバーできるか確認できます。
申請種別管理画面では、全作業で共通利用する申請カテゴリ（資源配布、WFなど）を追加・編集・削除できます。カテゴリAPIは汎用の`categories`リソースと`scope`で分類し、申請種別は`scope=approval`として扱います。管理画面に追加のACLはなく、`?view=approval-categories`で直接開けます。申請物の種別はマスタ候補から選択するほか、候補外の文字列も任意入力できます。
申請物は未申請・申請中・回付済・結了済の4段階で管理し、一覧から状態を直接変更できます。申請物と手順書・関連リンクは備考を持ち、URLを後から登録する運用、クリップボード貼り付け、URLエンコードに対応します。一覧から外部リンクを直接開くほか、詳細モーダルで確認・編集・削除できます。タイムチャートと当日体制も編集モーダルから個別削除できます。
ブラウザセッションの初回表示時には、Release Hubのスプラッシュ画像を短時間表示します。

## 仕様・設計資料

- [ドキュメント一覧](docs/README.md)
- [機能仕様書](docs/requirements.md)
- [基本設計書](docs/basic-design.md)
- [API仕様書](docs/api-spec.md)
- [テスト仕様書](docs/test-spec.md)

## 構成

- フロントエンド: React + Vite + TypeScript のSPA
- 共有API: [light-api-server v2](https://github.com/aion0721/light-api-server/tree/v2)（Node.js標準モジュールのみ、依存パッケージ0）
- APIリソース: `/v2/releases`、`/v2/categories`
- データ保存: light-api-serverの `DATA_DIR/releases.json`、`DATA_DIR/categories.json`
- 明細保存は変更したトップレベル項目だけをPATCHし、画面内の連続操作は順番に保存します。申請物や体制の編集で既存Timelineを巻き込んで上書きしません。
- CI: GitLab CIで型検査、テスト、SPAビルド

## ローカル開発

Node.js 20以上が必要です。

```bash
npm ci
npm run dev
```

SPAとv2互換のローカルAPIが同時に起動します。画面は `http://localhost:5173`、APIは `http://localhost:4174` です。個別に起動する場合は、別々のターミナルで `npm run dev:web` と `npm run dev:api` を使用します。

## 本番起動

```bash
npm ci
npm run build
npm start
```

既定では `http://0.0.0.0:3000` でSPAとv2互換APIをまとめて配信します。共有環境ではSPAを静的配信し、`VITE_API_BASE_URL`で別ホストのlight-api-serverを指定できます。

### light-api-server設定例

```json
{
  "port": 3000,
  "resources": ["releases", "categories"],
  "cors": {
    "origin": "https://release-hub.example.jp"
  },
  "https": {
    "enabled": true,
    "keyFile": "./certs/server.key",
    "certFile": "./certs/server.crt"
  }
}
```

SPAのビルド時にはAPIサーバのOriginを指定します。

```bash
VITE_API_BASE_URL=https://api.example.jp npm run build
```

## 環境変数

| 変数 | 既定値 | 用途 |
| --- | --- | --- |
| `PORT` | `3000` | 本番サーバーのポート |
| `HOST` | `0.0.0.0` | Listenアドレス |
| `DATA_DIR` | `./data` | ローカル互換APIの保存先 |
| `CORS_ORIGIN` | 未設定 | ローカル互換APIを別ドメイン公開する場合の許可Origin |
| `VITE_API_BASE_URL` | 未設定 | APIをSPAと別ドメインへ置く場合のURL |
| `VITE_BASE_PATH` | `/` | サブパス配信時のベースパス |

`VITE_API_BASE_URL`は末尾のスラッシュなしで指定します。GitHub PagesなどHTTPSのSPAから接続するAPIもHTTPSにし、light-api-server側のCORSでSPAのOriginを許可してください。

### 既存データの移行

旧 `DATA_DIR/release.json` は、light-api-serverを初めて起動する前に次のコマンドで汎用レコード配列へ変換します。既存の `releases.json` は上書きしません。

```bash
DATA_DIR=./data npm run migrate:data
```

移行後の `releases.json` をlight-api-serverの `DATA_DIR`へ配置してください。

## GitLab

`.gitlab-ci.yml` は型検査とテストを行い、`dist/`、`server/`、`package.json` を7日間の成果物として保存します。社内サーバー固有の配置先が決まったら、既存のデプロイジョブへこの成果物を渡してください。

## GitHub Pagesデモ

`.github/workflows/pages.yml` は `main` 更新時にテストとビルドを実行し、GitHub Pagesへデモ版を公開します。デモ版はサンプルデータを使用し、変更はブラウザを再読み込みするまでの一時的なものです。共有データを永続化する本番運用では、light-api-serverと永続化した `DATA_DIR` を使用してください。

## コンテナ

```bash
docker build -t release-hub .
docker run --rm -p 3000:3000 -v release-hub-data:/app/data release-hub
```
