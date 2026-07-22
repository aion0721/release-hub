import type { ApprovalCategory, CreateReleaseInput, ReleaseRecord, ReleaseSummary, ReleaseWork } from "./types";

const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";
const apiBase = configuredBase.replace(/\/$/, "");
const releasesPath = "/v2/releases";
const approvalCategoriesPath = "/v2/approval-categories";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { accept: "application/json", ...init?.headers },
    ...init,
  });
  if (!response.ok) {
    const message = response.status === 404 ? "対象の作業が見つかりません" : "共有データを処理できませんでした";
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function workFromRecord(record: ReleaseRecord): ReleaseWork {
  const { id, ...work } = record;
  return {
    ...work,
    release: { ...work.release, id },
    timeline: work.timeline ?? [],
    staffing: work.staffing ?? [],
    approvals: work.approvals ?? [],
    links: work.links ?? [],
  };
}

function recordFromWork(work: ReleaseWork): ReleaseRecord {
  return { ...work, id: work.release.id };
}

function summaryFromRecord(record: ReleaseRecord): ReleaseSummary {
  const work = workFromRecord(record);
  const done = work.timeline.filter((item) => item.status === "完了").length;
  return {
    ...work.release,
    progress: work.timeline.length ? Math.round((done / work.timeline.length) * 100) : 0,
    timelineCount: work.timeline.length,
    approvalCount: work.approvals.length,
  };
}

export async function fetchReleaseSummaries() {
  const records = await request<ReleaseRecord[]>(releasesPath);
  return records.map(summaryFromRecord).sort((left, right) => right.id - left.id);
}

export async function fetchReleaseWork(id: number) {
  return workFromRecord(await request<ReleaseRecord>(`${releasesPath}/${id}`));
}

export async function createReleaseWork(input: CreateReleaseInput) {
  const now = new Date().toISOString();
  const draft: ReleaseWork = {
    release: {
      id: 0,
      systemId: input.systemId.trim(),
      name: input.name.trim(),
      version: input.version.trim(),
      releaseDate: input.releaseDate.trim(),
      environment: input.environment.trim(),
      status: "準備中",
      manager: input.manager.trim(),
      updatedBy: input.manager.trim(),
      updatedAt: now,
    },
    timeline: [],
    staffing: [],
    approvals: [],
    links: [],
  };
  return createReleaseCopy(draft);
}

export async function createReleaseCopy(draft: ReleaseWork) {
  const created = await request<ReleaseRecord>(releasesPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...draft, release: { ...draft.release, id: 0 } }),
  });
  return workFromRecord(created);
}

export async function saveReleaseWork(work: ReleaseWork) {
  const saved = await request<ReleaseRecord>(`${releasesPath}/${work.release.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(recordFromWork(work)),
  });
  return workFromRecord(saved);
}

export async function deleteReleaseWork(id: number) {
  await request<ReleaseRecord>(`${releasesPath}/${id}`, { method: "DELETE" });
}

export async function fetchApprovalCategories() {
  return request<ApprovalCategory[]>(approvalCategoriesPath);
}

export async function createApprovalCategory(input: Omit<ApprovalCategory, "id">) {
  return request<ApprovalCategory>(approvalCategoriesPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, id: 0 }),
  });
}

export async function saveApprovalCategory(category: ApprovalCategory) {
  return request<ApprovalCategory>(`${approvalCategoriesPath}/${category.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(category),
  });
}

export async function deleteApprovalCategory(id: number) {
  await request<ApprovalCategory>(`${approvalCategoriesPath}/${id}`, { method: "DELETE" });
}
