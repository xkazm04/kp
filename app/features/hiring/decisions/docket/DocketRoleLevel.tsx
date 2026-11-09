"use client";

// Level 1: one role. Its waiting people on a score ladder (scored highest first, then the unscored,
// who are listed without a bar because never scored is not zero), the same rows and doors as the
// board, and beneath them the role's key-decision tools (compare a shortlist, run the screening
// wave) when the role has them. The reading of one person is the candidate modal the rows open.
// Each decide row also carries the work-sample result beside its fit (CX S45, role-view read).
// CX S46: beneath them, "Everyone on this role" - every ACTIVE candidate side by side (the same
// role-view read, fetched once), so a role with nobody waiting still has its ending here.
import { useTranslations } from "next-intl";
import { LevelFrame, LevelTrail, KeyHints } from "@/app/_components/kit/scene";
import { useMemo, type ReactNode } from "react";
import { DocketRowView, type DocketRowHandlers } from "./DocketBoard";
import { proposalOf, type DocketGroup } from "./docketModel";
import { DocketWorkSample } from "./DocketWorkSample";
import { DocketRoleOverview } from "./DocketRoleOverview";
import { useRoleDecisionView, workSamplesOf } from "./useRoleWorkSamples";
import "./docket.css";

export function DocketRoleLevel({
  group,
  roleTitle,
  onBack,
  rootLabel,
  tools,
  jobId: roleJobId,
  rosterRev,
  stageOrder,
  onOpenCandidate,
  onCompare,
  compareBusy,
  ...h
}: DocketRowHandlers & {
  /** The role's AI-review rows; null when only key-decision tools wait there. */
  group: DocketGroup | null;
  roleTitle: string;
  onBack: () => void;
  rootLabel: string;
  /** The role's key-decision row (compare / screening wave), already wired by the shell. */
  tools: ReactNode;
  /** The role's job id (null for a title-only role: nothing to read side by side). */
  jobId: string | null;
  /** Changes when a person on the role joins, leaves or moves stage: the overview re-reads. */
  rosterRev: string;
  stageOrder: readonly string[];
  /** Open one person (the decide rows' door; the human-gated stage actions live there). */
  onOpenCandidate: (entryId: string) => void;
  /** Hand a ticked shortlist to Group evaluation. */
  onCompare: (entryIds: string[]) => void;
  compareBusy: boolean;
}) {
  const t = useTranslations("decisions");
  const rows = useMemo(() => group?.rows ?? [], [group]);
  const scored = rows.filter((r) => r.score != null);
  // CX S45: the work-sample result beside each fit score, read for the role's job id (a
  // title-only group has none, and its rows simply carry no work-sample cell).
  const jobId = roleJobId ?? rows.find((r) => r.entry.jobId)?.entry.jobId ?? null;
  const read = useRoleDecisionView(jobId, `${rosterRev}|${rows.map((r) => r.entry.id).join(",")}`);
  const samples = workSamplesOf(read);
  const proposals = useMemo(() => new Map(rows.map((r) => [r.entry.id, proposalOf(r)] as const)), [rows]);
  return (
    <LevelFrame
      tone="steel"
      kicker={t("docket.roleKicker")}
      title={roleTitle}
      lead={
        rows.length > 0
          ? group?.best != null
            ? t("docket.roleLead", { count: rows.length, best: group.best })
            : t("docket.roleLeadUnscored", { count: rows.length })
          : t("docket.roleNone")
      }
      trail={
        <LevelTrail
          crumbs={[{ label: rootLabel, onSelect: onBack }, { label: roleTitle }]}
          onBack={onBack}
          backLabel={t("docket.backTo", { place: rootLabel })}
          label={t("docket.trailLabel")}
        />
      }
      keys={
        <KeyHints
          label={t("docket.keysLabel")}
          hints={[
            { id: "open", keys: ["Enter"], act: t("docket.keyOpen") },
            { id: "back", keys: ["Esc"], act: t("docket.keyBackToQueue") },
          ]}
        />
      }
    >
      {rows.length > 0 ? (
        <>
          <h3 className="dk-tools-h">{t("docket.ladderTitle")}</h3>
          <p className="text-micro text-steel">{t("docket.ladderNote")}</p>
          <ul className="dk-ladder" aria-label={t("docket.ladderTitle")}>
            {scored.map((r) => (
              <li key={r.entry.id} className="dk-rung">
                <span>
                  {r.entry.candidateLabel} <span className="dk-score nums">{r.score}</span>
                </span>
                <span className="dk-rung__bar" role="img" aria-label={`${r.score}`}>
                  <span className="dk-rung__fill" data-p={proposalOf(r)} style={{ inlineSize: `${Math.max(0, Math.min(100, r.score ?? 0))}%` }} />
                </span>
              </li>
            ))}
          </ul>
          <h3 className="dk-tools-h">{t("docket.decideTitle")}</h3>
          <ul className={samples.status === "none" ? "dk-rows" : "dk-rows dk-rows--ws"}>
            {rows.map((r) => (
              <DocketRowView key={r.entry.id} row={r} h={h} aside={<DocketWorkSample entryId={r.entry.id} samples={samples} />} />
            ))}
          </ul>
        </>
      ) : null}
      <div className="mt-6">
        <DocketRoleOverview
          jobId={jobId}
          read={read}
          hasJob={jobId != null}
          proposals={proposals}
          stageOrder={stageOrder}
          onOpen={onOpenCandidate}
          onCompare={onCompare}
          compareBusy={compareBusy}
        />
      </div>
      {tools ? (
        <>
          <h3 className="dk-tools-h">{t("keyDecisions")}</h3>
          {tools}
        </>
      ) : null}
    </LevelFrame>
  );
}
