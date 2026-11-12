"use client";
import Link from "next/link";
import { useState } from "react";
export default function BackupTools() {
  const [file, setFile] = useState<File | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function restore(event: React.FormEvent) {
    event.preventDefault(); if (!file || confirmation !== "RESTORE_CLASSDESK_BACKUP") return;
    setBusy(true); setMessage("");
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error("Backup file exceeds 100 MB.");
      const isZip = file.name.toLowerCase().endsWith(".zip");
      let response: Response;
      if (isZip) {
        response = await fetch("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/zip", "x-classdesk-restore-confirmation": confirmation }, body: await file.arrayBuffer() });
      } else {
        const parsed = JSON.parse(await file.text());
        response = await fetch("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...parsed, confirmation }) });
      }
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Restore failed");
      setMessage(`Restore complete: ${Object.entries(data.restored || {}).map(([key, value]) => `${key} ${value}`).join(" · ")}. Original files restored: ${data.originalsRestored || 0}; unavailable: ${(data.originalsMissing || 0) + (data.originalsFailed || 0)}. ${data.note || ""}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Restore failed"); }
    finally { setBusy(false); }
  }
  return <div className="grid">
    <div className="panel half"><h2>Data backup</h2><p className="sub">The complete ZIP backup includes class data, searchable document text, announcement history and original uploaded files when object storage is configured.</p><div className="actions"><Link className="btn primary" href="/api/export/archive">Download complete ZIP backup</Link><Link className="btn" href="/api/export">Download JSON data only</Link><Link className="btn" href="/api/export/weekly">Weekly report DOCX</Link><Link className="btn" href="/api/export/catch-up">Catch-up pack DOCX</Link><Link className="btn" href="/api/export/catch-up/pdf">Catch-up pack PDF</Link></div><p className="sub" style={{ marginTop: 12 }}>Backups are not encrypted by ClassDesk; store them securely. ZIP backups include originals only when object storage is configured and accessible.</p></div>
    <div className="panel half"><h2>Restore from backup</h2><p className="sub">Restore merges matching IDs and adds missing items. It does not delete unrelated current data. ZIP restores can include original files; JSON restores contain searchable text only.</p><form onSubmit={restore}><div className="field"><label>BACKUP FILE (JSON OR ZIP)</label><input type="file" accept="application/json,.json,.zip,application/zip" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></div><div className="field"><label>TYPE RESTORE_CLASSDESK_BACKUP TO CONFIRM</label><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required /></div><button className="btn primary" disabled={busy || !file || confirmation !== "RESTORE_CLASSDESK_BACKUP"}>{busy ? "Restoring…" : "Restore backup"}</button></form>{message && <p className="sub" role="status">{message}</p>}</div>
  </div>;
}
