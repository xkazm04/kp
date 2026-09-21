"use client";

import { useLocale, useTranslations } from "next-intl";
import { fmtBand } from "../jobsCoachSalary";
import type { RolePattern, Winnability } from "./rolePatterns";

// One place that turns a derived pattern into the words a recruiter reads, so the
// three variants cannot describe the same row in three different ways. next-intl keys
// are TYPED and reject a template literal, so the kind → key mapping is an explicit
// map rather than `pattern.${kind}`.

const KIND_KEY = {
  language: "pattern.language",
  education: "pattern.education",
  skill: "pattern.skill",
  salary: "pattern.salary",
} as const;

export type PatternCopy = {
  /** The row's headline — "Czech C1 required", "Kubernetes missing". */
  title: string;
  /** The measured clause — "23 of 34 candidates" — or null when nothing is countable. */
  measure: string | null;
  /** What loosening this would buy, per the scorer's own counterfactual. 0 = no gain. */
  gain: number;
};

export function usePatternCopy(win: Winnability | null): (pattern: RolePattern) => PatternCopy {
  const t = useTranslations("jobs.coach");
  const locale = useLocale();
  const marketBand = win?.salary?.marketBand ?? null;
  const jobBand = win?.salary?.jobBand ?? null;

  return (pattern: RolePattern): PatternCopy => {
    if (pattern.kind === "salary") {
      return {
        title: t(KIND_KEY.salary, {
          job: fmtBand(jobBand, locale) ?? t("salaryUnset"),
          market: fmtBand(marketBand, locale) ?? "",
        }),
        // A low band costs the role the candidates who never applied, and the pool
        // cannot see them. A "0 of 34" here would read as "this costs nobody".
        measure: null,
        gain: 0,
      };
    }
    return {
      title: t(KIND_KEY[pattern.kind], { value: pattern.value }),
      measure:
        pattern.denominator > 0
          ? t("measure", { affected: pattern.affected, denominator: pattern.denominator })
          : null,
      gain: pattern.gain,
    };
  };
}

/** The share as a whole percent, or null when the pattern has no countable share. */
export function sharePercent(pattern: RolePattern): number | null {
  return pattern.share === null ? null : Math.round(pattern.share * 100);
}
