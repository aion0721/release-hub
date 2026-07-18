import type { CreateReleaseInput, ReleaseSummary, ReleaseWork } from "./types";

const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";
const apiBase = configuredBase.replace(/\/$/, "");

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

export function fetchReleaseSummaries() {
  return request<ReleaseSummary[]>("/api/releases");
}

export function fetchReleaseWork(id: number) {
  return request<ReleaseWork>(`/api/releases/${id}`);
}

export function createReleaseWork(input: CreateReleaseInput) {
  return request<ReleaseWork>("/api/releases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function saveReleaseWork(work: ReleaseWork) {
  return request<ReleaseWork>(`/api/releases/${work.release.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(work),
  });
}
