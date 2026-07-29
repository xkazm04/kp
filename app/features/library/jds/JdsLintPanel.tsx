"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { jdLintMessage, type JdLintFinding } from "@/app/_lib/jd-lint";

// The inclusivity + specificity lint findings panel, extracted so the SAME panel
// renders on every authoring surface — the public-page in-place editor
// (JdActions) and any future builder-side lint. It used to be inline in the
// builder only, so a hand-edited JD shipped with no inclusivity/quality check at all.
// Reads the existing `library.result.lint*` keys.
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
        {findings.map((f, i) => {
          // Route through jdLintMessage so the key/params come from an EXHAUSTIVELY
          // switched mapping — an unhandled kind can no longer fall through to the
          // "missing place" label. bug-ui-scan-2026-07-09 (jd-authoring-library-templates #5)
          const m = jdLintMessage(f);
          return (
            <li key={i}>
              {m.key === "lintVague"
                ? t("lintVague", m.values)
                : m.key === "lintExclusionary"
                  ? t("lintExclusionary", m.values)
                  : m.key === "lintManyMustHaves"
                    ? t("lintManyMustHaves", m.values)
                    : m.key === "lintMissingSalary"
                      ? t("lintMissingSalary")
                      : t("lintMissingPlace")}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
