"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

// Auth foundation (P2) — the operator sign-in. Posts the password to
// /api/auth/login; on success the signed cookie is set and we return to `next`
// (open-redirect-guarded: same-origin absolute paths only).
function safeNext(): string {
  if (typeof window === "undefined") return "/";
  const n = new URLSearchParams(window.location.search).get("next") ?? "/";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

export default function LoginPage() {
  const t = useTranslations("login");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    if (r && r.ok) {
      router.replace(safeNext());
      router.refresh();
    } else {
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
      <h1 className="mt-1 font-serif text-display text-ink">{t("title")}</h1>
      <p className="mt-2 text-body text-steel">{t("subtitle")}</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <label className="block text-sm text-ink">
          {t("passwordLabel")}
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (status === "error") setStatus("idle");
            }}
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-stone-400"
          />
        </label>
        {status === "error" ? <p className="text-sm text-coral">{t("error")}</p> : null}
        <button
          type="submit"
          disabled={status === "submitting" || !password}
          className="w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
        >
          {status === "submitting" ? t("submitting") : t("submit")}
        </button>
      </form>
    </main>
  );
}
