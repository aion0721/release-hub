import { createServer } from "node:http";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = join(projectRoot, "dist");
const dataDir = resolve(projectRoot, process.env.DATA_DIR || "data");
const dataFile = join(dataDir, "release.json");
const seedFile = join(projectRoot, "server", "seed.json");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const corsOrigin = process.env.CORS_ORIGIN || "";
let writeQueue = Promise.resolve();

const mimeTypes = new Map([[".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"], [".png", "image/png"], [".svg", "image/svg+xml"], [".webp", "image/webp"]]);

async function ensureDataFile() {
  await mkdir(dataDir, { recursive: true });
  try { await stat(dataFile); } catch { await copyFile(seedFile, dataFile); }
}

async function readDatabase() {
  await ensureDataFile();
  const value = JSON.parse(await readFile(dataFile, "utf8"));
  if (Array.isArray(value.releases)) return normalizeDatabase(value);
  if (value.release && Array.isArray(value.timeline)) {
    value.release.manager ||= value.release.updatedBy || "未設定";
    return normalizeDatabase({ releases: [value] });
  }
  return { releases: [] };
}

function normalizeDatabase(database) {
  for (const work of database.releases) {
    work.release.manager ||= work.release.updatedBy || "未設定";
    work.release.systemId ||= "未設定";
    work.staffing ||= [];
    normalizeTimeline(work);
    normalizeStaffing(work);
  }
  return database;
}

function datePart(value) {
  return String(value || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "1970-01-01";
}

function timePart(value) {
  return String(value || "00:00").match(/(\d{2}:\d{2})/)?.[1] || "00:00";
}

function timeMinutes(value) {
  const [hours, minutes] = timePart(value).split(":").map(Number);
  return hours * 60 + minutes;
}

function addDays(value, days) {
  const [year, month, day] = datePart(value).split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

function addDateTimeMinutes(value, minutes) {
  const normalized = String(value).replace(" ", "T");
  const result = new Date(`${normalized}:00Z`);
  result.setUTCMinutes(result.getUTCMinutes() + minutes);
  return result.toISOString().slice(0, 16);
}

function normalizeTimeline(work) {
  let dayOffset = 0;
  let previousMinutes = null;
  for (const item of work.timeline) {
    item.plan ||= "本線";
    if (!item.startAt) {
      const startMinutes = timeMinutes(item.time);
      if (previousMinutes !== null && startMinutes < previousMinutes) dayOffset += 1;
      item.startAt = `${addDays(work.release.releaseDate, dayOffset)}T${timePart(item.time)}`;
      previousMinutes = startMinutes;
    } else {
      item.startAt = String(item.startAt).replace(" ", "T");
    }
    if (!item.endAt) {
      const endTime = item.endTime ? timePart(item.endTime) : timePart(addDateTimeMinutes(item.startAt, 30));
      const endDayOffset = timeMinutes(endTime) <= timeMinutes(item.startAt) ? 1 : 0;
      item.endAt = `${addDays(item.startAt, endDayOffset)}T${endTime}`;
    } else {
      item.endAt = String(item.endAt).replace(" ", "T");
    }
    delete item.time;
    delete item.endTime;
  }
}

function normalizeStaffing(work) {
  for (const assignment of work.staffing) {
    assignment.phone ||= "";
    if (!assignment.startAt) assignment.startAt = `${datePart(work.release.releaseDate)}T${timePart(assignment.startTime)}`;
    else assignment.startAt = String(assignment.startAt).replace(" ", "T");
    if (!assignment.endAt) {
      const endTime = timePart(assignment.endTime);
      const endDayOffset = timeMinutes(endTime) <= timeMinutes(assignment.startAt) ? 1 : 0;
      assignment.endAt = `${addDays(assignment.startAt, endDayOffset)}T${endTime}`;
    } else {
      assignment.endAt = String(assignment.endAt).replace(" ", "T");
    }
    delete assignment.startTime;
    delete assignment.endTime;
  }
}

async function writeDatabase(database) {
  const temporaryFile = `${dataFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(database, null, 2)}\n`, "utf8");
  await rename(temporaryFile, dataFile);
}

function mutateDatabase(mutator) {
  const operation = writeQueue.then(async () => {
    const database = await readDatabase();
    const result = await mutator(database);
    await writeDatabase(database);
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function isReleaseWork(value) {
  return Boolean(value && typeof value === "object" && value.release && Number.isInteger(value.release.id) && Array.isArray(value.timeline) && Array.isArray(value.staffing) && Array.isArray(value.approvals) && Array.isArray(value.links));
}

function isCreateInput(value) {
  return Boolean(value && typeof value === "object" && ["systemId", "name", "version", "releaseDate", "environment", "manager"].every((key) => typeof value[key] === "string" && value[key].trim()));
}

function summary(work) {
  const done = work.timeline.filter((item) => item.status === "完了").length;
  return { ...work.release, progress: work.timeline.length ? Math.round((done / work.timeline.length) * 100) : 0, timelineCount: work.timeline.length, approvalCount: work.approvals.length };
}

function requestUser(request, fallback = "Release Team") {
  return String(request.headers["x-auth-request-email"] || request.headers["x-forwarded-user"] || fallback);
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request body is too large");
  }
  return JSON.parse(body || "{}");
}

function setCommonHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "SAMEORIGIN");
  response.setHeader("referrer-policy", "same-origin");
  if (corsOrigin) {
    response.setHeader("access-control-allow-origin", corsOrigin);
    response.setHeader("access-control-allow-methods", "GET, POST, PUT, OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
  }
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function serveStatic(pathname, response, method) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const candidate = normalize(join(distDir, decodeURIComponent(requested)));
  const safeCandidate = candidate.startsWith(`${distDir}${sep}`) ? candidate : join(distDir, "index.html");
  let filePath = safeCandidate;
  try { if (!(await stat(filePath)).isFile()) filePath = join(distDir, "index.html"); } catch { filePath = extname(requested) ? safeCandidate : join(distDir, "index.html"); }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": mimeTypes.get(extname(filePath)) || "application/octet-stream", "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable" });
    response.end(method === "HEAD" ? undefined : body);
  } catch { sendJson(response, 404, { error: "Not found" }); }
}

const server = createServer(async (request, response) => {
  setCommonHeaders(response);
  const method = request.method || "GET";
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  const releaseMatch = pathname.match(/^\/api\/releases\/(\d+)$/);

  try {
    if (method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    if (pathname === "/health") { sendJson(response, 200, { status: "ok" }); return; }
    if (pathname === "/api/releases" && method === "GET") {
      const database = await readDatabase();
      sendJson(response, 200, database.releases.map(summary).sort((a, b) => b.id - a.id));
      return;
    }
    if (pathname === "/api/releases" && method === "POST") {
      const input = await readBody(request);
      if (!isCreateInput(input)) { sendJson(response, 400, { error: "Invalid release input" }); return; }
      const created = await mutateDatabase((database) => {
        const id = database.releases.reduce((largest, work) => Math.max(largest, work.release.id), 0) + 1;
        const now = new Date().toISOString();
        const work = { release: { id, systemId: input.systemId.trim(), name: input.name.trim(), version: input.version.trim(), releaseDate: input.releaseDate.trim(), environment: input.environment.trim(), status: "準備中", manager: input.manager.trim(), updatedBy: requestUser(request, input.manager.trim()), updatedAt: now }, timeline: [], staffing: [], approvals: [], links: [] };
        database.releases.push(work);
        return work;
      });
      sendJson(response, 201, created);
      return;
    }
    if (releaseMatch && method === "GET") {
      const id = Number(releaseMatch[1]);
      const work = (await readDatabase()).releases.find((item) => item.release.id === id);
      sendJson(response, work ? 200 : 404, work || { error: "Release not found" });
      return;
    }
    if (releaseMatch && method === "PUT") {
      const id = Number(releaseMatch[1]);
      const input = await readBody(request);
      if (!isReleaseWork(input) || input.release.id !== id) { sendJson(response, 400, { error: "Invalid release data" }); return; }
      normalizeDatabase({ releases: [input] });
      const updated = await mutateDatabase((database) => {
        const index = database.releases.findIndex((item) => item.release.id === id);
        if (index < 0) return null;
        input.release.updatedBy = requestUser(request, input.release.updatedBy);
        input.release.updatedAt = new Date().toISOString();
        database.releases[index] = input;
        return input;
      });
      sendJson(response, updated ? 200 : 404, updated || { error: "Release not found" });
      return;
    }
    if (method === "GET" || method === "HEAD") { await serveStatic(pathname, response, method); return; }
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Internal server error" });
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`Release Hub server listening on http://${host}:${actualPort}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
