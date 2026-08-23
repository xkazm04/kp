"use client";

import { useTranslations } from "next-intl";
import { BTN_SECONDARY, CHIP_QUIET, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import type { AppMasterCompose, PopulationFit } from "@/app/_lib/db/intakes";
import type { RepoDossier } from "@/app/_lib/schemas.generated";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { DispatchState } from "./jdsIntakeAppMaster";

// The App-master card in the live brief panel (docs/features/app-master/README.md).
// Three stacked truths, in the order they become true:
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
  composeError: boolean;
  onCompose?: () => void;
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
        <p className="text-body text-steel">{scanNote ?? t("dossier.pending")}</p>
      ) : (
        <div className="space-y-1.5">
          {dossier.stack.length > 0 ? <Row label={t("dossier.stack")} value={dossier.stack.slice(0, 10).join(", ")} /> : null}
          {dossier.declaredGates.length > 0 ? (
            <Row label={t("dossier.gates")} value={dossier.declaredGates.slice(0, 6).join(" · ")} />
          ) : null}
          <Row
            label={t("dossier.contexts")}
            value={t("dossier.contextCount", { count: dossier.size.contexts || dossier.contexts.length })}
          />
          {dossier.hotSpots.length > 0 ? (
            <Row label={t("dossier.hotSpots")} value={dossier.hotSpots.slice(0, 3).map((h) => h.ref).join(", ")} />
          ) : null}
          {dossier.riskAreas.length > 0 ? (
            <Row label={t("dossier.riskAreas")} value={dossier.riskAreas.slice(0, 3).map((r) => r.ref).join(", ")} />
          ) : null}
          {dossier.candidateObjectives.length > 0 ? (
            <Row
              label={t("dossier.objectives")}
              value={dossier.candidateObjectives.slice(0, 4).map((o) => o.label).join(", ")}
            />
          ) : null}
          {dossier.maintainerLoadEstimate ? <Row label={t("dossier.load")} value={dossier.maintainerLoadEstimate} /> : null}
          {scanNote ? <p className="text-meta text-steel">{scanNote}</p> : null}
        </div>
      )}

      {/* Population fit — only once there is something to judge it over. */}
      {dossier ? (
        <div className="space-y-1.5 border-t border-stone-200 pt-3">
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
              <ul className="space-y-0.5">
                {fit.perObjective.slice(0, 6).map((o) => (
                  <li key={o.kpiKey} className="text-meta text-steel">
                    <span className="text-ink">{o.kpiKey}</span> — {t(`fit.coverageClass.${o.coverage}`)}
                    {o.rationale ? `: ${o.rationale}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {/* The composed spec + the two hire paths. */}
      {dossier ? (
        <div className="space-y-2 border-t border-stone-200 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={META_LABEL}>{t("spec.title")}</div>
            {!frozen && onCompose ? (
              <button type="button" className={`${BTN_SECONDARY} h-8 px-3 text-sm`} disabled={composing} onClick={onCompose}>
                {composing ? t("composing") : spec ? t("recompose") : t("compose")}
              </button>
            ) : null}
          </div>
          {composeError ? <p className="text-body text-red-700">{t("composeError")}</p> : null}
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
