# Release Hub API仕様書

## 1. 概要

Release Hubは共有APIとしてlight-api-server v2の汎用REST APIを利用する。Release Hub固有のエンドポイントやサーバーロジックは追加せず、SPAのAPIアダプターが汎用レコードと画面用データを相互変換する。

- API実装: `aion0721/light-api-server` の `v2` タグ
- 実行時依存パッケージ: 0
- リソース名: `releases`
- ベースURL: ビルド時の `VITE_API_BASE_URL`
- 永続化: light-api-serverの `DATA_DIR/releases.json`

ローカル開発と単体コンテナ用の `server/main.mjs` も同じ主要API契約を実装する。

## 2. 接続設定

```env
VITE_API_BASE_URL=https://api.example.jp
```

未設定の場合はSPAと同じOriginへ接続する。末尾のスラッシュはAPIクライアントが除去する。

light-api-serverの設定例:

```json
{
  "resources": ["releases"],
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

## 3. 共通仕様

| 項目 | 仕様 |
| --- | --- |
| Content-Type | `application/json; charset=utf-8` |
| 文字コード | UTF-8 |
| ID | light-api-serverがトップレベルの `id` を自動採番 |
| キャッシュ | `Cache-Control: no-store` |
| CORS | light-api-serverの `cors` 設定に従う |
| HTTPS | light-api-serverの証明書ファイル設定に従う |
| 最大ボディ | 既定1,000,000バイト。API設定で変更可能 |

日時形式:

| 用途 | 形式 | 例 |
| --- | --- | --- |
| 親作業日時 | `YYYY-MM-DD HH:mm` | `2026-08-01 22:00` |
| 明細・体制日時 | `YYYY-MM-DDTHH:mm` | `2026-08-01T22:30` |
| 申請期限 | `YYYY-MM-DD` | `2026-08-01` |
| `updatedAt` | ISO 8601または画面生成の日時文字列 | `2026-08-01T13:00:00.000Z` |

## 4. ReleaseRecord

light-api-serverへ保存する単位は、トップレベルIDを持つ `ReleaseRecord` である。

```json
{
  "id": 1,
  "release": {
    "id": 1,
    "systemId": "PAYMENT",
    "name": "決済基盤アップデート",
    "version": "v2.8.0",
    "releaseDate": "2026-07-24 22:00",
    "environment": "Production",
    "status": "準備中",
    "manager": "田中",
    "updatedBy": "田中",
    "updatedAt": "2026-07-21T01:00:00.000Z"
  },
  "timeline": [],
  "staffing": [],
  "approvals": [],
  "links": []
}
```

- トップレベルの `id` がAPI上の正規IDである。
- SPAは受信時に `release.id` をトップレベルの `id`へ揃える。
- SPAは保存時に `release.id` と同じトップレベル `id`を付ける。
- 一覧用の進捗、作業件数、申請件数はSPAがReleaseRecordから計算する。
- `updatedAt`はSPAが保存操作時に更新する。
- `updatedBy`は新規登録時に責任者を初期値とする。利用者識別が必要な場合は認証基盤側で別途設計する。
- `release.version`は任意で、未設定時は空文字を保存する。
- 申請リンクと関連リンクのURLは任意で、未登録時は空文字を保存する。
- 申請状態は未申請／申請中／回付済／結了済。旧「承認済み」はSPAで「結了済」へ読み替える。

## 5. エンドポイント一覧

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/health` | APIサーバーの稼働確認 |
| GET | `/v2/releases` | 全ReleaseRecord取得 |
| POST | `/v2/releases` | ReleaseRecord作成 |
| GET | `/v2/releases/:id` | 1件取得 |
| PUT | `/v2/releases/:id` | 1件全置換 |
| DELETE | `/v2/releases/:id` | 親作業と配下明細を削除 |
| OPTIONS | 任意 | CORSプリフライト |

light-api-server自体はPATCHとクエリ絞り込みも提供するが、現行Release Hubの画面は使用しない。一覧のSystemID・状態フィルターは取得済みReleaseRecordへSPA側で適用する。

## 6. GET /health

正常時は200を返す。

```json
{ "status": "ok", "version": 2 }
```

## 7. GET /v2/releases

ReleaseRecord配列を取得する。APIの配列順には依存せず、SPAがトップレベルIDの降順にサマリーを表示する。

正常レスポンス: `200 OK`

## 8. POST /v2/releases

SPAは入力値から空の明細配列を持つReleaseWorkを組み立てて送信する。トップレベルIDは送らず、light-api-serverに採番させる。

作業コピー時は、コピー・日付移動・状態初期化をSPA内で完了したReleaseWorkを同じPOSTへ送信する。Release Hub専用APIは追加しない。

```json
{
  "release": {
    "id": 0,
    "systemId": "MEMBER",
    "name": "会員基盤リリース",
    "version": "v1.3.0",
    "releaseDate": "2026-08-01 22:00",
    "environment": "Production",
    "status": "準備中",
    "manager": "山田",
    "updatedBy": "山田",
    "updatedAt": "2026-07-21T01:00:00.000Z"
  },
  "timeline": [],
  "staffing": [],
  "approvals": [],
  "links": []
}
```

正常レスポンスは採番済みトップレベルIDを含む `201 Created`。SPAはレスポンスのトップレベルIDを `release.id`へ反映する。

## 9. GET /v2/releases/:id

指定したトップレベルIDのReleaseRecordを取得する。

| Status | 条件 |
| --- | --- |
| 200 | 対象あり |
| 404 | 対象なし |

## 10. PUT /v2/releases/:id

作業基本情報と全明細を含むReleaseRecordを全置換する。URLのID、トップレベル `id`、`release.id`は同じ値とする。

| Status | 条件 |
| --- | --- |
| 200 | 更新成功 |
| 400 | URLとbodyのID不一致、JSON不正 |
| 404 | 対象なし |

## 11. DELETE /v2/releases/:id

詳細画面の削除確認モーダルで確定した作業を、配下明細を含むReleaseRecord単位で削除する。

| Status | 条件 |
| --- | --- |
| 200 | 削除成功。削除したReleaseRecordを返す |
| 404 | 対象なし |

削除成功後、SPAは一覧のサマリーから対象IDを除外して一覧画面へ戻る。削除の取消・復元は提供しない。

## 12. エラー処理

light-api-serverのv2エラーは次の形式で返る。

```json
{ "error": "Resource item not found" }
```

SPAは404を「対象の作業が見つかりません」、その他を「共有データを処理できませんでした」へ変換し、楽観更新に失敗した場合は直前の画面状態へ戻す。

## 13. データ移行

旧形式は `DATA_DIR/release.json` の `{ "releases": ReleaseWork[] }` である。次のコマンドで `DATA_DIR/releases.json` のReleaseRecord配列へ変換する。

```bash
npm run migrate:data
```

変換規則:

| 旧データ | 新データ |
| --- | --- |
| `release.id` | トップレベル `id` と `release.id` |
| `{ releases: [...] }` | `[...]` |
| 単一ReleaseWork | 1件のReleaseRecord配列 |

既存の `releases.json` は上書きしない。移行後のファイルをlight-api-serverの `DATA_DIR`へ配置してから起動する。

## 14. 永続化と制約

- light-api-serverが書き込みをリソース単位に直列化する。
- 一時ファイルを書いた後にrenameで `releases.json`を置換する。
- 複数プロセスから同じ `DATA_DIR`へ書き込む構成は対象外。
- バックアップ対象は `DATA_DIR/releases.json`。
- Release Hub専用の検証・集計ロジックはAPIサーバへ追加しない。
