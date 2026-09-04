"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Rocket } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { notifyDataChanged, useLiveRefresh } from "@/app/features/shell/live-refresh";
import { buildUrl } from "@/app/features/shell/tabs";

// Phase 1: authored-JD drafts awaiting publication. "Publish" marks a draft live
// and pulls matching candidates in (the API route is /publish; the DB status it
// sets is 'published'). Distinct from external "Publish to job boards"
// distribution. See docs/features/jobs/README.md.
//
// The button used to read "Source into Pipeline" and report its outcome in an
// inline note under the list — which the successful path then DELETED: publishing
// the last draft empties `drafts`, the panel early-returns null, and the note went
// with it. A publish that spends ~20s in the sourcing matcher therefore ended in a
// label reverting and nothing else, which reads as "the button did nothing".
// Outcomes now land as TOASTS (app/_components/toast-store.ts), which outlive the
// surface that raised them; only the quota refusal stays inline, because it
// carries a Billing CTA and the panel is still standing in that branch.
//
// Self-contained: owns its own drafts/publish state and live-refreshes itself,
// so JobsTab just drops it in. Renders nothing when there are no drafts.
//
// onPublished (optional — the panel still works standalone without it) closes the
// surface-agreement gap: going live from HERE used to refresh only this panel, so
// the very same role in the table two lines below kept its DRAFT badge, the stat
// chips stayed stale, and the "open only" filter went on hiding a role that was now
// live. The modal path already had the fix pair (patchJobStatus + reload); this hands
// the owner the same hook so both publish surfaces agree instantly.
export function DraftsPanel({ onPublished }: { onPublished?: (jobId: string) => void } = {}) {
  const t = useTranslations("jobs.drafts");
  // /publish answers with `{ error, code }` — the `code` is what gets localized
  // (the quota branch below already reads it); the English `error` never shows.
  const errMsg = useErrorMessage();
  const router = useRouter();
  const search = useSearchParams();
  const goToBilling = () => router.push(buildUrl({ tab: "billing" }, search.toString()));
  const [drafts, setDrafts] = useState<{ id: string; title: string; company: string | null }[]>([]);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  // The plan's active-job cap (402) — an upgrade prompt, not a warning, and the one
  // outcome that stays inline because it comes with a Billing CTA. Every other
  // outcome is a toast (see the file header).
  const [quotaNote, setQuotaNote] = useState<string | null>(null);
  const loadDrafts = () =>
    fetch("/api/jobs/status").then((r) => r.json()).then((p) => setDrafts(p.drafts ?? [])).catch(() => undefined);
  useEffect(() => {
    loadDrafts();
  }, []);
  useLiveRefresh(loadDrafts); // a JD saved elsewhere (e.g. the simulation) shows up here
  const publishDraft = async (id: string, title: string) => {
    setPublishingId(id);
    setQuotaNote(null);
    try {
      const r = await fetch(`/api/jobs/${id}/publish`, { method: "POST" });
      const p = await r.json();
      if (!r.ok) {
        // Plan's active-job cap (402): distinct upgrade prompt, not a sourcing-failed warn.
        if (p.code === "quota_exceeded") {
          setQuotaNote(t("quotaNote"));
          return;
        }
        throw new Error(errMsg(p, t("sourcingFailed")));
      }
      if (p.sourcingWarning) {
        // Live, but sourcing broke. Two toasts, not one merged line: the role IS
        // published (a success the recruiter must not miss), and the sourcing failure
        // is a separate fact that must not read as a clean "sourced 0".
        toast.success(t("published", { title }));
        toast.error(t("publishedButFailed", { warning: p.sourcingWarning }));
      } else {
        toast.success(`${t("published", { title })} ${t("sourced", { count: p.sourced ?? 0 })}`);
      }
      loadDrafts();
      // The role IS live now (both the warn and ok branches above reached a 2xx
      // /publish) — tell the owner so the table row, the badge and the stat chips
      // stop disagreeing with this panel.
      onPublished?.(id);
      // …and tell every OTHER open view. A publish flips a status and sources
      // people into the pipeline, and nothing on this path signalled the bus: the
      // sidebar's Jobs badge and an open board kept their pre-publish numbers until
      // the 60s attention poll happened to come round (app/features/shell/useAttention.ts).
      notifyDataChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("sourcingFailed"));
    } finally {
      setPublishingId(null);
    }
  };

  if (drafts.length === 0) return null;

  return (
    <div data-sim="job-drafts" className="mt-4 rounded-lg border border-coral/30 bg-coral/5 p-3">
      <p className="text-meta uppercase tracking-wide text-coral">{t("heading")} · {drafts.length}</p>
      <ul className="mt-2 space-y-1.5">
        {drafts.map((d) => (
          <li key={d.id} data-sim-entry={d.id} className="flex flex-wrap items-center gap-2 rounded-md bg-white px-3 py-1.5 text-sm">
            <span className="rounded-full bg-stone-200 px-1.5 py-0.5 text-micro font-semibold uppercase text-steel">{t("draftBadge")}</span>
            <span className="min-w-0 flex-1 truncate text-ink">
              {d.title}
              {d.company ? <span className="text-steel">{` · ${d.company}`}</span> : null}
            </span>
            <button
              type="button"
              data-sim-click="publish"
              onClick={() => publishDraft(d.id, d.title)}
              disabled={publishingId === d.id}
              title={t("sourceTitle")}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {/* A publish spends ~20s in the sourcing matcher, so the in-flight state
                  needs a moving part — a static label swap on a disabled button was
                  indistinguishable from a click that did nothing at all. */}
              {publishingId === d.id ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Rocket size={13} aria-hidden />}
              {publishingId === d.id ? t("sourcing") : t("sourceIntoPipeline")}
            </button>
          </li>
        ))}
      </ul>
      {quotaNote ? (
        <div
          aria-live="polite"
          className="animate-fade-in mt-2 flex flex-wrap items-center gap-2 rounded-md border border-coral/40 bg-coral/5 px-2.5 py-1.5 text-sm text-coral"
        >
          <span>{quotaNote}</span>
          <button
            type="button"
            onClick={goToBilling}
            className="focus-ring rounded-md border border-coral/40 bg-white px-2 py-0.5 font-semibold text-coral hover:bg-coral/10"
          >
            {t("goToBilling")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
