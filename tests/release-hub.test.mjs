import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("SPA contains the Release Hub sections", async () => {
  const [app, html] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  assert.match(app, /作業タイムチャート/);
  assert.match(app, /リリース作業一覧/);
  assert.match(app, /リリース作業を登録/);
  assert.match(app, /ガント/);
  assert.match(app, /当日体制/);
  assert.match(app, /対応開始日時/);
  assert.match(app, /電話番号/);
  assert.match(app, /開始日時/);
  assert.match(app, /作業情報を編集/);
  assert.match(app, /コンチプラン/);
  assert.match(app, /ドラッグして並べ替え/);
  assert.match(app, /統合/);
  assert.match(app, /申請物一覧/);
  assert.match(app, /手順書・関連リンク/);
  assert.match(app, /PreviewModal/);
  assert.match(app, /target="_blank"/);
  assert.match(app, /リンクを開く/);
  assert.match(app, /release-hub-splash\.png/);
  assert.match(html, /Release Hub \| リリース情報をひとつに/);
});

test("Node API creates a release work before persisting its details", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "release-hub-test-"));
  const child = spawn(process.execPath, ["server/main.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: "0", DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => child.kill());

  const baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server start timed out")), 5000);
    child.once("error", reject);
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/http:\/\/[^:]+:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
  });

  const initial = await fetch(`${baseUrl}/api/releases`).then((response) => response.json());
  assert.equal(initial.length, 1);
  assert.equal(initial[0].name, "決済基盤アップデート");

  const created = await fetch(`${baseUrl}/api/releases`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-user": "test-user" },
    body: JSON.stringify({ name: "会員基盤リリース", version: "v1.3.0", releaseDate: "2026-08-01 21:00", environment: "Production", manager: "山田" }),
  }).then((response) => response.json());
  assert.equal(created.release.id, 2);
  assert.equal(created.timeline.length, 0);
  assert.equal(created.staffing.length, 0);

  created.timeline.push({ id: 1, time: "21:00", endTime: "21:30", title: "デプロイ", owner: "山田", status: "完了" });
  created.staffing.push({ id: 1, name: "佐藤", startTime: "09:00", endTime: "17:00", location: "名古屋", note: "現地対応" });
  const saved = await fetch(`${baseUrl}/api/releases/2`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-forwarded-user": "test-user" },
    body: JSON.stringify(created),
  }).then((response) => response.json());
  assert.equal(saved.timeline[0].title, "デプロイ");
  assert.equal(saved.timeline[0].startAt, "2026-08-01T21:00");
  assert.equal(saved.timeline[0].endAt, "2026-08-01T21:30");
  assert.equal(saved.timeline[0].plan, "本線");
  assert.equal(saved.staffing[0].startAt, "2026-08-01T09:00");
  assert.equal(saved.staffing[0].endAt, "2026-08-01T17:00");
  assert.equal(saved.staffing[0].phone, "");
  assert.equal("time" in saved.timeline[0], false);
  assert.equal(saved.release.updatedBy, "test-user");

  const reloaded = await fetch(`${baseUrl}/api/releases/2`).then((response) => response.json());
  assert.equal(reloaded.release.name, "会員基盤リリース");
  assert.equal(reloaded.timeline.length, 1);
  assert.equal(reloaded.staffing[0].location, "名古屋");

  const summaries = await fetch(`${baseUrl}/api/releases`).then((response) => response.json());
  assert.equal(summaries[0].id, 2);
  assert.equal(summaries[0].progress, 100);
});
