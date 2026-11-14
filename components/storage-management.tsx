"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type StoredDocument = { id: string; title: string; filename: string; sizeBytes: number; status: string; createdAt: string };
type AuditEvent = { id: string; actorUsername: string; actorRole: string; action: string; targetType: string; targetId: string | null; details: unknown; createdAt: string };

type StorageData = {
  counts: Record<string, number>;
  databaseBytes: number | null;
  tableSizes?: Array<{ table: string; bytes: number }>;
  cleanupPolicy: string;
};

const labels: Record<string, string> = {
  records: "Academic records",
  documents: "Uploaded documents",
  chunks: "Search-index chunks",
  announcements: "Announcements",
  announcementVersions: "Announcement history versions",
  announcementEvents: "Announcement audit events",
  courses: "Courses",
  lectures: "Lecture sessions",
  assignments: "Assignments",
  attendance: "Attendance summaries",
  concerns: "Class concerns",
  syncPending: "Pending sync mutations",
  syncApplied: "Applied sync history",
  rateLimitBuckets: "Rate-limit entries",
  aiReceipts: "AI request receipts",
};

function formatBytes(value: number | null) {
  if (value === null) return "Not available from this database role";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toFixed(2)} ${units[index]}`;
}

export default function StorageManagement() {
  const [data, setData] = useState<StorageData | null>(null);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [days, setDays] = useState("30");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sql, setSql] = useState('SELECT "id", "title", "status", "createdAt" FROM "Document" ORDER BY "createdAt" DESC');
  const [sqlRows, setSqlRows] = useState<unknown[]>([]);
  const [sqlBusy, setSqlBusy] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/storage", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not inspect SQL storage");
      setData(result);
      const documentResponse = await fetch("/api/documents", { cache: "no-store" });
      if (documentResponse.ok) {
        const documentData = await documentResponse.json();
        setDocuments(documentData.documents || []);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not inspect SQL storage");
    }
  }, []);

  async function deleteDocument(document: StoredDocument) {
    setBusy(true);
    setMessage("");
    try {
      const previewResponse = await fetch("/api/ai/tools", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview_delete_document", documentId: document.id })
      });
      const previewData = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(previewData.error || "Could not inspect deletion target");
      const preview = previewData.preview;
      const confirmed = window.confirm(
        "PERMANENT DELETION\n\n" + preview.title + "\n" + preview.filename + "\n" + formatBytes(preview.sizeBytes) + "\n\n" + preview.action + "\n\nContinue?"
      );
      if (!confirmed) return;
      const response = await fetch("/api/ai/tools", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_document", documentId: document.id, confirmPermanent: true, confirmTitle: document.title })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not delete stored document");
      if (!result.deleted?.databaseRecord || (preview.originalInSharedStorage && !result.deleted?.sharedStorageObject)) {
        throw new Error("Deletion returned an incomplete verification result. Check the audit log before retrying.");
      }
      setMessage("Verified deletion of \"" + document.title + "\" from the database and shared storage.");
      await refresh();
      await loadAuditEvents();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete stored document");
    } finally {
      setBusy(false);
    }
  }

  async function runSql() {
    setSqlBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/ai/tools", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sql_select", query: sql })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "SQL query failed");
      setSqlRows(result.rows || []);
      setMessage("Read-only SQL completed. Returned " + result.rowCount + " row(s)" + (result.limited ? " (100-row display limit)" : "") + ".");
      await loadAuditEvents();
    } catch (error) {
      setSqlRows([]);
      setMessage(error instanceof Error ? error.message : "SQL query failed");
    } finally { setSqlBusy(false); }
  }

  const loadAuditEvents = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/tools", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_audit_logs" })
      });
      const result = await response.json();
      if (response.ok) setAuditEvents(result.events || []);
    } catch { /* The audit history can be refreshed separately. */ }
  }, []);

  useEffect(() => { void refresh(); void loadAuditEvents(); }, [refresh, loadAuditEvents]);

  async function cleanup() {
    if (confirmation !== "CLEANUP_CLASSDESK_SQL") return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation, retentionDays: Number(days) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "SQL cleanup failed");
      setMessage(`Cleanup complete — expired rate-limit entries: ${result.deleted.expiredRateLimitBuckets}; old non-deletion sync receipts: ${result.deleted.oldAppliedSyncMutations}; old AI receipts: ${result.deleted.oldAiRequestReceipts}. Class content was not deleted.`);
      setConfirmation("");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "SQL cleanup failed");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel" style={{ marginTop: 16 }}>
    <div className="row" style={{ alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div><h2>SQL server storage</h2><p className="sub">Inspect database usage and remove expired operational data without wiping class content.</p></div>
      <button className="btn" type="button" onClick={() => void refresh()} disabled={busy}>Refresh usage</button>
    </div>
    <div className="panel" style={{ marginTop: 12 }}>
      <p className="sub">Reported PostgreSQL database size</p>
      <h2 style={{ fontSize: 28 }}>{formatBytes(data?.databaseBytes ?? null)}</h2>
      <p className="sub">Your hosted database quota is managed by your database provider. This figure is the whole database size, not a per-user estimate. Deleting rows makes space reusable, but PostgreSQL may not reduce the reported database size immediately; provider maintenance or compaction may be needed.</p>
    </div>
    <div className="grid" style={{ marginTop: 12 }}>
      {data && Object.entries(data.counts).map(([key, value]) => <div className="panel half" key={key}>
        <p className="sub">{labels[key] || key}</p><strong>{value.toLocaleString()}</strong>
      </div>)}
    </div>
    {!!data?.tableSizes?.length && <div style={{ marginTop: 14 }}>
      <h3>Largest SQL tables</h3>
      <div className="panel">
        {data.tableSizes.map((item) => <div key={item.table} className="row" style={{ justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border, #333)" }}>
          <span className="sub">{item.table}</span><strong>{formatBytes(item.bytes)}</strong>
        </div>)}
      </div>
    </div>}
    <p className="sub" style={{ marginTop: 12 }}>{data?.cleanupPolicy || "Loading cleanup policy…"}</p>
    <div className="actions" style={{ marginTop: 12 }}>
      <Link className="btn" href="/records">Manage records and uploaded documents</Link>
      <Link className="btn" href="/announcements">Manage announcements</Link>
    </div>
    <div style={{ marginTop: 16 }}>
      <h3>Stored documents — SQL + file storage</h3>
      <p className="sub">Deleting a document removes its extracted text and search chunks from PostgreSQL and its original file from shared object storage.</p>
      {!documents.length ? <p className="sub">No stored documents were returned.</p> : documents.map((document) => <div className="row" key={document.id} style={{ justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border, #333)" }}>
        <div style={{ minWidth: 0 }}><strong>{document.title}</strong><p className="sub">{document.filename} · {formatBytes(document.sizeBytes)} · {document.status}</p></div>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => void deleteDocument(document)}>Delete permanently</button>
      </div>)}
    </div>
    <div style={{ borderTop: "1px solid var(--border, #333)", marginTop: 18, paddingTop: 16 }}>
      <h3>Ava SQL editor / read-only</h3>
      <p className="sub">Run approved SELECT queries against ClassDesk tables. The server enforces a read-only transaction, a 3-second timeout and a 100-row result cap. Write or destructive SQL is not exposed to the model.</p>
      <div className="field">
        <label htmlFor="ava-sql-query">SQL SELECT</label>
        <textarea id="ava-sql-query" value={sql} onChange={event => setSql(event.target.value)} rows={5} spellCheck={false} style={{ width: "100%", fontFamily: "monospace" }} />
      </div>
      <button className="btn" type="button" onClick={() => void runSql()} disabled={sqlBusy || busy || !sql.trim()}>{sqlBusy ? "Running read-only query…" : "Execute SELECT"}</button>
      {!!sqlRows.length && <pre style={{ overflowX: "auto", maxHeight: 360, padding: 12, background: "#0A1019", color: "#CFD9E4", fontSize: 11 }}>{JSON.stringify(sqlRows, null, 2)}</pre>}
    </div>
    <div style={{ borderTop: "1px solid var(--border, #333)", marginTop: 18, paddingTop: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><h3>Privileged action audit log</h3><button className="btn ghost" type="button" onClick={() => void loadAuditEvents()}>Refresh log</button></div>
      <p className="sub">Permanent document deletions and SQL editor executions are recorded with the acting account.</p>
      {!auditEvents.length ? <p className="sub">No privileged events recorded yet.</p> : auditEvents.slice(0, 30).map(event => <div key={event.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border, #333)" }}>
        <strong>{event.action}</strong><p className="sub">{event.actorUsername} · {event.actorRole} · {event.targetType} · {new Date(event.createdAt).toLocaleString("en-GB")}</p>
      </div>)}
    </div>
    <div style={{ borderTop: "1px solid var(--border, #333)", marginTop: 18, paddingTop: 16 }}>
      <h3>Clean temporary SQL data</h3>
      <p className="sub">Removes expired rate-limit counters, old applied non-deletion sync receipts, and old AI idempotency receipts. Offline deletion tombstones are retained so devices that reconnect late still receive deletions. Pending sync changes are never removed. Academic records, documents, extracted text, announcements and accounts are not touched.</p>
      <div className="field">
        <label htmlFor="sql-retention-days">KEEP APPLIED SYNC HISTORY AND AI RECEIPTS FOR</label>
        <select id="sql-retention-days" value={days} onChange={(event) => setDays(event.target.value)}>
          <option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="sql-cleanup-confirm">TYPE CLEANUP_CLASSDESK_SQL TO CONFIRM</label>
        <input id="sql-cleanup-confirm" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
      </div>
      <button className="btn" type="button" onClick={() => void cleanup()} disabled={busy || confirmation !== "CLEANUP_CLASSDESK_SQL"}>{busy ? "Cleaning SQL data…" : "Clean temporary SQL data"}</button>
    </div>
    {message && <p className="sub" role="status" style={{ marginTop: 12 }}>{message}</p>}
  </section>;
}
