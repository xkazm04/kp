"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { TextInput } from "@/app/_components/TextInput";
import { toast } from "@/app/_components/toast-store";
import { BTN_GHOST, BTN_PRIMARY, NOTICE } from "@/app/_components/ui/recipes";
import { classifyLoginResult, type LoginFetchResult } from "@/app/login/login-result";
import { useSessionLapse } from "./useSessionLapse";

// The shell's session-lapse surface: a warning chip from ten minutes before expiry,
// and an in-place sign-in over the page once the session has lapsed (sessionLapse.ts
// holds the decisions, useSessionLapse.ts the wiring). The sign-in goes through the
// real login door — this surface never mints, renews or extends anything itself.
// Renders nothing in open mode and while the session is live.

const LOGIN_TIMEOUT_MS = 15_000;

export function SessionLapseDialog() {
  const lapse = useSessionLapse();
  const t = useTranslations("sessionLapse");
  const { phase, session } = lapse;
  if (!session || phase.phase === "live") return null;
  const isLapsed = phase.phase === "lapsed";
  return (
    <>
      {lapse.dialogOpen ? null : (
        <div
          role="status"
          className={`${NOTICE(isLapsed ? "critical" : "amber")} fixed left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-3 px-3 py-1.5 text-sm shadow-pop`}
        >
          <span>{isLapsed ? t("lapsedChip") : t("expiringChip", { minutes: phase.minutesLeft })}</span>
          <button type="button" onClick={lapse.openDialog} className={`${BTN_PRIMARY} h-8 px-3 text-sm`}>
            {isLapsed ? t("signInAgain") : t("staySignedIn")}
          </button>
        </div>
      )}
      {lapse.dialogOpen ? (
        <ReauthForm
          lapsed={isLapsed}
          operator={session.kind === "operator"}
          initialEmail={session.email ?? ""}
          onClose={lapse.closeDialog}
          onSignedIn={lapse.afterSignIn}
        />
      ) : null}
    </>
  );
}

function ReauthForm({
  lapsed,
  operator,
  initialEmail,
  onClose,
  onSignedIn,
}: {
  lapsed: boolean;
  operator: boolean;
  initialEmail: string;
  onClose: () => void;
  onSignedIn: () => Promise<"resume" | "reload">;
}) {
  const t = useTranslations("sessionLapse");
  const tl = useTranslations("login");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
    let result: LoginFetchResult;
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operator ? { password } : { email: email.trim(), password }),
        signal: controller.signal,
      });
      result = { status: r.status };
    } catch (err) {
      result = { failure: err instanceof DOMException && err.name === "AbortError" ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
    switch (classifyLoginResult(result)) {
      case "success": {
        const outcome = await onSignedIn();
        if (outcome === "resume") toast.success(t("resumed"));
        return;
      }
      case "credential":
        setStatus("error");
        return;
      case "rateLimited":
        setStatus("idle");
        toast.error(tl("rateLimited"));
        return;
      case "serverError":
        setStatus("idle");
        toast.error(tl("serverError"));
        return;
      case "timeout":
        setStatus("idle");
        toast.error(tl("timeoutError"));
        return;
      case "network":
        setStatus("idle");
        toast.error(tl("networkError"));
        return;
    }
  }

  const clearError = () => {
    if (status === "error") setStatus("idle");
  };

  return (
    <Modal title={lapsed ? t("titleLapsed") : t("titleExpiring")} onClose={onClose} size="md">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-body text-steel">{operator ? t("bodyOperator") : t("bodyUser")}</p>
        {operator ? null : (
          <label className="block text-sm text-ink">
            {tl("emailLabel")}
            <TextInput
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearError();
              }}
              className="mt-1"
            />
          </label>
        )}
        <label className="block text-sm text-ink">
          {tl("passwordLabel")}
          <TextInput
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError();
            }}
            invalid={status === "error"}
            aria-describedby={status === "error" ? "session-lapse-error" : undefined}
            className="mt-1"
          />
        </label>
        {status === "error" ? (
          <p id="session-lapse-error" role="alert" className="text-sm text-coral">
            {tl("error")}
          </p>
        ) : null}
        {operator ? null : <p className="text-xs text-steel">{t("notYouHint")}</p>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={`${BTN_GHOST} h-10 px-3 text-sm`}>
            {t("later")}
          </button>
          <button
            type="submit"
            disabled={status === "submitting" || !password || (!operator && !email.trim())}
            className={`${BTN_PRIMARY} h-10 justify-center px-4 text-sm`}
          >
            {status === "submitting" ? tl("submitting") : tl("submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
