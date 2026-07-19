import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function startServer(context) {
  const dataDir = await mkdtemp(join(tmpdir(), "release-hub-test-"));
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
  const { response, body } = await requestJson(`${baseUrl}/api/releases`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-user": "test-user" },
    body: JSON.stringify({ systemId: "MEMBER", name: "会員基盤リリース", version: "v1.3.0", releaseDate: "2026-08-01 22:00", environment: "Production", manager: "山田", ...overrides }),
  });
  assert.equal(response.status, 201);
  return body;
}

async function saveRelease(baseUrl, work) {
  return requestJson(`${baseUrl}/api/releases/${work.release.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-forwarded-user": "test-user" },
    body: JSON.stringify(work),
  });
}

test("SPA contains editable release-operation controls", async () => {
  const [app, html] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  for (const label of ["当日オペレーション", "ALL-IN-ONE", "オールインワン表示", "リリース作業", "リリース作業を登録", "SystemIDで絞り込み", "作業カレンダー", "前の月", "次の月", "予定開始日時", "予定終了日時", "実績開始日時", "実績終了日時", "今を開始に設定", "今を終了に設定", "作業中は実績開始のみ入力", "実績を編集", "表示範囲外", "ガント", "当日体制", "対応開始日時", "電話番号", "開始日時", "作業情報を編集", "コンチプラン", "ドラッグして並べ替え", "上下にドラッグ", "5分単位でドラッグ変更", "対応時間帯をドラッグで移動", "対応開始時刻をドラッグで変更", "対応終了時刻をドラッグで変更", "申請物一覧", "申請物を編集", "手順書・関連リンク", "リンク情報を編集", "情報を編集", "リンクを開く"]) {
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
  assert.match(app, /getTimezoneOffset\(\) \* 60_000/);
  assert.match(app, /setInterval\(\(\) => setCurrentMinute\(currentLocalMinutes\(\)\), 30_000\)/);
  assert.match(html, /Release Hub \| リリース情報をひとつに/);
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

test("development command starts both the SPA and Node API", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const devScript = await readFile(new URL("../scripts/dev.mjs", import.meta.url), "utf8");
  assert.equal(packageJson.scripts.dev, "node scripts/dev.mjs");
  assert.equal(packageJson.scripts["dev:web"], "vite");
  assert.match(devScript, /server\/main\.mjs/);
  assert.match(devScript, /PORT: process\.env\.PORT \|\| "4174"/);
  assert.match(devScript, /node_modules\/vite\/bin\/vite\.js/);
});

test("Node API migrates legacy time-only details across midnight", async (context) => {
  const baseUrl = await startServer(context);
  const created = await createRelease(baseUrl);
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
  assert.equal(saved.staffing[0].startAt, "2026-08-01T21:00");
  assert.equal(saved.staffing[0].endAt, "2026-08-02T01:00");
  assert.equal(saved.staffing[0].phone, "");
  assert.equal(saved.release.systemId, "未設定");
  assert.equal(saved.timeline[0].actualStartAt, "");
  assert.equal(saved.timeline[0].actualEndAt, "");
  assert.equal("time" in saved.timeline[0], false);
  assert.equal("startTime" in saved.staffing[0], false);
});

test("Node API persists work edits, contact details, plan types, and timeline order", async (context) => {
  const baseUrl = await startServer(context);
  const initial = await requestJson(`${baseUrl}/api/releases`);
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body[0].name, "決済基盤アップデート");
  assert.equal(initial.body[0].systemId, "PAYMENT");

  const created = await createRelease(baseUrl);
  created.timeline = [
    { id: 1, startAt: "2026-08-01T22:00", endAt: "2026-08-01T22:30", actualStartAt: "2026-08-01T22:05", actualEndAt: "2026-08-01T22:42", title: "本番デプロイ", owner: "山田", status: "完了", plan: "本線" },
    { id: 2, startAt: "2026-08-01T22:30", endAt: "2026-08-01T23:00", title: "切り戻し", owner: "佐藤", status: "未着手", plan: "コンチプラン" },
  ];
  created.staffing = [{ id: 1, name: "佐藤", phone: "090-1111-2222", startAt: "2026-08-01T21:00", endAt: "2026-08-02T01:00", location: "オンコール", note: "一次連絡先" }];
  created.approvals = [{ id: 1, title: "本番変更申請", owner: "佐藤", due: "8/1", status: "申請中", url: "https://example.com/approval" }];
  created.links = [{ id: 1, title: "本番手順書", category: "手順書", description: "初版", url: "https://example.com/runbook" }];
  let saved = (await saveRelease(baseUrl, created)).body;

  saved.release.name = "会員基盤リリース（更新）";
  saved.release.systemId = "MEMBER-CORE";
  saved.release.status = "進行中";
  saved.release.manager = "佐藤";
  saved.timeline.reverse();
  saved.staffing[0].phone = "090-3333-4444";
  saved.approvals[0] = { ...saved.approvals[0], title: "本番変更申請（更新）", status: "承認済み" };
  saved.links[0] = { ...saved.links[0], description: "改訂版", url: "https://example.com/runbook/v2" };
  const update = await saveRelease(baseUrl, saved);
  assert.equal(update.response.status, 200);
  assert.equal(update.body.release.updatedBy, "test-user");

  const reloaded = await requestJson(`${baseUrl}/api/releases/${created.release.id}`);
  assert.equal(reloaded.response.status, 200);
  assert.equal(reloaded.body.release.name, "会員基盤リリース（更新）");
  assert.equal(reloaded.body.release.systemId, "MEMBER-CORE");
  assert.equal(reloaded.body.release.status, "進行中");
  assert.equal(reloaded.body.release.manager, "佐藤");
  assert.deepEqual(reloaded.body.timeline.map((item) => item.id), [2, 1]);
  assert.equal(reloaded.body.timeline[0].plan, "コンチプラン");
  assert.equal(reloaded.body.timeline[1].actualStartAt, "2026-08-01T22:05");
  assert.equal(reloaded.body.timeline[1].actualEndAt, "2026-08-01T22:42");
  assert.equal(reloaded.body.staffing[0].phone, "090-3333-4444");
  assert.equal(reloaded.body.approvals[0].title, "本番変更申請（更新）");
  assert.equal(reloaded.body.approvals[0].status, "承認済み");
  assert.equal(reloaded.body.links[0].description, "改訂版");
  assert.equal(reloaded.body.links[0].url, "https://example.com/runbook/v2");

  const summaries = await requestJson(`${baseUrl}/api/releases`);
  assert.equal(summaries.body[0].id, created.release.id);
  assert.equal(summaries.body[0].progress, 50);
  assert.equal(summaries.body[0].status, "進行中");
  assert.equal(summaries.body[0].systemId, "MEMBER-CORE");
});

test("Node API rejects invalid mutations and reports missing resources", async (context) => {
  const baseUrl = await startServer(context);
  const invalidCreate = await requestJson(`${baseUrl}/api/releases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "項目不足" }),
  });
  assert.equal(invalidCreate.response.status, 400);

  const created = await createRelease(baseUrl);
  created.release.id = 999;
  const mismatchedUpdate = await requestJson(`${baseUrl}/api/releases/2`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(created),
  });
  assert.equal(mismatchedUpdate.response.status, 400);

  const missing = await requestJson(`${baseUrl}/api/releases/9999`);
  assert.equal(missing.response.status, 404);
  const unsupported = await requestJson(`${baseUrl}/api/releases`, { method: "DELETE" });
  assert.equal(unsupported.response.status, 405);
  const health = await requestJson(`${baseUrl}/health`);
  assert.deepEqual(health.body, { status: "ok" });
});
