import { useTranslations } from "next-intl";
import { META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import type { GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";
import { capNames, rerunDelta } from "./groupEvalDelta";
import { MODE_LABEL_KEY } from "./GroupEvalNotices";

// "What this re-run changed" — the one question a recruiter re-runs a comparison to
// answer. Every sentence is a claim groupEvalDelta.ts can support from the two
// records: rank moves only among the candidates compared both times, a lead swap
// inside the confidence band stated as a tie, a run that names no lead never read as
// somebody losing it. Renders nothing without a previous run (first run, cache open).
export function RerunDelta({ previous, current }: { previous: GroupEvalPayload | null | undefined; current: GroupEvalPayload }) {
  const t = useTranslations("decisions.groupEval");
  const tDecisions = useTranslations("decisions");
  const delta = rerunDelta(previous, current);
  if (!delta) return null;

  const names = (list: readonly string[]): string => {
    const { shown, more } = capNames(list);
    return more > 0 ? t("namesAndMore", { names: shown.join(", "), count: more }) : shown.join(", ");
  };
  const b = (chunks: React.ReactNode) => <b>{chunks}</b>;
  const lead = delta.lead;
  const currentLead = current.topPick?.label ?? null;

  return (
    <section className={`${PANEL} p-4`} aria-live="polite">
      <p className={META_LABEL}>{t("deltaTitle")}</p>
      {delta.unchanged ? (
        <p className="mt-2 text-base text-ink">{t("deltaUnchanged")}</p>
      ) : (
        <div className="mt-2 space-y-1 text-base text-ink">
          {delta.entered.length > 0 ? <p>{t("deltaEntered", { names: names(delta.entered) })}</p> : null}
          {delta.dropped.length > 0 ? <p>{t("deltaDropped", { names: names(delta.dropped) })}</p> : null}
          {delta.modeChanged ? (
            <p>
              {t("deltaMode", {
                from: tDecisions(MODE_LABEL_KEY[delta.mode.from]),
                to: tDecisions(MODE_LABEL_KEY[delta.mode.to]),
              })}
            </p>
          ) : null}
          {lead === null ? (
            currentLead ? <p>{t.rich("deltaLeadSame", { name: currentLead, b })}</p> : null
          ) : lead.reason === "no_lead" ? (
            <p>{t.rich("deltaLeadNone", { from: lead.from ?? "", b })}</p>
          ) : lead.reason === "within_band" ? (
            <p>{t.rich("deltaLeadTied", { from: lead.from ?? "", to: lead.to ?? "", b })}</p>
          ) : lead.from === null ? (
            <p>{t.rich("deltaLeadNew", { to: lead.to ?? "", b })}</p>
          ) : (
            <p>{t.rich("deltaLeadChanged", { from: lead.from, to: lead.to ?? "", b })}</p>
          )}
          {delta.moves.length > 0 ? (
            <>
              <p className="text-steel">
                {delta.fieldChanged ? t("deltaMovesCommon", { count: delta.common }) : t("deltaMovesSameField")}
              </p>
              <ul className="space-y-0.5">
                {delta.moves.map((m) => (
                  <li key={m.id} className="nums">
                    {t("deltaMove", { name: m.label, from: m.from, to: m.to })}
                  </li>
                ))}
              </ul>
            </>
          ) : delta.common >= 2 ? (
            <p className="text-steel">{t("deltaNoMoves")}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
