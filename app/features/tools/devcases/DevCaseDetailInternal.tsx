"use client";

// "Internal — interviewer & reviewer material" section, split out of
// DevCaseDetail.tsx: covert probes, discrimination banner, rubric chips, role
// must-haves/responsibilities, and the cohort probe-miss roll-up.
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { ProbeStrengthBanner } from "./DevProbeStrengthBanner";
import { CohortProbePanel } from "./DevCohortProbePanel";
import { MiniList, ProbeRow, RubricChip } from "./DevShared";
import type { CaseScenario, RoleSpec, Submission } from "./DevTypes";

export function DevCaseDetailInternal({
  c,
  role,
  caseSubmissions,
}: {
  c: CaseScenario;
  role: RoleSpec | null;
  caseSubmissions: Submission[];
}) {
  const t = useTranslations("devcase.studio.internal");
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
      <h3 className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-amber-700">
        <Lock size={12} /> {t("title")}
      </h3>

      {(c.coverProbes ?? []).length ? (
        <ul className="mt-2 space-y-2">
          {(c.coverProbes ?? []).map((p, i) => (
            <li key={p.id ?? i} className="rounded-md border border-amber-200/70 bg-white/70 p-2.5">
              <ProbeRow probe={p} tone="amber" showDecisionSpace />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-micro text-steel">{t("noProbes")}</p>
      )}

      {/* bb4f5494 — does this case actually discriminate? */}
      <ProbeStrengthBanner probes={c.coverProbes ?? []} />

      {(c.rubricDimensions ?? []).length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(c.rubricDimensions ?? []).map((d) => (
            <RubricChip key={d.name} dim={d} tone="amber" />
          ))}
        </div>
      ) : null}

      {role ? (
        <div className="mt-3 grid gap-3 border-t border-amber-200/60 pt-3 sm:grid-cols-2">
          <MiniList title={t("roleMustHaves")} items={role.mustHaves ?? []} />
          <MiniList title={t("roleResponsibilities")} items={role.responsibilities ?? []} />
        </div>
      ) : null}

      <CohortProbePanel probes={c.coverProbes ?? []} submissions={caseSubmissions} />
    </section>
  );
}
