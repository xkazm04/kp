import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { koFailed } from "./groupEvalHelpers";
import { topPickWhyText, type Translate } from "./localize";
import { Pill, SectionTitle } from "@/app/features/hiring/decisions/groupEval/GroupEvalPrimitives";
import type { GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";

// ---- Legacy fallback (no recruiter breakdown: job-less role, old saved eval,
// or the simulation's loading payload) ------------------------------------
export function LegacyView({ evaluation }: { evaluation: GroupEvalPayload }) {
  const t = useTranslations("decisions.groupEval");
  const enumLabel = useEnumLabel();
  // The lead's "why" is either the AI verdict (already in the org locale) or one of
  // two canned lines flagged by `whyKind` — those are composed from the catalog.
  const why = topPickWhyText(t as unknown as Translate, evaluation.topPick);
  return (
    <div className="space-y-4">
      {evaluation.topPick ? (
        <div className="rounded-lg border border-moss/30 bg-moss/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-moss">
            <Sparkles size={14} /> {t("recommendedLead")}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 font-serif text-h3 text-ink">
            {evaluation.topPick.label} <ScoreBadge score={evaluation.topPick.score} />
            {/* Same hedge as the comparison table's crown: the sealed record already
                says the top two are a tie on the evidence, so the compact view must
                not present the lead as decisive either. */}
            {evaluation.leadSeparation === "overlapping" ? (
              <Pill tone="amber" title={t("leadTiedTitle")}>
                {t("leadTied")}
              </Pill>
            ) : null}
          </p>
          {why ? <p className="mt-1 text-base text-steel">{why}</p> : null}
        </div>
      ) : null}

      {evaluation.candidates?.length ? (
        <section>
          <SectionTitle>{t("perCandidate")}</SectionTitle>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            {evaluation.candidates.map((c, i) => (
              <div key={i} className="rounded-md border border-stone-200 p-2.5">
                <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
                  {c.label}
                  <ScoreBadge score={c.score} />
                  {/* The SAME knock-out rule the enriched header enforces (koFailed). This
                      view is still reached by every payload without a score breakdown — a
                      job-less role, an old saved eval, the simulation's loading payload —
                      and it rendered no KO pill at all, so a candidate who FAILED a
                      knock-out read here as an ordinary contender. */}
                  {koFailed(c) ? <Pill tone="coral">{t("ko")}</Pill> : null}
                  {c.seniority ? <span className="font-normal text-steel">{enumLabel("seniority", c.seniority)}</span> : null}
                </p>
                {c.verdict ? <p className="mt-0.5 text-base text-ink">{c.verdict}</p> : null}
                <div className="mt-1 grid gap-1 text-base sm:grid-cols-2">
                  {c.strengths.length ? <p><span className="font-semibold text-moss">+ </span>{c.strengths.slice(0, 3).join("; ")}</p> : null}
                  {c.gaps.length ? <p><span className="font-semibold text-coral">! </span>{c.gaps.slice(0, 3).join("; ")}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {evaluation.differentiators?.length ? (
        <p className="text-base text-ink">
          <span className="font-semibold">{t("differentiators")}</span> {evaluation.differentiators.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
