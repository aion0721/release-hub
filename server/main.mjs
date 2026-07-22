import { createServer } from "node:http";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = join(projectRoot, "dist");
const dataDir = resolve(projectRoot, process.env.DATA_DIR || "data");
const dataFile = join(dataDir, "releases.json");
const categoriesFile = join(dataDir, "categories.json");
const legacyApprovalCategoriesFile = join(dataDir, "approval-categories.json");
const legacyDataFile = join(dataDir, "release.json");
const seedFile = join(projectRoot, "server", "seed.json");
const categoriesSeedFile = join(projectRoot, "server", "categories.seed.json");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const corsOrigin = process.env.CORS_ORIGIN || "";
let writeQueue = Promise.resolve();

const mimeTypes = new Map([[".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"], [".png", "image/png"], [".svg", "image/svg+xml"], [".webp", "image/webp"]]);

function recordsFromValue(value) {
  const works = Array.isArray(value) ? value : Array.isArray(value?.releases) ? value.releases : value?.release ? [value] : [];
  return works.map((value, index) => {
    const record = { ...value, id: Number(value.id || value.release?.id || index + 1) };
    return normalizeRecord(record);
  });
}

async function ensureDataFile() {
  await mkdir(dataDir, { recursive: true });
  try {
    await stat(dataFile);
    return;
  } catch {
    let source = seedFile;
    try {
      await stat(legacyDataFile);
      source = legacyDataFile;
    } catch {
      // Use the bundled seed when no legacy database exists.
    }
    const records = recordsFromValue(JSON.parse(await readFile(source, "utf8")));
    await writeFile(dataFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  }
}

async function readDatabase() {
  await ensureDataFile();
  return recordsFromValue(JSON.parse(await readFile(dataFile, "utf8")));
}

async function ensureCategoriesFile() {
  await mkdir(dataDir, { recursive: true });
  try {
    await stat(categoriesFile);
    return;
  } catch {
    let categories;
    try {
      await stat(legacyApprovalCategoriesFile);
      const legacy = JSON.parse(await readFile(legacyApprovalCategoriesFile, "utf8"));
      categories = Array.isArray(legacy) ? legacy.map((category) => ({ ...category, scope: "approval" })) : [];
    } catch {
      categories = JSON.parse(await readFile(categoriesSeedFile, "utf8"));
    }
    await writeFile(categoriesFile, `${JSON.stringify(categories, null, 2)}\n`, "utf8");
  }
}

async function readCategories() {
  await ensureCategoriesFile();
  const value = JSON.parse(await readFile(categoriesFile, "utf8"));
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object").map((item) => ({ id: Number(item.id), scope: String(item.scope || "approval"), name: String(item.name || ""), description: String(item.description || "") })) : [];
}

function normalizeRecord(record) {
  record.release ||= {};
  record.release.id = record.id;
  record.release.manager ||= record.release.updatedBy || "未設定";
  record.release.systemId ||= "未設定";
  record.release.projectNumber ||= record.release.version || "";
  delete record.release.version;
  record.timeline ||= [];
  record.staffing ||= [];
  record.approvals ||= [];
  record.links ||= [];
  normalizeTimeline(record);
  normalizeStaffing(record);
  return record;
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
  const result = new Date(`${String(value).replace(" ", "T")}:00Z`);
  result.setUTCMinutes(result.getUTCMinutes() + minutes);
  return result.toISOString().slice(0, 16);
}

function normalizeTimeline(work) {
  let dayOffset = 0;
  let previousMinutes = null;
  for (const item of work.timeline) {
    item.plan ||= "本線";
    item.kind ||= "作業";
    item.content ||= "";
    if (item.kind === "申請物" && Number.isInteger(Number(item.approvalId)) && Number(item.approvalId) > 0) item.approvalId = Number(item.approvalId);
    else delete item.approvalId;
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
    item.actualStartAt = item.actualStartAt ? String(item.actualStartAt).replace(" ", "T") : "";
    item.actualEndAt = item.actualEndAt ? String(item.actualEndAt).replace(" ", "T") : "";
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

async function writeDatabase(records) {
  const temporaryFile = `${dataFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  await rename(temporaryFile, dataFile);
}

async function writeCategories(categories) {
  const temporaryFile = `${categoriesFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(categories, null, 2)}\n`, "utf8");
  await rename(temporaryFile, categoriesFile);
}

function mutateDatabase(mutator) {
  const operation = writeQueue.then(async () => {
    const records = await readDatabase();
    const result = await mutator(records);
    await writeDatabase(records);
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function mutateCategories(mutator) {
  const operation = writeQueue.then(async () => {
    const categories = await readCategories();
    const result = await mutator(categories);
    await writeCategories(categories);
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function isReleaseWork(value) {
  return Boolean(value && typeof value === "object" && value.release && Array.isArray(value.timeline) && Array.isArray(value.staffing) && Array.isArray(value.approvals) && Array.isArray(value.links));
}

function isCategory(value) {
  return Boolean(value && typeof value === "object" && String(value.scope || "").trim() && String(value.name || "").trim());
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw Object.assign(new Error("Request body is too large"), { statusCode: 413 });
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { statusCode: 400 });
  }
}

function setCommonHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "SAMEORIGIN");
  response.setHeader("referrer-policy", "same-origin");
  if (corsOrigin) response.setHeader("access-control-allow-origin", corsOrigin);
  response.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
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
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

const server = createServer(async (request, response) => {
  setCommonHeaders(response);
  const method = request.method || "GET";
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  const releaseMatch = pathname.match(/^\/v2\/releases\/(\d+)$/);
  const categoryMatch = pathname.match(/^\/v2\/categories\/(\d+)$/);

  try {
    if (method === "OPTIONS") { response.writeHead(200); response.end(); return; }
    if (pathname === "/health") { sendJson(response, 200, { status: "ok", version: 2 }); return; }
    if (pathname === "/v2/releases" && method === "GET") {
      sendJson(response, 200, await readDatabase());
      return;
    }
    if (pathname === "/v2/releases" && method === "POST") {
      const input = await readBody(request);
      if (!isReleaseWork(input)) { sendJson(response, 400, { error: "Invalid release data" }); return; }
      const created = await mutateDatabase((records) => {
        const id = records.reduce((largest, record) => Math.max(largest, Number(record.id) || 0), 0) + 1;
        const record = normalizeRecord({ ...input, id });
        records.push(record);
        return record;
      });
      sendJson(response, 201, created);
      return;
    }
    if (releaseMatch && method === "GET") {
      const record = (await readDatabase()).find((item) => item.id === Number(releaseMatch[1]));
      sendJson(response, record ? 200 : 404, record || { error: "Resource item not found" });
      return;
    }
    if (releaseMatch && method === "PUT") {
      const id = Number(releaseMatch[1]);
      const input = await readBody(request);
      if (!isReleaseWork(input) || input.id !== id) { sendJson(response, 400, { error: "Resource id does not match request path" }); return; }
      const updated = await mutateDatabase((records) => {
        const index = records.findIndex((item) => item.id === id);
        if (index < 0) return null;
        records[index] = normalizeRecord(input);
        return records[index];
      });
      sendJson(response, updated ? 200 : 404, updated || { error: "Resource item not found" });
      return;
    }
    if (releaseMatch && method === "PATCH") {
      const id = Number(releaseMatch[1]);
      const input = await readBody(request);
      if (input.id !== undefined && Number(input.id) !== id) { sendJson(response, 400, { error: "Resource id does not match request path" }); return; }
      const patch = {};
      if (input.release && typeof input.release === "object") patch.release = input.release;
      for (const key of ["timeline", "staffing", "approvals", "links"]) {
        if (input[key] !== undefined) {
          if (!Array.isArray(input[key])) { sendJson(response, 400, { error: `Invalid ${key} data` }); return; }
          patch[key] = input[key];
        }
      }
      if (!Object.keys(patch).length) { sendJson(response, 400, { error: "No supported release fields supplied" }); return; }
      const updated = await mutateDatabase((records) => {
        const index = records.findIndex((item) => item.id === id);
        if (index < 0) return null;
        records[index] = normalizeRecord({ ...records[index], ...patch, id });
        return records[index];
      });
      sendJson(response, updated ? 200 : 404, updated || { error: "Resource item not found" });
      return;
    }
    if (releaseMatch && method === "DELETE") {
      const id = Number(releaseMatch[1]);
      const deleted = await mutateDatabase((records) => {
        const index = records.findIndex((item) => item.id === id);
        if (index < 0) return null;
        return records.splice(index, 1)[0];
      });
      sendJson(response, deleted ? 200 : 404, deleted || { error: "Resource item not found" });
      return;
    }
    if (pathname === "/v2/categories" && method === "GET") {
      sendJson(response, 200, await readCategories());
      return;
    }
    if (pathname === "/v2/categories" && method === "POST") {
      const input = await readBody(request);
      if (!isCategory(input)) { sendJson(response, 400, { error: "Invalid category data" }); return; }
      const created = await mutateCategories((categories) => {
        const id = categories.reduce((largest, category) => Math.max(largest, Number(category.id) || 0), 0) + 1;
        const category = { id, scope: String(input.scope).trim(), name: String(input.name).trim(), description: String(input.description || "").trim() };
        categories.push(category);
        return category;
      });
      sendJson(response, 201, created);
      return;
    }
    if (categoryMatch && method === "PUT") {
      const id = Number(categoryMatch[1]);
      const input = await readBody(request);
      if (!isCategory(input) || Number(input.id) !== id) { sendJson(response, 400, { error: "Resource id does not match request path" }); return; }
      const updated = await mutateCategories((categories) => {
        const index = categories.findIndex((category) => category.id === id);
        if (index < 0) return null;
        categories[index] = { id, scope: String(input.scope).trim(), name: String(input.name).trim(), description: String(input.description || "").trim() };
        return categories[index];
      });
      sendJson(response, updated ? 200 : 404, updated || { error: "Resource item not found" });
      return;
    }
    if (categoryMatch && method === "DELETE") {
      const id = Number(categoryMatch[1]);
      const deleted = await mutateCategories((categories) => {
        const index = categories.findIndex((category) => category.id === id);
        if (index < 0) return null;
        return categories.splice(index, 1)[0];
      });
      sendJson(response, deleted ? 200 : 404, deleted || { error: "Resource item not found" });
      return;
    }
    if (method === "GET" || method === "HEAD") { await serveStatic(pathname, response, method); return; }
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(response, Number(error?.statusCode) || 500, { error: error instanceof Error ? error.message : "Internal server error" });
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`Release Hub v2-compatible server listening on http://${host}:${actualPort}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
