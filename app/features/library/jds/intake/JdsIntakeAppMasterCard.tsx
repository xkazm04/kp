"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_GHOST, BTN_SECONDARY, CHIP_QUIET, DIVIDER, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { mandateSections } from "@/app/_lib/app-master/mandate-view";
import type { AppMasterCompose, PopulationFit } from "@/app/_lib/db/intakes";
import type { AppMasterSpec, RepoDossier } from "@/app/_lib/schemas.generated";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { DispatchState } from "./jdsIntakeAppMaster";

// The App-master card in the live brief panel (docs/features/app-master/README.md).
// Four stacked truths, in the order they become true:
//
//   1. **What the scan read** — the dossier, labelled as a MACHINE READING with
//      its own provenance (`llm` = Claude Code read the repo in place;
//      `heuristic` = the keyless file-walk). Never presented as the requestor's
//      words: the `inferred` chips on the facets below say the same thing, and
//      this card must not quietly upgrade them.
//   2. **Population fit** — ✓ / – / ✗ on one axis only ("could an agent hold
//      this?"), always with the verdict spelled out beside the glyph, and
//      `unassessed` shown as the disclosed unknown rather than hidden.
//   3. **The composed spec** — mandate rung, forbidden classes, budget, tenure,
//      owner — plus every assumption the composition had to make.
//   4. **The mandate itself** — the approval gates Personas will execute, every
//      objective's bar (target · unit · direction · window), the review cadence,
//      the retire criteria and the budget's reservation policy. This card used
//      to show one number out of all of that, the objective COUNT, under a
//      control that hires an accountable owner. Every capped list here (fit
//      rows, dossier lines) also carries a "+N more": a silent truncation is a
//      claim about how much was read.
//
// Both themes come from recipes + tokens (PANEL/CHIP_QUIET/META_LABEL, ink /
// steel / moss / coral / amber-700); there is no raw colour here.

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-meta text-steel">{label}</span>
      <span className="text-body text-ink">{value}</span>
    </div>
  );
}

// The "+N more" affordance every capped list in this card owes. The caps are
// real (a 40-context dossier line is unreadable), but a silent cap is a lie
// about how much the scan read — MatchCardSkillChips has shown the same list
// its expansion for a while, and these lists had none.
function MoreToggle({ hidden, expanded, onToggle }: { hidden: number; expanded: boolean; onToggle: () => void }) {
  const t = useTranslations("library.tab.intake.appMaster");
  if (hidden <= 0 && !expanded) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`${CHIP_QUIET} focus-ring ml-1.5 font-semibold hover:bg-stone-200`}
    >
      {expanded ? t("showLess") : t("moreCount", { count: hidden })}
    </button>
  );
}

/** A one-line fact whose value is a capped, expandable list. Renders nothing at
 *  all when the list is empty — a hole reads as a hole. */
function ListRow({ label, items, cap, sep = ", " }: { label: string; items: string[]; cap: number; sep?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, cap);
  return (
    <Row
      label={label}
      value={
        <>
          {shown.join(sep)}
          <MoreToggle hidden={items.length - shown.length} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
        </>
      }
    />
  );
}

/** The per-objective coverage rows behind the fit verdict. Capped at six and
 *  expandable: the verdict is computed over ALL of them, so a silently-cut list
 *  under a percentage is a percentage nobody can check. */
function FitRows({ rows }: { rows: PopulationFit["perObjective"] }) {
  const t = useTranslations("library.tab.intake.appMaster");
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, 6);
  return (
    <>
      <ul className="space-y-0.5">
        {shown.map((o) => (
          <li key={o.kpiKey} className="text-meta text-steel">
            <span className="text-ink">{o.kpiKey}</span> — {t(`fit.coverageClass.${o.coverage}`)}
            {o.rationale ? `: ${o.rationale}` : ""}
          </li>
        ))}
      </ul>
      <MoreToggle hidden={rows.length - shown.length} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
    </>
  );
}

/** THE MANDATE — the contract the requestor is about to hand to an owner they
 *  may never speak to. Approval gates are executed by Personas; each objective's
 *  target/unit/direction/window is the bar it is measured against; the review
 *  cadence and retire criteria are how it ends; the reservation policy is how
 *  its budget is held. The card used to show one number out of all of it (the
 *  objective COUNT), so "Dispatch" asked for consent to terms nobody had read.
 *
 *  The field mapping lives in `mandateSections` (pure, `app/_lib/app-master/
 *  mandate-view.ts`) — this is only its typography. Absent values render
 *  NOTHING: no zero, no dash, no invented default. */
function MandateSection({ spec }: { spec: AppMasterSpec }) {
  const t = useTranslations("library.tab.intake.appMaster");
  const view = mandateSections(spec);
  if (view.isEmpty) return null;
  return (
    <div className={`${DIVIDER} space-y-2 pt-3`}>
      <div className={META_LABEL}>{t("mandate.title")}</div>

      {view.approvalGates.length > 0 ? (
        <div className="space-y-0.5">
          <div className="text-meta text-steel">{t("mandate.gates")}</div>
          <ul className="space-y-0.5">
            {view.approvalGates.map((gate) => (
              <li key={gate} className="text-body text-ink">
                {gate}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.objectives.length > 0 ? (
        <div className="space-y-0.5">
          <div className="text-meta text-steel">{t("mandate.objectives")}</div>
          <ul className="space-y-1">
            {view.objectives.map((o) => (
              <li key={o.kpiKey}>
                <div className="text-body text-ink">{o.label}</div>
                <div className="text-meta text-steel nums">
                  {o.target !== null ? (
                    <span>
                      {t(`mandate.direction.${o.direction}`)} {o.target}
                      {o.unit ? ` ${o.unit}` : ""}
                    </span>
                  ) : null}
                  {o.target !== null && o.windowDays !== null ? " · " : ""}
                  {o.windowDays !== null ? t("mandate.windowValue", { days: o.windowDays }) : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-1.5">
        {view.reviewCadenceDays !== null ? (
          <Row
            label={t("mandate.reviewCadence")}
            value={<span className="nums">{t("mandate.reviewCadenceValue", { days: view.reviewCadenceDays })}</span>}
          />
        ) : null}
        {view.reservationPolicy ? (
          <Row label={t("mandate.reservation")} value={t(`mandate.reservationValue.${view.reservationPolicy}`)} />
        ) : null}
      </div>

      {view.retireCriteria.length > 0 ? (
        <div className="space-y-0.5">
          <div className="text-meta text-steel">{t("mandate.retire")}</div>
          <ul className="space-y-0.5">
            {view.retireCriteria.map((c) => (
              <li key={c} className="text-body text-ink">
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// next-intl keys are typed, so the rung cannot be interpolated into the key.
// The ladder is closed at 0..2 anyway (rungs 3 and 4 are never grantable), so an
// explicit map is also the honest shape.
const RUNG_KEY = ["spec.rungValue.0", "spec.rungValue.1", "spec.rungValue.2"] as const;

const VERDICT_GLYPH: Record<PopulationFit["verdict"], { glyph: string; cls: string }> = {
  agent: { glyph: "✓", cls: "text-moss" },
  hybrid: { glyph: "–", cls: "text-amber-700" },
  human: { glyph: "✗", cls: "text-coral" },
  unassessed: { glyph: "–", cls: "text-steel" },
};

export function JdsIntakeAppMasterCard({
  dossier,
  appMaster,
  scanNote,
  objectiveCount,
  composing,
  composeError,
  onCompose,
  onCancelCompose,
  onCancelScan,
  frozen,
  paired,
  dispatchState,
  onDispatch,
}: {
  dossier: RepoDossier | null;
  appMaster: AppMasterCompose | null;
  /** A line about the scan while it is still running / unreachable. */
  scanNote: string | null;
  /** How many `objective:` facets the brief holds — the fit is judged over them. */
  objectiveCount: number;
  composing: boolean;
  /** The failed compose's machine CODE, resolved through the `errors` catalog in
   *  the reader's language. `null` = nothing failed. */
  composeError: { code: string | null } | null;
  onCompose?: () => void;
  /** Abort an in-flight compose. The spawn behind it can run for minutes. */
  onCancelCompose?: () => void;
  /** Stop the repo SCAN that is still running (a different, longer thing than the
   *  compose above: a clone plus an in-repo agent session, minutes of it). Absent
   *  when there is nothing to cancel — the control is then not rendered, never
   *  rendered dead. */
  onCancelScan?: () => void;
  frozen?: boolean;
  /** Personas pairing: null = not read yet, false = dispatch cannot work. */
  paired: boolean | null;
  dispatchState: DispatchState;
  onDispatch?: () => void;
}) {
  const t = useTranslations("library.tab.intake.appMaster");
  // An API failure is shown from its machine `code`, never from the server's
  // English `error` string (app/_lib/use-error-message.ts).
  const resolveError = useErrorMessage();
  const fit = appMaster?.fit ?? null;
  const spec = appMaster?.spec ?? null;

  return (
    <div className={`${PANEL} space-y-4 p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={META_LABEL}>{t("dossier.title")}</div>
        {dossier ? <span className={CHIP_QUIET}>{t(`dossier.source.${dossier.source}`)}</span> : null}
      </div>

      {!dossier ? (
        <div className="space-y-2">
          {/* The scan line is the ONLY thing on this card until a dossier lands, so
              it is also where the way out belongs: a scan pointed at the wrong
              repository used to be a four-minute wait with no exit, even though the
              engine has threaded the abort signal end to end the whole time. */}
          <p className="text-body text-steel">{scanNote ?? t("dossier.pending")}</p>
          {onCancelScan ? (
            <button type="button" className={`${BTN_GHOST} h-8 px-3 text-sm`} onClick={onCancelScan}>
              {t("cancelScan")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1.5">
          <ListRow label={t("dossier.stack")} items={dossier.stack} cap={10} />
          <ListRow label={t("dossier.gates")} items={dossier.declaredGates} cap={6} sep=" · " />
          <Row
            label={t("dossier.contexts")}
            value={t("dossier.contextCount", { count: dossier.size.contexts || dossier.contexts.length })}
          />
          <ListRow label={t("dossier.hotSpots")} items={dossier.hotSpots.map((h) => h.ref)} cap={3} />
          <ListRow label={t("dossier.riskAreas")} items={dossier.riskAreas.map((r) => r.ref)} cap={3} />
          <ListRow label={t("dossier.objectives")} items={dossier.candidateObjectives.map((o) => o.label)} cap={4} />
          {dossier.maintainerLoadEstimate ? <Row label={t("dossier.load")} value={dossier.maintainerLoadEstimate} /> : null}
          {scanNote ? <p className="text-meta text-steel">{scanNote}</p> : null}
        </div>
      )}

      {/* Population fit — only once there is something to judge it over. */}
      {dossier ? (
        <div className={`${DIVIDER} space-y-1.5 pt-3`}>
          <div className={META_LABEL}>{t("fit.title")}</div>
          {objectiveCount === 0 ? (
            <p className="text-body text-steel">{t("fit.needsObjectives")}</p>
          ) : !fit ? (
            <p className="text-body text-steel">{t("fit.notRun")}</p>
          ) : (
            <>
              <p className="text-body text-ink">
                <span className={`${VERDICT_GLYPH[fit.verdict].cls} font-semibold`} aria-hidden>
                  {VERDICT_GLYPH[fit.verdict].glyph}
                </span>{" "}
                {t(`fit.verdict.${fit.verdict}`)}
              </p>
              <p className="text-meta text-steel nums">
                {t("fit.coverage", { pct: Math.round(fit.coverageRatio * 100) })}
                {fit.source === "deterministic" ? ` · ${t("fit.keyless")}` : ""}
              </p>
              <FitRows rows={fit.perObjective} />
            </>
          )}
        </div>
      ) : null}

      {/* The composed spec + the two hire paths. */}
      {dossier ? (
        <div className={`${DIVIDER} space-y-2 pt-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={META_LABEL}>{t("spec.title")}</div>
            {!frozen && onCompose ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`${BTN_SECONDARY} h-8 px-3 text-sm`}
                  disabled={composing}
                  onClick={onCompose}
                >
                  {composing ? t("composing") : spec ? t("recompose") : t("compose")}
                </button>
                {/* The compose spawn runs for up to three minutes. A requestor who
                    changed their mind gets a real cancel — the abort reaches the
                    Python process — instead of a button they can only wait out. */}
                {composing && onCancelCompose ? (
                  <button type="button" className={`${BTN_GHOST} h-8 px-3 text-sm`} onClick={onCancelCompose}>
                    {t("cancel")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {composeError ? (
            <p className="text-body text-red-700">{resolveError(composeError, t("composeError"))}</p>
          ) : null}
          {spec ? (
            <div className="space-y-1.5">
              <Row label={t("spec.population")} value={t(`fit.verdict.${spec.role.population === "either" ? "unassessed" : spec.role.population}`)} />
              <Row label={t("spec.rung")} value={t(RUNG_KEY[Math.min(2, Math.max(0, spec.mandate.scopeRung))])} />
              <Row label={t("spec.forbidden")} value={t("spec.forbiddenCount", { count: spec.mandate.forbiddenClasses.length })} />
              <Row
                label={t("spec.budget")}
                value={<span className="nums">{t("spec.budgetValue", { usd: spec.budget.monthlyUsd })}</span>}
              />
              <Row
                label={t("spec.probation")}
                value={<span className="nums">{t("spec.probationValue", { days: spec.tenure.probationDays })}</span>}
              />
              <Row label={t("spec.owner")} value={spec.mandate.owner || t("spec.noOwner")} />
              <Row label={t("spec.objectives")} value={t("spec.objectiveCount", { count: spec.objectives.length })} />
              {/* The contract itself, below the summary rows it summarizes. */}
              <MandateSection spec={spec} />
              {spec.coercionNotes.length > 0 ? (
                <div className="pt-1">
                  <div className={META_LABEL}>{t("spec.notes")}</div>
                  <ul className="mt-1 space-y-0.5">
                    {spec.coercionNotes.map((n, i) => (
                      <li key={i} className="text-meta text-steel">
                        {n}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {/* Dispatch (P4). Every reason the control cannot act is SAID —
                  a human-population spec, an unpaired bridge, a frozen intake —
                  rather than left as a dead button; and "sent" claims only what
                  actually happened (Personas accepted the request; a human there
                  still has to approve it), never "hired". */}
              {(() => {
                const humanOnly = spec.role.population === "human";
                const blocked = humanOnly || paired === false || !!frozen || !onDispatch;
                const sending = dispatchState.status === "sending";
                return (
                  <div className="pt-2">
                    <button
                      type="button"
                      className={`${BTN_SECONDARY} h-8 px-3 text-sm`}
                      disabled={blocked || sending || dispatchState.status === "sent"}
                      onClick={onDispatch}
                    >
                      {sending ? t("dispatching") : t("dispatch")}
                    </button>
                    {humanOnly ? (
                      <p className="mt-1 text-meta text-steel">{t("dispatchHuman")}</p>
                    ) : paired === false ? (
                      <p className="mt-1 text-meta text-steel">{t("dispatchNeedsPairing")}</p>
                    ) : null}
                    {dispatchState.status === "sent" ? (
                      <p className="mt-1 text-meta text-moss">{t("dispatchSent")}</p>
                    ) : null}
                    {dispatchState.status === "error" ? (
                      <p className="mt-1 text-meta text-red-700">
                        {resolveError({ code: dispatchState.code }, t("dispatchError"))}
                      </p>
                    ) : null}
                  </div>
                );
              })()}
            </div>
          ) : (
            <p className="text-body text-steel">{t("spec.empty")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
