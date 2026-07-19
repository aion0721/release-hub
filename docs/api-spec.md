# Release Hub API仕様書

## 1. 概要

Release HubのNode APIは、リリース作業と配下明細を共有・永続化するHTTP JSON APIである。Node.js標準モジュールのみで実装し、同じプロセスからproduction SPAも配信する。

## 2. 共通仕様

| 項目 | 仕様 |
| --- | --- |
| ベースパス | `/api` |
| Content-Type | リクエスト・レスポンスとも原則 `application/json` |
| 文字コード | UTF-8 |
| 認証 | アプリ外のリバースプロキシ／SSOに委譲 |
| 更新者ヘッダー | `x-auth-request-email`、次に `x-forwarded-user` |
| キャッシュ | APIレスポンスは `Cache-Control: no-store` |
| 最大ボディ | 1,000,000文字 |
| CORS | `CORS_ORIGIN` 設定時のみ対象Originを許可 |

### 2.1 共通レスポンスヘッダー

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: same-origin`

### 2.2 日時形式

| 項目 | 形式 | 例 |
| --- | --- | --- |
| 親作業日時 | `YYYY-MM-DD HH:mm` | `2026-08-01 22:00` |
| 明細・体制日時 | `YYYY-MM-DDTHH:mm` | `2026-08-01T22:30` |
| `updatedAt` | ISO 8601 | `2026-08-01T13:00:00.000Z` |

日時は業務上のローカル時刻として扱う。APIはタイムゾーン変換を行わない。

## 3. データ型

### 3.1 ReleaseWork

```json
{
  "release": {
    "id": 2,
    "systemId": "PAYMENT",
    "name": "決済基盤アップデート",
    "version": "v2.8.0",
    "releaseDate": "2026-08-01 22:00",
    "environment": "Production",
    "status": "準備中",
    "manager": "田中",
    "updatedBy": "tanaka@example.com",
    "updatedAt": "2026-08-01T01:00:00.000Z"
  },
  "timeline": [],
  "staffing": [],
  "approvals": [],
  "links": []
}
```

配下要素の詳細は [基本設計書のデータ設計](basic-design.md#5-データ設計) を参照する。

### 3.2 ReleaseSummary

`ReleaseWork.release` に以下を追加した一覧用データである。

| フィールド | 型 | 算出方法 |
| --- | --- | --- |
| `progress` | number | 完了明細数／全明細数を百分率で四捨五入 |
| `timelineCount` | number | 作業明細数 |
| `approvalCount` | number | 申請物数 |

## 4. エンドポイント一覧

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/health` | ヘルスチェック |
| GET | `/api/releases` | リリース作業サマリー一覧 |
| POST | `/api/releases` | リリース作業新規登録 |
| GET | `/api/releases/:id` | リリース作業詳細取得 |
| PUT | `/api/releases/:id` | リリース作業全体更新 |
| OPTIONS | 任意 | CORSプリフライト |

## 5. GET /health

Nodeプロセスの生存確認に使用する。データファイルの読み書きまでは確認しない。

### 正常レスポンス

- Status: `200 OK`

```json
{ "status": "ok" }
```

## 6. GET /api/releases

リリース作業のサマリー一覧を取得する。

### 処理

- データファイルを読み込む。
- 旧形式・欠損項目を正規化する。
- 各作業の進捗と件数を算出する。
- `id` の降順で返す。

### 正常レスポンス

- Status: `200 OK`
- Body: `ReleaseSummary[]`

```json
[
  {
    "id": 2,
    "systemId": "PAYMENT",
    "name": "決済基盤アップデート",
    "version": "v2.8.0",
    "releaseDate": "2026-08-01 22:00",
    "environment": "Production",
    "status": "進行中",
    "manager": "田中",
    "updatedBy": "tanaka@example.com",
    "updatedAt": "2026-08-01T13:00:00.000Z",
    "progress": 50,
    "timelineCount": 4,
    "approvalCount": 3
  }
]
```

## 7. POST /api/releases

空の配下明細を持つリリース作業を新規登録する。

### リクエスト

```json
{
  "systemId": "PAYMENT",
  "name": "決済基盤アップデート",
  "version": "v2.8.0",
  "releaseDate": "2026-08-01 22:00",
  "environment": "Production",
  "manager": "田中"
}
```

### 入力条件

- 上記6フィールドがすべて文字列かつtrim後に空でないこと。
- IDは既存の最大リリースID＋1。
- 状態は `準備中`。
- `timeline`、`staffing`、`approvals`、`links` は空配列。
- `updatedBy` は更新者ヘッダー、ヘッダーがなければmanager。
- `updatedAt` はサーバー現在時刻。

### 正常レスポンス

- Status: `201 Created`
- Body: 作成した `ReleaseWork`

### エラー

| Status | 条件 | Body |
| --- | --- | --- |
| 400 | 必須入力不足・空文字・型不正 | `{ "error": "Invalid release input" }` |
| 500 | 読み込み、JSON解析、書き込み等の失敗 | `{ "error": "..." }` |

## 8. GET /api/releases/:id

指定IDのリリース作業全体を取得する。

### パスパラメータ

| 名称 | 型 | 内容 |
| --- | --- | --- |
| `id` | 正の整数相当 | リリース作業ID |

### 正常レスポンス

- Status: `200 OK`
- Body: `ReleaseWork`

### エラー

| Status | 条件 | Body |
| --- | --- | --- |
| 404 | 対象IDなし | `{ "error": "Release not found" }` |

## 9. PUT /api/releases/:id

指定IDのリリース作業を配下明細ごと置換する。部分更新ではない。

### リクエスト

- Body: `ReleaseWork` 全体
- URLのIDと `body.release.id` が一致すること。
- `timeline`、`staffing`、`approvals`、`links` が配列であること。

```json
{
  "release": {
    "id": 2,
    "systemId": "PAYMENT",
    "name": "決済基盤アップデート",
    "version": "v2.8.0",
    "releaseDate": "2026-08-01 22:00",
    "environment": "Production",
    "status": "進行中",
    "manager": "田中",
    "updatedBy": "Release Team",
    "updatedAt": ""
  },
  "timeline": [
    {
      "id": 1,
      "startAt": "2026-08-01T22:00",
      "endAt": "2026-08-01T22:30",
      "actualStartAt": "2026-08-01T22:03",
      "actualEndAt": "",
      "title": "本番デプロイ",
      "owner": "佐藤",
      "status": "進行中",
      "plan": "本線"
    }
  ],
  "staffing": [],
  "approvals": [],
  "links": []
}
```

### サーバー処理

1. 親構造とID一致を検証する。
2. 欠損・旧形式データを正規化する。
3. 対象IDの存在を確認する。
4. `updatedBy` と `updatedAt` をサーバー側で更新する。
5. 作業全体を置換してJSONファイルへ保存する。

### 正常レスポンス

- Status: `200 OK`
- Body: 保存後の `ReleaseWork`

### エラー

| Status | 条件 | Body |
| --- | --- | --- |
| 400 | 親構造不正、配列不足、ID不一致 | `{ "error": "Invalid release data" }` |
| 404 | URLの対象IDなし | `{ "error": "Release not found" }` |
| 500 | 読み込み・書き込み等の失敗 | `{ "error": "..." }` |

## 10. OPTIONS

`OPTIONS` リクエストには `204 No Content` を返す。`CORS_ORIGIN` 設定時は以下を付与する。

- `Access-Control-Allow-Origin: <CORS_ORIGIN>`
- `Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS`
- `Access-Control-Allow-Headers: content-type`

## 11. その他のメソッド・パス

- APIに対する未対応メソッドは `405 Method Not Allowed` と `{ "error": "Method not allowed" }`。
- GET/HEADの非APIパスは静的ファイル配信へ渡す。
- 存在しない静的資産は `404` と `{ "error": "Not found" }`。

## 12. 永続化

### 12.1 ファイル

- 保存先: `DATA_DIR/release.json`
- 未作成時: `server/seed.json` をコピー
- ルート形式:

```json
{ "releases": [] }
```

### 12.2 書き込み方式

1. プロセス内Promiseキューで更新処理を直列化する。
2. 最新ファイルを読み込む。
3. メモリ上で更新する。
4. `release.json.<pid>.tmp` に整形JSONを書き込む。
5. renameで `release.json` を置換する。

### 12.3 制約

- 同一Nodeプロセス内の競合だけを直列化する。
- 複数プロセス／複数コンテナから同一ファイルを更新してはならない。
- PUTは全体置換であり、同時編集は後勝ちとなる。

## 13. 旧データ互換

読み込み・PUT時に以下を正規化する。

| 旧状態 | 正規化 |
| --- | --- |
| ルートが単一 `ReleaseWork` | `{ releases: [work] }` へ変換 |
| `release.systemId` なし | `未設定` |
| `release.manager` なし | `updatedBy`、なければ `未設定` |
| `staffing` なし | 空配列 |
| `timeline.plan` なし | `本線` |
| `timeline.time` のみ | 親作業日と並び順から `startAt` を生成 |
| `timeline.endTime` のみ | 日跨ぎ判定して `endAt` を生成 |
| 実績日時なし | 空文字 |
| `staffing.startTime/endTime` | 親作業日と日跨ぎ判定から日時を生成 |
| `staffing.phone` なし | 空文字 |

正規化後は旧フィールド `time`、`endTime`、`startTime` を削除する。

## 14. エラーレスポンス

```json
{ "error": "エラー内容" }
```

Node APIは予期しない例外を `500 Internal Server Error` として返す。現行フロントエンドは404とその他のエラーを日本語の共通メッセージへ変換する。

## 15. API変更ルール

- 後方互換性を壊す変更はデータ移行処理を同時に実装する。
- `src/types.ts`、`src/api.ts`、`server/main.mjs`、`server/seed.json`、`src/sampleData.ts`、APIテスト、本書を同時更新する。
- 新規更新APIには入力検証と失敗系テストを追加する。
- 認証情報をリクエストボディから受け取らない。
