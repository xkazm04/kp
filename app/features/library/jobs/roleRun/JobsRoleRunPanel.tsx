"use client";

// The Run tab of the job posting modal (review 2026-10-23, delivery 2: a recruiter can reach
// the run). Top to bottom: start the role's run (or see where it stands), the gates it is parked
// at - each ONE batch the recruiter reviews and then approves or declines - and the stage log.
//
// A gate commit already continues the run (ADR 0011; commitRoleRunStageGateAndContinue), so
// there is no "advance" click after a decision: the panel re-reads and shows the next gate. The
// approval is a human step and stays one: the approver is the signed-in person, and when the
// deployment cannot name one the refusal is shown as its own code, not worked around.
import { Play, RefreshCw, Route } from "lucide-react";
import { BTN_AFFIRM, BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, META_LABEL, NOTICE, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { ROLE_RUN_STAGES, type RoleRunStageKind } from "@/app/_lib/role-run-stages";
import type { RoleRunGateBatch, RoleRunView } from "@/app/api/role-runs/[id]/view";
import { useRoleRunPanel } from "./useRoleRunPanel";

/** How many artifacts each stage has produced so far, in stage order, empty stages left out. */
function stageCounts(view: RoleRunView): { kind: RoleRunStageKind; count: number }[] {
  return ROLE_RUN_STAGES.map((kind) => ({ kind, count: view.stages.filter((s) => s.kind === kind).length })).filter((s) => s.count > 0);
}

export function JobsRoleRunPanel({ jobId }: { jobId: string }) {
  const p = useRoleRunPanel(jobId);
  const { t, view, busy } = p;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 font-serif text-h3 text-ink">
          <Route size={16} className="text-coral-ink" aria-hidden /> {t("heading")}
        </h3>
        <p className="mt-1 text-meta text-steel">{t("intro")}</p>
      </div>

      {p.refusalText ? (
        <p role="alert" className={`${NOTICE("amber")} px-3 py-2 text-meta`}>
          {p.refusalText}
        </p>
      ) : null}

      {p.loading ? <LoadingGap className="min-h-[12rem]" /> : null}

      {!p.loading && !view ? (
        <div className={`${PANEL_SUNKEN} flex flex-wrap items-center gap-3 p-4`}>
          <p className="text-body text-ink">{t("noRun")}</p>
          <button type="button" onClick={() => void p.start()} disabled={busy !== null} className={`${BTN_PRIMARY} h-9 px-4 text-meta`}>
            <Play size={14} aria-hidden /> {busy === "start" ? t("starting") : t("start")}
          </button>
        </div>
      ) : null}

      {view ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className={CHIP_QUIET}>{t(`status.${view.run.status}`)}</span>
            <span className="text-meta text-steel">{t("cycle", { cycle: view.run.cycle })}</span>
            <button type="button" onClick={() => void p.reload()} disabled={p.loading || busy !== null} className={`${BTN_SECONDARY} ml-auto h-8 px-3 text-meta`}>
              <RefreshCw size={13} aria-hidden /> {t("reload")}
            </button>
          </div>

          {view.gates.length === 0 ? (
            <div className={`${PANEL_SUNKEN} flex flex-wrap items-center gap-3 p-4`}>
              <p className="text-body text-steel">{view.stages.length === 0 ? t("noStages") : t("noGates")}</p>
              {view.run.status === "running" ? (
                <button type="button" onClick={() => void p.advance()} disabled={busy !== null} className={`${BTN_SECONDARY} h-9 px-4 text-meta`}>
                  {busy === "advance" ? t("advancing") : t("advance")}
                </button>
              ) : null}
            </div>
          ) : (
            <ul className="space-y-3">
              {view.gates.map((batch) => (
                <GateBatch key={batch.gate} batch={batch} p={p} />
              ))}
            </ul>
          )}

          <section aria-label={t("stagesHeading")}>
            <h4 className={META_LABEL}>{t("stagesHeading")}</h4>
            <ul className="mt-2 flex flex-wrap gap-2">
              {stageCounts(view).map(({ kind, count }) => (
                <li key={kind} className={CHIP_QUIET}>
                  {t(`stage.${kind}`)} · {count}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}

function GateBatch({ batch, p }: { batch: RoleRunGateBatch; p: ReturnType<typeof useRoleRunPanel> }) {
  const { t, busy } = p;
  const preview = p.previews[batch.gate];
  const committing = busy === `commit:${batch.gate}`;
  return (
    <li className={`${PANEL_SUNKEN} space-y-3 p-4`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="font-serif text-h3 text-ink">{t(`gate.${batch.gate}.title`)}</h4>
        <span className="text-body font-semibold text-ink">{t("candidates", { count: batch.branchRefs.length })}</span>
        <span className="text-meta text-steel">{t("policy", { policy: batch.policyVersion })}</span>
      </div>
      <p className="text-meta text-steel">{t(`gate.${batch.gate}.hint`)}</p>

      {preview ? (
        <ul className="space-y-1" aria-label={t("previewHeading")}>
          {preview.map((row) => (
            <li key={row.branchRef} className="text-meta text-ink">
              <code>{row.branchRef}</code> · {t("subjects", { count: row.subjectRefs.length })}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void p.preview(batch)}
          disabled={busy !== null}
          className={`${BTN_SECONDARY} h-9 px-4 text-meta`}
        >
          {busy === `preview:${batch.gate}` ? t("previewing") : t("review")}
        </button>
        <button
          type="button"
          onClick={() => void p.decide(batch, "approved")}
          disabled={busy !== null || !preview}
          className={`${BTN_AFFIRM} h-9 px-4 text-meta`}
        >
          {committing ? t("committing") : t("approve")}
        </button>
        <button
          type="button"
          onClick={() => void p.decide(batch, "declined")}
          disabled={busy !== null || !preview}
          className={`${BTN_SECONDARY} h-9 px-4 text-meta`}
        >
          {t("decline")}
        </button>
      </div>
      <p className="text-meta text-steel">{t("humanStep")}</p>
    </li>
  );
}
