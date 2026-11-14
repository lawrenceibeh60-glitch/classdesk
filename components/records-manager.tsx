"use client";
import { useCallback, useEffect, useState } from "react";
import SectionShell from "@/components/section-shell";
import { offlineDB, type CachedRecord, type QueuedUpload } from "@/lib/offline-db";

type R = CachedRecord;
type Doc = { id: string; title: string; filename: string; status: string; securityScanStatus?: string; originalAvailable?: boolean; courseName?: string | null; topic?: string | null; lectureDate?: string | null };
type Mode = "notes" | "records";

export default function RecordsManager({ mode }: { mode: Mode }) {
  const [items, setItems] = useState<R[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState(mode === "notes" ? "LECTURE" : "CONCERN");
  const [eventDate, setEventDate] = useState("");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [course, setCourse] = useState("");
  const [code, setCode] = useState("");
  const [topic, setTopic] = useState("");
  const [lectureDate, setLectureDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");

  const load = useCallback(async () => {
    let pending: R[] = [];
    if (offlineDB) {
      try { pending = await offlineDB.records.where("syncState").equals("pending").toArray(); } catch { /* ignore */ }
    }
    try {
      const r = await fetch("/api/records?limit=200", { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        const server: R[] = d.records || [];
        const pendingIds = new Set(pending.map((item) => item.id));
        const pendingDeletes = offlineDB ? new Set((await offlineDB.outbox.toArray()).filter((item) => item.operation === "delete").map((item) => item.entityId)) : new Set<string>();
        const visibleServer = server.filter((item) => !pendingIds.has(item.id) && !pendingDeletes.has(item.id));
        setItems([...pending, ...visibleServer]);
        if (offlineDB) await offlineDB.records.bulkPut(visibleServer.map(x => ({ ...x, metadata: x.metadata || {}, syncState: "synced" as const })));
      }
    } catch {
      if (offlineDB) setItems(await offlineDB.records.orderBy("updatedAt").reverse().toArray());
    }
    let serverDocs: Doc[] = [];
    try { const dr = await fetch("/api/documents"); if (dr.ok) serverDocs = (await dr.json()).documents || []; } catch { /* offline */ }
    const queuedDocs = offlineDB ? (await offlineDB.uploads.toArray()).map(item => ({ id: item.id, title: item.title, filename: item.filename, status: "QUEUED" })) : [];
    setDocs([...queuedDocs, ...serverDocs]);
  }, []);

  useEffect(() => {
    void load();
    const onOnline = async () => {
      if (offlineDB) {
        const queued = await offlineDB.uploads.orderBy("createdAt").limit(10).toArray();
        for (const upload of queued) {
          const form = new FormData(); form.set("id", upload.id); form.set("file", upload.file, upload.filename); form.set("title", upload.title); form.set("courseName", upload.courseName); form.set("courseCode", upload.courseCode); form.set("topic", upload.topic); form.set("lectureDate", upload.lectureDate);
          const response = await fetch("/api/documents", { method: "POST", body: form });
          if (response.ok) await offlineDB.uploads.delete(upload.id); else break;
        }
      }
      await load();
    };
    window.addEventListener("online", onOnline); return () => window.removeEventListener("online", onOnline);
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setMessage("");
    try {
      if (editId) {
        const payload = { id: editId, type, title, content, metadata: { source: "class-representative" }, eventDate: eventDate || null };
        let queued = !navigator.onLine;
        if (!queued) {
          try {
            const r = await fetch("/api/records", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error || "Could not update record");
          } catch (err) { if (!(err instanceof TypeError)) throw err; queued = true; }
        }
        if (queued) await queueRecord(payload);
        setMessage(queued ? "Update saved on this device. It will sync when you reconnect." : "Record updated.");
        setEditId(null); setTitle(""); setContent(""); setEventDate(""); await load(); return;
      }
      const id = crypto.randomUUID();
      const payload = { id, type, title, content, metadata: { source: "class-representative" }, eventDate: eventDate || null };
      let queued = !navigator.onLine;
      if (!queued) {
        try {
          const r = await fetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "Record save failed");
          setMessage("Record saved to the cloud.");
        } catch (err) { if (!(err instanceof TypeError)) throw err; queued = true; }
      }
      if (queued) {
        if (!offlineDB) throw new Error("Offline storage is unavailable in this browser.");
        await queueRecord(payload);
        setMessage("Saved on this device. It will sync when you reconnect.");
      }
      setTitle(""); setContent(""); setEventDate(""); await load();
    } catch (err) { setMessage(err instanceof Error ? err.message : "Could not save"); } finally { setLoading(false); }
  }


  async function queueRecord(input: { id: string; type: string; title: string; content: string; metadata?: Record<string, unknown>; eventDate?: string | null; status?: string; version?: number }) {
    const database = offlineDB;
    if (!database) throw new Error("Offline storage is unavailable in this browser.");
    const now = new Date().toISOString();
    const existing = await database.records.get(input.id);
    const baseVersion = existing?.version ?? input.version ?? 0;
    const local = { ...existing, ...input, version: baseVersion, metadata: input.metadata || existing?.metadata || {}, updatedAt: now, syncState: "pending" as const };
    await database.transaction("rw", database.records, database.outbox, async () => {
      await database.records.put(local);
      await database.outbox.where("entityId").equals(input.id).delete();
      await database.outbox.put({ id: crypto.randomUUID(), entityType: "record", entityId: input.id, operation: "upsert", baseVersion, payload: local, createdAt: now });
    });
  }

  async function queueDelete(id: string) {
    const database = offlineDB;
    if (!database) throw new Error("Offline storage is unavailable in this browser.");
    const now = new Date().toISOString();
    const existing = await database.records.get(id);
    const baseVersion = existing?.version ?? 0;
    await database.transaction("rw", database.records, database.outbox, async () => {
      await database.records.delete(id);
      await database.outbox.where("entityId").equals(id).delete();
      await database.outbox.put({ id: crypto.randomUUID(), entityType: "record", entityId: id, operation: "delete", baseVersion, payload: {}, createdAt: now });
    });
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault(); if (!file) return;
    setLoading(true); setMessage("");
    const f = new FormData();
    const uploadId = crypto.randomUUID();
    f.set("id", uploadId); f.set("file", file); f.set("title", title || file.name); f.set("courseName", course); f.set("courseCode", code); f.set("topic", topic); f.set("lectureDate", lectureDate);
    try {
      if (!navigator.onLine) {
        if (!offlineDB) throw new Error("Offline file storage is unavailable in this browser.");
        await queueUpload(file, uploadId);
        setMessage("File saved securely on this device. It will upload and index when you reconnect.");
        setFile(null); setTitle(""); setTopic(""); setLectureDate(""); (e.target as HTMLFormElement).reset(); return;
      }
      const r = await fetch("/api/documents", { method: "POST", body: f });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Upload failed");
      setMessage(`Document processed: ${d.document.chunkCount} searchable sections.`);
      setFile(null); setTitle(""); setTopic(""); setLectureDate(""); (e.target as HTMLFormElement).reset(); await load();
    } catch (err) {
      if (err instanceof TypeError && offlineDB && file) {
        await queueUpload(file, uploadId); setMessage("Network unavailable. File saved on this device and queued for upload."); setFile(null); setTitle(""); setTopic(""); setLectureDate(""); (e.target as HTMLFormElement).reset();
      } else setMessage(err instanceof Error ? err.message : "Upload failed");
    } finally { setLoading(false); }
  }

  async function queueUpload(selected: File, uploadId = crypto.randomUUID()) {
    if (!offlineDB) throw new Error("Offline file storage is unavailable in this browser.");
    if (selected.size > 20 * 1024 * 1024) throw new Error("Offline uploads are limited to 20 MB per file.");
    const item: QueuedUpload = { id: uploadId, file: selected, filename: selected.name, mimeType: selected.type || "application/octet-stream", title: title || selected.name, courseName: course, courseCode: code, topic, lectureDate, createdAt: new Date().toISOString() };
    await offlineDB.uploads.put(item);
  }

  async function removeRecord(id: string) {
    if (!confirm("Delete this record permanently?")) return;
    if (!navigator.onLine) { await queueDelete(id); setMessage("Deletion queued on this device and will sync when you reconnect."); await load(); return; }
    try {
      const r = await fetch(`/api/records?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) { setMessage("Could not delete record."); return; }
      if (offlineDB) await offlineDB.records.delete(id);
      await load();
    } catch { await queueDelete(id); setMessage("Deletion queued on this device and will sync when you reconnect."); await load(); }
  }
  async function removeDoc(id: string) {
    if (!confirm("Delete this document or queued upload?")) return;
    if (offlineDB && await offlineDB.uploads.get(id)) { await offlineDB.uploads.delete(id); await load(); setMessage("Queued upload removed from this device."); return; }
    const r = await fetch(`/api/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) { setMessage("Could not delete document."); return; }
    await load();
  }
  function startEdit(i: R) { setEditId(i.id); setTitle(i.title); setContent(i.content); setType(i.type); setEventDate(i.eventDate ? i.eventDate.slice(0, 10) : ""); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function setStatus(i: R, status: string) {
    const updated = { ...i, status, eventDate: i.eventDate || null };
    if (!navigator.onLine) { await queueRecord(updated); await load(); return; }
    try {
      const r = await fetch("/api/records", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: i.id, status }) });
      if (r.ok) await load(); else setMessage("Could not update status.");
    } catch { await queueRecord(updated); await load(); }
  }
  async function toggleDone(i: R) {
    const status = i.status === "DONE" ? "ACTIVE" : "DONE";
    await setStatus(i, status);
  }

  const heading = mode === "notes" ? "Lecture & Notes Manager" : "Class Records";
  const types = ["COURSE", "LECTURE", "TASK", "CONCERN"];
  const term = q.trim().toLowerCase();
  const visible = items
    .filter(i => filter === "ALL" || i.type === filter)
    .filter(i => !term || (i.title + " " + i.content).toLowerCase().includes(term));
  const visibleDocs = docs.filter(d => !term || (d.title + " " + (d.courseName || "") + " " + (d.topic || "")).toLowerCase().includes(term));
  const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "");

  return (
    <SectionShell title={heading} description={mode === "notes" ? "Upload source documents, index lecture material and record what was actually covered. Offline uploads are held on this device until the next successful sync." : "Maintain a private, searchable record of class activities and concerns."}>
      <div className="grid">
        <div className="panel half">
          <h2>{mode === "notes" ? "Upload lecture material" : "Add class record"}</h2>
          {mode === "notes" ? (
            <form onSubmit={upload}>
              <div className="field"><label>DOCUMENT TITLE</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. PHY 101 — Lecture 1" /></div>
              <div className="field"><label>COURSE CODE</label><input value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. PHY 101" /></div>
              <div className="field"><label>COURSE NAME</label><input value={course} onChange={e => setCourse(e.target.value)} placeholder="e.g. General Physics" /></div>
              <div className="field"><label>TOPIC</label><input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Measurements" /></div>
              <div className="field"><label>LECTURE DATE</label><input type="date" value={lectureDate} onChange={e => setLectureDate(e.target.value)} /></div>
              <div className="field"><label>FILE (PDF, DOCX, PPTX, TXT, MD, PNG, JPG, WEBP)</label><input type="file" accept=".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp" onChange={e => setFile(e.target.files?.[0] || null)} required /></div>
              <button className="btn primary" disabled={loading}>{loading ? "Processing…" : "Upload & index document"}</button>
            </form>
          ) : (
            <form onSubmit={save}>
              <div className="field"><label>TITLE</label><input value={title} onChange={e => setTitle(e.target.value)} required /></div>
              <div className="field"><label>TYPE</label><select value={type} onChange={e => setType(e.target.value)}>{types.map(t => <option key={t}>{t}</option>)}</select></div>
              <div className="field"><label>{type === "TASK" ? "DUE DATE" : "DATE (OPTIONAL)"}</label><input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} /></div>
              <div className="field"><label>DETAILS / MESSAGE</label><textarea value={content} onChange={e => setContent(e.target.value)} required /></div>
              <button className="btn primary" disabled={loading}>{loading ? "Saving…" : editId ? "Update record" : "Save record"}</button>{editId && <button type="button" className="btn ghost" onClick={() => { setEditId(null); setTitle(""); setContent(""); setEventDate(""); }}>Cancel edit</button>}
            </form>
          )}
          {message && <p className="sub">{message}</p>}
        </div>
        <div className="panel half">
          <div className="row"><h2>{mode === "notes" ? "Indexed documents" : "Recent records"}</h2></div>
          <div className="field"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" aria-label="Search" /></div>
          {mode === "records" && <div className="field"><select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter by type"><option value="ALL">All types</option>{types.map(t => <option key={t}>{t}</option>)}</select></div>}
          {mode === "notes" ? (
            visibleDocs.length ? visibleDocs.map(d => (
              <div className="item" key={d.id}>
                <div className="row"><strong>{d.title}</strong><span className="tag">{d.status}{d.securityScanStatus ? ` · ${d.securityScanStatus}` : ""}</span></div>
                <p>{d.courseName || "Course not assigned"} · {d.topic || "Topic not assigned"}{d.lectureDate ? ` · ${fmt(d.lectureDate)}` : ""} · {d.filename}</p>
                <div className="actions">{d.status === "QUEUED" ? <span className="sub">Stored on this device · waiting for connection</span> : d.originalAvailable ? <a className="btn" href={`/api/documents/${encodeURIComponent(d.id)}`}>Download original</a> : <span className="sub">Original not retained · searchable text is saved</span>}{(d.status === "QUEUED" || isPrimaryAdmin) && <button className="btn ghost" onClick={() => void removeDoc(d.id)}>{d.status === "QUEUED" ? "Remove queued upload" : "Delete"}</button>}</div>
              </div>
            )) : <div className="empty">No documents found.</div>
          ) : visible.length ? visible.map(i => (
            <div className="item" key={i.id}>
              <div className="row"><strong style={i.status === "DONE" ? { textDecoration: "line-through" } : undefined}>{i.title}</strong><span className="tag">{i.type}</span></div>
              <p>{i.content.slice(0, 180)}{i.eventDate ? ` · ${fmt(i.eventDate)}` : ""}</p>
              <div className="actions">
                                <button className="btn ghost" onClick={() => startEdit(i)}>Edit</button>
                {i.type === "TASK" && <button className="btn" onClick={() => void toggleDone(i)}>{i.status === "DONE" ? "Reopen" : "Mark done"}</button>}
                {isPrimaryAdmin && <button className="btn ghost" onClick={() => void removeRecord(i.id)}>Delete</button>}
              </div>
            </div>
          )) : <div className="empty">No records found.</div>}
        </div>
      </div>
    </SectionShell>
  );
}
