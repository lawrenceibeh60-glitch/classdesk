"use client";
import { useState } from "react";
import { offlineDB } from "@/lib/offline-db";
export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function logout() {
    if (busy) return;
    const pending = offlineDB ? await offlineDB.outbox.count() : 0;
    const warning = pending
      ? `${pending} offline change(s) have not synced. Signing out will erase this device's local ClassDesk cache and pending changes. Continue?`
      : "Sign out and clear private ClassDesk data cached on this device?";
    if (!confirm(warning)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Could not end the server session. Check your connection and try again.");
      if (offlineDB) await offlineDB.delete();
      const registration = await navigator.serviceWorker?.getRegistration();
      registration?.active?.postMessage("clear-cache");
      location.href = "/login";
    } catch (error) {
      alert(error instanceof Error ? error.message : "Sign out failed");
      setBusy(false);
    }
  }
  return <button className="btn ghost" style={{ marginTop: "auto" }} onClick={() => void logout()} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>;
}
