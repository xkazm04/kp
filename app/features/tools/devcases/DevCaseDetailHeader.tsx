"use client";

// The case-detail header: back button, provenance badges, Publish/Source DB
// actions, and the confirm-before-publish dialog — split out of DevCaseDetail.tsx.
import { AlertTriangle, ArrowLeft, FileWarning, MicVocal, Send, Users } from "lucide-react";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { DevCaseJobLink } from "./DevCaseJobLink";
import type { DevCaseDetail } from "./DevTypes";

export function DevCaseDetailHeader({
  kase,
  onBack,
  published,
  publishing,
  source,
  sourcing,
  sourcedCounts,
  hasScenario,
  scenarioDegraded,
  seedDegraded,
  degraded,
  publishReasons,
  confirmingPublish,
  setConfirmingPublish,
  ackDegraded,
  setAckDegraded,
  canPublishNow,
  confirmPublish,
  cancelPublish,
}: {
  kase: DevCaseDetail;
  onBack: () => void;
  published: boolean;
  publishing?: boolean;
  source: (caseId: string) => void;
  sourcing: string | null;
  sourcedCounts: Record<string, number>;
  hasScenario: boolean;
  scenarioDegraded: boolean;
  seedDegraded: boolean;
  degraded: boolean;
  publishReasons: string[];
  confirmingPublish: boolean;
  setConfirmingPublish: (v: boolean) => void;
  ackDegraded: boolean;
  setAckDegraded: (v: boolean) => void;
  canPublishNow: boolean;
  confirmPublish: () => void;
  cancelPublish: () => void;
}) {
  const rel = useRelativeTime();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-steel hover:bg-paper hover:text-ink"
        >
          <ArrowLeft size={14} /> All cases
        </button>
        <span className="text-micro text-steel">created {rel(kase.createdAt) || "—"}</span>
        {/* ONE THREAD — the role this assignment was cut for, or an honest note that the
            JD it came from was never sourced into one. */}
        <DevCaseJobLink jobId={kase.jobId} jobTitle={kase.jobTitle} jdSlug={kase.jdSlug} />
        {hasScenario ? (
          scenarioDegraded ? (
            <span
              title="Scenario generation fell back to the deterministic template — probes are generic, not case-grounded. Re-run before interviewing on this case."
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-micro font-semibold uppercase text-amber-700"
            >
              <MicVocal size={11} /> interview scenario: template probes
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-moss/15 px-2 py-0.5 text-micro font-semibold uppercase text-moss">
              <MicVocal size={11} /> interview scenario ready
            </span>
          )
        ) : null}
        {seedDegraded ? (
          <span
            title="Seed materialization fell back to the deterministic template — candidates receive a prose-only README + DECISIONS skeleton, not concrete starter files. Re-run before sending the take-home."
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-micro font-semibold uppercase text-amber-700"
          >
            <FileWarning size={11} /> seed: skeleton only
          </span>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            // #3 — open the confirm step instead of publishing on this single click.
            onClick={() => setConfirmingPublish(true)}
            disabled={published || publishing || confirmingPublish}
            aria-haspopup="dialog"
            aria-expanded={confirmingPublish}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
          >
            <Send size={12} /> {published ? "Published" : publishing ? "Publishing…" : "Publish"}
          </button>
          <button
            type="button"
            onClick={() => source(kase.id)}
            disabled={sourcing === kase.id}
            title="Rank the existing candidate DB against this role and seed the pipeline"
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-coral hover:border-coral/40 disabled:opacity-50"
          >
            <Users size={12} /> {sourcing === kase.id ? "Sourcing…" : sourcedCounts[kase.id] != null ? `Sourced ${sourcedCounts[kase.id]}` : "Source DB"}
          </button>
        </div>
      </div>

      {/* #3 — confirm-before-publish. Publishing is effectively irreversible from here,
          so it takes an explicit confirm; a degraded case takes a "publish anyway" ack. */}
      {confirmingPublish && !published ? (
        <div role="alertdialog" aria-label="Confirm publish" className="rounded-lg border border-coral/30 bg-coral/5 p-4">
          <h3 className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-coral">
            <Send size={12} /> Publish this case?
          </h3>
          <p className="mt-2 max-w-prose text-sm text-steel">
            Publishing mints a live candidate-facing apply link and sources real candidates from your database into
            the pipeline. This can&apos;t be undone from here.
          </p>
          {degraded ? (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-meta font-semibold text-amber-700">
                <AlertTriangle size={13} /> This case is degraded
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-amber-800">
                {publishReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <label className="mt-2 flex items-start gap-2 text-xs font-medium text-amber-900">
                <input
                  type="checkbox"
                  checked={ackDegraded}
                  onChange={(e) => setAckDegraded(e.target.checked)}
                  className="mt-0.5"
                />
                I understand this case is degraded — publish it anyway.
              </label>
            </div>
          ) : null}
          <div className="mt-3 flex gap-1.5">
            <button
              type="button"
              onClick={confirmPublish}
              disabled={!canPublishNow || publishing}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-coral px-3 text-micro font-semibold text-white hover:bg-coral/90 disabled:opacity-50"
            >
              <Send size={12} /> {publishing ? "Publishing…" : "Confirm & publish"}
            </button>
            <button
              type="button"
              onClick={cancelPublish}
              className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 bg-white px-3 text-micro font-semibold text-steel hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
