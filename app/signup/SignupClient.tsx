"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { TextInput } from "@/app/_components/TextInput";

// Self-serve signup form — follows LoginClient's conventions exactly: abort
// budget, honest non-401 outcomes (toast + re-enable, never a misleading inline
// error), client-side navigation so the toast survives the redirect. On success
// we land on '/' where the first-run onboarding wizard fires for the brand-new
// user (onboarding-gate).
const SIGNUP_TIMEOUT_MS = 15_000;

// The register API's machine reasons (invite-accept contract) → inline copy.
type FieldError = "invalid_email" | "weak_password" | "email_taken" | null;

export function SignupClient() {
  const t = useTranslations("signup");
  const router = useRouter();
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<FieldError>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFieldError(null);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIGNUP_TIMEOUT_MS);
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() || null, orgName: orgName.trim() || null }),
        signal: controller.signal,
      });
      if (r.ok) {
        // Deliberately NOT re-enabled — the tenant is created and the session
        // cookie is set, so the form stays disabled through the client-side
        // navigation (LoginClient's success path does exactly this). Resetting
        // `submitting` in a `finally` re-armed the button while router.replace()
        // was still in flight: a second click POSTed the same address again,
        // which registerAccount answers `email_taken`, so the form told someone
        // whose workspace had just been provisioned that their email was already
        // taken — and burned a second slot of the 10-per-15-min per-IP
        // registration throttle on the way.
        toast.success(t("success"));
        router.replace("/");
        router.refresh();
        return;
      }
      const reason = ((await r.json().catch(() => ({}))) as { error?: string }).error;
      if (reason === "invalid_email" || reason === "weak_password" || reason === "email_taken") {
        setFieldError(reason);
      } else if (r.status === 429) {
        toast.error(t("rateLimited"));
      } else if (r.status === 404) {
        // The flag was switched off between page render and submit.
        toast.error(t("disabled"));
      } else {
        toast.error(t("serverError"));
      }
      setSubmitting(false);
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      toast.error(timedOut ? t("timeoutError") : t("networkError"));
      setSubmitting(false);
    } finally {
      clearTimeout(timer);
    }
  }

  const errorCopy =
    fieldError === "invalid_email" ? t("invalidEmail") : fieldError === "weak_password" ? t("weakPassword") : fieldError === "email_taken" ? t("emailTaken") : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
      <h1 className="mt-1 font-serif text-display text-ink">{t("title")}</h1>
      <p className="mt-2 text-body text-steel">{t("subtitle")}</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <label className="block text-sm text-ink">
          {t("nameLabel")}
          <TextInput autoFocus autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} className="mt-1" />
        </label>
        <label className="block text-sm text-ink">
          {t("orgLabel")}
          <TextInput autoComplete="organization" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder={t("orgPlaceholder")} className="mt-1" />
        </label>
        <p className="text-xs text-steel">{t("orgHint")}</p>
        <label className="block text-sm text-ink">
          {t("emailLabel")}
          <TextInput
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldError) setFieldError(null);
            }}
            placeholder={t("emailPlaceholder")}
            invalid={fieldError === "invalid_email" || fieldError === "email_taken"}
            className="mt-1"
          />
        </label>
        <label className="block text-sm text-ink">
          {t("passwordLabel")}
          <TextInput
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (fieldError) setFieldError(null);
            }}
            invalid={fieldError === "weak_password"}
            aria-describedby={errorCopy ? "signup-error" : undefined}
            className="mt-1"
          />
        </label>
        <p className="text-xs text-steel">{t("passwordHint")}</p>
        {errorCopy ? (
          <p id="signup-error" role="alert" className="text-sm text-coral">
            {errorCopy}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting || !password || !email.trim()}
          className="w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
        >
          {submitting ? t("submitting") : t("submit")}
        </button>
      </form>
      <p className="mt-4 text-sm text-steel">
        {t("haveAccount")}{" "}
        <Link href="/login" className="text-ink underline underline-offset-2">
          {t("goToSignIn")}
        </Link>
      </p>
    </main>
  );
}
