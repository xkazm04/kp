import { useTranslations } from "next-intl";
import { ArrowRight, Sparkles } from "lucide-react";
import { Pill } from "./GroupEvalPrimitives";
import type { Comparison } from "@/app/features/shared/groupEvalTypes";

// Minimal inline markdown: render **bold** spans as <strong>; everything else verbatim.
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold text-ink">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

// ---- AI verdict (formatted, bold) -----------------------------------------

export function AiVerdict({ comparison, fallback, aiBacked }: { comparison?: Comparison | null; fallback?: string; aiBacked: boolean }) {
  const t = useTranslations("decisions.groupEval");
  if (!comparison && !fallback) return null;
  return (
    <section className="rounded-xl border border-stone-200 bg-paper/40 p-4">
      <div className="mb-1.5 flex items-center gap-2">
        <Sparkles size={15} className="text-coral" aria-hidden />
        <span className="text-sm font-semibold uppercase tracking-wide text-steel">{t("aiComparison")}</span>
        <Pill tone={aiBacked ? "info" : "neutral"}>{aiBacked ? t("aiBacked") : t("ruleBased")}</Pill>
      </div>
      {comparison ? (
        <>
          <p className="font-serif text-h3 leading-snug text-ink">
            <RichText text={comparison.headline} />
          </p>
          {comparison.keyPoints.length ? (
            <ul className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2">
              {comparison.keyPoints.map((p, i) => (
                <li key={i} className="flex gap-2 text-base text-steel">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-coral/60" aria-hidden />
                  <span>
                    <RichText text={p} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {comparison.recommendation ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-moss/30 bg-moss/5 p-2.5 text-base text-ink">
              <ArrowRight size={16} className="mt-0.5 shrink-0 text-moss" aria-hidden />
              <span>
                <RichText text={comparison.recommendation} />
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-base text-ink">{fallback}</p>
      )}
    </section>
  );
}
