"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import SectionShell from "@/components/section-shell";
import { offlineDB } from "@/lib/offline-db";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mode = "courses" | "lectures" | "assignments" | "attendance" | "concerns";
type Field = { key: string; label: string; kind?: "textarea" | "date" | "number" | "course" | "select"; required?: boolean; options?: string[]; placeholder?: string };
const config: Record<Mode, { title: string; description: string; fields: Field[] }> = {
  courses: { title: "Course catalogue", description: "Maintain the class course list and lecturer details. Only enter details confirmed by your department or lecturer.", fields: [
    { key: "code", label: "COURSE CODE", required: true }, { key: "name", label: "COURSE NAME", required: true }, { key: "lecturer", label: "LECTURER (OPTIONAL)" }, { key: "semester", label: "SEMESTER / SESSION" }, { key: "description", label: "NOTES", kind: "textarea" },
  ] },
  lectures: { title: "Lecture sessions", description: "Record scheduled and completed lectures, topics actually covered, venues and verified summaries.", fields: [
    { key: "courseId", label: "COURSE", kind: "course" }, { key: "topic", label: "TOPIC", required: true }, { key: "scheduledAt", label: "SCHEDULED DATE", kind: "date" }, { key: "heldAt", label: "DATE HELD" }, { key: "venue", label: "VENUE" }, { key: "lecturer", label: "LECTURER" }, { key: "summary", label: "WHAT WAS ACTUALLY COVERED", kind: "textarea" },
  ] },
  assignments: { title: "Assignments & deadlines", description: "Track assignment details, due dates and submission instructions. Verify deadlines before sharing them.", fields: [
    { key: "courseId", label: "COURSE", kind: "course" }, { key: "title", label: "ASSIGNMENT TITLE", required: true }, { key: "dueAt", label: "DUE DATE", kind: "date" }, { key: "details", label: "DESCRIPTION", kind: "textarea" }, { key: "submissionInstructions", label: "SUBMISSION INSTRUCTIONS", kind: "textarea" }, { key: "source", label: "SOURCE / CONFIRMATION" },
  ] },
  attendance: { title: "Attendance summaries", description: "Store aggregate class counts only. Do not enter student names, phone numbers or other identifiable attendance details here.", fields: [
    { key: "courseId", label: "COURSE", kind: "course" }, { key: "sessionDate", label: "SESSION DATE", kind: "date", required: true }, { key: "presentCount", label: "PRESENT COUNT", kind: "number", required: true }, { key: "absentCount", label: "ABSENT COUNT", kind: "number", required: true }, { key: "note", label: "GENERAL NOTE (NO STUDENT IDENTIFIERS)", kind: "textarea" },
  ] },
  concerns: { title: "Class concerns", description: "Track issues raised by classmates and the actions taken. Avoid storing sensitive personal details or private medical information.", fields: [
    { key: "category", label: "CATEGORY", kind: "select", options: ["GENERAL", "LECTURE", "FACILITY", "TIMETABLE", "ACADEMIC", "OTHER"] }, { key: "title", label: "CONCERN", required: true }, { key: "details", label: "DETAILS", kind: "textarea", required: true }, { key: "resolution", label: "RESOLUTION / ACTION TAKEN", kind: "textarea" },
  ] },
};
const blank = (mode: Mode) => Object.fromEntries(config[mode].fields.map((field) => [field.key, field.kind === "select" ? field.options?.[0] || "" : ""]));

export default function AcademicManager({ mode }: { mode: Mode }) {
  const meta = config[mode];
  const [items, setItems] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [values, setValues] = useState<Record<string, string>>(() => blank(mode));
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/academic?resource=${mode}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load records");
      const serverItems = data.items || [];
      if (offlineDB) {
        const [cachedItems, pendingMutations] = await Promise.all([
          offlineDB.academicItems.where("resource").equals(mode).toArray(),
          offlineDB.academicQueue.where("resource").equals(mode).toArray(),
        ]);
        const pendingDeletes = new Set(pendingMutations.filter(item => item.method === "DELETE").map(item => String(item.payload.id || "")));
        const pendingWrites = new Set(pendingMutations.filter(item => item.method !== "DELETE").map(item => String(item.payload.id || "")));
        const currentIds = new Set(serverItems.map((item: any) => item.id));
        const pendingCached = cachedItems.filter(item => pendingWrites.has(item.id));
        const pendingCachedIds = new Set(pendingCached.map(item => item.id));
        await offlineDB.academicItems.bulkDelete(cachedItems.filter(item => !currentIds.has(item.id) && !pendingWrites.has(item.id)).map(item => item.key));
        await offlineDB.academicItems.bulkPut(serverItems.filter((item: any) => !pendingWrites.has(item.id)).map((item: any) => ({ key: `${mode}:${item.id}`, resource: mode, id: item.id, payload: item, updatedAt: new Date().toISOString() })));
        const visibleServer = serverItems.filter((item: any) => !pendingDeletes.has(item.id) && !pendingCachedIds.has(item.id));
        setItems([...visibleServer, ...pendingCached.map(item => item.payload)]);
      } else {
        setItems(serverItems);
      }
      if (mode !== "courses") {
        const courseResponse = await fetch("/api/academic?resource=courses", { cache: "no-store" });
        if (courseResponse.ok) { const list = (await courseResponse.json()).items || []; setCourses(list); if (offlineDB) await offlineDB.academicItems.bulkPut(list.map((item: any) => ({ key: `courses:${item.id}`, resource: "courses", id: item.id, payload: item, updatedAt: new Date().toISOString() }))); }
      }
    } catch (error) {
      if (!offlineDB) throw error;
      const cached = await offlineDB.academicItems.where("resource").equals(mode).toArray();
      setItems(cached.map(item => item.payload));
      if (mode !== "courses") { const savedCourses = await offlineDB.academicItems.where("resource").equals("courses").toArray(); setCourses(savedCourses.map(item => item.payload)); }
      if (!cached.length) setMessage("Offline: no cached items are available yet.");
    }
  }, [mode]);
  useEffect(() => {
    void load().catch((error) => setMessage(error.message));
    const onOnline = async () => {
      if (offlineDB) {
        const pending = await offlineDB.academicQueue.where("resource").equals(mode).toArray();
        pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        for (const mutation of pending) {
          const response = mutation.method === "DELETE"
            ? await fetch(`/api/academic?resource=${mode}&id=${encodeURIComponent(String(mutation.payload.id || ""))}`, { method: "DELETE" })
            : await fetch("/api/academic", { method: mutation.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation.payload) });
          if (response.ok || (mutation.method === "DELETE" && response.status === 404)) await offlineDB.academicQueue.delete(mutation.id);
          else { setMessage("Some offline changes remain queued. Open the dashboard to review sync status."); break; }
        }
      }
      await load();
    };
    window.addEventListener("online", onOnline); return () => window.removeEventListener("online", onOnline);
  }, [load, mode]);
  async function queueOffline(method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>) {
    if (!offlineDB) throw new Error("Offline storage is unavailable in this browser.");
    const id = String(payload.id || "");
    await offlineDB.academicQueue.put({ id: crypto.randomUUID(), resource: mode, method, payload, createdAt: new Date().toISOString() });
    if (method === "DELETE") await offlineDB.academicItems.delete(`${mode}:${id}`);
    else {
      const existing = await offlineDB.academicItems.get(`${mode}:${id}`);
      await offlineDB.academicItems.put({ key: `${mode}:${id}`, resource: mode, id, payload: { ...(existing?.payload || {}), ...payload }, updatedAt: new Date().toISOString() });
    }
  }

  const filtered = useMemo(() => items.filter((item) => (JSON.stringify(item) || "").toLowerCase().includes(search.toLowerCase())), [items, search]);
  function setField(key: string, value: string) { setValues((current) => ({ ...current, [key]: value })); }
  function edit(item: any) {
    const next = blank(mode);
    for (const field of meta.fields) {
      let value = item[field.key];
      if (field.key === "courseId") value = item.courseId || "";
      if (field.kind === "date" || field.key.endsWith("At") || field.key === "heldAt" || field.key === "sessionDate") value = value ? new Date(value).toISOString().slice(0, 10) : "";
      next[field.key] = value === null || value === undefined ? "" : String(value);
    }
    setValues(next); setEditId(item.id); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    const id = editId || crypto.randomUUID();
    const payload: Record<string, unknown> = { resource: mode, id };
    for (const field of meta.fields) {
      const value = values[field.key] || "";
      payload[field.key] = field.kind === "number" ? Number(value) : value || null;
    }
    try {
      if (!navigator.onLine) { await queueOffline(editId ? "PATCH" : "POST", payload); setMessage("Saved on this device. It will sync when you reconnect."); }
      else {
        try {
          const response = await fetch("/api/academic", { method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not save");
        } catch (error) { if (!(error instanceof TypeError)) throw error; await queueOffline(editId ? "PATCH" : "POST", payload); setMessage("Network unavailable. Saved on this device for later sync."); }
      }
      setEditId(null); setValues(blank(mode)); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); }
    finally { setBusy(false); }
  }
  async function update(id: string, changes: Record<string, unknown>) {
    const payload = { resource: mode, id, ...changes };
    if (!navigator.onLine) { await queueOffline("PATCH", payload); await load(); setMessage("Change saved offline; sync will resume when online."); return; }
    try { const response = await fetch("/api/academic", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Update failed"); await load(); }
    catch (error) { if (error instanceof TypeError) { await queueOffline("PATCH", payload); await load(); setMessage("Network unavailable. Change queued for sync."); } else setMessage(error instanceof Error ? error.message : "Update failed"); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this item permanently?")) return;
    if (!navigator.onLine) { await queueOffline("DELETE", { resource: mode, id }); await load(); setMessage("Deletion queued on this device."); return; }
    try { const response = await fetch(`/api/academic?resource=${mode}&id=${encodeURIComponent(id)}`, { method: "DELETE" }); if (!response.ok && response.status !== 404) throw new Error("Could not delete this item."); await load(); }
    catch (error) { if (error instanceof TypeError) { await queueOffline("DELETE", { resource: mode, id }); await load(); setMessage("Network unavailable. Deletion queued for sync."); } else setMessage(error instanceof Error ? error.message : "Delete failed"); }
  }
  const courseName = (item: any) => item.course ? `${item.course.code} · ${item.course.name}` : "Course not assigned";
  function date(value?: string | null) { return value ? new Date(value).toLocaleDateString("en-GB") : "Date not set"; }

  return <SectionShell title={meta.title} description={meta.description}>
    <div className="grid">
      <div className="panel half"><h2>{editId ? "Edit item" : "Add new item"}</h2><form onSubmit={save}>
        {meta.fields.map((field) => <div className="field" key={field.key}><label>{field.label}</label>
          {field.kind === "textarea" ? <textarea required={field.required} value={values[field.key] || ""} onChange={(event) => setField(field.key, event.target.value)} />
            : field.kind === "course" ? <select value={values[field.key] || ""} onChange={(event) => setField(field.key, event.target.value)}><option value="">Unassigned</option>{courses.map((course) => <option value={course.id} key={course.id}>{course.code} · {course.name}</option>)}</select>
            : field.kind === "select" ? <select value={values[field.key] || ""} onChange={(event) => setField(field.key, event.target.value)}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>
            : <input type={field.kind === "number" ? "number" : field.kind === "date" || field.key.endsWith("At") || ["heldAt", "sessionDate"].includes(field.key) ? "date" : "text"} min={field.kind === "number" ? 0 : undefined} required={field.required} value={values[field.key] || ""} placeholder={field.placeholder} onChange={(event) => setField(field.key, event.target.value)} />}
        </div>)}
        <div className="actions"><button className="btn primary" disabled={busy}>{busy ? "Saving…" : editId ? "Save changes" : "Add item"}</button>{editId && <button type="button" className="btn ghost" onClick={() => { setEditId(null); setValues(blank(mode)); }}>Cancel</button>}</div>
      </form>{message && <p className="sub" role="status">{message}</p>}</div>
      <div className="panel half"><div className="row"><h2>Saved items</h2><span className="tag">{filtered.length}</span></div><div className="field"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search records…" aria-label="Search records" /></div>
        {filtered.length ? filtered.map((item) => <div className="item" key={item.id}>
          <div className="row"><strong>{item.code ? `${item.code} · ${item.name}` : item.title || item.topic || item.name || item.category}</strong><span className="tag">{item.status || (item.active === false ? "INACTIVE" : "SAVED")}</span></div>
          {mode === "lectures" && <p>{courseName(item)} · Held: {date(item.heldAt)} · Scheduled: {date(item.scheduledAt)}<br />{item.summary}</p>}
          {mode === "assignments" && <p>{courseName(item)} · Due: {date(item.dueAt)}<br />{item.details}</p>}
          {mode === "attendance" && <p>{courseName(item)} · {date(item.sessionDate)} · Present: {item.presentCount} · Absent: {item.absentCount}<br />{item.note}</p>}
          {mode === "concerns" && <p>{item.category} · {item.details}{item.resolution ? ` · Resolution: ${item.resolution}` : ""}</p>}
          {mode === "courses" && <p>{item.lecturer || "Lecturer not recorded"} · {item.semester || "Semester not set"}</p>}
          <div className="actions"><button className="btn ghost" onClick={() => edit(item)}>Edit</button>
            {mode === "assignments" && <button className="btn" onClick={() => { const next = item.status === "TODO" ? "IN_PROGRESS" : item.status === "IN_PROGRESS" ? "DONE" : "TODO"; void update(item.id, { status: next }); }}>{item.status === "TODO" ? "Start" : item.status === "IN_PROGRESS" ? "Mark done" : "Reopen"}</button>}
            {mode === "concerns" && <button className="btn" onClick={() => void update(item.id, { status: item.status === "RESOLVED" ? "OPEN" : "RESOLVED" })}>{item.status === "RESOLVED" ? "Reopen" : "Resolve"}</button>}
            {mode === "courses" && <button className="btn" onClick={() => void update(item.id, { active: !item.active })}>{item.active ? "Deactivate" : "Activate"}</button>}
            <button className="btn ghost" onClick={() => void remove(item.id)}>Delete</button></div>
        </div>) : <div className="empty">No items yet. Add your first entry here.</div>}
      </div>
    </div>
  </SectionShell>;
}
