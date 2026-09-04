import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Meter } from "@/app/_components/Meter";
import { scoreTone } from "@/app/_lib/format";
import type { BuildResult } from "@/app/features/shared/profileTypes";
import { labelOr, useEnumLabel } from "@/app/_lib/use-enum-label";
import { fieldTargetForCheck, fieldTargetForMissing, type ProfileFieldKey } from "./profileCompletenessFields";
import { routingReasonsLine, SELF_DECLARED_REASON_KIND } from "./profileRoutingReasons";

// Named for what it panels — the PROFILE build result. It used to export
// `ResultPanel`, the same name app/_components/results/ResultPanel.tsx exports for
// the CV-analysis result, so two different components answered to one name in the
// same tree and an import was one autocomplete away from the wrong panel.
export function ProfileResultPanel({
  result,
  onMatchNow,
  onGoToField,
}: {
  result: BuildResult;
  /** Present only for a SAVED result: one click runs a match against this profile. */
  onMatchNow?: () => void;
  /** Jump to the editor field that resolves a given completeness gap. */
  onGoToField?: (key: ProfileFieldKey) => void;
}) {
  const t = useTranslations("profile.result");
  const enumLabel = useEnumLabel();
  // The router's reasons arrive as {kind, params} codes (registry.detect_detailed);
  // this resolves one against the catalogs, returning null for a kind with no entry
  // so the caller can fall back to the router's English sentence rather than throw.
  // The self-declaration's `archetype` param is a wire id — localized here, so the
  // catalog entry stays one sentence for every (including custom) archetype.
  const translateReason = useCallback(
    (kind: string, params: Record<string, string | number>) => {
      const key = `reasons.${kind}` as Parameters<typeof t>[0];
      if (!t.has(key)) return null;
      const values =
        kind === SELF_DECLARED_REASON_KIND && typeof params.archetype === "string"
          ? { ...params, archetype: enumLabel("archetype", params.archetype) }
          : params;
      return t(key, values as never);
    },
    [t, enumLabel]
  );
  const routing = routingReasonsLine(result.reasonCodes, result.reasons, translateReason);
  const pct = Math.round((result.completeness ?? 0) * 100);
  // Prefer the id-keyed gaps (localizable label + reliably clickable via the stable
  // check id); fall back to the raw `missing` labels for a result persisted before
  // profile_cli emitted `missingGaps`. A gap's label is localized by its check id
  // (checks.<id>), degrading to the raw registry label only for an unmapped id.
  const gaps: { label: string; target: ProfileFieldKey | null }[] = result.missingGaps?.length
    ? result.missingGaps.map((g) => ({
        label: labelOr(t, `checks.${g.check}`, g.label),
        target: onGoToField ? fieldTargetForCheck(g.check) : null,
      }))
    : (result.missing ?? []).map((m) => ({
        label: m,
        target: onGoToField ? fieldTargetForMissing(m) : null,
      }));
  return (
    <div className="mt-4 rounded-lg border border-stone-200 bg-paper/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-sm font-semibold text-white">
          {enumLabel("archetype", result.archetype)}
        </span>
        {/* UAT RECON-06 — the archetype router's SIGNAL AGREEMENT (the winner's share
            of the routing vote, registry.detect), not a confidence. The catalog word
            changed; the payload field keeps its Python name. */}
        <span className="text-sm text-steel">{t("confidence", { pct: Math.round((result.confidence ?? 0) * 100) })}</span>
        {result.saved?.id ? (
          /* The RECEIPT names the profile, not the row. The store id is an internal
             key the recruiter cannot act on and could not match to anything on screen;
             the display name is what they just typed. A profile saved without one
             falls back to a short opaque reference, never the full id. */
          <span className="text-sm text-green-700">
            {t("saved", {
              name: result.profile?.displayName?.trim() || result.saved.id.slice(0, 6),
            })}
          </span>
        ) : (
          <span className="text-sm text-steel">{t("preview")}</span>
        )}
        {onMatchNow ? (
          <button
            type="button"
            onClick={onMatchNow}
            className="focus-ring ml-auto inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-3 text-sm font-semibold text-white hover:bg-coral/90"
          >
            {t("matchNow")} <ArrowRight size={15} aria-hidden />
          </button>
        ) : null}
      </div>
      {routing ? <p className="mt-1 text-sm text-steel">{t("routing", { reasons: routing })}</p> : null}

      <div className="mt-3">
        <div className="flex justify-between text-sm text-steel">
          <span className="font-semibold uppercase tracking-wide">{t("completeness")}</span>
          <span>{pct}%</span>
        </div>
        <Meter value={pct} tone={scoreTone(pct)} className="mt-1 h-2" aria-label={t("completenessAria", { pct })} />
      </div>
      {gaps.length ? (
        <div className="mt-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-steel">{t("addNext")}</p>
          <ul className="mt-1 space-y-0.5 text-sm text-ink">
            {gaps.map(({ label, target }, i) => (
              <li key={i} className="flex">
                {target ? (
                  <button
                    type="button"
                    onClick={() => onGoToField?.(target)}
                    title={t("goToField")}
                    className="focus-ring group -ml-1 inline-flex items-center gap-1 rounded px-1 text-left text-ink hover:text-coral"
                  >
                    <span className="text-coral">{"+"}</span>
                    <span className="underline decoration-dotted decoration-steel/50 underline-offset-2 group-hover:decoration-coral">
                      {label}
                    </span>
                  </button>
                ) : (
                  <span className="px-1">
                    <span className="text-steel">{"•"}</span> {label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-sm text-green-700">{t("complete")}</p>
      )}
    </div>
  );
}
