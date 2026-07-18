import { type DragEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createReleaseWork, fetchReleaseSummaries, fetchReleaseWork, saveReleaseWork } from "./api";
import { sampleWork } from "./sampleData";
import type { ApprovalItem, CreateReleaseInput, ReleaseSummary, ReleaseWork, ResourceLink, StaffingAssignment, TimelineItem, TimelinePlan, TimelineStatus } from "./types";

type ModalType = "work" | "staffing" | "timeline" | "approval" | "link";
type PreviewItem = { type: "approval"; item: ApprovalItem } | { type: "link"; item: ResourceLink };
type EditTarget = { type: "work"; item: ReleaseWork["release"] } | { type: "staffing"; item: StaffingAssignment } | { type: "timeline"; item: TimelineItem };
const demoMode = import.meta.env.VITE_DEMO_MODE === "true";

function nextId(items: Array<{ id: number }>) {
  return items.reduce((largest, item) => Math.max(largest, item.id), 0) + 1;
}

function toSummary(work: ReleaseWork): ReleaseSummary {
  const done = work.timeline.filter((item) => item.status === "完了").length;
  return {
    ...work.release,
    progress: work.timeline.length ? Math.round((done / work.timeline.length) * 100) : 0,
    timelineCount: work.timeline.length,
    approvalCount: work.approvals.length,
  };
}

export default function App() {
  const [showSplash, setShowSplash] = useState(() => sessionStorage.getItem("release-hub-splash-seen") !== "1");
  const [summaries, setSummaries] = useState<ReleaseSummary[]>([toSummary(sampleWork)]);
  const [demoWorks, setDemoWorks] = useState<ReleaseWork[]>([sampleWork]);
  const [selected, setSelected] = useState<ReleaseWork | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalType | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [preview, setPreview] = useState<PreviewItem | null>(null);

  const loadSummaries = useCallback(async () => {
    if (demoMode) {
      setLoading(false);
      return;
    }
    try {
      setSummaries(await fetchReleaseSummaries());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "作業一覧を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummaries();
  }, [loadSummaries]);

  useEffect(() => {
    if (!showSplash) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      sessionStorage.setItem("release-hub-splash-seen", "1");
      setShowSplash(false);
    }, reducedMotion ? 350 : 1800);
    return () => window.clearTimeout(timer);
  }, [showSplash]);

  async function openWork(id: number) {
    setLoading(true);
    if (demoMode) {
      setSelected(demoWorks.find((work) => work.release.id === id) || null);
      setError("");
      setLoading(false);
      window.scrollTo({ top: 0 });
      return;
    }
    try {
      setSelected(await fetchReleaseWork(id));
      setError("");
      window.scrollTo({ top: 0 });
    } catch (reason) {
      if (id === sampleWork.release.id) setSelected(sampleWork);
      setError(reason instanceof Error ? reason.message : "作業を読み込めませんでした");
    } finally {
      setLoading(false);
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

  function openModal(type: ModalType) {
    setEditTarget(null);
    setModal(type);
  }

  function openEditor(target: EditTarget) {
    setEditTarget(target);
    setModal(target.type);
  }

  function closeModal() {
    setModal(null);
    setEditTarget(null);
  }

  function reorderTimeline(sourceId: number, targetId: number) {
    if (!selected || sourceId === targetId) return;
    const sourceIndex = selected.timeline.findIndex((item) => item.id === sourceId);
    const targetIndex = selected.timeline.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const timeline = [...selected.timeline];
    const [moved] = timeline.splice(sourceIndex, 1);
    timeline.splice(targetIndex, 0, moved);
    void commit({ ...selected, timeline });
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
        closeModal();
        setError("");
        return;
      }
      setSaving(true);
      try {
        const created = await createReleaseWork(input);
        setSummaries((current) => [toSummary(created), ...current]);
        setSelected(created);
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
    if ((modal === "staffing" || modal === "timeline") && String(values.endAt) <= String(values.startAt)) {
      setError("終了日時は開始日時より後にしてください");
      return;
    }
    let nextWork = selected;
    if (modal === "staffing") {
      const editing = editTarget?.type === "staffing" ? editTarget.item : null;
      const item: StaffingAssignment = { id: editing?.id ?? nextId(selected.staffing), name: String(values.name), phone: String(values.phone || ""), startAt: String(values.startAt), endAt: String(values.endAt), location: String(values.location), note: String(values.note || "") };
      nextWork = { ...selected, staffing: editing ? selected.staffing.map((row) => row.id === editing.id ? item : row) : [...selected.staffing, item] };
    } else if (modal === "timeline") {
      const editing = editTarget?.type === "timeline" ? editTarget.item : null;
      const item: TimelineItem = { id: editing?.id ?? nextId(selected.timeline), startAt: String(values.startAt), endAt: String(values.endAt), title: String(values.title), owner: String(values.owner), status: String(values.status || "未着手") as TimelineStatus, plan: String(values.plan || "本線") as TimelinePlan };
      nextWork = { ...selected, timeline: editing ? selected.timeline.map((row) => row.id === editing.id ? item : row) : [...selected.timeline, item] };
    } else if (modal === "approval") {
      nextWork = { ...selected, approvals: [...selected.approvals, { id: nextId(selected.approvals), title: String(values.title), owner: String(values.owner), due: String(values.due), status: "未申請", url: String(values.url) }] };
    } else {
      nextWork = { ...selected, links: [...selected.links, { id: nextId(selected.links), title: String(values.title), category: String(values.category), description: String(values.description), url: String(values.url) }] };
    }
    closeModal();
    void commit(nextWork);
  }

  return (
    <main className="app-shell">
      {showSplash && <div className="splash-screen" role="status" aria-label="Release Hubを起動しています"><img src={`${import.meta.env.BASE_URL}release-hub-splash.png`} alt="Release Hub リリース情報を、ひとつに。" /></div>}
      <Sidebar detailOpen={Boolean(selected)} onShowList={() => setSelected(null)} />
      <section className="content">
        {error && <div className="error-banner">{error} — API起動前はサンプルデータを表示します</div>}
        {selected ? (
          <WorkDetail work={selected} loading={loading} saving={saving} onBack={() => setSelected(null)} onOpenModal={openModal} onOpenEditor={openEditor} onOpenPreview={setPreview} onReorderTimeline={reorderTimeline} />
        ) : (
          <WorkList summaries={summaries} loading={loading} onCreate={() => openModal("work")} onOpen={openWork} />
        )}
      </section>
      {modal && <ItemModal type={modal} editTarget={editTarget} saving={saving} onClose={closeModal} onSubmit={submitItem} />}
      {preview && <PreviewModal preview={preview} onClose={() => setPreview(null)} />}
    </main>
  );
}

function Sidebar({ detailOpen, onShowList }: { detailOpen: boolean; onShowList: () => void }) {
  return <aside className="sidebar">
    <div className="brand"><span className="brand-mark">R</span><span>Release Hub</span></div>
    <nav aria-label="メインメニュー">
      <button className={`nav-item ${!detailOpen ? "active" : ""}`} onClick={onShowList}><span>▦</span>作業一覧</button>
      {detailOpen && <><a className="nav-item" href="#overview"><span>⌂</span>作業概要</a><a className="nav-item" href="#staffing"><span>♙</span>当日体制</a><a className="nav-item" href="#timeline"><span>◷</span>タイムチャート</a><a className="nav-item" href="#approvals"><span>✓</span>申請物</a><a className="nav-item" href="#links"><span>↗</span>リンク集</a></>}
    </nav>
    <div className="side-note"><strong>親子構造で管理</strong><span>作業を登録し、必要な明細をひとつに集約</span></div>
    <div className="user-chip"><span className="avatar">RT</span><div><strong>Release Team</strong><small>社内環境</small></div></div>
  </aside>;
}

function WorkList({ summaries, loading, onCreate, onOpen }: { summaries: ReleaseSummary[]; loading: boolean; onCreate: () => void; onOpen: (id: number) => void }) {
  const activeCount = summaries.filter((item) => item.status !== "完了").length;
  return <>
    <header className="topbar list-topbar"><div><span className="eyebrow">RELEASE WORKS</span><h1>リリース作業一覧</h1><p>作業を登録してから、タイムチャート・申請・資料を紐づけます。</p></div><button className="primary-button" onClick={onCreate}>＋ 新しい作業を登録</button></header>
    <section className="list-hero">
      <div><span className="section-kicker">OVERVIEW</span><strong>{summaries.length}</strong><p>登録済みのリリース作業</p></div>
      <div><span>進行中・準備中</span><strong>{activeCount}</strong></div>
      <div><span>今後の流れ</span><ol><li><i>1</i>作業を登録</li><li><i>2</i>明細を追加</li><li><i>3</i>当日の進捗を更新</li></ol></div>
    </section>
    <section className="panel work-list-panel">
      <div className="panel-heading"><div><span className="section-kicker">RELEASE QUEUE</span><h2>作業を選択</h2></div><span className="list-count">{summaries.length}件</span></div>
      <div className="work-table-head"><span>作業名</span><span>実施日時</span><span>責任者</span><span>進捗</span><span>状態</span><span /></div>
      <div className="work-list">
        {summaries.map((work) => <button className="work-row" key={work.id} onClick={() => onOpen(work.id)} disabled={loading}>
          <span className="work-title"><i>{work.name.slice(0, 1)}</i><span><strong>{work.name}</strong><small>{work.version}・{work.environment}</small></span></span>
          <span className="work-date">{work.releaseDate}</span><span>{work.manager}</span>
          <span className="row-progress"><span><i style={{ width: `${work.progress}%` }} /></span><b>{work.progress}%</b><small>{work.timelineCount}工程</small></span>
          <span><em className={`release-status release-status-${work.status}`}>{work.status}</em></span><span className="row-arrow">›</span>
        </button>)}
        {!summaries.length && <div className="empty-state"><span>＋</span><h3>最初の作業を登録しましょう</h3><p>登録後にタイムチャートや申請物を追加できます。</p><button className="primary-button" onClick={onCreate}>作業を登録</button></div>}
      </div>
    </section>
  </>;
}

function WorkDetail({ work, loading, saving, onBack, onOpenModal, onOpenEditor, onOpenPreview, onReorderTimeline }: { work: ReleaseWork; loading: boolean; saving: boolean; onBack: () => void; onOpenModal: (type: ModalType) => void; onOpenEditor: (target: EditTarget) => void; onOpenPreview: (preview: PreviewItem) => void; onReorderTimeline: (sourceId: number, targetId: number) => void }) {
  const [timelineView, setTimelineView] = useState<"list" | "gantt" | "combined">("list");
  const progress = useMemo(() => work.timeline.length ? Math.round((work.timeline.filter((item) => item.status === "完了").length / work.timeline.length) * 100) : 0, [work.timeline]);
  const completed = work.timeline.filter((item) => item.status === "完了").length;
  const approved = work.approvals.filter((item) => item.status === "承認済み").length;
  return <>
    <header className="topbar"><div><button className="back-button" onClick={onBack}>‹ 作業一覧</button><span className="eyebrow">RELEASE CONTROL CENTER</span><h1>{work.release.name}</h1></div><div className="top-actions"><span className={`live-dot ${saving ? "saving" : ""}`} /><span>{saving ? "保存中" : "共有済み"}</span><button className="ghost-button" onClick={() => onOpenEditor({ type: "work", item: work.release })}>作業情報を編集</button><button className="primary-button" onClick={() => onOpenModal("timeline")}>＋ 作業明細を追加</button></div></header>
    <div id="overview" className="release-banner"><div className="release-main"><span className="status-pill">{work.release.status}</span><h2>{work.release.version}</h2><p>{work.release.environment} 環境</p></div><div className="release-meta"><div><span>実施日時</span><strong>{work.release.releaseDate}</strong></div><div><span>責任者</span><strong>{work.release.manager}</strong></div><div><span>作業進捗</span><strong>{progress}%</strong></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div></div>
    <div className="summary-grid"><article className="metric-card"><span className="metric-icon blue">◷</span><div><small>作業項目</small><strong>{work.timeline.length}</strong><em>件</em></div><p>{completed}件 完了</p></article><article className="metric-card"><span className="metric-icon purple">♙</span><div><small>当日体制</small><strong>{work.staffing.length}</strong><em>名</em></div><p>対応メンバー</p></article><article className="metric-card"><span className="metric-icon green">✓</span><div><small>申請・承認</small><strong>{approved}</strong><em>/{work.approvals.length}</em></div><p>承認済み</p></article><article className="metric-card"><span className="metric-icon amber">↗</span><div><small>関連資料</small><strong>{work.links.length}</strong><em>件</em></div><p>すぐにアクセス</p></article></div>
    <StaffingPanel assignments={work.staffing} onAdd={() => onOpenModal("staffing")} onEdit={(item) => onOpenEditor({ type: "staffing", item })} />
    <div className="workspace-grid"><section id="timeline" className={`panel timeline-panel ${timelineView !== "list" ? "gantt-panel" : ""}`}><div className="panel-heading"><div><span className="section-kicker">TIMELINE</span><h2>作業タイムチャート</h2></div><div className="panel-actions"><div className="view-switch" aria-label="タイムチャート表示"><button className={timelineView === "list" ? "active" : ""} onClick={() => setTimelineView("list")} aria-pressed={timelineView === "list"}>☷ リスト</button><button className={timelineView === "gantt" ? "active" : ""} onClick={() => setTimelineView("gantt")} aria-pressed={timelineView === "gantt"}>▥ ガント</button><button className={timelineView === "combined" ? "active" : ""} onClick={() => setTimelineView("combined")} aria-pressed={timelineView === "combined"}>≋ 統合</button></div><button className="ghost-button" onClick={() => onOpenModal("timeline")}>＋ 追加</button></div></div>{timelineView === "list" ? <TimelineList items={work.timeline} disabled={loading || saving} onEdit={(item) => onOpenEditor({ type: "timeline", item })} onReorder={onReorderTimeline} /> : timelineView === "gantt" ? <GanttChart items={work.timeline} disabled={loading || saving} onEdit={(item) => onOpenEditor({ type: "timeline", item })} /> : <CombinedSchedule items={work.timeline} assignments={work.staffing} disabled={loading || saving} onEditTimeline={(item) => onOpenEditor({ type: "timeline", item })} onEditStaffing={(item) => onOpenEditor({ type: "staffing", item })} />}</section>
      <section id="approvals" className="panel approvals-panel"><div className="panel-heading"><div><span className="section-kicker">APPROVALS</span><h2>申請物一覧</h2></div><button className="ghost-button" onClick={() => onOpenModal("approval")}>＋ 追加</button></div><div className="approval-list">{work.approvals.map((item) => <button type="button" key={item.id} className="approval-row" onClick={() => onOpenPreview({ type: "approval", item })} aria-label={`${item.title}の詳細を開く`}><span className={`check ${item.status === "承認済み" ? "checked" : ""}`}>{item.status === "承認済み" ? "✓" : ""}</span><span><strong>{item.title}</strong><small>{item.owner}・期限 {item.due}</small></span><span className={`tag status-${item.status}`}>{item.status}</span><span className="external-link">詳細を見る ›</span></button>)}{!work.approvals.length && <p className="section-empty">まだ申請物はありません</p>}</div></section></div>
    <section id="links" className="panel links-panel"><div className="panel-heading"><div><span className="section-kicker">RESOURCES</span><h2>手順書・関連リンク</h2></div><button className="ghost-button" onClick={() => onOpenModal("link")}>＋ 追加</button></div><div className="link-grid">{work.links.map((item) => <button type="button" key={item.id} className="link-card" onClick={() => onOpenPreview({ type: "link", item })} aria-label={`${item.title}の詳細を開く`}><span className="doc-icon">▤</span><span><small>{item.category}</small><strong>{item.title}</strong><p>{item.description}</p></span><b>›</b></button>)}</div>{!work.links.length && <p className="section-empty links-empty">まだリンクはありません</p>}</section>
    <footer>最終更新：{work.release.updatedAt || "未更新"} ・ {work.release.updatedBy}</footer>
  </>;
}

function TimelineList({ items, disabled, onEdit, onReorder }: { items: TimelineItem[]; disabled: boolean; onEdit: (item: TimelineItem) => void; onReorder: (sourceId: number, targetId: number) => void }) {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const plans: TimelinePlan[] = ["本線", "コンチプラン"];
  if (!items.length) return <p className="section-empty">まだ作業明細はありません</p>;
  return <div className="timeline-list">{plans.map((plan) => {
    const planItems = items.filter((item) => item.plan === plan);
    return <section className={`timeline-group plan-${plan}`} key={plan}><div className="timeline-group-heading"><h3>{plan}</h3><span>{planItems.length}件</span></div>
      {planItems.length ? planItems.map((item, index) => <button key={item.id} className={`timeline-row ${item.status === "完了" ? "done" : ""} ${draggingId === item.id ? "dragging" : ""}`} onClick={() => onEdit(item)} onDragOver={(event: DragEvent<HTMLButtonElement>) => event.preventDefault()} onDrop={(event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); const sourceId = Number(event.dataTransfer.getData("text/plain")) || draggingId; const source = items.find((candidate) => candidate.id === sourceId); if (source && source.plan === item.plan) onReorder(source.id, item.id); setDraggingId(null); }} disabled={disabled} aria-label={`${item.title}を編集`}><span className="drag-handle" draggable={!disabled} onClick={(event) => event.stopPropagation()} onDragStart={(event: DragEvent<HTMLSpanElement>) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(item.id)); setDraggingId(item.id); }} onDragEnd={() => setDraggingId(null)} title="ドラッグして並べ替え">⋮⋮</span><span className="time">{formatDateTime(item.startAt)}</span><span className="line"><i>{item.status === "完了" ? "✓" : index + 1}</i></span><span className="task"><strong>{item.title}</strong><small>担当：{item.owner}・{formatDateTimeRange(item.startAt, item.endAt)}</small></span><span className={`tag status-${item.status}`}>{item.status}</span></button>) : <p className="timeline-group-empty">登録なし</p>}
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

function formatDateTimeRange(startAt: string, endAt: string) {
  const start = dateTimeParts(startAt);
  const end = dateTimeParts(endAt);
  const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;
  const endText = sameDay ? `${String(end.hours).padStart(2, "0")}:${String(end.minutes).padStart(2, "0")}` : formatDateTime(endAt);
  return `${formatDateTime(startAt)}–${endText}`;
}

function StaffingPanel({ assignments, onAdd, onEdit }: { assignments: StaffingAssignment[]; onAdd: () => void; onEdit: (item: StaffingAssignment) => void }) {
  const ranges = assignments.map((assignment) => {
    const start = toMinutes(assignment.startAt);
    return { assignment, start, end: toMinutes(assignment.endAt) };
  });
  const rangeStart = ranges.length ? Math.floor(Math.min(...ranges.map((range) => range.start)) / 60) * 60 : 0;
  const rangeEnd = ranges.length ? Math.max(rangeStart + 60, Math.ceil(Math.max(...ranges.map((range) => range.end)) / 60) * 60) : 60;
  const duration = rangeEnd - rangeStart;
  const ticks = Array.from({ length: Math.floor(duration / 60) + 1 }, (_, index) => rangeStart + index * 60);

  return <section id="staffing" className="panel staffing-panel"><div className="panel-heading"><div><span className="section-kicker">DAY-OF COVERAGE</span><h2>当日体制</h2></div><button className="ghost-button" onClick={onAdd}>＋ メンバーを追加</button></div>
    {!assignments.length ? <p className="section-empty">まだ当日の体制は登録されていません</p> : <div className="staffing-scroll"><div className="staffing-chart" style={{ minWidth: `${Math.max(720, 250 + duration * 1.35)}px` }} role="group" aria-label={`${formatMinutes(rangeStart)}から${formatMinutes(rangeEnd)}までの当日体制`}>
      <div className="staffing-corner">メンバー / 場所・待機形態</div><div className="staffing-axis">{ticks.map((tick) => <span key={tick} style={{ left: `${((tick - rangeStart) / duration) * 100}%` }}>{formatMinutes(tick)}</span>)}</div>
      {ranges.map(({ assignment, start, end }) => <div className="staffing-row" key={assignment.id}><button type="button" className="staffing-label" onClick={() => onEdit(assignment)} aria-label={`${assignment.name}の体制を編集`}><span className="member-avatar">{assignment.name.slice(0, 1)}</span><span><strong>{assignment.name}</strong><small>{assignment.phone || "電話番号未登録"}</small><small>{assignment.location}{assignment.note ? `・${assignment.note}` : ""}</small></span></button><div className="staffing-lane" style={{ backgroundSize: `${100 / Math.max(1, ticks.length - 1)}% 100%` }}><button type="button" className="staffing-bar" onClick={() => onEdit(assignment)} style={{ left: `${((start - rangeStart) / duration) * 100}%`, width: `${Math.max(3, ((end - start) / duration) * 100)}%` }} title={`${assignment.name} ${formatDateTimeRange(assignment.startAt, assignment.endAt)} ${assignment.location}`}><strong>{assignment.location}</strong><span>{formatDateTimeRange(assignment.startAt, assignment.endAt)}</span></button></div></div>)}
    </div></div>}
  </section>;
}

function CombinedSchedule({ items, assignments, disabled, onEditTimeline, onEditStaffing }: { items: TimelineItem[]; assignments: StaffingAssignment[]; disabled: boolean; onEditTimeline: (item: TimelineItem) => void; onEditStaffing: (item: StaffingAssignment) => void }) {
  if (!items.length && !assignments.length) return <p className="section-empty">統合表示する作業・体制がありません</p>;
  const workRanges = items.map((item) => {
    const start = toMinutes(item.startAt);
    return { item, start, end: toMinutes(item.endAt) };
  });
  const staffingRanges = assignments.map((assignment) => {
    const start = toMinutes(assignment.startAt);
    return { assignment, start, end: toMinutes(assignment.endAt) };
  });
  const starts = [...workRanges.map((range) => range.start), ...staffingRanges.map((range) => range.start)];
  const ends = [...workRanges.map((range) => range.end), ...staffingRanges.map((range) => range.end)];
  const rangeStart = Math.floor(Math.min(...starts) / 60) * 60;
  const rangeEnd = Math.max(rangeStart + 60, Math.ceil(Math.max(...ends) / 60) * 60);
  const duration = rangeEnd - rangeStart;
  const ticks = Array.from({ length: Math.floor(duration / 60) + 1 }, (_, index) => rangeStart + index * 60);
  const laneStyle = { backgroundSize: `${100 / Math.max(1, ticks.length - 1)}% 100%` };

  return <div className="combined-scroll"><div className="combined-chart" style={{ minWidth: `${Math.max(760, 255 + duration * 1.8)}px` }} role="group" aria-label={`${formatMinutes(rangeStart)}から${formatMinutes(rangeEnd)}までの作業と体制の統合チャート`}>
    <div className="combined-corner">作業・メンバー</div><div className="combined-axis">{ticks.map((tick) => <span key={tick} style={{ left: `${((tick - rangeStart) / duration) * 100}%` }}>{formatMinutes(tick)}</span>)}</div>
    <div className="combined-section-label">作業</div><div className="combined-section-line"><span>WORK</span></div>
    {workRanges.map(({ item, start, end }) => <div className="combined-row" key={`work-${item.id}`}><div className="combined-label"><i className={`combined-dot work-dot status-${item.status}`} /><span><strong>{item.title}</strong><small>{item.plan}・{item.owner}・{formatDateTimeRange(item.startAt, item.endAt)}</small></span></div><div className="combined-lane" style={laneStyle}><button className={`combined-bar work-bar gantt-${item.status} plan-${item.plan}`} style={{ left: `${((start - rangeStart) / duration) * 100}%`, width: `${Math.max(2.5, ((end - start) / duration) * 100)}%` }} onClick={() => onEditTimeline(item)} disabled={disabled} aria-label={`${item.title}を編集`}><strong>{item.title}</strong><span>{item.plan}・{item.owner}</span></button></div></div>)}
    <div className="combined-section-label">体制</div><div className="combined-section-line staffing-line"><span>STAFFING</span></div>
    {staffingRanges.map(({ assignment, start, end }) => <div className="combined-row" key={`staff-${assignment.id}`}><div className="combined-label"><span className="member-avatar">{assignment.name.slice(0, 1)}</span><span><strong>{assignment.name}</strong><small>{assignment.location}・{formatDateTimeRange(assignment.startAt, assignment.endAt)}</small></span></div><div className="combined-lane" style={laneStyle}><button type="button" className="combined-bar staffing-combined-bar" style={{ left: `${((start - rangeStart) / duration) * 100}%`, width: `${Math.max(2.5, ((end - start) / duration) * 100)}%` }} onClick={() => onEditStaffing(assignment)} disabled={disabled} aria-label={`${assignment.name}の体制を編集`}><strong>{assignment.name}・{assignment.location}</strong><span>{assignment.note || formatDateTimeRange(assignment.startAt, assignment.endAt)}</span></button></div></div>)}
  </div></div>;
}

function GanttChart({ items, disabled, onEdit }: { items: TimelineItem[]; disabled: boolean; onEdit: (item: TimelineItem) => void }) {
  if (!items.length) return <p className="section-empty">ガント表示する作業明細がありません</p>;
  const ranges = items.map((item) => {
    const start = toMinutes(item.startAt);
    return { item, start, end: toMinutes(item.endAt) };
  });
  const rangeStart = Math.floor(Math.min(...ranges.map((range) => range.start)) / 60) * 60;
  const rangeEnd = Math.max(rangeStart + 60, Math.ceil(Math.max(...ranges.map((range) => range.end)) / 60) * 60);
  const duration = rangeEnd - rangeStart;
  const ticks = Array.from({ length: Math.floor(duration / 60) + 1 }, (_, index) => rangeStart + index * 60);

  return <div className="gantt-scroll"><div className="gantt-chart" style={{ minWidth: `${Math.max(620, 260 + duration * 2.1)}px` }} role="group" aria-label={`${formatMinutes(rangeStart)}から${formatMinutes(rangeEnd)}までの作業ガントチャート`}>
    <div className="gantt-corner">作業 / 担当</div><div className="gantt-axis">{ticks.map((tick) => <span key={tick} style={{ left: `${((tick - rangeStart) / duration) * 100}%` }}>{formatMinutes(tick)}</span>)}</div>
    {ranges.map(({ item, start, end }) => <div className="gantt-row" key={item.id}><div className="gantt-label"><strong>{item.title}</strong><small>{item.plan}・{item.owner}・{formatDateTimeRange(item.startAt, item.endAt)}</small></div><div className="gantt-lane" style={{ backgroundSize: `${100 / Math.max(1, ticks.length - 1)}% 100%` }}><button className={`gantt-bar gantt-${item.status} plan-${item.plan}`} style={{ left: `${((start - rangeStart) / duration) * 100}%`, width: `${Math.max(2.5, ((end - start) / duration) * 100)}%` }} onClick={() => onEdit(item)} disabled={disabled} aria-label={`${item.title}を編集`}><span>{item.status === "完了" ? "✓ " : ""}{item.title}</span></button></div></div>)}
  </div></div>;
}

function ItemModal({ type, editTarget, saving, onClose, onSubmit }: { type: ModalType; editTarget: EditTarget | null; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const work = editTarget?.type === "work" ? editTarget.item : null;
  const staffing = editTarget?.type === "staffing" ? editTarget.item : null;
  const timeline = editTarget?.type === "timeline" ? editTarget.item : null;
  const editing = Boolean(work || staffing || timeline);
  const title = work ? "リリース作業を編集" : staffing ? "体制メンバーを編集" : timeline ? "作業明細を編集" : type === "work" ? "リリース作業を登録" : type === "staffing" ? "体制メンバーを追加" : type === "timeline" ? "作業明細を追加" : type === "approval" ? "申請物を追加" : "リンクを追加";
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="section-kicker">{editing ? "EDIT ITEM" : type === "work" ? "NEW RELEASE WORK" : "NEW ITEM"}</span><h2 id="modal-title">{title}</h2></div><button onClick={onClose} aria-label="閉じる">×</button></div><form onSubmit={onSubmit}>
    {type === "work" && <><label>作業名<input name="name" defaultValue={work?.name} placeholder="例：決済基盤アップデート" required autoFocus /></label><div className="field-row"><label>バージョン<input name="version" defaultValue={work?.version} placeholder="v2.8.0" required /></label><label>環境<select name="environment" defaultValue={work?.environment || "Production"}><option>Production</option><option>Staging</option><option>Development</option></select></label></div><label>実施日時<input name="releaseDate" type="datetime-local" defaultValue={work?.releaseDate.replace(" ", "T")} required /></label><label>責任者<input name="manager" defaultValue={work?.manager} placeholder="例：田中" required /></label>{work && <label>状態<select name="status" defaultValue={work.status}><option>準備中</option><option>進行中</option><option>完了</option></select></label>}<p className="form-hint">{work ? "作業の基本情報を更新します。紐づく明細は保持されます。" : "登録後にタイムチャート・申請物・資料を追加します。"}</p></>}
    {type === "staffing" && <><div className="field-row"><label>氏名<input name="name" defaultValue={staffing?.name} placeholder="例：佐藤" required autoFocus /></label><label>電話番号<input name="phone" type="tel" defaultValue={staffing?.phone} placeholder="例：090-1234-5678" /></label></div><div className="field-row"><label>対応開始日時<input name="startAt" type="datetime-local" defaultValue={staffing?.startAt} required /></label><label>対応終了日時<input name="endAt" type="datetime-local" defaultValue={staffing?.endAt} required /></label></div><label>場所・待機形態<input name="location" defaultValue={staffing?.location} placeholder="例：名古屋、オンコール" required /></label><label>役割・補足<input name="note" defaultValue={staffing?.note} placeholder="例：現地対応、一次連絡先" /></label></>}
    {type === "timeline" && <><div className="field-row"><label>区分<select name="plan" defaultValue={timeline?.plan || "本線"}><option>本線</option><option>コンチプラン</option></select></label><label>状態<select name="status" defaultValue={timeline?.status || "未着手"}><option>未着手</option><option>進行中</option><option>完了</option></select></label></div><div className="field-row"><label>開始日時<input name="startAt" type="datetime-local" defaultValue={timeline?.startAt} required /></label><label>終了日時<input name="endAt" type="datetime-local" defaultValue={timeline?.endAt} required /></label></div><label>作業内容<input name="title" defaultValue={timeline?.title} placeholder="例：本番デプロイ" required /></label><label>担当者<input name="owner" defaultValue={timeline?.owner} placeholder="例：田中" required /></label></>}
    {type === "approval" && <><label>申請名<input name="title" required /></label><label>担当者<input name="owner" required /></label><label>期限<input name="due" placeholder="7/22" required /></label><label>申請リンク<input name="url" type="url" placeholder="https://..." required /></label></>}
    {type === "link" && <><label>タイトル<input name="title" required /></label><label>カテゴリ<input name="category" placeholder="手順書" required /></label><label>説明<input name="description" required /></label><label>URL<input name="url" type="url" placeholder="https://..." required /></label></>}
    <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>キャンセル</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "保存中" : editing ? "変更を保存" : type === "work" ? "登録して明細へ" : "追加する"}</button></div>
  </form></div></div>;
}

function PreviewModal({ preview, onClose }: { preview: PreviewItem; onClose: () => void }) {
  const isApproval = preview.type === "approval";
  const item = preview.item;
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><div className="modal preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="section-kicker">{isApproval ? "APPROVAL DETAIL" : "RESOURCE DETAIL"}</span><h2 id="preview-title">{item.title}</h2></div><button onClick={onClose} aria-label="閉じる">×</button></div><div className="preview-body">
    {isApproval ? <><div className="preview-status"><span className={`tag status-${preview.item.status}`}>{preview.item.status}</span></div><dl><div><dt>担当者</dt><dd>{preview.item.owner}</dd></div><div><dt>期限</dt><dd>{preview.item.due}</dd></div></dl></> : <><span className="preview-category">{preview.item.category}</span><p>{preview.item.description}</p></>}
    <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>閉じる</button><a className="primary-button modal-link-button" href={item.url} target="_blank" rel="noopener noreferrer">リンクを開く ↗</a></div>
  </div></div></div>;
}
