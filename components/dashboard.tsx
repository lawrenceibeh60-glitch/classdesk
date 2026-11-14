"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { offlineDB, type CachedRecord, type OutboxItem } from "@/lib/offline-db";
import LogoutButton from "@/components/logout-button";
import AccountBadge from "@/components/account-badge";

type RecordItem = CachedRecord;
type AssignmentItem = { id: string; title: string; status: string; dueAt: string | null; course?: { code: string } | null };
type DashboardSummary = { courses: number; lectures: number; assignments: number; concerns: number };
type SyncConflict = { id: string; entityId: string; reason: string; serverRecord: RecordItem | null; mutation: OutboxItem; createdAt: string };
const nav = [
  ["⌂", "Overview", "/"], ["▤", "Lecture & notes", "/notes"], ["◫", "Announcements", "/announcements"],
  ["✧", "AI assistant", "/assistant"], ["↗", "Catch-up centre", "/catch-up"], ["◧", "Coverage", "/coverage"],
  ["▦", "Class records", "/records"], ["∑", "Courses", "/courses"], ["▧", "Lectures", "/lectures"], ["◷", "Assignments", "/assignments"], ["▦", "Calendar & timetable", "/calendar"], ["◉", "Attendance", "/attendance"], ["◇", "Class concerns", "/concerns"], ["⚙", "Settings", "/settings"],
];

export default function Dashboard() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [upcoming, setUpcoming] = useState<AssignmentItem[]>([]);
  const [summary, setSummary] = useState<DashboardSummary>({ courses: 0, lectures: 0, assignments: 0, concerns: 0 });
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const syncingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/records?limit=12", { cache: "no-store" });
      if (r.ok) {
        const server = (await r.json()).records as RecordItem[];
        if (offlineDB) {
          const localPending = await offlineDB.records.where("syncState").equals("pending").toArray();
          const pendingIds = new Set(localPending.map((item) => item.id));
          const pendingDeletes = new Set((await offlineDB.outbox.toArray()).filter((item) => item.operation === "delete").map((item) => item.entityId));
          const visibleServer = server.filter((item) => !pendingIds.has(item.id) && !pendingDeletes.has(item.id));
          await offlineDB.records.bulkPut(visibleServer.map((item) => ({ ...item, metadata: item.metadata || {}, syncState: "synced" as const })));
          setRecords([...localPending, ...visibleServer]);
        } else setRecords(server);
      }
    } catch {
      if (offlineDB) setRecords(await offlineDB.records.orderBy("updatedAt").reverse().limit(12).toArray());
    }
    try {
      const response = await fetch("/api/academic?resource=summary", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        setSummary(data.summary || { courses: 0, lectures: 0, assignments: 0, concerns: 0 });
        setUpcoming(data.upcomingAssignments || []);
      }
    } catch { /* keep cached dashboard state */ }
    if (offlineDB) {
      setPending((await offlineDB.outbox.count()) + (await offlineDB.uploads.count()) + (await offlineDB.academicQueue.count()) + (await offlineDB.aiQueue.count()));
      const savedConflicts = await offlineDB.meta.toArray();
      setConflicts(savedConflicts.filter((item) => item.key.startsWith("conflict:")).flatMap((item) => {
        try { return [JSON.parse(item.value) as SyncConflict]; } catch { return []; }
      }));
    }
  }, []);

  const sync = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current) return;
    syncingRef.current = true;
    setBusy(true);
    let statusMessage = "Workspace is up to date.";
    setSyncMessage("");
    try {
      if (offlineDB) {
        const queue = await offlineDB.outbox.orderBy("createdAt").limit(100).toArray();
        if (queue.length) {
          const pushed = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mutations: queue }) });
          const result = await pushed.json();
          if (!pushed.ok) throw new Error(result.error || "Could not upload offline changes");
          if (Array.isArray(result.appliedIds) && result.appliedIds.length) {
            await offlineDB.outbox.bulkDelete(result.appliedIds);
            for (const id of result.appliedIds) {
              const mutation = queue.find((item) => item.id === id);
              if (mutation?.operation === "delete") await offlineDB.records.delete(mutation.entityId);
              else if (mutation) {
                const local = await offlineDB.records.get(mutation.entityId);
                if (local) await offlineDB.records.put({ ...local, syncState: "synced" });
              }
            }
          }
          if (result.conflicts?.length) {
            for (const conflict of result.conflicts as Array<{ id: string; entityId: string; reason: string; serverRecord: RecordItem | null }>) {
              const mutation = queue.find((item) => item.id === conflict.id);
              if (mutation) await offlineDB.meta.put({ key: `conflict:${conflict.id}`, value: JSON.stringify({ ...conflict, mutation, createdAt: new Date().toISOString() }) });
            }
            statusMessage = `${result.conflicts.length} change(s) need your decision. Open the conflict panel below.`;
          } else if (result.rejected?.length) statusMessage = `${result.rejected.length} change(s) could not sync. Your local copy was preserved.`;
        }
        const academicMutations = await offlineDB.academicQueue.orderBy("createdAt").limit(100).toArray();
        for (const mutation of academicMutations) {
          let response: Response;
          if (mutation.resource === "announcements") {
            if (mutation.method === "DELETE") response = await fetch(`/api/announcements?id=${encodeURIComponent(String(mutation.payload.id || ""))}`, { method: "DELETE" });
            else response = await fetch("/api/announcements", { method: mutation.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...mutation.payload, clientMutationId: mutation.id }) });
          } else if (mutation.method === "DELETE") response = await fetch(`/api/academic?resource=${encodeURIComponent(mutation.resource)}&id=${encodeURIComponent(String(mutation.payload.id || ""))}`, { method: "DELETE" });
          else response = await fetch("/api/academic", { method: mutation.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation.payload) });
          if (response.ok || (mutation.method === "DELETE" && response.status === 404)) await offlineDB.academicQueue.delete(mutation.id);
          else { const result = await response.json().catch(() => ({})); statusMessage = `Academic change is still queued: ${result.error || "Server rejected the update"}`; break; }
        }
        const queuedUploads = await offlineDB.uploads.orderBy("createdAt").limit(10).toArray();
        for (const upload of queuedUploads) {
          const form = new FormData();
          form.set("id", upload.id); form.set("file", upload.file, upload.filename); form.set("title", upload.title);
          form.set("courseName", upload.courseName); form.set("courseCode", upload.courseCode);
          form.set("topic", upload.topic); form.set("lectureDate", upload.lectureDate);
          const response = await fetch("/api/documents", { method: "POST", body: form });
          const data = await response.json().catch(() => ({}));
          if (response.ok) await offlineDB.uploads.delete(upload.id);
          else { statusMessage = `An offline upload is still waiting: ${data.error || "Upload failed"}`; break; }
        }
        const aiRequests = await offlineDB.aiQueue.orderBy("createdAt").limit(20).toArray();
        for (const request of aiRequests) {
          const endpoint = request.kind === "chat" ? "/api/ai/chat" : "/api/ai/generate";
          const payload = request.kind === "chat" ? { message: request.prompt, history: request.history, clientRequestId: request.id } : { kind: request.draftKind, prompt: request.prompt, query: request.prompt, clientRequestId: request.id };
          const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) { statusMessage = `An AI request remains queued: ${result.error || "AI service unavailable"}`; break; }
          await offlineDB.meta.put({ key: `ai-result:${request.id}`, value: JSON.stringify({ kind: request.kind, draftKind: request.draftKind, prompt: request.prompt, answer: request.kind === "chat" ? result.answer : result.output, sources: result.sources || [], createdAt: new Date().toISOString() }) });
          await offlineDB.aiQueue.delete(request.id);
        }
        const since = (await offlineDB.meta.get("lastSync"))?.value || new Date(0).toISOString();
        const pulled = await fetch(`/api/sync?since=${encodeURIComponent(since)}`, { cache: "no-store" });
        if (!pulled.ok) throw new Error("Could not download cloud changes");
        const delta = await pulled.json();
        const pendingRecords = await offlineDB.records.where("syncState").equals("pending").toArray();
        const pendingIds = new Set(pendingRecords.map((item) => item.id));
        for (const record of (delta.records || []) as RecordItem[]) {
          if (!pendingIds.has(record.id)) await offlineDB.records.put({ ...record, metadata: record.metadata || {}, syncState: "synced" });
        }
        for (const id of (delta.deletedIds || []) as string[]) if (!pendingIds.has(id)) await offlineDB.records.delete(id);
        await offlineDB.meta.put({ key: "lastSync", value: delta.serverTime || new Date().toISOString() });
      }
      await load();
      setSyncMessage(statusMessage);
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Sync failed. Local changes are safe on this device.");
    } finally { syncingRef.current = false; setBusy(false); }
  }, [load]);

  async function resolveConflict(conflict: SyncConflict, choice: "server" | "local") {
    if (!offlineDB) return;
    const mutation = await offlineDB.outbox.get(conflict.id);
    if (!mutation) { await offlineDB.meta.delete(`conflict:${conflict.id}`); await load(); return; }
    if (choice === "server") {
      await offlineDB.outbox.delete(conflict.id);
      if (conflict.serverRecord) await offlineDB.records.put({ ...conflict.serverRecord, metadata: conflict.serverRecord.metadata || {}, syncState: "synced" });
      else await offlineDB.records.delete(conflict.entityId);
    } else {
      const nextVersion = conflict.serverRecord?.version ?? 0;
      await offlineDB.outbox.put({ ...mutation, baseVersion: nextVersion });
      const local = await offlineDB.records.get(conflict.entityId);
      if (local) await offlineDB.records.put({ ...local, version: nextVersion, syncState: "pending" });
    }
    await offlineDB.meta.delete(`conflict:${conflict.id}`);
    await load();
    if (choice === "local") void sync();
  }

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => { setOnline(navigator.onLine); if (navigator.onLine) void sync(); };
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    if (navigator.onLine) void sync(); else void load();
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, [load, sync]);

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">✳</div><div><strong>ClassDesk</strong><small>AFIT · ND1 · 2026/27</small></div></div><div className="nav-label">Workspace</div><nav className="nav">{nav.map(([icon, label, href]) => <Link key={href} className={href === "/" ? "active" : ""} href={href}><span>{icon}</span>{label}</Link>)}</nav><div style={{ marginTop: "auto" }} className="notice">Private workspace<br /><span className="muted">Two authorised staff accounts</span></div><LogoutButton /></aside>
    <main className="main"><div className="topline"><div><div className="eyebrow">COMMAND CENTRE / 2026–2027</div><h1>Good day, Class Rep.</h1><div className="sub">Your academic coordination workspace. Keep information accurate, organised and accessible.</div></div><div className="actions"><AccountBadge /><span className="tag">{online ? "ONLINE" : "OFFLINE"}</span><button className="btn ghost" onClick={() => void sync()} disabled={busy}>{busy ? "Syncing…" : "↻ Sync"} {pending > 0 ? `(${pending})` : ""}</button></div></div>
      {syncMessage && <p className="sub" role="status">{syncMessage}</p>}
      {conflicts.length > 0 && <div className="panel" style={{ marginBottom: 16 }}><div className="row"><h2>Sync conflicts</h2><span className="tag">{conflicts.length} need review</span></div><p className="sub">Another device changed or deleted a record while this device was offline. Choose which version should win. No change is discarded until you choose.</p>{conflicts.map((conflict) => <div className="item" key={conflict.id}><div className="row"><strong>{conflict.mutation.operation === "delete" ? "Offline deletion" : (conflict.mutation.payload as RecordItem).title}</strong><span className="tag">{conflict.reason}</span></div><p>Cloud version: {conflict.serverRecord?.title || "Record no longer exists in the cloud"}</p><div className="actions"><button className="btn" onClick={() => void resolveConflict(conflict, "server")}>Use cloud version</button><button className="btn primary" onClick={() => void resolveConflict(conflict, "local")}>{conflict.mutation.operation === "delete" ? "Delete cloud version" : "Keep my local version"}</button></div></div>)}</div>}
      <section className="grid"><div className="panel stat"><label>ACTIVE COURSES</label><strong>{summary.courses}</strong><small>In the course catalogue</small></div><div className="panel stat"><label>LECTURE SESSIONS</label><strong>{summary.lectures}</strong><small>Scheduled or recorded</small></div><div className="panel stat"><label>OPEN ASSIGNMENTS</label><strong>{summary.assignments}</strong><small>Not marked complete</small></div><div className="panel stat"><label>SYNC QUEUE</label><strong>{pending}</strong><small>Changes waiting to sync</small></div>
        <div className="panel wide"><div className="row"><h2>Recent activity</h2><Link className="sub" href="/records">View records →</Link></div>{records.length ? records.map((r) => <div className="item" key={r.id}><div className="row"><strong>{r.title}</strong><span className="tag">{r.type}</span></div><p>{r.content.slice(0, 160) || "No description added."}</p></div>) : <div className="empty">No records yet. Start by adding your first lecture or class activity.</div>}</div>
        <div className="panel side"><h2>Upcoming deadlines</h2>{upcoming.length ? upcoming.map((u) => { const due = u.dueAt ? new Date(u.dueAt) : null; const overdue = due ? due.getTime() < new Date(new Date().toDateString()).getTime() : false; return <div className="item" key={u.id}><div className="row"><strong>{u.title}</strong><span className="tag">{overdue ? "OVERDUE" : due?.toLocaleDateString("en-GB") || "DATE NOT SET"}</span></div><p>{u.course?.code || "Unassigned course"} · {u.status}</p></div>; }) : <div className="empty">No dated assignments recorded. Add due dates in Assignments.</div>}<div style={{ height: 18 }} /><h2>Quick actions</h2><div className="actions"><Link href="/notes" className="btn primary">＋ Upload lecture notes</Link><Link href="/announcements" className="btn">Create announcement</Link><Link href="/calendar" className="btn">Open calendar & timetable</Link><Link href="/assistant" className="btn">Ask academic AI</Link><Link href="/catch-up" className="btn">Build catch-up pack</Link></div><div style={{ height: 18 }} /><div className="notice">AI-generated content is always a draft. Verify dates, course details and departmental instructions before sharing.</div></div>
        <div className="panel half"><h2>Academic coverage</h2><p className="sub">Track what has actually been taught, course by course. Coverage is based on your verified lecture records, not assumptions.</p><Link href="/coverage" className="btn">Open coverage timeline →</Link></div><div className="panel half"><h2>Weekly administration</h2><p className="sub">Prepare a clear weekly summary of lectures, assignments, notices and upcoming activities.</p><div className="actions"><Link href="/assistant" className="btn">Draft AI weekly report</Link><Link href="/api/export/weekly" className="btn">Download weekly DOCX</Link><Link href="/api/export/weekly/pdf" className="btn">Download weekly PDF</Link></div></div>
      </section><footer className="sub" style={{ marginTop: 28 }}>AFIT ClassDesk · Personal-use academic administration · Not an official AFIT portal.</footer></main>
  </div>;
}
