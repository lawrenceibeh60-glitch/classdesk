"use client";
import { useCallback, useEffect, useState } from "react";
import SectionShell from "@/components/section-shell";
import { offlineDB } from "@/lib/offline-db";
type Version = { id: string; version: number; title: string; body: string; status: string; createdAt: string };
type AnnouncementEvent = { id: string; action: string; details?: string | null; createdAt: string };
type Announcement = { id: string; title: string; body: string; category: string; source?: string | null; status: string; publishedAt?: string | null; updatedAt: string; versions: Version[]; events: AnnouncementEvent[] };
export default function AnnouncementStudio({ isPrimaryAdmin }: { isPrimaryAdmin: boolean }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [category, setCategory] = useState("GENERAL"); const [source, setSource] = useState("");
  const [editId, setEditId] = useState<string | null>(null); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [expanded, setExpanded] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/announcements", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load announcements");
      const list = data.announcements || [];
      if (offlineDB) {
        const [cached, pending] = await Promise.all([
          offlineDB.academicItems.where("resource").equals("announcements").toArray(),
          offlineDB.academicQueue.where("resource").equals("announcements").toArray(),
        ]);
        const pendingDeletes = new Set(pending.filter(item => item.method === "DELETE").map(item => String(item.payload.id || "")));
        const pendingWrites = new Set(pending.filter(item => item.method !== "DELETE").map(item => String(item.payload.id || "")));
        const pendingCached = cached.filter(item => pendingWrites.has(item.id));
        const pendingCachedIds = new Set(pendingCached.map(item => item.id));
        const serverIds = new Set(list.map((item: Announcement) => item.id));
        await offlineDB.academicItems.bulkDelete(cached.filter(item => !serverIds.has(item.id) && !pendingWrites.has(item.id)).map(item => item.key));
        await offlineDB.academicItems.bulkPut(list.filter((item: Announcement) => !pendingWrites.has(item.id)).map((item: Announcement) => ({ key: `announcements:${item.id}`, resource: "announcements", id: item.id, payload: item as unknown as Record<string, unknown>, updatedAt: new Date().toISOString() })));
        setItems([...list.filter((item: Announcement) => !pendingDeletes.has(item.id) && !pendingCachedIds.has(item.id)), ...pendingCached.map(item => item.payload as unknown as Announcement)]);
      } else {
        setItems(list);
      }
    } catch (error) {
      if (!offlineDB) throw error;
      const cached = await offlineDB.academicItems.where("resource").equals("announcements").toArray(); setItems(cached.map(item => item.payload as unknown as Announcement));
      if (!cached.length) setMessage(error instanceof Error ? error.message : "Offline: no cached announcements available.");
    }
  }, []);
  useEffect(() => {
    void load();
    const onOnline = async () => {
      if (offlineDB) {
        const pending = await offlineDB.academicQueue.where("resource").equals("announcements").toArray();
        pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        for (const mutation of pending) {
          const response = mutation.method === "DELETE"
            ? await fetch(`/api/announcements?id=${encodeURIComponent(String(mutation.payload.id || ""))}`, { method: "DELETE" })
            : await fetch("/api/announcements", { method: mutation.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...mutation.payload, clientMutationId: mutation.id }) });
          if (response.ok || (mutation.method === "DELETE" && response.status === 404)) await offlineDB.academicQueue.delete(mutation.id);
          else { setMessage("Some announcement drafts remain queued. Review the connection and try again."); break; }
        }
      }
      await load();
    };
    window.addEventListener("online", onOnline); return () => window.removeEventListener("online", onOnline);
  }, [load]);
  async function queueOffline(method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>) {
    if (!offlineDB) throw new Error("Offline storage is unavailable in this browser.");
    const id = String(payload.id || "");
    await offlineDB.academicQueue.put({ id: crypto.randomUUID(), resource: "announcements", method, payload, createdAt: new Date().toISOString() });
    if (method === "DELETE") await offlineDB.academicItems.delete(`announcements:${id}`);
    else { const previous = await offlineDB.academicItems.get(`announcements:${id}`); await offlineDB.academicItems.put({ key: `announcements:${id}`, resource: "announcements", id, payload: { ...(previous?.payload || {}), ...payload, status: "DRAFT" }, updatedAt: new Date().toISOString() }); }
  }
  function reset() { setTitle(""); setBody(""); setCategory("GENERAL"); setSource(""); setEditId(null); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    const id = editId || crypto.randomUUID();
    const payload = editId ? { id, action: "edit", title, body, category, source } : { id, title, body, category, source };
    try {
      if (!navigator.onLine) { await queueOffline(editId ? "PATCH" : "POST", payload); setMessage("Draft saved on this device. It will sync when you reconnect; approval and publication require a connection."); }
      else {
        try {
          const response = await fetch("/api/announcements", { method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not save announcement");
          setMessage(editId ? "A new draft version was saved. Previous versions remain available." : "Draft created. It has not been approved or published.");
        } catch (error) { if (!(error instanceof TypeError)) throw error; await queueOffline(editId ? "PATCH" : "POST", payload); setMessage("Network unavailable. Draft saved locally for later sync."); }
      }
      reset(); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); }
    finally { setBusy(false); }
  }
  async function action(item: Announcement, actionName: string) {
    if (!navigator.onLine) { setMessage("Approval, publication and archive actions require an internet connection. Drafts can still be saved offline."); return; }
    setMessage(""); const response = await fetch("/api/announcements", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, action: actionName }) });
    const data = await response.json(); if (!response.ok) { setMessage(data.error || "Action failed"); return; } await load();
  }
  function edit(item: Announcement) { setEditId(item.id); setTitle(item.title); setBody(item.body); setCategory(item.category); setSource(item.source || ""); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function remove(item: Announcement) { if (!confirm("Permanently delete this announcement and its version history?")) return; if (!navigator.onLine) { await queueOffline("DELETE", { id: item.id }); await load(); setMessage("Deletion queued on this device."); return; } const response = await fetch(`/api/announcements?id=${encodeURIComponent(item.id)}`, { method: "DELETE" }); if (!response.ok) { setMessage("Could not delete announcement"); return; } await load(); }
  const share = (item: Announcement) => `https://wa.me/?text=${encodeURIComponent(`*${item.title}*\n\n${item.body}`)}`;
  const unresolved = (item: Announcement) => /\[[A-Z0-9 _/:-]{2,}\]/.test(item.title + " " + item.body);
  return <SectionShell title="Announcement studio" description="Prepare class notices, preserve every revision, and enforce a human approval step before publication.">
    <div className="grid">
      <div className="panel half"><h2>{editId ? "Revise announcement" : "Create announcement draft"}</h2><form onSubmit={save}>
        <div className="field"><label>TITLE</label><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} required /></div>
        <div className="field"><label>CATEGORY</label><select value={category} onChange={(event) => setCategory(event.target.value)}><option>GENERAL</option><option>LECTURE</option><option>ASSIGNMENT</option><option>ASSESSMENT</option><option>ADMINISTRATION</option><option>MEETING</option></select></div>
        <div className="field"><label>MESSAGE</label><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={20000} required /></div>
        <div className="field"><label>VERIFIED SOURCE / CONFIRMATION</label><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="e.g. Department notice, lecturer confirmation" /></div>
        <div className="notice">AI-generated or manually drafted text remains a draft. Verify every date, venue, lecturer instruction and deadline before approval.</div>
        <div className="actions" style={{ marginTop: 14 }}><button className="btn primary" disabled={busy}>{busy ? "Saving…" : editId ? "Save new version" : "Save draft"}</button>{editId && <button type="button" className="btn ghost" onClick={reset}>Cancel</button>}</div>
      </form>{message && <p className="sub" role="status">{message}</p>}</div>
      <div className="panel half"><div className="row"><h2>Announcement register</h2><span className="tag">{items.length}</span></div>
        {items.length ? items.map((item) => <article className="item" key={item.id}>
          <div className="row"><strong>{item.title}</strong><span className="tag">{item.status}</span></div>
          <p>{item.category} · Version {item.versions?.[0]?.version || 1} · Updated {new Date(item.updatedAt).toLocaleDateString("en-GB")}</p>
          <p style={{ whiteSpace: "pre-wrap" }}>{item.body}</p>
          {item.source && <p>Source: {item.source}</p>}
          {item.status === "DRAFT" && unresolved(item) && <p className="error-text">Contains unresolved [PLACEHOLDER] fields. Approval is blocked.</p>}
          <div className="actions" style={{ marginTop: 10 }}>
            {isPrimaryAdmin && item.status === "DRAFT" && <button className="btn" onClick={() => void action(item, "approve")} disabled={unresolved(item)}>Approve</button>}
            {isPrimaryAdmin && item.status === "APPROVED" && <button className="btn primary" onClick={() => void action(item, "publish")}>Mark published</button>}
            {item.status === "PUBLISHED" && <a className="btn" href={share(item)} target="_blank" rel="noreferrer">Share on WhatsApp</a>}
            {item.status !== "ARCHIVED" && <button className="btn ghost" onClick={() => edit(item)}>Edit / revise</button>}
            {isPrimaryAdmin && item.status !== "ARCHIVED" && <button className="btn ghost" onClick={() => void action(item, "archive")}>Archive</button>}
            {isPrimaryAdmin && item.status !== "DRAFT" && item.status !== "ARCHIVED" && <button className="btn ghost" onClick={() => void action(item, "backToDraft")}>Return to draft</button>}
            <button className="btn ghost" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>History ({item.versions?.length || 0})</button>
            {isPrimaryAdmin && <button className="btn ghost" onClick={() => void remove(item)}>Delete</button>}
          </div>
          {expanded === item.id && <div className="notice" style={{ marginTop: 12 }}><strong>Approval / publication activity</strong>{item.events?.map((event) => <div className="item" key={event.id}><div className="row"><strong>{event.action.replaceAll("_", " ")}</strong><span className="tag">{new Date(event.createdAt).toLocaleString("en-GB")}</span></div><p>{event.details}</p></div>)}<strong>Content version history</strong>{item.versions?.map((version) => <div className="item" key={version.id}><div className="row"><strong>Version {version.version}</strong><span className="tag">{version.status}</span></div><p>{new Date(version.createdAt).toLocaleString("en-GB")}</p><p style={{ whiteSpace: "pre-wrap" }}>{version.title}<br />{version.body}</p></div>)}</div>}
        </article>) : <div className="empty">No announcements yet. Create your first draft.</div>}
      </div>
    </div>
  </SectionShell>;
}
