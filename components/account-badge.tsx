"use client";
import { useEffect, useState } from "react";

type Account = { displayName: string; username: string; role: "CLASS_REP" | "ASSISTANT_REP" };

export default function AccountBadge() {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (active && data?.user) setAccount(data.user as Account); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (!account) return null;
  const role = account.role === "CLASS_REP" ? "PRIMARY ADMIN" : "ASSISTANT REP";
  return <span className="tag" title={account.username}>{account.displayName.toUpperCase()} · {role}</span>;
}
