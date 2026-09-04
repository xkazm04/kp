"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Rocket } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { notifyDataChanged, useLiveRefresh } from "@/app/features/shell/live-refresh";
import { buildUrl } from "@/app/features/shell/tabs";
import { PublishFlightNote, PublishSentences, usePublishSentenceText } from "./JobsPublishNote";
import {
  publishNoteSentences,
  rememberPublishResult,
  type PublishNote,
  type PublishResponse,
} from "./jobsPublishResult";

// Phase 1: authored-JD drafts awaiting sourcing. "Source into Pipeline" marks
// a draft live and pulls matching candidates in (the API route is /publish;
// the DB status it sets is 'published'). Distinct from external "Publish to
// job boards" distribution. See docs/features/jobs/README.md.
//
// Self-contained: owns its own drafts/sourcing state and live-refreshes itself,
// so JobsTab just drops it in. Renders nothing when there are no drafts — which is
// also why the outcome of publishing the LAST draft is repeated as a toast: the
// success empties `drafts`, this panel early-returns null, and the sentences it
// just wrote go with it. A publish that spends ~20s in the sourcing matcher would
// then end in the row vanishing and nothing else, which reads as "it did nothing".
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
  // The same words PublishSentences renders, for the toast that has to outlive
  // this panel.
  const say = usePublishSentenceText();
  const router = useRouter();
  const search = useSearchParams();
  const goToBilling = () => router.push(buildUrl({ tab: "billing" }, search.toString()));
  const [drafts, setDrafts] = useState<{ id: string; title: string; company: string | null }[]>([]);
  // The drafts read used to end in `.catch(() => undefined)`, so a failed load left
  // `drafts` at [] and the panel returned null: an authored JD awaiting sourcing
  // simply WAS NOT THERE, indistinguishable from having none. A failure is now a
  // state of its own — the panel stays on screen with a retryable line.
  const [loadFailed, setLoadFailed] = useState(false);
  const [sourcingId, setSourcingId] = useState<string | null>(null);
  // tone "warn" = publish succeeded but sourcing errored (or the call failed) — styled
  // distinctly so a broken pipeline isn't mistaken for a clean "sourced 0" result.
  // tone "quota" = hit the plan's active-job cap (402); an upgrade prompt, not a warning.
  const [draftNote, setDraftNote] = useState<{ text: string; tone: "warn" | "quota" } | null>(null);
  // A successful publish is a LIST of sentences, one per fact the route answered
  // (jobsPublishResult.ts) — the same reading the job modal's footer gives, from
  // the same call. The old single line reported `sourced` and nothing else, so an
  // idempotent re-publish read "Sourced 0 candidates into the Pipeline."
  const [publishOutcome, setPublishOutcome] = useState<{ note: PublishNote } | null>(null);
  const publishAbort = useRef<AbortController | null>(null);
  const loadDrafts = () =>
    fetch("/api/jobs/status")
      .then(async (r) => {
        // A non-2xx still parses (safeJsonError answers JSON) and `?? []` would turn
        // it into a confident "no drafts" — treat it as the failure it is.
        const p = r.ok ? ((await r.json()) as { drafts?: { id: string; title: string; company: string | null }[] }) : null;
        if (!p) {
          setLoadFailed(true);
          return;
        }
        setDrafts(p.drafts ?? []);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  useEffect(() => {
    loadDrafts();
  }, []);
  useLiveRefresh(loadDrafts); // a JD saved elsewhere (e.g. the simulation) shows up here
  const sourceDraft = async (id: string) => {
    setSourcingId(id);
    setDraftNote(null);
    setPublishOutcome(null);
    const controller = new AbortController();
    publishAbort.current = controller;
    try {
      const r = await fetch(`/api/jobs/${id}/publish`, { method: "POST", signal: controller.signal });
      const p = (await r.json().catch(() => null)) as (PublishResponse & { code?: string }) | null;
      if (!r.ok || !p) {
        // Plan's active-job cap (402): distinct upgrade prompt, not a sourcing-failed warn.
        if (p?.code === "BILLING_QUOTA_EXCEEDED") {
          setDraftNote({ text: t("quotaNote"), tone: "quota" });
          return;
        }
        throw new Error(errMsg(p, t("sourcingFailed")));
      }
      // Remembered per job, so opening the role afterwards shows what the publish
      // actually did instead of an empty modal.
      rememberPublishResult(id, p);
      const note = publishNoteSentences(p);
      setPublishOutcome({ note });
      // Publishing the last draft unmounts this panel (see the header note), so the
      // outcome is also spoken where it survives that. `drafts` is the list as it
      // stood at click time: a concurrent arrival can make this toast redundant
      // beside the inline note, which is the harmless direction to be wrong in.
      if (drafts.length <= 1) {
        const text = note.sentences.map(say).join(" ");
        if (note.tone === "warn") toast.error(text);
        else toast.success(text);
      }
      loadDrafts();
      // The role IS live now (both the warn and ok branches above reached a 2xx
      // /publish) — tell the owner so the table row, the badge and the stat chips
      // stop disagreeing with this panel.
      onPublished?.(id);
      // …and every OTHER open view. A publish flips a status and files people into
      // the pipeline, and the bus is signal-on-call: without this the sidebar's Jobs
      // badge and an open board kept their pre-publish numbers until the 60s
      // attention poll came round (app/features/shell/useAttention.ts).
      notifyDataChanged();
    } catch (e) {
      setDraftNote({
        text: controller.signal.aborted ? t("publishAbandoned") : e instanceof Error ? e.message : t("sourcingFailed"),
        tone: "warn",
      });
    } finally {
      publishAbort.current = null;
      setSourcingId(null);
    }
  };

  if (drafts.length === 0 && !loadFailed) return null;

  return (
    <div data-sim="job-drafts" className="mt-4 rounded-lg border border-coral/30 bg-coral/5 p-3">
      <p className="text-meta uppercase tracking-wide text-coral">{t("heading")} · {drafts.length}</p>
      {loadFailed ? (
        <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-amber-800">
          {t("loadFailed")}{" "}
          <button
            type="button"
            onClick={() => loadDrafts()}
            className="focus-ring rounded-md font-semibold underline hover:text-ink"
          >
            {t("retry")}
          </button>
        </p>
      ) : null}
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
              onClick={() => sourceDraft(d.id)}
              disabled={sourcingId === d.id}
              title={t("sourceTitle")}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {/* The verb is "Publish" (jobs.drafts.sourceIntoPipeline); the icon
                  follows it. Sourcing is what the publish DOES, and the result
                  sentences below say so. */}
              <Rocket size={13} aria-hidden /> {sourcingId === d.id ? t("sourcing") : t("sourceIntoPipeline")}
            </button>
          </li>
        ))}
      </ul>
      {sourcingId ? <PublishFlightNote className="mt-2 flex" onStop={() => publishAbort.current?.abort()} /> : null}
      {!sourcingId && publishOutcome ? <PublishSentences className="mt-2 block" note={publishOutcome.note} /> : null}
      {draftNote ? (
        draftNote.tone === "quota" ? (
          <div
            aria-live="polite"
            className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-coral/40 bg-coral/5 px-2.5 py-1.5 text-sm text-coral"
          >
            <span>{draftNote.text}</span>
            <button
              type="button"
              onClick={goToBilling}
              className="focus-ring rounded-md border border-coral/40 bg-white px-2 py-0.5 font-semibold text-coral hover:bg-coral/10"
            >
              {t("goToBilling")}
            </button>
          </div>
        ) : (
          <p
            aria-live="polite"
            className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-sm text-amber-800"
          >
            {draftNote.text}
          </p>
        )
      ) : null}
    </div>
  );
}
