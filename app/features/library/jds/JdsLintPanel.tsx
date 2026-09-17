"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { jdLintMessage, lintFindingPhrase, type JdLintFinding } from "@/app/_lib/jd-lint";
import { NOTICE } from "@/app/_components/ui/recipes";

// The inclusivity + specificity lint findings panel, extracted so the SAME panel
// renders on every authoring surface — the public-page in-place editor
// (JdActions) and any future builder-side lint. It used to be inline in the
// builder only, so a hand-edited JD shipped with no inclusivity/quality check at all.
// Reads the existing `library.result.lint*` keys.
export function JdLintPanel({ findings, onLocate }: { findings: JdLintFinding[]; onLocate?: (phrase: string) => void }) {
  const t = useTranslations("library.result");
  if (!findings.length) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-sm text-moss">
        <Check size={14} aria-hidden /> {t("lintAllClear")}
      </p>
    );
  }
  return (
    <div className={`mt-3 ${NOTICE()} px-3 py-2 text-sm`}>
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle size={14} aria-hidden /> {t("lintHeading")}
      </p>
      <ul className="mt-1 list-inside list-disc space-y-0.5">
        {findings.map((f, i) => {
          // Route through jdLintMessage so the key/params come from an EXHAUSTIVELY
          // switched mapping — an unhandled kind can no longer fall through to the
          // "missing place" label. bug-ui-scan-2026-07-09 (jd-authoring-library-templates #5)
          const m = jdLintMessage(f);
          const label =
            m.key === "lintVague"
              ? t("lintVague", m.values)
              : m.key === "lintExclusionary"
                ? t("lintExclusionary", m.values)
                : m.key === "lintManyMustHaves"
                  ? t("lintManyMustHaves", m.values)
                  : m.key === "lintMissingSalary"
                    ? t("lintMissingSalary")
                    : m.key === "lintMissingPlace"
                      ? t("lintMissingPlace")
                      : assertLintMessageHandled(m);
          const phrase = lintFindingPhrase(f);
          return (
            <li key={i}>
              {phrase && onLocate ? (
                <button
                  type="button"
                  className="text-left underline decoration-dotted underline-offset-2 hover:text-coral"
                  onClick={() => onLocate(phrase)}
                >
                  {label}
                </button>
              ) : (
                label
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// The chain above ends on a NAMED key, not on a fall-through. jdLintMessage is
// already exhaustive over JdLintFinding, so a new finding kind is a compile error
// there — but that error is discharged by adding a JdLintMessage member, and the
// ternary below it used to absorb the new key into the "missing place" label and
// ship. A reader whose unrecognized branch DOES something is reached by every
// addition to the contract it reads, and no gate sees it; the last branch must be
// a key this panel actually names, with the residue a compile error here too.
function assertLintMessageHandled(m: never): never {
  throw new Error(`Unhandled JdLintMessage in JdLintPanel: ${JSON.stringify(m)}`);
}
