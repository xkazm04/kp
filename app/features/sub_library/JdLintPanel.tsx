"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import type { JdLintFinding } from "@/app/_lib/jd-lint";

// The inclusivity + specificity lint findings panel, extracted so the SAME panel
// renders on every authoring surface — the AI builder (JdBuilderResult), the paste
// form (LibraryJdForm), and the public-page in-place editor (JdActions). It used to
// be inline in the builder only, so a pasted or hand-edited JD shipped with no
// inclusivity/quality check at all. Reads the existing `library.result.lint*` keys.
export function JdLintPanel({ findings }: { findings: JdLintFinding[] }) {
  const t = useTranslations("library.result");
  if (!findings.length) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-sm text-moss">
        <Check size={14} aria-hidden /> {t("lintAllClear")}
      </p>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-800">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle size={14} aria-hidden /> {t("lintHeading")}
      </p>
      <ul className="mt-1 list-inside list-disc space-y-0.5">
        {findings.map((f, i) => (
          <li key={i}>
            {f.kind === "vague"
              ? t("lintVague", { phrase: f.phrase })
              : f.kind === "exclusionary"
                ? t("lintExclusionary", { phrase: f.phrase })
                : f.kind === "manyMustHaves"
                  ? t("lintManyMustHaves", { count: f.count })
                  : f.what === "salary"
                    ? t("lintMissingSalary")
                    : t("lintMissingPlace")}
          </li>
        ))}
      </ul>
    </div>
  );
}
