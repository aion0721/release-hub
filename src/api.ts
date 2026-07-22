import type { Category, CreateReleaseInput, ReleaseRecord, ReleaseSummary, ReleaseWork } from "./types";

const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";
const apiBase = configuredBase.replace(/\/$/, "");
const releasesPath = "/v2/releases";
const categoriesPath = "/v2/categories";

type RequestErrorMessages = {
  notFound?: string;
  failed?: string;
};

async function request<T>(path: string, init?: RequestInit, messages: RequestErrorMessages = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { accept: "application/json", ...init?.headers },
    ...init,
  });
  if (!response.ok) {
    const message = response.status === 404
      ? messages.notFound || "対象のデータが見つかりません"
      : messages.failed || "共有データを処理できませんでした";
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function workFromRecord(record: ReleaseRecord): ReleaseWork {
  const { id, ...work } = record;
  const legacyRelease = work.release as ReleaseWork["release"] & { version?: string };
  const { version, ...release } = legacyRelease;
  return {
    ...work,
    release: { ...release, id, projectNumber: release.projectNumber || version || "" },
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
  return workFromRecord(await request<ReleaseRecord>(`${releasesPath}/${id}`, undefined, {
    notFound: "対象の作業が見つかりません",
  }));
}

export async function createReleaseWork(input: CreateReleaseInput) {
  const now = new Date().toISOString();
  const draft: ReleaseWork = {
    release: {
      id: 0,
      systemId: input.systemId.trim(),
      name: input.name.trim(),
      projectNumber: input.projectNumber.trim(),
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
  }, { notFound: "対象の作業が見つかりません" });
  return workFromRecord(saved);
}

export async function deleteReleaseWork(id: number) {
  await request<ReleaseRecord>(`${releasesPath}/${id}`, { method: "DELETE" }, {
    notFound: "対象の作業が見つかりません",
  });
}

export async function fetchCategories(scope?: string) {
  const categories = await request<Category[]>(categoriesPath, undefined, {
    notFound: "カテゴリAPIが利用できません。APIサーバーのresourcesにcategoriesを追加してください",
  });
  return scope ? categories.filter((category) => category.scope === scope) : categories;
}

export async function createCategory(input: Omit<Category, "id">) {
  return request<Category>(categoriesPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function saveCategory(category: Category) {
  return request<Category>(`${categoriesPath}/${category.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(category),
  }, { notFound: "対象のカテゴリが見つかりません。一覧を更新してください" });
}

export async function deleteCategory(id: number) {
  await request<Category>(`${categoriesPath}/${id}`, { method: "DELETE" }, {
    notFound: "対象のカテゴリが見つかりません。一覧を更新してください",
  });
}
