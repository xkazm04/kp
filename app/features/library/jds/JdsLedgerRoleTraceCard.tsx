"use client";

import { useTranslations } from "next-intl";
import { ROLE_TRACE_SECTIONS, type RoleTrace } from "@/app/_lib/jd-role-trace";

// Read-only "stated vs added" card for the Ledger detail, beside SalaryCard and
// RepoGroundingCard — same question (where did this come from?), same tone. It lists
// ONLY the lines the build supplied that were not found in the author's brief, and says
// how the role was designed. It never touches the published JD body, which carries no
// marks. The raw fallbackReason (exception text) is deliberately not rendered.
export function RoleTraceCard({ trace }: { trace: RoleTrace }) {
  const t = useTranslations("library.tab");
  const sectionLabel = {
    responsibilities: t("roleTraceSectionResponsibilities"),
    mustHaves: t("roleTraceSectionMustHaves"),
    niceToHaves: t("roleTraceSectionNiceToHaves"),
    languages: t("roleTraceSectionLanguages"),
  } as const;
  const added = trace.lines.filter((l) => l.origin === "added");
  return (
    <div className="rounded-lg border border-stone-200 bg-paper/50 p-3">
      <p className="text-meta uppercase tracking-wide text-steel">
        {t("roleTraceTitle")} · {trace.designedBy === "model" ? t("roleTraceModel") : t("roleTraceFallback")}
      </p>
      {added.length ? (
        <>
          <p className="mt-1.5 text-sm text-ink">{t("roleTraceAddedIntro", { count: added.length })}</p>
          {ROLE_TRACE_SECTIONS.map((section) => {
            const items = added.filter((l) => l.section === section);
            if (!items.length) return null;
            return (
              <div key={section} className="mt-2">
                <p className="text-sm font-semibold text-steel">{sectionLabel[section]}</p>
                <ul className="mt-0.5 space-y-0.5">
                  {items.map((l, i) => (
                    <li key={i} className="text-sm text-ink">• {l.text}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      ) : (
        <p className="mt-1.5 text-sm text-steel">{t("roleTraceNoneAdded")}</p>
      )}
    </div>
  );
}
