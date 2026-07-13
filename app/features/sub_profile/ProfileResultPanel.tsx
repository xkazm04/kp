import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Meter } from "@/app/_components/Meter";
import { scoreTone } from "@/app/_lib/format";
import type { BuildResult } from "./ProfileTypes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { fieldTargetForMissing, type ProfileFieldKey } from "./completeness-fields";

export function ResultPanel({
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
  const pct = Math.round((result.completeness ?? 0) * 100);
  return (
    <div className="mt-4 rounded-lg border border-stone-200 bg-paper/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-sm font-semibold text-white">
          {enumLabel("archetype", result.archetype)}
        </span>
        <span className="text-sm text-steel">{t("confidence", { pct: Math.round((result.confidence ?? 0) * 100) })}</span>
        {result.saved?.id ? (
          <span className="text-sm text-green-700">{t("saved", { id: result.saved.id })}</span>
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
      {result.reasons?.length ? (
        <p className="mt-1 text-sm text-steel">{t("routing", { reasons: result.reasons.join("; ") })}</p>
      ) : null}

      <div className="mt-3">
        <div className="flex justify-between text-sm text-steel">
          <span className="font-semibold uppercase tracking-wide">{t("completeness")}</span>
          <span>{pct}%</span>
        </div>
        <Meter value={pct} tone={scoreTone(pct)} className="mt-1 h-2" aria-label={t("completenessAria", { pct })} />
      </div>
      {result.missing?.length ? (
        <div className="mt-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-steel">{t("addNext")}</p>
          <ul className="mt-1 space-y-0.5 text-sm text-ink">
            {result.missing.map((m, i) => {
              const target = onGoToField ? fieldTargetForMissing(m) : null;
              return (
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
                        {m}
                      </span>
                    </button>
                  ) : (
                    <span className="px-1">
                      <span className="text-steel">{"•"}</span> {m}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-sm text-green-700">{t("complete")}</p>
      )}
    </div>
  );
}
