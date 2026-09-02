"use client";

// The case-detail header: back button, provenance badges, Publish/Source DB
// actions, and the confirm-before-publish dialog — split out of DevCaseDetail.tsx.
import { AlertTriangle, ArrowLeft, FileWarning, MicVocal, Send, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { DevCaseJobLink } from "./DevCaseJobLink";
import type { DegradedReason } from "./DevCaseDetail.publish";
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
  publishReasons: DegradedReason[];
  confirmingPublish: boolean;
  setConfirmingPublish: (v: boolean) => void;
  ackDegraded: boolean;
  setAckDegraded: (v: boolean) => void;
  canPublishNow: boolean;
  confirmPublish: () => void;
  cancelPublish: () => void;
}) {
  const rel = useRelativeTime();
  const t = useTranslations("devcase.studio.detail");
  const tReason = useTranslations("devcase.studio.degradedReason");
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-steel hover:bg-paper hover:text-ink"
        >
          {/* ONE WORD PER ENTITY. This read "All cases" — the last user-facing
              "case" left on the thread, and the one none of the three vocabulary
              guards could see: it is a raw JSX literal, so the catalog walk
              (devcase-vocabulary.test.ts) never visited it, and it is not in
              DevTabViews.ts, so the source-level guard missed it too. A reader who
              opened an Assignment was told to go back to "cases". It reads from the
              catalog now, and the source guard walks this file. */}
          <ArrowLeft size={14} /> {t("back")}
        </button>
        <span className="text-micro text-steel">{t("created", { when: rel(kase.createdAt) || "—" })}</span>
        {/* ONE THREAD — the role this assignment was cut for, or an honest note that the
            JD it came from was never sourced into one. */}
        <DevCaseJobLink jobId={kase.jobId} jobTitle={kase.jobTitle} jdSlug={kase.jdSlug} />
        {hasScenario ? (
          scenarioDegraded ? (
            <span
              title={t("scenarioTemplateHint")}
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-micro font-semibold uppercase text-amber-700"
            >
              <MicVocal size={11} /> {t("scenarioTemplate")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-moss/15 px-2 py-0.5 text-micro font-semibold uppercase text-moss">
              <MicVocal size={11} /> {t("scenarioReady")}
            </span>
          )
        ) : null}
        {seedDegraded ? (
          <span
            title={t("seedSkeletonHint")}
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-micro font-semibold uppercase text-amber-700"
          >
            <FileWarning size={11} /> {t("seedSkeleton")}
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
            <Send size={12} /> {published ? t("published") : publishing ? t("publishing") : t("publish")}
          </button>
          <button
            type="button"
            onClick={() => source(kase.id)}
            disabled={sourcing === kase.id}
            title={t("sourceHint")}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-coral hover:border-coral/40 disabled:opacity-50"
          >
            <Users size={12} />{" "}
            {sourcing === kase.id
              ? t("sourcing")
              : sourcedCounts[kase.id] != null
                ? t("sourced", { count: sourcedCounts[kase.id] })
                : t("sourceDb")}
          </button>
        </div>
      </div>

      {/* #3 — confirm-before-publish. Publishing is effectively irreversible from here,
          so it takes an explicit confirm; a degraded case takes a "publish anyway" ack. */}
      {confirmingPublish && !published ? (
        <div role="alertdialog" aria-label={t("confirmLabel")} className="rounded-lg border border-coral/30 bg-coral/5 p-4">
          <h3 className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-coral">
            <Send size={12} /> {t("confirmTitle")}
          </h3>
          <p className="mt-2 max-w-prose text-sm text-steel">{t("confirmBody")}</p>
          {degraded ? (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-meta font-semibold text-amber-700">
                <AlertTriangle size={13} /> {t("degradedTitle")}
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-amber-800">
                {publishReasons.map((r) => (
                  <li key={r}>{tReason(r)}</li>
                ))}
              </ul>
              <label className="mt-2 flex items-start gap-2 text-xs font-medium text-amber-900">
                <input
                  type="checkbox"
                  checked={ackDegraded}
                  onChange={(e) => setAckDegraded(e.target.checked)}
                  className="mt-0.5"
                />
                {t("degradedAck")}
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
              <Send size={12} /> {publishing ? t("publishing") : t("confirmCta")}
            </button>
            <button
              type="button"
              onClick={cancelPublish}
              className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 bg-white px-3 text-micro font-semibold text-steel hover:text-ink"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
