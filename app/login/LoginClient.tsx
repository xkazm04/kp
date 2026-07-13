"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { TextInput } from "@/app/_components/TextInput";
import { classifyLoginResult, type LoginFetchResult } from "./login-result";

// Auth foundation (P2) — the operator sign-in. Posts the password to
// /api/auth/login; on success the signed cookie is set and we return to `next`
// (open-redirect-guarded: same-origin absolute paths only).
function safeNext(): string {
  if (typeof window === "undefined") return "/";
  const n = new URLSearchParams(window.location.search).get("next") ?? "/";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

// Upper bound on a login round-trip before we abort and re-enable the form
// (bug-ui-scan-2026-07-09 auth-sessions-workspace-tenancy #5).
const LOGIN_TIMEOUT_MS = 15_000;

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

    // bug-ui-scan-2026-07-09 (auth-sessions-workspace-tenancy #5): a stalled
    // request must not strand the form in "submitting" forever. Abort after a
    // fixed budget so the fetch rejects and we recover the form.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
    let result: LoginFetchResult;
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmedEmail ? { email: trimmedEmail, password } : { password }),
        signal: controller.signal,
      });
      result = { status: r.status };
    } catch (err) {
      // AbortError = our timeout fired; anything else = the fetch never reached
      // the server. Neither is a wrong-password case.
      result = { failure: err instanceof DOMException && err.name === "AbortError" ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }

    // bug-ui-scan-2026-07-09 (auth-sessions-workspace-tenancy #5): branch on the
    // real outcome instead of collapsing every non-ok into the inline "wrong
    // password" message. Only a 401 blames the credentials; 429/5xx/timeout/
    // network each get an honest toast and re-enable the form.
    switch (classifyLoginResult(result)) {
      case "success":
        // Client-side navigation keeps the toast alive across the redirect (the
        // Toaster lives in the root layout).
        toast.success(t("success"));
        router.replace(safeNext());
        router.refresh();
        return;
      case "credential":
        setStatus("error");
        return;
      case "rateLimited":
        setStatus("idle");
        toast.error(t("rateLimited"));
        return;
      case "serverError":
        setStatus("idle");
        toast.error(t("serverError"));
        return;
      case "timeout":
        setStatus("idle");
        toast.error(t("timeoutError"));
        return;
      case "network":
        setStatus("idle");
        toast.error(t("networkError"));
        return;
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
