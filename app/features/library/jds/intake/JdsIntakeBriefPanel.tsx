"use client";

import { useTranslations } from "next-intl";
import { CHIP_QUIET, META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import type { RoleBrief } from "@/app/_lib/rolespec";

// The live brief — the surface's signature moment: the requestor WATCHES the
// structure being built while they talk. Every value carries its provenance
// (stated = their words · inferred = the agent's reading · default = template)
// so a proposal can never masquerade as something they said.

function ProvenanceChip({ provenance }: { provenance?: string }) {
  const t = useTranslations("library.tab.intake.provenance");
  if (provenance === "stated") return <span className={`${CHIP_QUIET} text-moss`}>{t("stated")}</span>;
  if (provenance === "inferred") return <span className={`${CHIP_QUIET} text-coral`}>{t("inferred")}</span>;
  return <span className={CHIP_QUIET}>{t("default")}</span>;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={META_LABEL}>{label}</div>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </div>
  );
}

export function JdsIntakeBriefPanel({ brief }: { brief: RoleBrief | null }) {
  const t = useTranslations("library.tab.intake.brief");
  const musts = (brief?.requirements ?? []).filter((r) => r.kind === "must_have");
  const nices = (brief?.requirements ?? []).filter((r) => r.kind === "nice_to_have");
  const empty =
    !brief ||
    (!brief.title && musts.length === 0 && nices.length === 0 && (brief.successCriteria ?? []).length === 0 && (brief.facets ?? []).length === 0);

  return (
    <div className={`${PANEL_SUNKEN} h-full space-y-5 p-4`}>
      <div className={META_LABEL}>{t("title")}</div>
      {empty ? (
        <p className="text-body text-steel">{t("empty")}</p>
      ) : (
        <>
          <Section label={t("role")}>
            <div className="flex flex-wrap items-center gap-2 text-body text-ink">
              <span>{brief?.title || "—"}</span>
              {brief?.seniority ? (
                <>
                  <span className={CHIP_QUIET}>{brief.seniority}</span>
                  {/* Spine provenance (UAT L1-CONV-3): a defaulted seniority must
                      read as "assumed", never as captured. Missing key = default. */}
                  <ProvenanceChip provenance={brief?.spineProvenance?.seniority ?? "default"} />
                </>
              ) : null}
            </div>
          </Section>
          {(brief?.successCriteria ?? []).length > 0 ? (
            <Section label={t("outcomes")}>
              {(brief?.successCriteria ?? []).map((s, i) => (
                <div key={i} className="text-body text-ink">
                  {s}
                </div>
              ))}
            </Section>
          ) : null}
          {musts.length > 0 ? (
            <Section label={t("dealbreakers")}>
              {musts.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-body text-ink">
                  <span>{r.skill}</span>
                  {r.hardness === "learnable" ? <span className={CHIP_QUIET}>{t("learnable")}</span> : null}
                  <ProvenanceChip provenance={r.provenance} />
                </div>
              ))}
            </Section>
          ) : null}
          {nices.length > 0 ? (
            <Section label={t("niceToHave")}>
              {nices.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-body text-ink">
                  <span>{r.skill}</span>
                  <ProvenanceChip provenance={r.provenance} />
                </div>
              ))}
            </Section>
          ) : null}
          {(brief?.languages ?? []).length > 0 ? (
            <Section label={t("languages")}>
              <div className="text-body text-ink">{(brief?.languages ?? []).join(", ")}</div>
            </Section>
          ) : null}
          {(brief?.facets ?? []).length > 0 ? (
            <Section label={t("context")}>
              {(brief?.facets ?? []).map((f, i) => (
                <div key={i} className="text-body text-ink">
                  <span className="text-steel">{f.label || f.key}:</span> {f.value} <ProvenanceChip provenance={f.provenance} />
                </div>
              ))}
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}
