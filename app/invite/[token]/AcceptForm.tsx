"use client";

import { useEffect, useState } from "react";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";
import { TextInput } from "@/app/_components/TextInput";
import { roleLabel } from "@/app/features/shared/memberUi";
import type { MemberRole } from "@/app/_lib/auth/roles";

type Preview =
  | { valid: true; email: string; role: string; orgName: string; needsName: boolean; minPasswordLength: number }
  | { valid: false };

export function AcceptForm({ token }: { token: string }) {
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
        <p className="text-body text-steel">Loading your invitation…</p>
      </main>
    );
  }

  if (!preview.valid) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 text-center">
        <h1 className="font-serif text-display text-ink">Invitation unavailable</h1>
        <p className="mt-2 text-body text-steel">This link is invalid, already used, or expired. Ask an admin to send a new one.</p>
        <a href="/login" className="mt-6 text-sm font-semibold text-coral underline">
          Go to sign in
        </a>
      </main>
    );
  }

  const { email, role, orgName, needsName, minPasswordLength } = preview;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < minPasswordLength) {
      setError(`Choose a password of at least ${minPasswordLength} characters.`);
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
        ? `Choose a password of at least ${minPasswordLength} characters.`
        : err === "email_taken"
          ? "This email already belongs to another organization."
          : err === "already_active"
            ? "This account is already active — sign in instead."
            : "Couldn't accept the invite — the link may have just expired.",
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <p className="text-meta uppercase text-coral">Join {orgName}</p>
      <h1 className="mt-1 font-serif text-display text-ink">Set your password</h1>
      <p className="mt-2 text-body text-steel">
        You’ve been invited as {roleLabel(role as MemberRole)}. Choose a password to finish setting up{" "}
        <span className="font-medium text-ink">{email}</span>.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        {needsName ? (
          <label className="block text-sm text-ink">
            Your name
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1" />
          </label>
        ) : null}
        <label className="block text-sm text-ink">
          Password
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
          {submitting ? "Setting up…" : "Accept invitation"}
        </button>
      </form>
    </main>
  );
}
