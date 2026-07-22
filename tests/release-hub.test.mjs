import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function startServer(context, prepareDataDir) {
  const dataDir = await mkdtemp(join(tmpdir(), "release-hub-test-"));
  if (prepareDataDir) await prepareDataDir(dataDir);
  const child = spawn(process.execPath, ["server/main.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: "0", DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => child.kill());

  return new Promise((resolve, reject) => {
    let errors = "";
    const timer = setTimeout(() => reject(new Error(`Server start timed out: ${errors}`)), 5000);
    child.once("error", reject);
    child.stderr.on("data", (chunk) => { errors += String(chunk); });
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/http:\/\/[^:]+:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
  });
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  return { response, body: await response.json() };
}

async function createRelease(baseUrl, overrides = {}) {
  const input = { systemId: "MEMBER", name: "会員基盤リリース", projectNumber: "PJ-MEMBER-001", releaseDate: "2026-08-01 22:00", environment: "Production", manager: "山田", ...overrides };
  const work = {
    release: { id: 0, ...input, status: "準備中", updatedBy: input.manager, updatedAt: new Date().toISOString() },
    timeline: [], staffing: [], approvals: [], links: [],
  };
  const { response, body } = await requestJson(`${baseUrl}/v2/releases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(work),
  });
  assert.equal(response.status, 201);
  return body;
}

async function saveRelease(baseUrl, work) {
  return requestJson(`${baseUrl}/v2/releases/${work.release.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...work, id: work.release.id }),
  });
}

async function patchRelease(baseUrl, id, patch) {
  return requestJson(`${baseUrl}/v2/releases/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, ...patch }),
  });
}

test("SPA contains editable release-operation controls", async () => {
  const [app, apiClient, html] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  for (const label of ["当日オペレーション", "ALL-IN-ONE", "オールインワン表示", "リリース作業", "リリース作業を登録", "一覧を更新", "作業一覧へ戻る", "この作業", "共有URLをコピー", "URLをコピーしました", "作業をコピー", "コピーを作成", "明細をコピー", "プロジェクト番号（任意）", "プロジェクト番号未設定", "作業をグループ化", "グループなし", "SystemIDで絞り込み", "作業状態で絞り込み", "未完了", "作業を削除", "この操作は取り消せません", "作業カレンダー", "前の月", "次の月", "作業日", "開始時刻", "終了時刻", "開始から", "実績開始日時", "実績終了日時", "今を開始に設定", "今を終了に設定", "作業中は実績開始のみ入力", "実績を編集", "表示範囲外", "ガント", "当日体制", "＋ 体制", "対応開始日時", "電話番号", "開始日時", "作業情報を編集", "作業タイトル", "内容（任意）", "紐づける申請物（任意）", "申請物一覧へ申請", "コンチプラン", "ドラッグして並べ替え", "上下にドラッグ", "5分単位でドラッグ変更", "対応時間帯をドラッグで移動", "対応開始時刻をドラッグで変更", "対応終了時刻をドラッグで変更", "申請物一覧", "申請物を編集", "未申請", "申請中", "回付済", "結了済", "申請リンク（任意）", "手順書・関連リンク", "リンク情報を編集", "URL（任意）", "情報を編集", "リンクを開く", "リンク未登録", "当日作業の開始から8時間", "当日体制から選択または入力", "種別", "入力内容を保存できません", "▶ 開始", "✓ 完了", "申請種別管理", "申請種別を追加", "認証・権限制御なし", "自由入力対応", "申請種別（任意）", "候補から選択または手入力"]) {
    assert.match(app, new RegExp(label));
  }
  assert.match(app, /PreviewModal/);
  assert.match(app, /target="_blank"/);
  assert.match(app, /release-hub-splash\.png/);
  assert.match(app, /onTimeChange/);
  assert.match(app, /gantt-resize-handle/);
  assert.match(app, /AllInOneList/);
  assert.doesNotMatch(app, /≋ 統合/);
  assert.match(app, /Math\.round\(rawDelta \/ 5\) \* 5/);
  assert.match(app, /lockedRangeRef/);
  assert.doesNotMatch(app, /Math\.max\(2\.5, \(\(end - start\)/);
  assert.match(app, /getTimezoneOffset\(\) \* 60_000/);
  assert.match(app, /setInterval\(\(\) => setCurrentMinute\(currentLocalMinutes\(\)\), 30_000\)/);
  assert.match(app, /\[15, 30, 60\]\.map/);
  assert.match(app, /values\.startAt =/);
  assert.doesNotMatch(app, /name="version"/);
  assert.match(app, /name="projectNumber"/);
  assert.match(app, /projectGroups\.map/);
  assert.match(app, /name="due" type="date"/);
  assert.doesNotMatch(app, /name="url"[^>]*required/);
  assert.match(app, /status === "承認済み"\) return "結了済"/);
  assert.match(app, /searchParams\.set\("release"/);
  assert.match(app, /addEventListener\("popstate"/);
  assert.match(app, /demoWorksRef\.current\.find/);
  assert.match(app, /navigator\.clipboard\.writeText/);
  assert.match(app, /buildReleaseCopy/);
  assert.match(app, /const minuteDelta =/);
  assert.match(app, /actualStartAt: "", actualEndAt: "", status: "未着手"/);
  assert.match(app, /status: "未申請", url: ""/);
  assert.match(app, /item\.kind \|\| "作業"/);
  assert.match(app, /toMinutes\(staffingStartAt\) \+ 8 \* 60/);
  assert.match(app, /list="staffing-owner-options"/);
  assert.match(app, /role="alert"/);
  assert.match(app, /updateTimelineStatus/);
  assert.match(app, /name="approvalId"/);
  assert.match(app, /content: String\(values\.content/);
  const detailHeaderSource = app.slice(app.indexOf('function WorkDetail'), app.indexOf('<div id="overview"'));
  assert.match(detailHeaderSource, /loading \? "更新中" : "更新"/);
  assert.doesNotMatch(detailHeaderSource, /作業明細を追加/);
  assert.match(app, /approvalCategoryAdminFromUrl/);
  assert.match(app, /list="approval-category-options"/);
  assert.match(app, /sampleApprovalCategories/);
  const timelineModalSource = app.slice(app.indexOf('{type === "timeline"'), app.indexOf('{type === "approval"'));
  assert.ok(timelineModalSource.indexOf('name="title"') < timelineModalSource.indexOf('name="plan"'));
  const previewSource = app.slice(app.indexOf("function PreviewModal"));
  assert.doesNotMatch(previewSource, /onClick=\{onClose\}>閉じる<\/button>/);
  assert.match(apiClient, /\/v2\/releases/);
  assert.match(apiClient, /ReleaseWorkSection/);
  assert.match(apiClient, /method: "PATCH"/);
  assert.match(app, /saveQueueRef\.current = saveQueueRef\.current\.then/);
  assert.match(app, /Timelineが空になる保存を安全のため中止しました/);
  assert.match(apiClient, /summaryFromRecord/);
  assert.match(apiClient, /createReleaseCopy/);
  assert.match(apiClient, /projectNumber: release\.projectNumber \|\| version \|\| ""/);
  assert.match(apiClient, /method: "DELETE"/);
  assert.match(apiClient, /\/v2\/categories/);
  assert.match(apiClient, /category\.scope === scope/);
  assert.match(apiClient, /APIサーバーのresourcesにcategoriesを追加してください/);
  assert.doesNotMatch(apiClient, /JSON\.stringify\(\{ \.\.\.input, id: 0 \}\)/);
  assert.match(html, /Release Hub \| リリース情報をひとつに/);
});

test("partial release updates preserve timeline and other detail arrays", async (context) => {
  const baseUrl = await startServer(context);
  const created = await createRelease(baseUrl);
  created.timeline = [{ id: 1, startAt: "2026-08-01T22:00", endAt: "2026-08-01T22:30", title: "本番デプロイ", owner: "山田", status: "未着手", plan: "本線" }];
  created.staffing = [{ id: 1, name: "山田", phone: "", startAt: "2026-08-01T21:00", endAt: "2026-08-02T01:00", location: "オンコール", note: "" }];
  const saved = (await saveRelease(baseUrl, created)).body;

  const approvalPatch = await patchRelease(baseUrl, saved.id, {
    approvals: [{ id: 1, title: "本番変更申請", category: "WF", owner: "山田", due: "2026-08-01", status: "未申請", url: "" }],
  });
  assert.equal(approvalPatch.response.status, 200);
  assert.equal(approvalPatch.body.timeline.length, 1);
  assert.equal(approvalPatch.body.timeline[0].title, "本番デプロイ");
  assert.equal(approvalPatch.body.staffing.length, 1);

  const reloaded = await requestJson(`${baseUrl}/v2/releases/${saved.id}`);
  assert.equal(reloaded.body.timeline.length, 1);
  assert.equal(reloaded.body.approvals.length, 1);
});

test("GitHub Pages workflow builds the demo with required deployment settings", async () => {
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /VITE_BASE_PATH: \/release-hub\//);
  assert.match(workflow, /VITE_DEMO_MODE: "true"/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /needs: build/);
});

test("project documentation covers current product, API, design, and acceptance tests", async () => {
  const [readme, requirements, design, api, testSpec] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/requirements.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/basic-design.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/api-spec.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/test-spec.md", import.meta.url), "utf8"),
  ]);
  for (const path of ["docs/requirements.md", "docs/basic-design.md", "docs/api-spec.md", "docs/test-spec.md"]) assert.match(readme, new RegExp(path));
  for (const term of ["SystemID", "コンチプラン", "表示範囲外", "VITE_DEMO_MODE", "申請種別管理", "scope=approval"]) assert.match(requirements, new RegExp(term));
  for (const term of ["mermaid", "release.json", "GitLab CI", "GitHub Actions"]) assert.match(design, new RegExp(term));
  for (const endpoint of ["GET /health", "GET /v2/releases", "POST /v2/releases", "PUT /v2/releases/:id", "GET /v2/categories", "POST /v2/categories"]) assert.match(api, new RegExp(endpoint));
  for (const testId of ["FT-020", "FT-046", "API-007", "MIG-006", "NFT-008"]) assert.match(testSpec, new RegExp(testId));
});

test("development command starts both the SPA and v2-compatible local API", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const devScript = await readFile(new URL("../scripts/dev.mjs", import.meta.url), "utf8");
  assert.equal(packageJson.scripts.dev, "node scripts/dev.mjs");
  assert.equal(packageJson.scripts["dev:web"], "vite");
  assert.match(devScript, /server\/main\.mjs/);
  assert.match(devScript, /PORT: process\.env\.PORT \|\| "4174"/);
  assert.match(devScript, /node_modules\/vite\/bin\/vite\.js/);
});

test("v2-compatible local API migrates legacy time-only details across midnight", async (context) => {
  const baseUrl = await startServer(context);
  const created = await createRelease(baseUrl, { projectNumber: "" });
  assert.equal(created.release.projectNumber, "");
  delete created.release.systemId;
  created.timeline.push(
    { id: 1, time: "23:50", endTime: "00:10", title: "デプロイ", owner: "山田", status: "完了" },
    { id: 2, time: "00:15", endTime: "00:45", title: "翌日確認", owner: "山田", status: "未着手" },
  );
  created.staffing.push({ id: 1, name: "佐藤", startTime: "21:00", endTime: "01:00", location: "名古屋", note: "現地対応" });

  const { response, body: saved } = await saveRelease(baseUrl, created);
  assert.equal(response.status, 200);
  assert.deepEqual(saved.timeline.map(({ startAt, endAt }) => [startAt, endAt]), [
    ["2026-08-01T23:50", "2026-08-02T00:10"],
    ["2026-08-02T00:15", "2026-08-02T00:45"],
  ]);
  assert.equal(saved.timeline[0].plan, "本線");
  assert.equal(saved.timeline[0].kind, "作業");
  assert.equal(saved.timeline[0].content, "");
  assert.equal(saved.staffing[0].startAt, "2026-08-01T21:00");
  assert.equal(saved.staffing[0].endAt, "2026-08-02T01:00");
  assert.equal(saved.staffing[0].phone, "");
  assert.equal(saved.release.systemId, "未設定");
  assert.equal(saved.timeline[0].actualStartAt, "");
  assert.equal(saved.timeline[0].actualEndAt, "");
  assert.equal("time" in saved.timeline[0], false);
  assert.equal("startTime" in saved.staffing[0], false);
});

test("v2-compatible local API migrates legacy release version to project number", async (context) => {
  const baseUrl = await startServer(context);
  const created = await createRelease(baseUrl, { projectNumber: undefined, version: "v1.3.0" });
  assert.equal(created.release.projectNumber, "v1.3.0");
  assert.equal("version" in created.release, false);
});

test("v2-compatible local API persists release records and work edits", async (context) => {
  const baseUrl = await startServer(context);
  const initial = await requestJson(`${baseUrl}/v2/releases`);
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body[0].id, 1);
  assert.equal(initial.body[0].release.name, "決済基盤アップデート");
  assert.equal(initial.body[0].release.systemId, "PAYMENT");

  const created = await createRelease(baseUrl);
  created.timeline = [
    { id: 1, startAt: "2026-08-01T22:00", endAt: "2026-08-01T22:30", actualStartAt: "2026-08-01T22:05", actualEndAt: "2026-08-01T22:42", title: "本番デプロイ", owner: "山田", status: "完了", plan: "本線" },
    { id: 2, startAt: "2026-08-01T22:30", endAt: "2026-08-01T23:00", title: "切り戻し判定", content: "申請の回付状態を確認", owner: "佐藤", status: "未着手", plan: "コンチプラン", kind: "申請物", approvalId: 1 },
  ];
  created.staffing = [{ id: 1, name: "佐藤", phone: "090-1111-2222", startAt: "2026-08-01T21:00", endAt: "2026-08-02T01:00", location: "オンコール", note: "一次連絡先" }];
  created.approvals = [{ id: 1, title: "本番変更申請", owner: "佐藤", due: "2026-08-01", status: "申請中", url: "" }];
  created.links = [{ id: 1, title: "本番手順書", category: "手順書", description: "初版", url: "" }];
  let saved = (await saveRelease(baseUrl, created)).body;

  saved.release.name = "会員基盤リリース（更新）";
  saved.release.systemId = "MEMBER-CORE";
  saved.release.status = "進行中";
  saved.release.manager = "佐藤";
  saved.timeline.reverse();
  saved.staffing[0].phone = "090-3333-4444";
  saved.approvals[0] = { ...saved.approvals[0], title: "本番変更申請（更新）", status: "結了済" };
  saved.links[0] = { ...saved.links[0], description: "改訂版", url: "https://example.com/runbook/v2" };
  const update = await saveRelease(baseUrl, saved);
  assert.equal(update.response.status, 200);
  assert.equal(update.body.release.updatedBy, "山田");

  const reloaded = await requestJson(`${baseUrl}/v2/releases/${created.release.id}`);
  assert.equal(reloaded.response.status, 200);
  assert.equal(reloaded.body.release.name, "会員基盤リリース（更新）");
  assert.equal(reloaded.body.release.systemId, "MEMBER-CORE");
  assert.equal(reloaded.body.release.status, "進行中");
  assert.equal(reloaded.body.release.manager, "佐藤");
  assert.deepEqual(reloaded.body.timeline.map((item) => item.id), [2, 1]);
  assert.equal(reloaded.body.timeline[0].plan, "コンチプラン");
  assert.equal(reloaded.body.timeline[0].kind, "申請物");
  assert.equal(reloaded.body.timeline[0].content, "申請の回付状態を確認");
  assert.equal(reloaded.body.timeline[0].approvalId, 1);
  assert.equal(reloaded.body.timeline[1].actualStartAt, "2026-08-01T22:05");
  assert.equal(reloaded.body.timeline[1].actualEndAt, "2026-08-01T22:42");
  assert.equal(reloaded.body.staffing[0].phone, "090-3333-4444");
  assert.equal(reloaded.body.approvals[0].title, "本番変更申請（更新）");
  assert.equal(reloaded.body.approvals[0].status, "結了済");
  assert.equal(reloaded.body.links[0].description, "改訂版");
  assert.equal(reloaded.body.links[0].url, "https://example.com/runbook/v2");

  const records = await requestJson(`${baseUrl}/v2/releases`);
  const record = records.body.find((item) => item.id === created.release.id);
  assert.equal(record.release.status, "進行中");
  assert.equal(record.release.systemId, "MEMBER-CORE");
});

test("v2-compatible local API manages scoped categories", async (context) => {
  const baseUrl = await startServer(context);
  const initial = await requestJson(`${baseUrl}/v2/categories`);
  assert.equal(initial.response.status, 200);
  assert.deepEqual(initial.body.map((category) => category.name), ["資源配布", "WF"]);
  assert.deepEqual(initial.body.map((category) => category.scope), ["approval", "approval"]);

  const created = await requestJson(`${baseUrl}/v2/categories`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "resource-link", name: "監視", description: "監視ツール" }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.id, 3);

  const updated = await requestJson(`${baseUrl}/v2/categories/${created.body.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...created.body, name: "監視・ログ", description: "監視とログ確認" }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.name, "監視・ログ");
  assert.equal(updated.body.scope, "resource-link");

  const deleted = await requestJson(`${baseUrl}/v2/categories/${created.body.id}`, { method: "DELETE" });
  assert.equal(deleted.response.status, 200);
  assert.equal((await requestJson(`${baseUrl}/v2/categories`)).body.length, 2);
  assert.equal((await requestJson(`${baseUrl}/v2/categories/${created.body.id}`, { method: "DELETE" })).response.status, 404);
});

test("v2-compatible local API migrates legacy approval categories into scoped categories", async (context) => {
  const baseUrl = await startServer(context, (dataDir) => writeFile(join(dataDir, "approval-categories.json"), JSON.stringify([{ id: 7, name: "旧WF", description: "旧マスタ" }]), "utf8"));
  const categories = await requestJson(`${baseUrl}/v2/categories`);
  assert.equal(categories.response.status, 200);
  assert.deepEqual(categories.body, [{ id: 7, scope: "approval", name: "旧WF", description: "旧マスタ" }]);
});

test("v2-compatible local API rejects invalid mutations and reports missing resources", async (context) => {
  const baseUrl = await startServer(context);
  const created = await createRelease(baseUrl);
  created.id = 999;
  const mismatchedUpdate = await requestJson(`${baseUrl}/v2/releases/${created.release.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(created),
  });
  assert.equal(mismatchedUpdate.response.status, 400);

  const deleted = await requestJson(`${baseUrl}/v2/releases/${created.release.id}`, { method: "DELETE" });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.body.id, created.release.id);
  assert.equal((await requestJson(`${baseUrl}/v2/releases/${created.release.id}`)).response.status, 404);
  assert.equal((await requestJson(`${baseUrl}/v2/releases/${created.release.id}`, { method: "DELETE" })).response.status, 404);

  const missing = await requestJson(`${baseUrl}/v2/releases/9999`);
  assert.equal(missing.response.status, 404);
  const unsupported = await requestJson(`${baseUrl}/v2/releases`, { method: "DELETE" });
  assert.equal(unsupported.response.status, 405);
  const health = await requestJson(`${baseUrl}/health`);
  assert.deepEqual(health.body, { status: "ok", version: 2 });
});

test("migration command converts the legacy database into v2 release records", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "release-hub-migration-"));
  const legacy = {
    releases: [{
      release: { id: 7, systemId: "LEGACY", name: "旧作業" },
      timeline: [], staffing: [], approvals: [], links: [],
    }],
  };
  await writeFile(join(dataDir, "release.json"), JSON.stringify(legacy), "utf8");
  const child = spawn(process.execPath, ["scripts/migrate-data.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const { code, errors } = await new Promise((resolve) => {
    let errors = "";
    child.stderr.on("data", (chunk) => { errors += String(chunk); });
    child.once("exit", (code) => resolve({ code, errors }));
  });
  assert.equal(code, 0, errors);
  const records = JSON.parse(await readFile(join(dataDir, "releases.json"), "utf8"));
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 7);
  assert.equal(records[0].release.id, 7);
  assert.equal(records[0].release.systemId, "LEGACY");
});
