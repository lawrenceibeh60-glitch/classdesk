"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type StoredDocument = { id: string; title: string; filename: string; sizeBytes: number; status: string; createdAt: string };

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
  courses: "Courses",
  assignments: "Assignments",
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

  useEffect(() => { void refresh(); }, [refresh]);

  async function deleteDocument(document: StoredDocument) {
    if (!window.confirm(`Permanently delete "${document.title}"? This removes its SQL document row, extracted text, search chunks and stored original file.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/documents?id=${encodeURIComponent(document.id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not delete stored document");
      setMessage(`Deleted "${document.title}" from SQL and shared file storage.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete stored document");
    } finally {
      setBusy(false);
    }
  }

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
      <p className="sub">Your hosted database quota is managed by your database provider. This figure is the whole database size, not a per-user estimate.</p>
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
