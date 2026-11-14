"use client";
import { useState } from "react";

export default function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sign-in failed");
      location.href = "/";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="classdesk-username">USERNAME</label>
        <input id="classdesk-username" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={80} />
      </div>
      <div className="field">
        <label htmlFor="classdesk-password">PASSWORD</label>
        <input id="classdesk-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={256} />
      </div>
      {error && <p role="alert" style={{ color: "#ff9a8f", fontSize: 12 }}>{error}</p>}
      <button className="btn primary" disabled={busy} style={{ width: "100%" }}>{busy ? "Verifying credentials…" : "Enter workspace"}</button>
    </form>
  );
}
