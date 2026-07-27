import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { riskText, type Translate } from "./localize";
import type { RiskFact } from "./types";

// Watch-outs strip at the bottom of the modal — the evaluation's pool-level risks.
// A risk arrives as a STRUCTURED FACT and is composed here in the reader's
// language; a legacy payload's frozen English sentence renders verbatim
// (eval-speaks-your-language — see ./localize.ts).
export function Risks({ risks }: { risks: (string | RiskFact)[] }) {
  const t = useTranslations("decisions.groupEval");
  const tt = t as unknown as Translate;
  if (!risks.length) return null;
  return (
    <section>
      <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-coral">
        <AlertTriangle size={14} /> {t("watchOuts", { n: risks.length })}
      </p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {risks.map((r, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-base text-amber-900">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>{riskText(tt, r)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
