"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { TextInput } from "@/app/_components/TextInput";

// Auth foundation (P2) — the operator sign-in. Posts the password to
// /api/auth/login; on success the signed cookie is set and we return to `next`
// (open-redirect-guarded: same-origin absolute paths only).
function safeNext(): string {
  if (typeof window === "undefined") return "/";
  const n = new URLSearchParams(window.location.search).get("next") ?? "/";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

export function LoginClient() {
  const t = useTranslations("login");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    // An email routes to per-user login; blank falls back to the operator password.
    const trimmedEmail = email.trim();
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(trimmedEmail ? { email: trimmedEmail, password } : { password }),
    }).catch(() => null);
    if (r && r.ok) {
      // Client-side navigation keeps the toast alive across the redirect (the
      // Toaster lives in the root layout).
      toast.success(t("success"));
      router.replace(safeNext());
      router.refresh();
    } else if (!r) {
      // Network failure ≠ wrong password: the fetch never reached the server, so
      // the inline "incorrect password" message would blame the wrong thing.
      setStatus("idle");
      toast.error(t("networkError"));
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
          {t("emailLabel")}
          <TextInput
            type="email"
            autoFocus
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (status === "error") setStatus("idle");
            }}
            placeholder={t("emailPlaceholder")}
            className="mt-1"
          />
        </label>
        <p className="text-xs text-steel">{t("emailHint")}</p>
        <label className="block text-sm text-ink">
          {t("passwordLabel")}
          <TextInput
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (status === "error") setStatus("idle");
            }}
            invalid={status === "error"}
            aria-describedby={status === "error" ? "login-error" : undefined}
            className="mt-1"
          />
        </label>
        {status === "error" ? (
          <p id="login-error" role="alert" className="text-sm text-coral">
            {t("error")}
          </p>
        ) : null}
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
