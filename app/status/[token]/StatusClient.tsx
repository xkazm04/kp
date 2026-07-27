"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import {
  CANDIDATE_TIMELINE,
  classifyStatusError,
  isTerminalCandidateStatus,
  timelineIndex,
  type CandidateStatus,
  type StatusFetchError,
} from "@/app/_lib/application-status";

type StatusView = {
  status: CandidateStatus;
  jobTitle: string | null;
  company: string | null;
  updatedAt: string | null;
  // REC-10 — false when no delivery relay is configured (no email will ever
  // arrive), so the stage copy must not say "watch your email".
  relayConfigured?: boolean;
};

// Public, token-gated candidate application-status page (idea-e76a6fb2). Shows
// where the candidate stands — received → under review → interview → offer →
// hired — without them having to email the recruiter.
export function StatusClient() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const t = useTranslations("status");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [view, setView] = useState<StatusView | null>(null);
  // Typed so the copy can be honest about WHY it failed (bug-ui-scan-2026-07-09
  // #4): an `invalid` link (bad/expired token) is a permanent, user-actionable
  // condition; a `retryable` fault (offline / 5xx) gets a Retry affordance.
  const [error, setError] = useState<StatusFetchError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch (or re-fetch) the status. Stable across renders so the mount fetch, the
  // interval poll, the focus/visibility revalidation, and manual Refresh all share
  // one path. A success clears any prior error; a failure is classified, never
  // collapsed into one generic message.
  const load = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/status/${token}`);
      if (!res.ok) {
        setError(classifyStatusError(res.status));
        return;
      }
      const p = (await res.json()) as StatusView & { error?: string };
      if (p.error) {
        // A 200 body that still carries an error is anomalous — treat as transient.
        setError("retryable");
        return;
      }
      setView(p);
      setError(null);
    } catch {
      // No HTTP response at all (offline / DNS) — always retryable.
      setError(classifyStatusError(null));
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    // Scheduled (not called synchronously in the effect body) because load()
    // sets `refreshing` before its first await.
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  // Revalidate so a bookmarked/left-open status page doesn't freeze on a stale
  // stage (bug-ui-scan-2026-07-09 #3, idea-e76a6fb2's whole promise): poll on an
  // interval AND refetch when the tab regains focus/visibility. Stop once the
  // candidate status is terminal — there is nothing left to advance to.
  const terminal = view ? isTerminalCandidateStatus(view.status) : false;
  useEffect(() => {
    if (!token || terminal) return;
    const POLL_MS = 45_000;
    const id = window.setInterval(() => void load(), POLL_MS);
    const revalidate = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
    };
  }, [token, terminal, load]);

  // Literal-key lookups for the 5 happy-path steps (next-intl's `t` rejects
  // template-literal keys), read by the timeline loop below via the step value.
  const stepLabels: Record<string, string> = {
    received: t("steps.received"),
    under_review: t("steps.under_review"),
    interview: t("steps.interview"),
    offer: t("steps.offer"),
    hired: t("steps.hired"),
  };
  // "Watch your email" is only promised when a relay can actually deliver one
  // (REC-10); otherwise the honest variant — the team reaches out directly.
  const emailPromised = view?.relayConfigured !== false;
  const nowText: Record<string, string> = {
    received: t("now.received"),
    under_review: t("now.under_review"),
    interview: emailPromised ? t("now.interview") : t("now.interviewNoEmail"),
    offer: emailPromised ? t("now.offer") : t("now.offerNoEmail"),
    hired: t("now.hired"),
  };

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      {/* The candidate's own escape hatch, mirroring the public apply page: the
          status link is now ?lang=-pinned, but a forwarded/bookmarked link (or a
          stale NEXT_LOCALE cookie from an earlier visit) can still land them in
          a language they don't read — and this page has no other chrome. */}
      <div className="mb-4 flex justify-end">
        <LanguageSwitcher />
      </div>
      <p className="text-meta uppercase tracking-wide text-coral">{t("eyebrow")}</p>
      {error && !view ? (
        // Only take over the page on the INITIAL load failure — a transient poll
        // error after a good render must never wipe an already-shown status.
        // Distinct copy per failure kind: a bad/expired LINK tells the candidate
        // to fetch a fresh one (no futile Retry); a transient fault offers Retry.
        <div role="alert" className="mt-4 rounded-lg border border-stone-200 bg-paper p-4">
          <p className="text-body text-steel">{error === "invalid" ? t("linkInvalid") : t("loadFailed")}</p>
          {error === "retryable" ? (
            <button
              type="button"
              onClick={() => void load()}
              disabled={refreshing}
              className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-md bg-ink px-4 py-2 text-base font-semibold text-white hover:bg-steel disabled:opacity-50"
            >
              {refreshing ? tCommon("loading") : tCommon("retry")}
            </button>
          ) : null}
        </div>
      ) : !view ? (
        // Skeleton that reserves the heading + 5 timeline rows so the resolved
        // content swaps in place instead of shoving layout (CLS) on first paint.
        <div className="mt-1 animate-pulse" aria-busy="true">
          <span className="sr-only">{tCommon("loading")}</span>
          <div className="h-9 w-3/4 rounded bg-stone-200" />
          <ol className="mt-6 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-start gap-3">
                <span aria-hidden className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-stone-200" />
                <span aria-hidden className="mt-1 h-4 w-40 rounded bg-stone-200" />
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <>
          <h1 className="mt-1 font-serif text-display text-ink">
            {view.jobTitle ? t("forRole", { role: view.jobTitle }) : t("forRoleGeneric")}
          </h1>
          {view.company ? <p className="mt-1 text-body text-steel">{view.company}</p> : null}

          {isTerminalCandidateStatus(view.status) && view.status !== "hired" ? (
            <div
              role="status"
              className="mt-6 rounded-lg border border-stone-200 bg-paper p-5"
            >
              <p className="font-serif text-h3 text-ink">
                {view.status === "not_selected" ? t("notSelectedTitle") : t("withdrawnTitle")}
              </p>
              <p className="mt-2 text-body text-steel">
                {view.status === "not_selected" ? t("notSelectedBody") : t("withdrawnBody")}
              </p>
            </div>
          ) : (
            <>
              <ol className="mt-6 space-y-3" role="list">
                {CANDIDATE_TIMELINE.map((step, i) => {
                  const reached = i <= timelineIndex(view.status);
                  const current = i === timelineIndex(view.status);
                  return (
                    <li key={step} className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-semibold ${
                          reached ? "border-moss bg-moss text-white" : "border-stone-300 bg-white text-steel"
                        }`}
                      >
                        {reached ? <Check size={14} /> : i + 1}
                      </span>
                      <div>
                        <p className={`text-body font-semibold ${current ? "text-ink" : reached ? "text-steel" : "text-stone-400"}`}>
                          {stepLabels[step]}
                        </p>
                        {current ? <p className="mt-0.5 text-base text-steel">{nowText[step]}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            {view.updatedAt ? (
              <p className="text-meta text-steel">
                {t("updated", {
                  date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(view.updatedAt)),
                })}
              </p>
            ) : (
              <span />
            )}
            {/* Manual refresh — the page also polls + revalidates on focus
                (idea-e76a6fb2 / #3), but a candidate can force a check too. */}
            <button
              type="button"
              onClick={() => void load()}
              disabled={refreshing}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-meta font-semibold text-steel hover:text-ink disabled:opacity-50"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} aria-hidden />
              {t("refresh")}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
