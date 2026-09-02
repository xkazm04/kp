"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { TextInput } from "@/app/_components/TextInput";
import { roleLabel } from "@/app/features/shared/memberUi";
import type { MemberRole } from "@/app/_lib/auth/roles";
import { classifyInviteResult, isRetryableInviteOutcome, type InviteFetchResult, type InviteOutcome } from "./invite-result";

type Preview = {
  email: string;
  role: string;
  // Null when the org row is gone/unnamed: the SERVER no longer invents an
  // English "your organization" for a page that renders in four languages.
  orgName: string | null;
  needsName: boolean;
  minPasswordLength: number;
};

// The preview GET's three resting states. `failed` carries the classified
// outcome so the panel can tell a dead link from a throttle from a blip —
// the whole point of invite-result.ts.
type LoadState = { phase: "loading" } | { phase: "ready"; preview: Preview } | { phase: "failed"; outcome: InviteOutcome };

// Upper bound on either invite round-trip before we abort and re-offer the
// action, mirroring LoginClient's LOGIN_TIMEOUT_MS: a stalled request must not
// leave the invitee on a spinner (GET) or a dead "Setting up…" button (POST).
const INVITE_TIMEOUT_MS = 15_000;

// Only reached if the server omitted minPasswordLength; the server (org-service's
// MIN_PASSWORD_LENGTH) remains the authority and re-checks on redeem.
const MIN_PASSWORD_FALLBACK = 8;

/** The classifier's input plus the parsed body, which only the preview caller reads. */
type InviteResponse = InviteFetchResult & { body?: Record<string, unknown> };

/** Run a fetch under a hard timeout and reduce it to the classifier's input.
 *  Never throws: an abort is a `timeout`, anything else a `network` failure. */
async function inviteFetch(input: string, init?: RequestInit): Promise<InviteResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INVITE_TIMEOUT_MS);
  try {
    const r = await fetch(input, { ...init, signal: controller.signal });
    // The redeem path answers with a stable reason code; the preview path does
    // not, and a non-JSON body (a proxy's HTML 502) must not throw here.
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: r.status, error: typeof body.error === "string" ? body.error : null, body };
  } catch (err) {
    return { failure: err instanceof DOMException && err.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

export function AcceptForm({ token }: { token: string }) {
  const t = useTranslations("invite");
  const tCommon = useTranslations("common");
  // The role the invitee is joining as — same labels the Organization console uses.
  const tRole = useTranslations("workspaceAdmin.members");
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await inviteFetch(`/api/invite/${token}`);
    const outcome = classifyInviteResult(result);
    if (outcome !== "ok") return { outcome, preview: null } as const;
    const body = result.body ?? {};
    return {
      outcome,
      preview: {
        email: typeof body.email === "string" ? body.email : "",
        role: typeof body.role === "string" ? body.role : "recruiter",
        orgName: typeof body.orgName === "string" && body.orgName ? body.orgName : null,
        needsName: body.needsName === true,
        minPasswordLength: Number(body.minPasswordLength) || MIN_PASSWORD_FALLBACK,
      } satisfies Preview,
    } as const;
  }, [token]);

  useEffect(() => {
    let alive = true;
    void load().then((r) => {
      if (!alive) return;
      setState(r.outcome === "ok" && r.preview ? { phase: "ready", preview: r.preview } : { phase: "failed", outcome: r.outcome });
    });
    return () => {
      alive = false;
    };
  }, [load]);

  // Retry: back to the skeleton state immediately (a synchronous set is fine in
  // an event handler), then refetch. Only reachable for the retryable outcomes.
  const retry = () => {
    setState({ phase: "loading" });
    void load().then((r) =>
      setState(r.outcome === "ok" && r.preview ? { phase: "ready", preview: r.preview } : { phase: "failed", outcome: r.outcome })
    );
  };

  if (state.phase === "loading") {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
        <p className="text-body text-steel">{t("loading")}</p>
      </main>
    );
  }

  if (state.phase === "failed") {
    // Three honest endings instead of one. Only `dead` says the invitation is
    // gone; the other two say the invitation is fine and offer the retry.
    const dead = state.outcome === "dead";
    const throttled = state.outcome === "rateLimited";
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 text-center">
        <h1 className="font-serif text-display text-ink">
          {dead ? t("unavailableTitle") : throttled ? t("rateLimitedTitle") : t("loadFailedTitle")}
        </h1>
        <p className="mt-2 text-body text-steel">
          {dead ? t("unavailableBody") : throttled ? t("rateLimitedBody") : t("loadFailedBody")}
        </p>
        {isRetryableInviteOutcome(state.outcome) ? (
          <button type="button" onClick={retry} className={`${BTN_SECONDARY} mt-6 h-11 justify-center px-4`}>
            {tCommon("retry")}
          </button>
        ) : null}
        <a href="/login" className="focus-ring mt-6 inline-flex min-h-11 items-center justify-center text-sm font-semibold text-coral underline">
          {t("goToSignIn")}
        </a>
      </main>
    );
  }

  const { email, role, orgName, needsName, minPasswordLength } = state.preview;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < minPasswordLength) {
      setError(t("weakPassword", { minLength: minPasswordLength }));
      return;
    }
    setSubmitting(true);
    const result = await inviteFetch(`/api/invite/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || undefined, password }),
    });
    const outcome = classifyInviteResult(result);
    if (outcome === "ok") {
      window.location.assign("/");
      return;
    }
    setSubmitting(false);
    // A redeem that answers 410 means the link was consumed or lapsed WHILE the
    // form was open: swap to the dead-invite ending rather than leaving a generic
    // line under a form that can never succeed again.
    if (outcome === "dead") {
      setState({ phase: "failed", outcome });
      return;
    }
    setError(
      outcome === "weakPassword"
        ? t("weakPassword", { minLength: minPasswordLength })
        : outcome === "emailTaken"
          ? t("emailTaken")
          : outcome === "alreadyActive"
            ? t("alreadyActive")
            : outcome === "rateLimited"
              ? t("rateLimitedBody")
              : t("retryError")
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      {/* The org name is the SERVER's when it has one; the fallback is a catalog
          string, so a nameless org reads in the invitee's language rather than in
          English on every locale. */}
      <p className="text-meta uppercase text-coral">{t("eyebrow", { orgName: orgName ?? t("orgNameFallback") })}</p>
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
        {/* h-11 (44px), the mobile touch-target floor the offer door's actions
            already use — this form is opened on a phone as often as not. */}
        <button type="submit" disabled={submitting || !password} className={`${BTN_PRIMARY} h-11 w-full justify-center`}>
          {submitting ? t("submitting") : t("submit")}
        </button>
      </form>
    </main>
  );
}
