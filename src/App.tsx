import { type CSSProperties, type DragEvent, type FormEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCategory, createReleaseCopy, createReleaseWork, deleteCategory, deleteReleaseWork, fetchCategories, fetchReleaseSummaries, fetchReleaseWork, saveCategory, saveReleaseWork } from "./api";
import { sampleWork } from "./sampleData";
import type { ApprovalItem, ApprovalStatus, Category, CreateReleaseInput, ReleaseSummary, ReleaseWork, ResourceLink, StaffingAssignment, TimelineItem, TimelineKind, TimelinePlan, TimelineStatus } from "./types";

type ModalType = "work" | "staffing" | "timeline" | "approval" | "link";
type PreviewItem = { type: "approval"; item: ApprovalItem } | { type: "link"; item: ResourceLink };
type EditTarget = { type: "work"; item: ReleaseWork["release"] } | { type: "staffing"; item: StaffingAssignment } | { type: "timeline"; item: TimelineItem } | { type: "approval"; item: ApprovalItem } | { type: "link"; item: ResourceLink };
const demoMode = import.meta.env.VITE_DEMO_MODE === "true";
const sampleApprovalCategories: Category[] = [
  { id: 1, scope: "approval", name: "資源配布", description: "サーバー、ストレージ、アカウントなどの資源配布に関する申請" },
  { id: 2, scope: "approval", name: "WF", description: "社内ワークフローで回付する申請" },
];

function nextId(items: Array<{ id: number }>) {
  return items.reduce((largest, item) => Math.max(largest, item.id), 0) + 1;
}

function toSummary(work: ReleaseWork): ReleaseSummary {
  const done = work.timeline.filter((item) => item.status === "完了").length;
  return {
    ...work.release,
    systemId: work.release.systemId || "未設定",
    progress: work.timeline.length ? Math.round((done / work.timeline.length) * 100) : 0,
    timelineCount: work.timeline.length,
    approvalCount: work.approvals.length,
  };
}

function normalizeSummary(item: ReleaseSummary): ReleaseSummary {
  return { ...item, systemId: item.systemId || "未設定" };
}

function normalizeApprovalStatus(status: string): ApprovalStatus {
  if (status === "承認済み") return "結了済";
  return (["未申請", "申請中", "回付済", "結了済"] as ApprovalStatus[]).includes(status as ApprovalStatus) ? status as ApprovalStatus : "未申請";
}

function normalizeDueDate(due: string, releaseDate: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  const legacy = due.match(/^(\d{1,2})\/(\d{1,2})$/);
  const year = releaseDate.match(/^(\d{4})/)?.[1];
  return legacy && year ? `${year}-${legacy[1].padStart(2, "0")}-${legacy[2].padStart(2, "0")}` : "";
}

function normalizeWork(work: ReleaseWork): ReleaseWork {
  return {
    ...work,
    release: { ...work.release, systemId: work.release.systemId || "未設定" },
    timeline: (work.timeline || []).map((item) => ({ ...item, kind: item.kind || "作業" })),
    approvals: (work.approvals || []).map((item) => ({ ...item, category: item.category || "", due: normalizeDueDate(item.due, work.release.releaseDate), status: normalizeApprovalStatus(item.status) })),
  };
}

type HistoryMode = "push" | "replace" | "none";

function releaseIdFromUrl() {
  const value = new URL(window.location.href).searchParams.get("release");
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function approvalCategoryAdminFromUrl() {
  return new URL(window.location.href).searchParams.get("view") === "approval-categories";
}

function updateReleaseUrl(id: number | null, mode: Exclude<HistoryMode, "none">) {
  const url = new URL(window.location.href);
  url.searchParams.delete("view");
  if (id === null) url.searchParams.delete("release");
  else url.searchParams.set("release", String(id));
  window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
}

function updateApprovalCategoryAdminUrl(mode: Exclude<HistoryMode, "none">) {
  const url = new URL(window.location.href);
  url.searchParams.delete("release");
  url.searchParams.set("view", "approval-categories");
  window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
}

function shiftDate(value: string, days: number) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

function buildReleaseCopy(source: ReleaseWork, input: CreateReleaseInput): ReleaseWork {
  const sourceDay = Date.parse(`${source.release.releaseDate.slice(0, 10)}T00:00:00Z`);
  const targetDay = Date.parse(`${input.releaseDate.slice(0, 10)}T00:00:00Z`);
  const dayDelta = Number.isFinite(sourceDay) && Number.isFinite(targetDay) ? Math.round((targetDay - sourceDay) / 86_400_000) : 0;
  const minuteDelta = toMinutes(input.releaseDate.replace(" ", "T")) - toMinutes(source.release.releaseDate.replace(" ", "T"));
  const shiftDateTime = (value: string) => value ? fromMinutes(toMinutes(value) + minuteDelta) : "";
  return {
    release: { id: 0, ...input, status: "準備中", updatedBy: input.manager, updatedAt: new Date().toISOString() },
    timeline: source.timeline.map((item) => ({ ...item, startAt: shiftDateTime(item.startAt), endAt: shiftDateTime(item.endAt), actualStartAt: "", actualEndAt: "", status: "未着手" })),
    staffing: source.staffing.map((item) => ({ ...item, startAt: shiftDateTime(item.startAt), endAt: shiftDateTime(item.endAt) })),
    approvals: source.approvals.map((item) => ({ ...item, due: shiftDate(item.due, dayDelta), status: "未申請", url: "" })),
    links: source.links.map((item) => ({ ...item })),
  };
}

export default function App() {
  const [showSplash, setShowSplash] = useState(() => sessionStorage.getItem("release-hub-splash-seen") !== "1");
  const [summaries, setSummaries] = useState<ReleaseSummary[]>([toSummary(sampleWork)]);
  const [demoWorks, setDemoWorks] = useState<ReleaseWork[]>([sampleWork]);
  const demoWorksRef = useRef(demoWorks);
  demoWorksRef.current = demoWorks;
  const [selected, setSelected] = useState<ReleaseWork | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [approvalCategories, setApprovalCategories] = useState<Category[]>(demoMode ? sampleApprovalCategories : []);
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [modal, setModal] = useState<ModalType | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [preview, setPreview] = useState<PreviewItem | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);

  const loadSummaries = useCallback(async () => {
    setLoading(true);
    if (demoMode) {
      setLoading(false);
      return;
    }
    try {
      setSummaries((await fetchReleaseSummaries()).map(normalizeSummary));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "作業一覧を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummaries();
    if (!demoMode) void fetchCategories("approval").then((categories) => { setApprovalCategories(categories); setCategoryError(""); }).catch((reason) => {
      setApprovalCategories([]);
      setCategoryError(reason instanceof Error ? reason.message : "申請種別を読み込めませんでした");
    });
  }, [loadSummaries]);

  useEffect(() => {
    const showFromUrl = () => {
      if (approvalCategoryAdminFromUrl()) {
        setSelected(null);
        setAdminOpen(true);
        return;
      }
      setAdminOpen(false);
      const id = releaseIdFromUrl();
      if (id === null) setSelected(null);
      else void openWork(id, "none");
    };
    showFromUrl();
    window.addEventListener("popstate", showFromUrl);
    return () => window.removeEventListener("popstate", showFromUrl);
  }, []);

  useEffect(() => {
    if (!showSplash) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      sessionStorage.setItem("release-hub-splash-seen", "1");
      setShowSplash(false);
    }, reducedMotion ? 350 : 1800);
    return () => window.clearTimeout(timer);
  }, [showSplash]);

  async function openWork(id: number, historyMode: HistoryMode = "push") {
    setAdminOpen(false);
    setLoading(true);
    if (demoMode) {
      const work = demoWorksRef.current.find((item) => item.release.id === id);
      setSelected(work ? normalizeWork(work) : null);
      setError(work ? "" : "共有URLの作業が見つかりません");
      if (work && historyMode !== "none") updateReleaseUrl(id, historyMode);
      setLoading(false);
      window.scrollTo({ top: 0 });
      return;
    }
    try {
      setSelected(normalizeWork(await fetchReleaseWork(id)));
      if (historyMode !== "none") updateReleaseUrl(id, historyMode);
      setError("");
      window.scrollTo({ top: 0 });
    } catch (reason) {
      if (id === sampleWork.release.id) {
        setSelected(sampleWork);
        if (historyMode !== "none") updateReleaseUrl(id, historyMode);
      }
      setError(reason instanceof Error ? reason.message : "作業を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }

  function showList(historyMode: HistoryMode = "push") {
    setSelected(null);
    setAdminOpen(false);
    if (historyMode !== "none") updateReleaseUrl(null, historyMode);
    window.scrollTo({ top: 0 });
  }

  function showApprovalCategoryAdmin(historyMode: HistoryMode = "push") {
    setSelected(null);
    setAdminOpen(true);
    if (historyMode !== "none") updateApprovalCategoryAdminUrl(historyMode);
    window.scrollTo({ top: 0 });
  }

  async function addApprovalCategory(name: string, description: string) {
    const normalizedName = name.trim();
    if (approvalCategories.some((category) => category.name.toLocaleLowerCase("ja") === normalizedName.toLocaleLowerCase("ja"))) {
      setCategoryError("同じ名前の申請種別がすでに登録されています");
      return false;
    }
    if (demoMode) {
      const id = nextId(approvalCategories);
      setApprovalCategories((current) => [...current, { id, scope: "approval", name: normalizedName, description: description.trim() }]);
      setCategoryError("");
      return true;
    }
    setCategorySaving(true);
    try {
      const created = await createCategory({ scope: "approval", name: normalizedName, description: description.trim() });
      setApprovalCategories((current) => [...current, created]);
      setCategoryError("");
      return true;
    } catch (reason) {
      setCategoryError(reason instanceof Error ? reason.message : "申請種別を追加できませんでした");
      return false;
    } finally {
      setCategorySaving(false);
    }
  }

  async function updateApprovalCategory(category: Category) {
    const normalizedName = category.name.trim();
    if (approvalCategories.some((item) => item.id !== category.id && item.name.toLocaleLowerCase("ja") === normalizedName.toLocaleLowerCase("ja"))) {
      setCategoryError("同じ名前の申請種別がすでに登録されています");
      return false;
    }
    const nextCategory = { ...category, name: normalizedName, description: category.description.trim() };
    if (demoMode) {
      setApprovalCategories((current) => current.map((item) => item.id === category.id ? nextCategory : item));
      setCategoryError("");
      return true;
    }
    setCategorySaving(true);
    try {
      const saved = await saveCategory(nextCategory);
      setApprovalCategories((current) => current.map((item) => item.id === saved.id ? saved : item));
      setCategoryError("");
      return true;
    } catch (reason) {
      setCategoryError(reason instanceof Error ? reason.message : "申請種別を更新できませんでした");
      return false;
    } finally {
      setCategorySaving(false);
    }
  }

  async function removeApprovalCategory(id: number) {
    if (demoMode) {
      setApprovalCategories((current) => current.filter((category) => category.id !== id));
      setCategoryError("");
      return true;
    }
    setCategorySaving(true);
    try {
      await deleteCategory(id);
      setApprovalCategories((current) => current.filter((category) => category.id !== id));
      setCategoryError("");
      return true;
    } catch (reason) {
      setCategoryError(reason instanceof Error ? reason.message : "申請種別を削除できませんでした");
      return false;
    } finally {
      setCategorySaving(false);
    }
  }

  async function commit(nextWork: ReleaseWork) {
    if (!selected) return;
    const previous = selected;
    const stamped: ReleaseWork = {
      ...nextWork,
      release: { ...nextWork.release, updatedAt: new Date().toLocaleString("ja-JP") },
    };
    setSelected(stamped);
    if (demoMode) {
      setDemoWorks((current) => current.map((work) => work.release.id === stamped.release.id ? stamped : work));
      setSummaries((current) => current.map((summary) => summary.id === stamped.release.id ? toSummary(stamped) : summary));
      setError("");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveReleaseWork(stamped);
      setSelected(saved);
      setSummaries((current) => current.map((summary) => summary.id === saved.release.id ? toSummary(saved) : summary));
      setError("");
    } catch (reason) {
      setSelected(previous);
      setError(reason instanceof Error ? reason.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedWork() {
    if (!selected) return;
    const id = selected.release.id;
    if (demoMode) {
      setDemoWorks((current) => current.filter((work) => work.release.id !== id));
      setSummaries((current) => current.filter((summary) => summary.id !== id));
      showList("replace");
      setDeleteConfirmOpen(false);
      setError("");
      return;
    }
    setSaving(true);
    try {
      await deleteReleaseWork(id);
      setSummaries((current) => current.filter((summary) => summary.id !== id));
      showList("replace");
      setDeleteConfirmOpen(false);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "作業を削除できませんでした");
    } finally {
      setSaving(false);
    }
  }

  function openModal(type: ModalType) {
    setFormError("");
    setEditTarget(null);
    setModal(type);
  }

  function openEditor(target: EditTarget) {
    setFormError("");
    setPreview(null);
    setEditTarget(target);
    setModal(target.type);
  }

  function closeModal() {
    setFormError("");
    setModal(null);
    setEditTarget(null);
  }

  function reorderTimeline(sourceId: number, targetId: number | null, targetPlan: TimelinePlan) {
    if (!selected) return;
    const sourceIndex = selected.timeline.findIndex((item) => item.id === sourceId);
    if (sourceIndex < 0) return;
    const source = selected.timeline[sourceIndex];
    if (sourceId === targetId && source.plan === targetPlan) return;
    const timeline = [...selected.timeline];
    const [moved] = timeline.splice(sourceIndex, 1);
    const updated = { ...moved, plan: targetPlan };
    if (targetId === null) {
      const lastPlanIndex = timeline.reduce((last, item, index) => item.plan === targetPlan ? index : last, -1);
      timeline.splice(lastPlanIndex + 1, 0, updated);
    } else {
      const targetIndex = timeline.findIndex((item) => item.id === targetId);
      if (targetIndex < 0) return;
      timeline.splice(targetIndex, 0, updated);
    }
    void commit({ ...selected, timeline });
  }

  function updateTimelineTime(id: number, startAt: string, endAt: string) {
    if (!selected) return;
    const timeline = selected.timeline.map((item) => item.id === id ? { ...item, startAt, endAt } : item);
    void commit({ ...selected, timeline });
  }

  function updateStaffingTime(id: number, startAt: string, endAt: string) {
    if (!selected) return;
    const staffing = selected.staffing.map((item) => item.id === id ? { ...item, startAt, endAt } : item);
    void commit({ ...selected, staffing });
  }

  function updateTimelineStatus(id: number, action: "start" | "complete") {
    if (!selected) return;
    const now = currentLocalDateTime();
    const timeline = selected.timeline.map((item) => {
      if (item.id !== id) return item;
      if (action === "start") return { ...item, status: "進行中" as TimelineStatus, actualStartAt: item.actualStartAt || now, actualEndAt: "" };
      const actualStartAt = item.actualStartAt || fromMinutes(toMinutes(now) - 1);
      const actualEndAt = toMinutes(now) > toMinutes(actualStartAt) ? now : fromMinutes(toMinutes(actualStartAt) + 1);
      return { ...item, status: "完了" as TimelineStatus, actualStartAt, actualEndAt };
    });
    void commit({ ...selected, timeline });
  }

  async function submitCopy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const input: CreateReleaseInput = {
      systemId: String(values.systemId),
      name: String(values.name),
      version: String(values.version),
      releaseDate: String(values.releaseDate).replace("T", " "),
      environment: String(values.environment),
      manager: String(values.manager),
    };
    const draft = buildReleaseCopy(selected, input);
    if (demoMode) {
      const id = demoWorks.reduce((largest, work) => Math.max(largest, work.release.id), 0) + 1;
      const created = { ...draft, release: { ...draft.release, id, updatedBy: "GitHub Pages Demo" } };
      setDemoWorks((current) => [created, ...current]);
      setSummaries((current) => [toSummary(created), ...current]);
      setSelected(created);
      setCopyOpen(false);
      updateReleaseUrl(id, "push");
      setError("");
      window.scrollTo({ top: 0 });
      return;
    }
    setSaving(true);
    try {
      const created = normalizeWork(await createReleaseCopy(draft));
      setSummaries((current) => [toSummary(created), ...current]);
      setSelected(created);
      setCopyOpen(false);
      updateReleaseUrl(created.release.id, "push");
      setError("");
      window.scrollTo({ top: 0 });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "作業をコピーできませんでした");
    } finally {
      setSaving(false);
    }
  }

  async function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());

    if (modal === "work") {
      if (editTarget?.type === "work" && selected) {
        const nextWork: ReleaseWork = {
          ...selected,
          release: {
            ...selected.release,
            systemId: String(values.systemId),
            name: String(values.name),
            version: String(values.version),
            releaseDate: String(values.releaseDate).replace("T", " "),
            environment: String(values.environment),
            manager: String(values.manager),
            status: String(values.status),
          },
        };
        closeModal();
        void commit(nextWork);
        return;
      }
      const input: CreateReleaseInput = {
        systemId: String(values.systemId),
        name: String(values.name),
        version: String(values.version),
        releaseDate: String(values.releaseDate).replace("T", " "),
        environment: String(values.environment),
        manager: String(values.manager),
      };
      if (demoMode) {
        const id = demoWorks.reduce((largest, work) => Math.max(largest, work.release.id), 0) + 1;
        const created: ReleaseWork = { release: { id, ...input, status: "準備中", updatedBy: "GitHub Pages Demo", updatedAt: new Date().toLocaleString("ja-JP") }, timeline: [], staffing: [], approvals: [], links: [] };
        setDemoWorks((current) => [created, ...current]);
        setSummaries((current) => [toSummary(created), ...current]);
        setSelected(created);
        updateReleaseUrl(id, "push");
        closeModal();
        setError("");
        return;
      }
      setSaving(true);
      try {
        const created = await createReleaseWork(input);
        setSummaries((current) => [toSummary(created), ...current]);
        setSelected(created);
        updateReleaseUrl(created.release.id, "push");
        closeModal();
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "作業を登録できませんでした");
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!selected) return;
    if (modal === "timeline") {
      values.startAt = `${String(values.workDate)}T${String(values.startTime)}`;
      values.endAt = `${String(values.endDate)}T${String(values.endTime)}`;
    }
    if ((modal === "staffing" || modal === "timeline") && String(values.endAt) <= String(values.startAt)) {
      setFormError("終了日時は開始日時より後にしてください。入力内容を確認してください。");
      return;
    }
    if (modal === "timeline" && values.actualEndAt && !values.actualStartAt) {
      setFormError("実績終了日時を入力する場合は、実績開始日時も入力してください。");
      return;
    }
    if (modal === "timeline" && values.actualStartAt && values.actualEndAt && String(values.actualEndAt) <= String(values.actualStartAt)) {
      setFormError("実績終了日時は実績開始日時より後にしてください。");
      return;
    }
    let nextWork = selected;
    if (modal === "staffing") {
      const editing = editTarget?.type === "staffing" ? editTarget.item : null;
      const item: StaffingAssignment = { id: editing?.id ?? nextId(selected.staffing), name: String(values.name), phone: String(values.phone || ""), startAt: String(values.startAt), endAt: String(values.endAt), location: String(values.location), note: String(values.note || "") };
      nextWork = { ...selected, staffing: editing ? selected.staffing.map((row) => row.id === editing.id ? item : row) : [...selected.staffing, item] };
    } else if (modal === "timeline") {
      const editing = editTarget?.type === "timeline" ? editTarget.item : null;
      const item: TimelineItem = { id: editing?.id ?? nextId(selected.timeline), startAt: String(values.startAt), endAt: String(values.endAt), actualStartAt: String(values.actualStartAt || ""), actualEndAt: String(values.actualEndAt || ""), title: String(values.title), owner: String(values.owner), status: String(values.status || "未着手") as TimelineStatus, plan: String(values.plan || "本線") as TimelinePlan, kind: String(values.kind || "作業") as TimelineKind };
      nextWork = { ...selected, timeline: editing ? selected.timeline.map((row) => row.id === editing.id ? item : row) : [...selected.timeline, item] };
    } else if (modal === "approval") {
      const editing = editTarget?.type === "approval" ? editTarget.item : null;
      const item: ApprovalItem = { id: editing?.id ?? nextId(selected.approvals), title: String(values.title), category: String(values.category || ""), owner: String(values.owner), due: String(values.due), status: String(values.status || "未申請") as ApprovalItem["status"], url: String(values.url) };
      nextWork = { ...selected, approvals: editing ? selected.approvals.map((row) => row.id === editing.id ? item : row) : [...selected.approvals, item] };
    } else {
      const editing = editTarget?.type === "link" ? editTarget.item : null;
      const item: ResourceLink = { id: editing?.id ?? nextId(selected.links), title: String(values.title), category: String(values.category), description: String(values.description), url: String(values.url) };
      nextWork = { ...selected, links: editing ? selected.links.map((row) => row.id === editing.id ? item : row) : [...selected.links, item] };
    }
    closeModal();
    void commit(nextWork);
  }

  return (
    <main className="app-shell">
      {showSplash && <div className="splash-screen" role="status" aria-label="Release Hubを起動しています"><img src={`${import.meta.env.BASE_URL}release-hub-splash.png`} alt="Release Hub リリース情報を、ひとつに。" /></div>}
      <Sidebar detailOpen={Boolean(selected)} adminOpen={adminOpen} onShowList={() => showList()} onShowAdmin={() => showApprovalCategoryAdmin()} />
      <section className="content">
        {error && <div className="error-banner">{error} — API起動前はサンプルデータを表示します</div>}
        {adminOpen ? (
          <ApprovalCategoryAdmin categories={approvalCategories} saving={categorySaving} error={categoryError} onBack={() => showList()} onCreate={addApprovalCategory} onSave={updateApprovalCategory} onDelete={removeApprovalCategory} />
        ) : selected ? (
          <WorkDetail work={selected} loading={loading} saving={saving} onBack={() => showList()} onCopy={() => setCopyOpen(true)} onDelete={() => setDeleteConfirmOpen(true)} onOpenModal={openModal} onOpenEditor={openEditor} onOpenPreview={setPreview} onReorderTimeline={reorderTimeline} onUpdateTimelineTime={updateTimelineTime} onUpdateStaffingTime={updateStaffingTime} onUpdateTimelineStatus={updateTimelineStatus} />
        ) : (
          <WorkList summaries={summaries} loading={loading} onCreate={() => openModal("work")} onRefresh={() => void loadSummaries()} onOpen={openWork} />
        )}
      </section>
      {modal && <ItemModal type={modal} editTarget={editTarget} releaseDate={selected?.release.releaseDate} staffing={selected?.staffing || []} approvalCategories={approvalCategories} formError={formError} saving={saving} onClose={closeModal} onSubmit={submitItem} />}
      {preview && <PreviewModal preview={preview} onClose={() => setPreview(null)} onEdit={(target) => openEditor(target)} />}
      {copyOpen && selected && <CopyWorkModal work={selected} saving={saving} onClose={() => setCopyOpen(false)} onSubmit={submitCopy} />}
      {deleteConfirmOpen && selected && <DeleteConfirmModal work={selected} saving={saving} onClose={() => setDeleteConfirmOpen(false)} onConfirm={() => void deleteSelectedWork()} />}
    </main>
  );
}

function Sidebar({ detailOpen, adminOpen, onShowList, onShowAdmin }: { detailOpen: boolean; adminOpen: boolean; onShowList: () => void; onShowAdmin: () => void }) {
  return <aside className="sidebar">
    <div className="brand"><span className="brand-mark">R</span><span>Release Hub</span></div>
    <nav aria-label="メインメニュー">
      {!detailOpen && !adminOpen ? <span className="nav-item nav-current active"><span>▦</span>作業一覧</span> : <button className="nav-item nav-back" onClick={onShowList}><span>‹</span>作業一覧へ戻る</button>}{detailOpen && <><span className="nav-group-label">この作業</span><div className="nav-children"><a className="nav-item" href="#overview"><span>⌂</span>作業概要</a><a className="nav-item" href="#timeline"><span>◷</span>当日オペレーション</a><a className="nav-item" href="#approvals"><span>✓</span>申請物</a><a className="nav-item" href="#links"><span>↗</span>リンク集</a></div></>}<span className="nav-group-label">管理</span><button className={`nav-item ${adminOpen ? "active" : ""}`} onClick={onShowAdmin}><span>⚙</span>申請種別管理</button>
    </nav>
    <div className="side-note"><strong>親子構造で管理</strong><span>作業を登録し、必要な明細をひとつに集約</span></div>
    <div className="user-chip"><span className="avatar">RT</span><div><strong>Release Team</strong><small>社内環境</small></div></div>
  </aside>;
}

function ApprovalCategoryAdmin({ categories, saving, error, onBack, onCreate, onSave, onDelete }: { categories: Category[]; saving: boolean; error: string; onBack: () => void; onCreate: (name: string, description: string) => Promise<boolean>; onSave: (category: Category) => Promise<boolean>; onDelete: (id: number) => Promise<boolean> }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  async function submitNew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (await onCreate(String(values.name), String(values.description || ""))) form.reset();
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, category: Category) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (await onSave({ ...category, name: String(values.name), description: String(values.description || "") })) setEditingId(null);
  }

  async function confirmDelete(id: number) {
    if (await onDelete(id)) setDeleteId(null);
  }

  return <>
    <header className="topbar admin-topbar"><div><button className="back-button" onClick={onBack}>‹ 作業一覧</button><span className="eyebrow">ADMINISTRATION</span><h1>申請種別管理</h1><p>申請物で利用するカテゴリ候補を管理します。認証・権限制御なしで利用できます。</p></div></header>
    <section className="admin-overview"><div><span className="section-kicker">APPROVAL CATEGORY MASTER</span><strong>{categories.length}</strong><p>登録済みの申請種別</p></div><div><strong>自由入力対応</strong><p>申請登録時はマスタ選択のほか、任意の種別名も入力できます。</p></div></section>
    {error && <div className="admin-error" role="alert">{error}</div>}
    <div className="admin-grid">
      <section className="panel category-create-panel"><div className="panel-heading"><div><span className="section-kicker">NEW CATEGORY</span><h2>申請種別を追加</h2></div></div><form onSubmit={submitNew}><label>申請種別名<input name="name" placeholder="例：資源配布、WF" required autoFocus /></label><label>説明（任意）<textarea name="description" rows={4} placeholder="利用目的や対象となる申請を記載" /></label><button type="submit" className="primary-button" disabled={saving}>{saving ? "保存中" : "＋ 申請種別を追加"}</button></form></section>
      <section className="panel category-list-panel"><div className="panel-heading"><div><span className="section-kicker">CATEGORIES</span><h2>登録済み申請種別</h2></div><span className="list-count">{categories.length}件</span></div><div className="category-list">
        {categories.map((category) => editingId === category.id ? <form className="category-edit-row" key={category.id} onSubmit={(event) => void submitEdit(event, category)}><label>申請種別名<input name="name" defaultValue={category.name} required autoFocus /></label><label>説明（任意）<textarea name="description" defaultValue={category.description} rows={3} /></label><div><button type="button" className="ghost-button" onClick={() => setEditingId(null)} disabled={saving}>キャンセル</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "保存中" : "変更を保存"}</button></div></form> : <article className="category-row" key={category.id}><span className="category-icon">✓</span><div><strong>{category.name}</strong><p>{category.description || "説明未設定"}</p></div>{deleteId === category.id ? <div className="category-delete-confirm"><span>削除しますか？</span><button type="button" onClick={() => setDeleteId(null)} disabled={saving}>戻る</button><button type="button" className="danger" onClick={() => void confirmDelete(category.id)} disabled={saving}>削除</button></div> : <div className="category-row-actions"><button type="button" onClick={() => { setEditingId(category.id); setDeleteId(null); }} disabled={saving}>編集</button><button type="button" className="danger" onClick={() => { setDeleteId(category.id); setEditingId(null); }} disabled={saving}>削除</button></div>}</article>)}
        {!categories.length && <div className="empty-state compact"><span>＋</span><h3>申請種別がありません</h3><p>左のフォームから最初の申請種別を登録してください。</p></div>}
      </div></section>
    </div>
  </>;
}

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7);
}

function buildCalendarDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    const value = date.toISOString().slice(0, 10);
    return { value, day: date.getUTCDate(), inMonth: value.slice(0, 7) === month };
  });
}

function formatMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${year}年 ${monthNumber}月`;
}

function WorkList({ summaries, loading, onCreate, onRefresh, onOpen }: { summaries: ReleaseSummary[]; loading: boolean; onCreate: () => void; onRefresh: () => void; onOpen: (id: number) => void }) {
  const [view, setView] = useState<"list" | "calendar">("list");
  const [systemFilter, setSystemFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all");
  const [calendarMonth, setCalendarMonth] = useState(() => summaries[0]?.releaseDate.slice(0, 7) || new Date().toISOString().slice(0, 7));
  const systemIds = useMemo(() => [...new Set(summaries.map((item) => item.systemId))].sort((a, b) => a.localeCompare(b, "ja")), [summaries]);
  const systemFiltered = useMemo(() => systemFilter === "all" ? summaries : summaries.filter((item) => item.systemId === systemFilter), [summaries, systemFilter]);
  const filtered = useMemo(() => systemFiltered.filter((item) => statusFilter === "all" || (statusFilter === "completed" ? item.status === "完了" : item.status !== "完了")), [systemFiltered, statusFilter]);
  const activeCount = systemFiltered.filter((item) => item.status !== "完了").length;
  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);
  return <>
    <header className="topbar list-topbar"><div><span className="eyebrow">RELEASE WORKS</span><h1>リリース作業</h1><p>SystemIDごと、または全体の作業予定を一覧・カレンダーで確認できます。</p></div><div className="list-actions"><button className="ghost-button" onClick={onRefresh} disabled={loading}>↻ {loading ? "更新中" : "一覧を更新"}</button><button className="primary-button" onClick={onCreate}>＋ 新しい作業を登録</button></div></header>
    <section className="list-hero">
      <div><span className="section-kicker">OVERVIEW</span><strong>{filtered.length}</strong><p>{systemFilter === "all" ? "全SystemIDのリリース作業" : `${systemFilter} のリリース作業`}</p></div>
      <div><span>進行中・準備中</span><strong>{activeCount}</strong></div>
      <div><span>今後の流れ</span><ol><li><i>1</i>作業を登録</li><li><i>2</i>明細を追加</li><li><i>3</i>当日の進捗を更新</li></ol></div>
    </section>
    <section className="panel work-list-panel">
      <div className="panel-heading work-list-heading"><div><span className="section-kicker">{view === "list" ? "RELEASE QUEUE" : "RELEASE CALENDAR"}</span><h2>{view === "list" ? "作業を選択" : "作業カレンダー"}</h2></div><div className="work-view-controls"><label>SystemID<select value={systemFilter} onChange={(event) => setSystemFilter(event.target.value)} aria-label="SystemIDで絞り込み"><option value="all" key="all">すべて</option>{systemIds.map((systemId) => <option value={systemId} key={systemId}>{systemId}</option>)}</select></label><label>作業状態<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "completed")} aria-label="作業状態で絞り込み"><option value="all">すべて</option><option value="active">未完了</option><option value="completed">完了</option></select></label><div className="view-switch" aria-label="作業表示"><button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-pressed={view === "list"}>☷ リスト</button><button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")} aria-pressed={view === "calendar"}>▦ カレンダー</button></div><span className="list-count">{filtered.length}件</span></div></div>
      {view === "list" ? <><div className="work-table-head"><span>作業名</span><span>SystemID</span><span>作業日時</span><span>責任者</span><span>進捗</span><span>状態</span><span /></div><div className="work-list">
        {filtered.map((work) => <button className="work-row" key={work.id} onClick={() => onOpen(work.id)} disabled={loading}>
          <span className="work-title"><i>{work.name.slice(0, 1)}</i><span><strong>{work.name}</strong><small>{work.version ? `${work.version}・` : ""}{work.environment}</small></span></span><span className="system-id-badge">{work.systemId}</span>
          <span className="work-date">{work.releaseDate}</span><span>{work.manager}</span><span className="row-progress"><span><i style={{ width: `${work.progress}%` }} /></span><b>{work.progress}%</b><small>{work.timelineCount}工程</small></span><span><em className={`release-status release-status-${work.status}`}>{work.status}</em></span><span className="row-arrow">›</span>
        </button>)}
        {!filtered.length && <div className="empty-state"><span>＋</span><h3>{summaries.length ? "該当する作業はありません" : "最初の作業を登録しましょう"}</h3><p>{summaries.length ? "SystemIDまたは作業状態の絞り込み条件を変更してください。" : "登録後にタイムチャートや申請物を追加できます。"}</p>{!summaries.length && <button className="primary-button" onClick={onCreate}>作業を登録</button>}</div>}
      </div></> : <div className="release-calendar"><div className="calendar-toolbar"><button type="button" onClick={() => setCalendarMonth((month) => shiftMonth(month, -1))} aria-label="前の月">‹</button><strong>{formatMonth(calendarMonth)}</strong><button type="button" onClick={() => setCalendarMonth((month) => shiftMonth(month, 1))} aria-label="次の月">›</button></div><div className="calendar-weekdays">{["日", "月", "火", "水", "木", "金", "土"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{calendarDays.map((day) => { const works = filtered.filter((work) => work.releaseDate.slice(0, 10) === day.value); return <div className={`calendar-day ${day.inMonth ? "" : "outside"}`} key={day.value}><span className="calendar-day-number">{day.day}</span><div className="calendar-events">{works.map((work) => <button type="button" key={work.id} onClick={() => onOpen(work.id)} disabled={loading} aria-label={`${work.name}の詳細を開く`}><span>{work.releaseDate.slice(11, 16)}</span><strong>{work.name}</strong><small>{work.systemId}</small></button>)}</div></div>; })}</div></div>}
    </section>
  </>;
}

function WorkDetail({ work, loading, saving, onBack, onCopy, onDelete, onOpenModal, onOpenEditor, onOpenPreview, onReorderTimeline, onUpdateTimelineTime, onUpdateStaffingTime, onUpdateTimelineStatus }: { work: ReleaseWork; loading: boolean; saving: boolean; onBack: () => void; onCopy: () => void; onDelete: () => void; onOpenModal: (type: ModalType) => void; onOpenEditor: (target: EditTarget) => void; onOpenPreview: (preview: PreviewItem) => void; onReorderTimeline: (sourceId: number, targetId: number | null, targetPlan: TimelinePlan) => void; onUpdateTimelineTime: (id: number, startAt: string, endAt: string) => void; onUpdateStaffingTime: (id: number, startAt: string, endAt: string) => void; onUpdateTimelineStatus: (id: number, action: "start" | "complete") => void }) {
  const [timelineView, setTimelineView] = useState<"list" | "gantt">("list");
  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");
  const progress = useMemo(() => work.timeline.length ? Math.round((work.timeline.filter((item) => item.status === "完了").length / work.timeline.length) * 100) : 0, [work.timeline]);
  const completed = work.timeline.filter((item) => item.status === "完了").length;
  const approved = work.approvals.filter((item) => item.status === "結了済").length;
  async function copyShareUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set("release", String(work.release.id));
    try {
      await navigator.clipboard.writeText(url.toString());
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 2_000);
    } catch {
      setShareState("failed");
    }
  }
  return <>
    <header className="topbar"><div><button className="back-button" onClick={onBack}>‹ 作業一覧</button><span className="eyebrow">RELEASE CONTROL CENTER</span><h1>{work.release.name}</h1></div><div className="top-actions"><span className={`live-dot ${saving ? "saving" : ""}`} /><span>{saving ? "保存中" : "共有済み"}</span><button className="ghost-button" onClick={() => void copyShareUrl()}>↗ {shareState === "copied" ? "URLをコピーしました" : shareState === "failed" ? "コピーできませんでした" : "共有URLをコピー"}</button><button className="ghost-button" onClick={onCopy} disabled={loading || saving}>⧉ 作業をコピー</button><button className="danger-button" onClick={onDelete} disabled={loading || saving}>作業を削除</button><button className="ghost-button" onClick={() => onOpenEditor({ type: "work", item: work.release })}>作業情報を編集</button><button className="primary-button" onClick={() => onOpenModal("timeline")}>＋ 作業明細を追加</button></div></header>
    <div id="overview" className="release-banner"><div className="release-main"><span className="status-pill">{work.release.status}</span><h2>{work.release.version || "バージョン未設定"}</h2><p><span className="system-id-badge">{work.release.systemId}</span>{work.release.environment} 環境</p></div><div className="release-meta"><div><span>実施日時</span><strong>{work.release.releaseDate}</strong></div><div><span>責任者</span><strong>{work.release.manager}</strong></div><div><span>作業進捗</span><strong>{progress}%</strong></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div></div>
    <div className="summary-grid"><article className="metric-card"><span className="metric-icon blue">◷</span><div><small>作業項目</small><strong>{work.timeline.length}</strong><em>件</em></div><p>{completed}件 完了</p></article><article className="metric-card"><span className="metric-icon purple">♙</span><div><small>当日体制</small><strong>{work.staffing.length}</strong><em>名</em></div><p>対応メンバー</p></article><article className="metric-card"><span className="metric-icon green">✓</span><div><small>申請・承認</small><strong>{approved}</strong><em>/{work.approvals.length}</em></div><p>結了済み</p></article><article className="metric-card"><span className="metric-icon amber">↗</span><div><small>関連資料</small><strong>{work.links.length}</strong><em>件</em></div><p>すぐにアクセス</p></article></div>
    <div className="workspace-grid"><section id="timeline" className={`panel timeline-panel ${timelineView === "gantt" ? "gantt-panel" : ""}`}><div className="panel-heading"><div><span className="section-kicker">ALL-IN-ONE</span><h2>当日オペレーション</h2><p className="timeline-drag-hint">{timelineView === "list" ? "作業と当日体制を一覧で編集。作業行は上下にドラッグ可能" : "作業と当日体制を同じ時間軸で表示。各バーは5分単位でドラッグ変更"}</p></div><div className="panel-actions"><div className="view-switch" aria-label="オールインワン表示"><button className={timelineView === "list" ? "active" : ""} onClick={() => setTimelineView("list")} aria-pressed={timelineView === "list"}>☷ リスト</button><button className={timelineView === "gantt" ? "active" : ""} onClick={() => setTimelineView("gantt")} aria-pressed={timelineView === "gantt"}>▥ ガント</button></div><button className="staffing-button" onClick={() => onOpenModal("staffing")}>＋ 体制を追加</button><button className="primary-button compact-button" onClick={() => onOpenModal("timeline")}>＋ 作業</button></div></div>{timelineView === "list" ? <AllInOneList items={work.timeline} assignments={work.staffing} disabled={loading || saving} onEditTimeline={(item) => onOpenEditor({ type: "timeline", item })} onEditStaffing={(item) => onOpenEditor({ type: "staffing", item })} onReorder={onReorderTimeline} onStatusChange={onUpdateTimelineStatus} /> : <GanttChart items={work.timeline} assignments={work.staffing} disabled={loading || saving} onEdit={(item) => onOpenEditor({ type: "timeline", item })} onEditStaffing={(item) => onOpenEditor({ type: "staffing", item })} onTimeChange={onUpdateTimelineTime} onStaffingTimeChange={onUpdateStaffingTime} onStatusChange={onUpdateTimelineStatus} />}</section>
      <section id="approvals" className="panel approvals-panel"><div className="panel-heading"><div><span className="section-kicker">APPROVALS</span><h2>申請物一覧</h2></div><button className="ghost-button" onClick={() => onOpenModal("approval")}>＋ 追加</button></div><div className="approval-list">{work.approvals.map((item) => <button type="button" key={item.id} className="approval-row" onClick={() => onOpenPreview({ type: "approval", item })} aria-label={`${item.title}の詳細を開く`}><span className={`approval-status-icon status-${item.status}`} aria-hidden="true">{item.status === "未申請" ? "○" : item.status === "申請中" ? "↗" : item.status === "回付済" ? "⇢" : "✓"}</span><span><strong>{item.title}</strong><small>{item.category ? <b className="approval-category-badge">{item.category}</b> : null}{item.owner}・期限 {formatDueDate(item.due)}</small></span><span className={`tag status-${item.status}`}>{item.status}</span><span className="external-link">詳細を見る ›</span></button>)}{!work.approvals.length && <p className="section-empty">まだ申請物はありません</p>}</div></section></div>
    <section id="links" className="panel links-panel"><div className="panel-heading"><div><span className="section-kicker">RESOURCES</span><h2>手順書・関連リンク</h2></div><button className="ghost-button" onClick={() => onOpenModal("link")}>＋ 追加</button></div><div className="link-grid">{work.links.map((item) => <button type="button" key={item.id} className="link-card" onClick={() => onOpenPreview({ type: "link", item })} aria-label={`${item.title}の詳細を開く`}><span className="doc-icon">▤</span><span><small>{item.category}</small><strong>{item.title}</strong><p>{item.description}</p></span><b>›</b></button>)}</div>{!work.links.length && <p className="section-empty links-empty">まだリンクはありません</p>}</section>
    <footer>最終更新：{work.release.updatedAt || "未更新"} ・ {work.release.updatedBy}</footer>
  </>;
}

function TimelineList({ items, disabled, onEdit, onReorder, onStatusChange }: { items: TimelineItem[]; disabled: boolean; onEdit: (item: TimelineItem) => void; onReorder: (sourceId: number, targetId: number | null, targetPlan: TimelinePlan) => void; onStatusChange: (id: number, action: "start" | "complete") => void }) {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const plans: TimelinePlan[] = ["本線", "コンチプラン"];
  if (!items.length) return <p className="section-empty">まだ作業明細はありません</p>;
  return <div className="timeline-list">{plans.map((plan) => {
    const planItems = items.filter((item) => item.plan === plan);
    return <section className={`timeline-group plan-${plan}`} key={plan} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const sourceId = Number(event.dataTransfer.getData("text/plain")) || draggingId; if (sourceId) onReorder(sourceId, null, plan); setDraggingId(null); }}><div className="timeline-group-heading"><h3>{plan}</h3><span>{planItems.length}件</span></div>
      {planItems.length ? planItems.map((item, index) => <div key={item.id} draggable={!disabled} className={`timeline-row ${item.status === "完了" ? "done" : ""} ${draggingId === item.id ? "dragging" : ""}`} onClick={() => onEdit(item)} onKeyDown={(event) => { if (event.key === "Enter") onEdit(item); }} onDragStart={(event: DragEvent<HTMLDivElement>) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(item.id)); setDraggingId(item.id); }} onDragEnd={() => setDraggingId(null)} onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); const sourceId = Number(event.dataTransfer.getData("text/plain")) || draggingId; if (sourceId) onReorder(sourceId, item.id, plan); setDraggingId(null); }} role="button" tabIndex={disabled ? -1 : 0} aria-label={`${item.title}を編集`} title="ドラッグして並べ替え。クリックで編集"><span className="drag-handle">⋮⋮</span><span className="time">{formatDateTime(item.startAt)}</span><span className="line"><i>{item.status === "完了" ? "✓" : index + 1}</i></span><span className="task"><strong><b className={`timeline-kind kind-${item.kind || "作業"}`}>{item.kind || "作業"}</b>{item.title}</strong><small><b className="time-kind planned">予定</b>担当：{item.owner}・{formatDateTimeRange(item.startAt, item.endAt)}</small><small className={`actual-time ${item.actualStartAt ? "recorded" : ""}`}><b className="time-kind actual">実績</b>{item.actualStartAt ? item.actualEndAt ? formatDateTimeRange(item.actualStartAt, item.actualEndAt) : `${formatDateTime(item.actualStartAt)}–進行中` : "未入力"}</small></span><span className="timeline-row-actions"><span className={`tag status-${item.status}`}>{item.status}</span>{item.status === "未着手" && <button type="button" className="timeline-action start" disabled={disabled} onClick={(event) => { event.stopPropagation(); onStatusChange(item.id, "start"); }}>▶ 開始</button>}{item.status === "進行中" && <button type="button" className="timeline-action complete" disabled={disabled} onClick={(event) => { event.stopPropagation(); onStatusChange(item.id, "complete"); }}>✓ 完了</button>}</span></div>) : <p className="timeline-group-empty">ここにドロップして移動</p>}
    </section>;
  })}</div>;
}

function dateTimeParts(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!match) return { year: 1970, month: 1, day: 1, hours: 0, minutes: 0 };
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hours: Number(match[4]), minutes: Number(match[5]) };
}

function toMinutes(value: string) {
  const { year, month, day, hours, minutes } = dateTimeParts(value);
  return Date.UTC(year, month - 1, day, hours, minutes) / 60_000;
}

function formatMinutes(minutes: number) {
  const date = new Date(minutes * 60_000);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function formatDateTime(value: string) {
  const { month, day, hours, minutes } = dateTimeParts(value);
  return `${month}/${day} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatDueDate(value: string) {
  const match = value.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : "未設定";
}

function formatDateTimeRange(startAt: string, endAt: string) {
  const start = dateTimeParts(startAt);
  const end = dateTimeParts(endAt);
  const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;
  const endText = sameDay ? `${String(end.hours).padStart(2, "0")}:${String(end.minutes).padStart(2, "0")}` : formatDateTime(endAt);
  return `${formatDateTime(startAt)}–${endText}`;
}

function fromMinutes(minutes: number) {
  return new Date(minutes * 60_000).toISOString().slice(0, 16);
}

function currentLocalMinutes() {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()) / 60_000;
}

function currentLocalDateTime() {
  return fromMinutes(currentLocalMinutes());
}

function AllInOneList({ items, assignments, disabled, onEditTimeline, onEditStaffing, onReorder, onStatusChange }: { items: TimelineItem[]; assignments: StaffingAssignment[]; disabled: boolean; onEditTimeline: (item: TimelineItem) => void; onEditStaffing: (item: StaffingAssignment) => void; onReorder: (sourceId: number, targetId: number | null, targetPlan: TimelinePlan) => void; onStatusChange: (id: number, action: "start" | "complete") => void }) {
  return <div className="all-in-one-list">
    <section className="operation-list-section"><div className="operation-subheading"><div><span className="operation-icon work">◷</span><h3>タイムチャート</h3></div><span>{items.length}件</span></div><TimelineList items={items} disabled={disabled} onEdit={onEditTimeline} onReorder={onReorder} onStatusChange={onStatusChange} /></section>
    <section id="staffing" className="operation-list-section"><div className="operation-subheading"><div><span className="operation-icon staffing">♙</span><h3>当日体制</h3></div><span>{assignments.length}名</span></div>
      {!assignments.length ? <p className="section-empty">まだ当日の体制は登録されていません</p> : <div className="staffing-compact-list">{assignments.map((assignment) => <button type="button" className="staffing-compact-row" key={assignment.id} onClick={() => onEditStaffing(assignment)} disabled={disabled} aria-label={`${assignment.name}の体制を編集`}><span className="member-avatar">{assignment.name.slice(0, 1)}</span><span className="staffing-person"><strong>{assignment.name}</strong><small>{assignment.phone || "電話番号未登録"}</small></span><span className="staffing-time"><strong>{formatDateTimeRange(assignment.startAt, assignment.endAt)}</strong><small>{assignment.location}{assignment.note ? `・${assignment.note}` : ""}</small></span><span className="row-arrow">›</span></button>)}</div>}
    </section>
  </div>;
}

type GanttDrag = { id: number; itemType: "timeline" | "staffing"; mode: "move" | "start" | "end"; pointerId: number; originX: number; start: number; end: number; currentStart: number; currentEnd: number; laneWidth: number; moved: boolean };

function GanttChart({ items, assignments, disabled, onEdit, onEditStaffing, onTimeChange, onStaffingTimeChange, onStatusChange }: { items: TimelineItem[]; assignments: StaffingAssignment[]; disabled: boolean; onEdit: (item: TimelineItem) => void; onEditStaffing: (item: StaffingAssignment) => void; onTimeChange: (id: number, startAt: string, endAt: string) => void; onStaffingTimeChange: (id: number, startAt: string, endAt: string) => void; onStatusChange: (id: number, action: "start" | "complete") => void }) {
  const dragRef = useRef<GanttDrag | null>(null);
  const suppressClickRef = useRef(false);
  const lockedRangeRef = useRef<{ start: number; end: number } | null>(null);
  const [draftTimes, setDraftTimes] = useState<Record<string, { start: number; end: number }>>({});
  const [currentMinute, setCurrentMinute] = useState(currentLocalMinutes);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentMinute(currentLocalMinutes()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!items.length && !assignments.length) return <p className="section-empty">表示する作業・当日体制がありません</p>;
  const ranges = items.map((item) => {
    const start = toMinutes(item.startAt);
    const actualStart = item.actualStartAt ? toMinutes(item.actualStartAt) : null;
    const actualEnd = actualStart === null ? null : item.actualEndAt ? toMinutes(item.actualEndAt) : actualStart + 5;
    return { item, start, end: toMinutes(item.endAt), actualStart, actualEnd };
  });
  const staffingRanges = assignments.map((assignment) => ({ assignment, start: toMinutes(assignment.startAt), end: toMinutes(assignment.endAt) }));
  const starts = [...ranges.map((range) => range.start), ...ranges.flatMap((range) => range.actualStart === null ? [] : [range.actualStart]), ...staffingRanges.map((range) => range.start)];
  const ends = [...ranges.map((range) => range.end), ...ranges.flatMap((range) => range.actualEnd === null ? [] : [range.actualEnd]), ...staffingRanges.map((range) => range.end)];
  const candidateStart = Math.floor(Math.min(...starts) / 60) * 60 - 60;
  const candidateEnd = Math.max(candidateStart + 120, Math.ceil(Math.max(...ends) / 60) * 60 + 60);
  const rangeStart = lockedRangeRef.current ? Math.min(lockedRangeRef.current.start, candidateStart) : candidateStart;
  const rangeEnd = lockedRangeRef.current ? Math.max(lockedRangeRef.current.end, candidateEnd) : candidateEnd;
  lockedRangeRef.current = { start: rangeStart, end: rangeEnd };
  const duration = rangeEnd - rangeStart;
  const ticks = Array.from({ length: Math.floor(duration / 60) + 1 }, (_, index) => rangeStart + index * 60);
  const currentTimeVisible = currentMinute >= rangeStart && currentMinute <= rangeEnd;
  const currentTimeLeft = `${((currentMinute - rangeStart) / duration) * 100}%`;

  function draftKey(itemType: GanttDrag["itemType"], id: number) {
    return `${itemType}-${id}`;
  }

  function beginTimeDrag(event: ReactPointerEvent<HTMLElement>, id: number, itemType: GanttDrag["itemType"], mode: GanttDrag["mode"], start: number, end: number) {
    if (disabled) return;
    const lane = event.currentTarget.closest(".gantt-lane");
    if (!(lane instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id, itemType, mode, pointerId: event.pointerId, originX: event.clientX, start, end, currentStart: start, currentEnd: end, laneWidth: lane.getBoundingClientRect().width, moved: false };
    setDraftTimes((current) => ({ ...current, [draftKey(itemType, id)]: { start, end } }));
  }

  function moveTimeDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rawDelta = ((event.clientX - drag.originX) / Math.max(1, drag.laneWidth)) * duration;
    const delta = Math.round(rawDelta / 5) * 5;
    let start = drag.start;
    let end = drag.end;
    if (drag.mode === "move") {
      const boundedDelta = Math.max(rangeStart - drag.start, Math.min(rangeEnd - drag.end, delta));
      start += boundedDelta;
      end += boundedDelta;
    } else if (drag.mode === "start") {
      start = Math.max(rangeStart, Math.min(drag.end - 5, drag.start + delta));
    } else {
      end = Math.min(rangeEnd, Math.max(drag.start + 5, drag.end + delta));
    }
    drag.moved ||= start !== drag.start || end !== drag.end;
    drag.currentStart = start;
    drag.currentEnd = end;
    setDraftTimes((current) => ({ ...current, [draftKey(drag.itemType, drag.id)]: { start, end } }));
  }

  function endTimeDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.mode === "move" && drag.moved) suppressClickRef.current = true;
    dragRef.current = null;
    setDraftTimes((current) => {
      const next = { ...current };
      delete next[draftKey(drag.itemType, drag.id)];
      return next;
    });
    if (drag.moved) {
      const saveTime = drag.itemType === "timeline" ? onTimeChange : onStaffingTimeChange;
      saveTime(drag.id, fromMinutes(drag.currentStart), fromMinutes(drag.currentEnd));
    }
  }

  return <div className="gantt-scroll"><div className={`gantt-chart ${currentTimeVisible ? "now-visible" : ""}`} style={{ minWidth: `${Math.max(760, 260 + duration * 1.35)}px`, "--gantt-now-left": currentTimeLeft } as CSSProperties} role="group" aria-label={`${formatMinutes(rangeStart)}から${formatMinutes(rangeEnd)}までの作業と当日体制`}>
    <div className="gantt-corner">作業・メンバー / 時間</div><div className="gantt-axis">{ticks.map((tick) => <span key={tick} style={{ left: `${((tick - rangeStart) / duration) * 100}%` }}>{formatMinutes(tick)}</span>)}{currentTimeVisible ? <i className="gantt-now-marker" style={{ left: currentTimeLeft }}><b>現在 {formatMinutes(currentMinute)}</b></i> : <em className="gantt-now-outside">現在 {formatMinutes(currentMinute)}（表示範囲外）</em>}</div>
    <div className="gantt-section-label"><span className="operation-icon work">◷</span>作業</div><div className="gantt-section-line"><span>WORK</span><div className="gantt-legend"><i className="planned" />予定<i className="actual" />実績</div></div>
    {ranges.map(({ item, start: savedStart, end: savedEnd, actualStart, actualEnd }) => {
      const draft = draftTimes[draftKey("timeline", item.id)];
      const start = draft?.start ?? savedStart;
      const end = draft?.end ?? savedEnd;
      const dragging = dragRef.current?.itemType === "timeline" && dragRef.current.id === item.id;
      return <div className="gantt-row" key={item.id}><div className="gantt-label"><strong><b className={`timeline-kind kind-${item.kind || "作業"}`}>{item.kind || "作業"}</b>{item.title}</strong><small><b className="time-kind planned">予定</b>{item.plan}・{item.owner}・{formatDateTimeRange(fromMinutes(start), fromMinutes(end))}</small><small className={item.actualStartAt ? "actual-recorded" : ""}><b className="time-kind actual">実績</b>{item.actualStartAt ? item.actualEndAt ? formatDateTimeRange(item.actualStartAt, item.actualEndAt) : `${formatDateTime(item.actualStartAt)}–進行中` : "未入力"}</small><span className="gantt-status-actions"><span className={`tag status-${item.status}`}>{item.status}</span>{item.status === "未着手" && <button type="button" className="timeline-action start" disabled={disabled} onClick={() => onStatusChange(item.id, "start")}>▶ 開始</button>}{item.status === "進行中" && <button type="button" className="timeline-action complete" disabled={disabled} onClick={() => onStatusChange(item.id, "complete")}>✓ 完了</button>}</span></div><div className="gantt-lane work-gantt-lane" style={{ backgroundSize: `${100 / Math.max(1, ticks.length - 1)}% 100%` }}><div className={`gantt-bar gantt-${item.status} plan-${item.plan} ${dragging ? "dragging" : ""} ${disabled ? "disabled" : ""}`} style={{ left: `${((start - rangeStart) / duration) * 100}%`, width: `${((end - start) / duration) * 100}%` }}><button className="gantt-bar-content" onPointerDown={(event) => beginTimeDrag(event, item.id, "timeline", "move", savedStart, savedEnd)} onPointerMove={moveTimeDrag} onPointerUp={endTimeDrag} onPointerCancel={endTimeDrag} onClick={() => { if (suppressClickRef.current) { suppressClickRef.current = false; return; } onEdit(item); }} disabled={disabled} aria-label={`${item.title}の予定時間帯をドラッグで移動。クリックで編集`} title="左右にドラッグして予定時間帯を移動"><span>{item.status === "完了" ? "✓ " : ""}{item.title}</span></button><button className="gantt-resize-handle start" onPointerDown={(event) => beginTimeDrag(event, item.id, "timeline", "start", savedStart, savedEnd)} onPointerMove={moveTimeDrag} onPointerUp={endTimeDrag} onPointerCancel={endTimeDrag} disabled={disabled} aria-label={`${item.title}の予定開始時刻をドラッグで変更`} title="予定開始時刻を変更" /><button className="gantt-resize-handle end" onPointerDown={(event) => beginTimeDrag(event, item.id, "timeline", "end", savedStart, savedEnd)} onPointerMove={moveTimeDrag} onPointerUp={endTimeDrag} onPointerCancel={endTimeDrag} disabled={disabled} aria-label={`${item.title}の予定終了時刻をドラッグで変更`} title="予定終了時刻を変更" /></div>{actualStart !== null && actualEnd !== null && <button type="button" className={`actual-gantt-bar ${item.actualEndAt ? "complete" : "running"}`} style={{ left: `${((actualStart - rangeStart) / duration) * 100}%`, width: `${Math.max(1.2, ((actualEnd - actualStart) / duration) * 100)}%` }} onClick={() => onEdit(item)} disabled={disabled} aria-label={`${item.title}の実績を編集`} title={item.actualEndAt ? formatDateTimeRange(item.actualStartAt || "", item.actualEndAt) : `${formatDateTime(item.actualStartAt || "")}から進行中`} />}</div></div>;
    })}
    <div id="staffing" className="gantt-section-label"><span className="operation-icon staffing">♙</span>当日体制</div><div className="gantt-section-line staffing"><span>STAFFING</span></div>
    {staffingRanges.map(({ assignment, start: savedStart, end: savedEnd }) => {
      const draft = draftTimes[draftKey("staffing", assignment.id)];
      const start = draft?.start ?? savedStart;
      const end = draft?.end ?? savedEnd;
      const dragging = dragRef.current?.itemType === "staffing" && dragRef.current.id === assignment.id;
      return <div className="gantt-row" key={`staffing-${assignment.id}`}><div className="gantt-label staffing-gantt-label"><span className="member-avatar">{assignment.name.slice(0, 1)}</span><span><strong>{assignment.name}</strong><small>{assignment.phone || "電話番号未登録"}・{assignment.location}・{formatDateTimeRange(fromMinutes(start), fromMinutes(end))}</small></span></div><div className="gantt-lane" style={{ backgroundSize: `${100 / Math.max(1, ticks.length - 1)}% 100%` }}><div className={`staffing-gantt-bar ${dragging ? "dragging" : ""} ${disabled ? "disabled" : ""}`} style={{ left: `${((start - rangeStart) / duration) * 100}%`, width: `${((end - start) / duration) * 100}%` }}><button type="button" className="staffing-gantt-content" onPointerDown={(event) => beginTimeDrag(event, assignment.id, "staffing", "move", savedStart, savedEnd)} onPointerMove={moveTimeDrag} onPointerUp={endTimeDrag} onPointerCancel={endTimeDrag} onClick={() => { if (suppressClickRef.current) { suppressClickRef.current = false; return; } onEditStaffing(assignment); }} disabled={disabled} aria-label={`${assignment.name}の対応時間帯をドラッグで移動。クリックで編集`} title="左右にドラッグして対応時間帯を移動"><strong>{assignment.name}・{assignment.location}</strong><span>{assignment.note || formatDateTimeRange(fromMinutes(start), fromMinutes(end))}</span></button><button className="gantt-resize-handle start" onPointerDown={(event) => beginTimeDrag(event, assignment.id, "staffing", "start", savedStart, savedEnd)} onPointerMove={moveTimeDrag} onPointerUp={endTimeDrag} onPointerCancel={endTimeDrag} disabled={disabled} aria-label={`${assignment.name}の対応開始時刻をドラッグで変更`} title="対応開始時刻を変更" /><button className="gantt-resize-handle end" onPointerDown={(event) => beginTimeDrag(event, assignment.id, "staffing", "end", savedStart, savedEnd)} onPointerMove={moveTimeDrag} onPointerUp={endTimeDrag} onPointerCancel={endTimeDrag} disabled={disabled} aria-label={`${assignment.name}の対応終了時刻をドラッグで変更`} title="対応終了時刻を変更" /></div></div></div>;
    })}
  </div></div>;
}

function setCurrentDateTime(button: HTMLButtonElement, fieldName: string) {
  const input = button.form?.elements.namedItem(fieldName);
  if (!(input instanceof HTMLInputElement)) return;
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  input.value = local.toISOString().slice(0, 16);
  input.focus();
}

function setPlannedDuration(button: HTMLButtonElement, minutes: number) {
  const form = button.form;
  const dateInput = form?.elements.namedItem("workDate");
  const timeInput = form?.elements.namedItem("startTime");
  const endDateInput = form?.elements.namedItem("endDate");
  const endTimeInput = form?.elements.namedItem("endTime");
  if (!(dateInput instanceof HTMLInputElement) || !(timeInput instanceof HTMLInputElement) || !(endDateInput instanceof HTMLInputElement) || !(endTimeInput instanceof HTMLInputElement) || !dateInput.value || !timeInput.value) return;
  const endAt = fromMinutes(toMinutes(`${dateInput.value}T${timeInput.value}`) + minutes);
  endDateInput.value = endAt.slice(0, 10);
  endTimeInput.value = endAt.slice(11, 16);
  endTimeInput.focus();
}

function CopyWorkModal({ work, saving, onClose, onSubmit }: { work: ReleaseWork; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const detailCount = work.timeline.length + work.staffing.length + work.approvals.length + work.links.length;
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><div className="modal copy-work-modal" role="dialog" aria-modal="true" aria-labelledby="copy-work-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="section-kicker">COPY RELEASE WORK</span><h2 id="copy-work-title">作業をコピー</h2></div><button onClick={onClose} aria-label="閉じる" disabled={saving}>×</button></div><form onSubmit={onSubmit}>
    <div className="field-row"><label>SystemID<input name="systemId" defaultValue={work.release.systemId} required /></label><label>作業名<input name="name" defaultValue={`${work.release.name}（コピー）`} required autoFocus /></label></div>
    <div className="field-row"><label>バージョン（任意）<input name="version" defaultValue={work.release.version} /></label><label>環境<select name="environment" defaultValue={work.release.environment}><option>Production</option><option>Staging</option><option>Development</option></select></label></div>
    <label>新しい作業日時<input name="releaseDate" type="datetime-local" defaultValue={work.release.releaseDate.replace(" ", "T")} required /></label>
    <label>責任者<input name="manager" defaultValue={work.release.manager} required /></label>
    <div className="copy-summary"><strong>{detailCount}件の明細をコピー</strong><span>作業工程 {work.timeline.length}件・当日体制 {work.staffing.length}件・申請物 {work.approvals.length}件・関連リンク {work.links.length}件</span><p>予定日時と期限は新しい作業日に合わせて移動します。作業実績・進捗・申請状態は初期化し、申請リンクは空欄にします。</p></div>
    <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose} disabled={saving}>キャンセル</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "コピー中" : "コピーを作成"}</button></div>
  </form></div></div>;
}

function DeleteConfirmModal({ work, saving, onClose, onConfirm }: { work: ReleaseWork; saving: boolean; onClose: () => void; onConfirm: () => void }) {
  const detailCount = work.timeline.length + work.staffing.length + work.approvals.length + work.links.length;
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><div className="modal delete-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-description" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="section-kicker danger">DELETE RELEASE WORK</span><h2 id="delete-confirm-title">リリース作業を削除しますか？</h2></div><button onClick={onClose} aria-label="閉じる" disabled={saving}>×</button></div><div className="delete-confirm-body"><strong>{work.release.name}</strong><p id="delete-confirm-description">タイムチャート、当日体制、申請物、関連リンクを含む{detailCount}件の明細も削除されます。この操作は取り消せません。</p></div><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose} disabled={saving}>キャンセル</button><button type="button" className="danger-button solid" onClick={onConfirm} disabled={saving}>{saving ? "削除中" : "作業を削除する"}</button></div></div></div>;
}

function ItemModal({ type, editTarget, releaseDate, staffing: staffingOptions, approvalCategories, formError, saving, onClose, onSubmit }: { type: ModalType; editTarget: EditTarget | null; releaseDate?: string; staffing: StaffingAssignment[]; approvalCategories: Category[]; formError: string; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const work = editTarget?.type === "work" ? editTarget.item : null;
  const staffing = editTarget?.type === "staffing" ? editTarget.item : null;
  const timeline = editTarget?.type === "timeline" ? editTarget.item : null;
  const approval = editTarget?.type === "approval" ? editTarget.item : null;
  const link = editTarget?.type === "link" ? editTarget.item : null;
  const releaseStartAt = releaseDate?.replace(" ", "T") || "";
  const staffingStartAt = staffing?.startAt || releaseStartAt;
  const staffingEndAt = staffing?.endAt || (staffingStartAt ? fromMinutes(toMinutes(staffingStartAt) + 8 * 60) : "");
  const plannedStartAt = timeline?.startAt || releaseStartAt;
  const plannedEndAt = timeline?.endAt || (plannedStartAt ? fromMinutes(toMinutes(plannedStartAt) + 30) : "");
  const editing = Boolean(work || staffing || timeline || approval || link);
  const title = work ? "リリース作業を編集" : staffing ? "体制メンバーを編集" : timeline ? "作業明細を編集" : approval ? "申請物を編集" : link ? "リンク情報を編集" : type === "work" ? "リリース作業を登録" : type === "staffing" ? "体制メンバーを追加" : type === "timeline" ? "作業明細を追加" : type === "approval" ? "申請物を追加" : "リンクを追加";
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="section-kicker">{editing ? "EDIT ITEM" : type === "work" ? "NEW RELEASE WORK" : "NEW ITEM"}</span><h2 id="modal-title">{title}</h2></div><button onClick={onClose} aria-label="閉じる">×</button></div><form onSubmit={onSubmit}>
    {formError && <div className="form-error" role="alert"><strong>入力内容を保存できません</strong><span>{formError}</span></div>}
    {type === "work" && <><div className="field-row"><label>SystemID<input name="systemId" defaultValue={work?.systemId} placeholder="例：PAYMENT" required autoFocus /></label><label>作業名<input name="name" defaultValue={work?.name} placeholder="例：決済基盤アップデート" required /></label></div><div className="field-row"><label>バージョン（任意）<input name="version" defaultValue={work?.version} placeholder="例：v2.8.0" /></label><label>環境<select name="environment" defaultValue={work?.environment || "Production"}><option>Production</option><option>Staging</option><option>Development</option></select></label></div><label>作業日時<input name="releaseDate" type="datetime-local" defaultValue={work?.releaseDate.replace(" ", "T")} required /></label><label>責任者<input name="manager" defaultValue={work?.manager} placeholder="例：田中" required /></label>{work && <label>状態<select name="status" defaultValue={work.status}><option>準備中</option><option>進行中</option><option>完了</option></select></label>}<p className="form-hint">{work ? "作業の基本情報を更新します。紐づく明細は保持されます。" : "登録後にタイムチャート・申請物・資料を追加します。"}</p></>}
    {type === "staffing" && <><div className="field-row"><label>氏名<input name="name" defaultValue={staffing?.name} placeholder="例：佐藤" required autoFocus /></label><label>電話番号<input name="phone" type="tel" defaultValue={staffing?.phone} placeholder="例：090-1234-5678" /></label></div><div className="field-row"><label>対応開始日時<input name="startAt" type="datetime-local" defaultValue={staffingStartAt} required /></label><label>対応終了日時<input name="endAt" type="datetime-local" defaultValue={staffingEndAt} required /></label></div><p className="field-help">新規追加時は当日作業の開始から8時間を初期表示します。</p><label>場所・待機形態<input name="location" defaultValue={staffing?.location} placeholder="例：名古屋、オンコール" required /></label><label>役割・補足<input name="note" defaultValue={staffing?.note} placeholder="例：現地対応、一次連絡先" /></label></>}
    {type === "timeline" && <><div className="field-row"><label>作業内容<input name="title" defaultValue={timeline?.title} placeholder="例：本番デプロイ" required autoFocus /></label><label>担当者<input name="owner" list="staffing-owner-options" defaultValue={timeline?.owner} placeholder="当日体制から選択または入力" required /></label><datalist id="staffing-owner-options">{staffingOptions.map((assignment) => <option value={assignment.name} key={assignment.id}>{assignment.location}</option>)}</datalist></div><div className="field-row timeline-classification"><label>種別<select name="kind" defaultValue={timeline?.kind || "作業"}><option>作業</option><option>申請物</option></select></label><label>区分<select name="plan" defaultValue={timeline?.plan || "本線"}><option>本線</option><option>コンチプラン</option></select></label><label>状態<select name="status" defaultValue={timeline?.status || "未着手"}><option>未着手</option><option>進行中</option><option>完了</option></select></label></div><p className="field-help">担当者は当日体制の登録メンバーから選択できます。未登録の名前も直接入力できます。</p><fieldset className="time-fieldset"><legend>予定</legend><div className="field-row"><label>作業日<input name="workDate" type="date" defaultValue={plannedStartAt.slice(0, 10)} required /></label><label>終了日<input name="endDate" type="date" defaultValue={plannedEndAt.slice(0, 10)} required /></label></div><div className="field-row"><label>開始時刻<input name="startTime" type="time" step="300" defaultValue={plannedStartAt.slice(11, 16)} required /></label><label>終了時刻<input name="endTime" type="time" step="300" defaultValue={plannedEndAt.slice(11, 16)} required /></label></div><div className="duration-presets"><span>開始から</span>{[15, 30, 60].map((minutes) => <button type="button" key={minutes} onClick={(event) => setPlannedDuration(event.currentTarget, minutes)}>＋{minutes}分</button>)}</div><p className="field-help">作業日と開始時刻は親作業の予定日時を初期表示します。日を跨ぐ場合は終了日を変更できます。</p></fieldset><fieldset className="time-fieldset actual"><legend>実績（任意）</legend><div className="field-row"><div className="actual-datetime-field"><label>実績開始日時<input name="actualStartAt" type="datetime-local" defaultValue={timeline?.actualStartAt} /></label><button type="button" className="set-now-button" onClick={(event) => setCurrentDateTime(event.currentTarget, "actualStartAt")}>◷ 今を開始に設定</button></div><div className="actual-datetime-field"><label>実績終了日時<input name="actualEndAt" type="datetime-local" defaultValue={timeline?.actualEndAt} /></label><button type="button" className="set-now-button" onClick={(event) => setCurrentDateTime(event.currentTarget, "actualEndAt")}>◷ 今を終了に設定</button></div></div><p className="field-help">作業中は実績開始のみ入力できます。</p></fieldset></>}
    {type === "approval" && <><label>申請名<input name="title" defaultValue={approval?.title} required autoFocus /></label><label>申請種別（任意）<input name="category" list="approval-category-options" defaultValue={approval?.category} placeholder="候補から選択または手入力" /></label><datalist id="approval-category-options">{approvalCategories.map((category) => <option value={category.name} key={category.id}>{category.description}</option>)}</datalist><p className="field-help">管理画面の候補から選択できます。候補にない種別も直接入力できます。</p><div className="field-row"><label>担当者<input name="owner" defaultValue={approval?.owner} required /></label><label>状態<select name="status" defaultValue={approval?.status || "未申請"}><option>未申請</option><option>申請中</option><option>回付済</option><option>結了済</option></select></label></div><label>期限<input name="due" type="date" defaultValue={approval?.due || releaseDate?.slice(0, 10)} required /></label><label>申請リンク（任意）<input name="url" inputMode="url" defaultValue={approval?.url} placeholder="後から登録できます" /></label></>}
    {type === "link" && <><label>タイトル<input name="title" defaultValue={link?.title} required autoFocus /></label><label>カテゴリ<input name="category" defaultValue={link?.category} placeholder="手順書" required /></label><label>説明<input name="description" defaultValue={link?.description} required /></label><label>URL（任意）<input name="url" inputMode="url" defaultValue={link?.url} placeholder="後から登録できます" /></label></>}
    <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>キャンセル</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "保存中" : editing ? "変更を保存" : type === "work" ? "登録して明細へ" : "追加する"}</button></div>
  </form></div></div>;
}

function PreviewModal({ preview, onClose, onEdit }: { preview: PreviewItem; onClose: () => void; onEdit: (target: EditTarget) => void }) {
  const isApproval = preview.type === "approval";
  const item = preview.item;
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><div className="modal preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="section-kicker">{isApproval ? "APPROVAL DETAIL" : "RESOURCE DETAIL"}</span><h2 id="preview-title">{item.title}</h2></div><button onClick={onClose} aria-label="閉じる">×</button></div><div className="preview-body">
    {isApproval ? <><div className="preview-status"><span className={`tag status-${preview.item.status}`}>{preview.item.status}</span>{preview.item.category && <span className="preview-category">{preview.item.category}</span>}</div><dl><div><dt>担当者</dt><dd>{preview.item.owner}</dd></div><div><dt>期限</dt><dd>{formatDueDate(preview.item.due)}</dd></div></dl></> : <><span className="preview-category">{preview.item.category}</span><p>{preview.item.description}</p></>}
    <div className="modal-actions"><button type="button" className="ghost-button" onClick={() => onEdit(preview)}>情報を編集</button>{item.url ? <a className="primary-button modal-link-button" href={item.url} target="_blank" rel="noopener noreferrer">リンクを開く ↗</a> : <span className="link-unregistered">リンク未登録</span>}</div>
  </div></div></div>;
}
