"use client";

import { useState } from "react";
import { ChevronDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

// Explainable potential score (SCOR3). Archetype-fair scoring replaces years of
// experience with a computed "potential" for students/switchers — but a bare
// "potential 64%" pill invites distrust and overrides. The engine has always
// computed the WHY (compute_potential's learning signals, map_transferable's
// professional-grade meta-skill credits, the domain_distance bridge grade) and
// fed it to the score math + the LLM reasoning prompt; this badge is the first
// surface to show it to the recruiter. With no explanation data (e.g. an old
// persisted group-eval snapshot from before the fields existed) it degrades to
// the same plain pill as before.
export type PotentialExplanation = {
  /** 0..1 */
  score: number;
  learningSignals?: string[] | null;
  transferableSkills?: string[] | null;
  /** adjacent | moderate | far (career switchers only) */
  domainDistance?: string | null;
};

export function PotentialBadge({ potential, className = "" }: { potential: PotentialExplanation; className?: string }) {
  const t = useTranslations("potential");
  const [open, setOpen] = useState(false);
  const pct = Math.round(potential.score * 100);
  const signals = potential.learningSignals ?? [];
  const transferable = potential.transferableSkills ?? [];
  const distance = potential.domainDistance ?? null;
  const hasDetail = signals.length > 0 || transferable.length > 0 || distance !== null;

  const label = (
    <>
      <TrendingUp size={12} aria-hidden />
      {t("badge", { pct })}
    </>
  );

  if (!hasDetail) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-sm text-steel ${className}`}>
        {label}
      </span>
    );
  }

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="focus-ring inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-sm text-steel hover:bg-stone-100 hover:text-ink"
      >
        {label}
        <ChevronDown size={12} className={open ? "rotate-180" : ""} aria-hidden />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1.5 w-72 rounded-lg border border-stone-200 bg-white p-3 text-left shadow-lg">
          <p className="text-meta uppercase tracking-wide text-steel">{t("explainTitle")}</p>
          {signals.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5 text-sm text-ink">
              {signals.map((s) => (
                <li key={s} className="flex items-start gap-1.5">
                  <TrendingUp size={12} className="mt-1 shrink-0 text-moss" aria-hidden />
                  {s}
                </li>
              ))}
            </ul>
          ) : null}
          {transferable.length > 0 ? (
            <div className="mt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-steel">{t("transferable")}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {transferable.map((skill) => (
                  <span key={skill} className="rounded-full bg-moss/10 px-2 py-0.5 text-xs font-medium text-moss">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {distance ? (
            <p className="mt-2 text-sm text-steel">
              <span className="font-semibold">{t("bridge")}</span>{" "}
              {t.has(`bridgeValues.${distance}` as Parameters<typeof t>[0])
                ? t(`bridgeValues.${distance}` as Parameters<typeof t>[0])
                : distance}
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
