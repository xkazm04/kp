"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_GHOST, CHIP_QUIET, META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { JdsIntakeBriefEdit } from "./JdsIntakeBriefEdit";
import { JdsIntakeBriefTitle, ProvenanceChip } from "./JdsIntakeBriefTitle";

// The live brief — the surface's signature moment: the requestor WATCHES the
// structure being built while they talk. Every value carries its provenance
// (stated = their words · inferred = the agent's reading · default = template),
// its grading (weight/confidence/rationale — the defensibility layer, UAT
// drain §2.2) and, where traceable, the transcript turn it came from
// (click → the chat scrolls to and flashes that bubble). Editable in place
// (UAT drain §2.1) unless the session was promoted — then the JD exists and
// the brief is frozen.

function TurnChip({ turn, onJump }: { turn?: number | null; onJump?: (turn: number) => void }) {
  const t = useTranslations("library.tab.intake.defense");
  if (turn == null) return null;
  return (
    <button
      type="button"
      className={`${CHIP_QUIET} focus-ring hover:text-ink`}
      onClick={onJump ? () => onJump(turn) : undefined}
      title={`${t("fromTurn")} ${turn}`}
    >
      {t("fromTurn")} [{turn}]
    </button>
  );
}

function RequirementRow({
  r,
  learnableLabel,
  onJump,
}: {
  r: NonNullable<RoleBrief["requirements"]>[number];
  learnableLabel: string | null;
  onJump?: (turn: number) => void;
}) {
  const t = useTranslations("library.tab.intake.defense");
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-body text-ink">
        <span>{r.skill}</span>
        {learnableLabel ? <span className={CHIP_QUIET}>{learnableLabel}</span> : null}
        <ProvenanceChip provenance={r.provenance} />
        <TurnChip turn={r.sourceTurn} onJump={onJump} />
        <span className="text-meta text-steel opacity-0 transition-opacity group-open:opacity-100 group-hover:opacity-100">
          {t("details")}
        </span>
      </summary>
      <div className="mt-1 pl-1 text-meta text-steel">
        {`${t("weight")} ${Math.round((r.weight ?? 0) * 100)}% · ${t("confidence")} ${Math.round((r.confidence ?? 0) * 100)}% — ${
          r.rationale || t("rationaleNone")
        }`}
      </div>
    </details>
  );
}

/** A facet's grading, shown only when the reading is UNCERTAIN.
 *
 *  Requirements have carried weight + confidence since the defensibility pass
 *  (RequirementRow below); facets never did, and one producer depends on them
 *  doing so. `_dossier_facet` in pipeline/jobfit/intake.py grades an App-master
 *  codebase facet 0.8 when Claude Code read the repo and 0.6 when a heuristic
 *  file-walk did, under a comment saying "a heuristic file-walk is a weaker
 *  reading than Claude Code in the repo, and the confidence the panel chips must
 *  say so". The chips could not: both readings are provenance `inferred` by
 *  construction (never "stated" - a machine read this), so the panel rendered the
 *  same chip for both and the number had no consumer.
 *
 *  Confidence 1 renders nothing. A stated value the requestor said out loud is
 *  the common case, and a "100%" chip on every line is noise that would bury the
 *  one number that carries information. */
function ConfidenceChip({ confidence }: { confidence?: number | null }) {
  const t = useTranslations("library.tab.intake.defense");
  if (confidence == null || confidence >= 1) return null;
  return (
    <span className={`${CHIP_QUIET} text-steel`} title={t("confidence")}>
      {t("confidence")} {Math.round(confidence * 100)}%
    </span>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={META_LABEL}>{label}</div>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </div>
  );
}

export function JdsIntakeBriefPanel({
  brief,
  intakeId,
  updatedAt,
  frozen,
  saving,
  onSaveBrief,
  onJumpToTurn,
  // Prototype layouts carry their own column header — suppress the inner title
  // so "Živé zadání" doesn't render twice (the edit affordance stays).
  showTitle = true,
  appMasterSlot,
}: {
  brief: RoleBrief | null;
  /** The open session and the row version its brief was read at — the edit
   *  form's draft key (intakeBriefDraft.ts). */
  intakeId: string;
  updatedAt: string | null;
  // Promoted session: the JD exists, the brief is frozen (edit hidden + note).
  frozen?: boolean;
  saving?: boolean;
  /** Resolves false when the server REFUSED the edit (409 on a promoted
   *  session, 400, offline) — edit mode then stays open holding the typed work
   *  instead of unmounting it under a one-line error. */
  onSaveBrief?: (edited: RoleBrief) => void | Promise<boolean>;
  onJumpToTurn?: (turn: number) => void;
  showTitle?: boolean;
  /** App master (docs/features/app-master/README.md): the Dossier / population-fit
   *  / composed-spec card, rendered ABOVE the brief sections because everything
   *  below it was shaped by what the scan read. Absent on the other two shapes. */
  appMasterSlot?: React.ReactNode;
}) {
  const t = useTranslations("library.tab.intake.brief");
  const tEdit = useTranslations("library.tab.intake.edit");
  const [editing, setEditing] = useState(false);
  const musts = (brief?.requirements ?? []).filter((r) => r.kind === "must_have");
  const nices = (brief?.requirements ?? []).filter((r) => r.kind === "nice_to_have");
  const empty =
    !brief ||
    (!brief.title && musts.length === 0 && nices.length === 0 && (brief.successCriteria ?? []).length === 0 && (brief.facets ?? []).length === 0);

  return (
    <div className={`${PANEL_SUNKEN} h-full space-y-5 p-4`}>
      <div className="flex items-center justify-between gap-2">
        {showTitle ? <div className={META_LABEL}>{t("title")}</div> : <span />}
        {!empty && !editing && !frozen && onSaveBrief ? (
          <button type="button" className={`${BTN_GHOST} h-8 px-2 text-sm`} onClick={() => setEditing(true)}>
            {tEdit("start")}
          </button>
        ) : null}
      </div>
      {frozen ? <p className="text-meta text-steel">{tEdit("frozen")}</p> : null}
      {appMasterSlot}
      {empty ? (
        <p className="text-body text-steel">{t("empty")}</p>
      ) : editing && brief && onSaveBrief ? (
        <JdsIntakeBriefEdit
          brief={brief}
          intakeId={intakeId}
          updatedAt={updatedAt}
          saving={saving ?? false}
          onSave={async (edited) => {
            // Close only on a CONFIRMED save. The form is the only copy of the
            // requestor's typed corrections; unmounting it on a refusal threw
            // the whole edit away and left just a red line.
            const ok = await onSaveBrief(edited);
            if (ok !== false) setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <Section label={t("role")}>
            {/* Title + seniority, each chipped, with inline title correction
                (UAT L1-TOM-2 / L1-CONV-3) — see JdsIntakeBriefTitle. */}
            <JdsIntakeBriefTitle brief={brief} frozen={frozen} saving={saving} onSaveBrief={onSaveBrief} />
          </Section>
          {(brief?.successCriteria ?? []).length > 0 ? (
            <Section label={t("outcomes")}>
              {(brief?.successCriteria ?? []).map((s, i) => (
                <div key={i} className="text-body text-ink">
                  {s}
                </div>
              ))}
            </Section>
          ) : null}
          {musts.length > 0 ? (
            <Section label={t("dealbreakers")}>
              {musts.map((r, i) => (
                <RequirementRow key={i} r={r} learnableLabel={r.hardness === "learnable" ? t("learnable") : null} onJump={onJumpToTurn} />
              ))}
            </Section>
          ) : null}
          {nices.length > 0 ? (
            <Section label={t("niceToHave")}>
              {nices.map((r, i) => (
                <RequirementRow key={i} r={r} learnableLabel={null} onJump={onJumpToTurn} />
              ))}
            </Section>
          ) : null}
          {(brief?.languages ?? []).length > 0 ? (
            <Section label={t("languages")}>
              <div className="text-body text-ink">{(brief?.languages ?? []).join(", ")}</div>
            </Section>
          ) : null}
          {(brief?.facets ?? []).length > 0 ? (
            <Section label={t("context")}>
              {(brief?.facets ?? []).map((f, i) => (
                <div key={i} className="text-body text-ink">
                  <span className="text-steel">{f.label || f.key}:</span> {f.value} <ProvenanceChip provenance={f.provenance} />{" "}
                  <ConfidenceChip confidence={f.confidence} /> <TurnChip turn={f.sourceTurn} onJump={onJumpToTurn} />
                </div>
              ))}
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}
