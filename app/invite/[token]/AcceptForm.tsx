"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";
import { TextInput } from "@/app/_components/TextInput";
import { roleLabel } from "@/app/features/shared/memberUi";
import type { MemberRole } from "@/app/_lib/auth/roles";

type Preview =
  | { valid: true; email: string; role: string; orgName: string; needsName: boolean; minPasswordLength: number }
  | { valid: false };

export function AcceptForm({ token }: { token: string }) {
  const t = useTranslations("invite");
  // The role the invitee is joining as — same labels the Organization console uses.
  const tRole = useTranslations("workspaceAdmin.members");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/invite/${token}`)
      .then(async (r) => (r.ok ? ((await r.json()) as Preview) : ({ valid: false } as Preview)))
      .then((data) => alive && setPreview(data))
      .catch(() => alive && setPreview({ valid: false }));
    return () => {
      alive = false;
    };
  }, [token]);

  if (preview === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
        <p className="text-body text-steel">{t("loading")}</p>
      </main>
    );
  }

  if (!preview.valid) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 text-center">
        <h1 className="font-serif text-display text-ink">{t("unavailableTitle")}</h1>
        <p className="mt-2 text-body text-steel">{t("unavailableBody")}</p>
        <a href="/login" className="mt-6 text-sm font-semibold text-coral underline">
          {t("goToSignIn")}
        </a>
      </main>
    );
  }

  const { email, role, orgName, needsName, minPasswordLength } = preview;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < minPasswordLength) {
      setError(t("weakPassword", { minLength: minPasswordLength }));
      return;
    }
    setSubmitting(true);
    const r = await fetch(`/api/invite/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || undefined, password }),
    }).catch(() => null);
    if (r && r.ok) {
      window.location.assign("/");
      return;
    }
    setSubmitting(false);
    const err = r ? ((await r.json().catch(() => ({}))) as { error?: string }).error : null;
    setError(
      err === "weak_password"
        ? t("weakPassword", { minLength: minPasswordLength })
        : err === "email_taken"
          ? t("emailTaken")
          : err === "already_active"
            ? t("alreadyActive")
            : t("genericError"),
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <p className="text-meta uppercase text-coral">{t("eyebrow", { orgName })}</p>
      <h1 className="mt-1 font-serif text-display text-ink">{t("title")}</h1>
      <p className="mt-2 text-body text-steel">
        {t.rich("subtitle", {
          role: roleLabel(role as MemberRole, tRole),
          email,
          em: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
        })}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        {needsName ? (
          <label className="block text-sm text-ink">
            {t("nameLabel")}
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1" />
          </label>
        ) : null}
        <label className="block text-sm text-ink">
          {t("passwordLabel")}
          <TextInput
            type="password"
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            invalid={error != null}
            className="mt-1"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-coral">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={submitting || !password} className={`${BTN_PRIMARY} h-10 w-full justify-center`}>
          {submitting ? t("submitting") : t("submit")}
        </button>
      </form>
    </main>
  );
}
