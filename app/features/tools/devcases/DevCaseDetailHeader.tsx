"use client";

// The case-detail header: back button, provenance badges, the intake action
// (Publish / Stop intake / Reopen intake) and Source DB, and the confirm dialog for
// each intake change — split out of DevCaseDetail.tsx.
import { ArrowLeft, CircleStop, FileWarning, MicVocal, RotateCcw, Send, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { DevCaseJobLink } from "./DevCaseJobLink";
import { DevPublishConfirm } from "./DevPublishConfirm";
import type { DegradedReason, IntakeAction, IntakeState } from "./DevCaseDetail.publish";
import type { DevCaseDetail } from "./DevTypes";

export function DevCaseDetailHeader({
  kase,
  onBack,
  intake,
  action,
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
  confirmingStop,
  setConfirmingStop,
  stopping,
  stopError,
  confirmStop,
  cancelStop,
}: {
  kase: DevCaseDetail;
  onBack: () => void;
  /** Intake read from the postings' status (intakeOf) - never "has any posting". */
  intake: IntakeState;
  /** The one intake change on offer (intakeAction); null while a running lifecycle owns
   *  intake, whose own Close ends it. */
  action: IntakeAction | null;
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
  confirmingStop: boolean;
  setConfirmingStop: (v: boolean) => void;
  stopping: boolean;
  stopError: string | null;
  confirmStop: () => void;
  cancelStop: () => void;
}) {
  const rel = useRelativeTime();
  const t = useTranslations("devcase.studio.detail");
  // LIVE intake: at least one open posting. The publish/reopen confirm below is offered
  // only when intake is NOT live; the stop confirm only when it is.
  const published = intake.state === "live";
  const lifecycleOwned = action === null && intake.state !== "unpublished";
  const stopOffered = action === "stop";
  const busy = action === "stop" ? stopping : !!publishing;
  const intakeLabel =
    action === "stop"
      ? t(busy ? "stopping" : "stopIntake")
      : action === "reopen"
        ? t(busy ? "publishing" : "reopen")
        : action === "publish"
          ? t(busy ? "publishing" : "publish")
          : t(published ? "published" : "intakeClosed");
  const IntakeIcon = action === "stop" ? CircleStop : action === "reopen" ? RotateCcw : Send;
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
        {/* Intake state, from the postings' status (challenge-r09 devcase-lifecycle/B):
            live, with how many channels are open, or closed. Unpublished says nothing
            here - its Publish button does. */}
        {intake.state === "live" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-moss/15 px-2 py-0.5 text-micro font-semibold uppercase text-moss">
            {t("intakeLive", { count: intake.open })}
          </span>
        ) : intake.state === "closed" ? (
          <span className={CHIP_QUIET}>
            {t("intakeClosed")}
          </span>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            // #3 — open the confirm step instead of acting on this single click. Stop has
            // its own confirm; publish and reopen share the publish confirm.
            onClick={() => (stopOffered ? setConfirmingStop(true) : setConfirmingPublish(true))}
            // NOT disabled while the confirm panel is open: useDialogA11y restores
            // focus to whatever had it when the panel mounted, and `.focus()` on a
            // disabled button is a silent no-op — so closing with Escape used to drop
            // a keyboard user onto <body>. `aria-expanded` states the panel is open,
            // and re-opening what is already open is harmless. Disabled only when no
            // intake change is on offer (a running lifecycle owns it) or one is in flight.
            disabled={action === null || busy}
            aria-haspopup="dialog"
            aria-expanded={stopOffered ? confirmingStop : confirmingPublish}
            aria-describedby={lifecycleOwned ? "devcase-intake-owner" : undefined}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
          >
            <IntakeIcon size={12} /> {intakeLabel}
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

      {/* A running lifecycle owns this intake: say so in words, rather than leave a
          disabled button to explain itself on hover. */}
      {lifecycleOwned ? (
        <p id="devcase-intake-owner" className="text-micro text-steel">
          {t("lifecycleOwnsIntake")}
        </p>
      ) : null}

      {/* #3 — confirm-before-publish. Publishing mints a live link and sources real
          candidates, so it takes an explicit confirm; a degraded assignment takes a
          "publish anyway" ack. A reopen is the same publish, worded as one. Its own
          component so the focus/Escape wiring mounts and unmounts WITH it. */}
      {confirmingPublish && !published ? (
        <DevPublishConfirm
          variant={intake.state === "closed" ? "reopen" : "publish"}
          publishing={publishing}
          degraded={degraded}
          publishReasons={publishReasons}
          ackDegraded={ackDegraded}
          setAckDegraded={setAckDegraded}
          canPublishNow={canPublishNow}
          confirmPublish={confirmPublish}
          cancelPublish={cancelPublish}
        />
      ) : null}
      {confirmingStop && published ? (
        <DevPublishConfirm
          variant="stop"
          publishing={stopping}
          degraded={false}
          publishReasons={[]}
          ackDegraded={false}
          setAckDegraded={() => {}}
          canPublishNow
          confirmPublish={confirmStop}
          cancelPublish={cancelStop}
          error={stopError}
        />
      ) : null}
    </>
  );
}
