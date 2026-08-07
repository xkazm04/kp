"use client";

// GH2 — GitHub evidence attached at add-to-pipeline (or run on demand from this
// drawer): corroborated vs claimed skills beside the interview outcomes, at the
// surface where advance/reject actually happens. Renders the evidence card when
// present, else (for an inbound applicant who shared only a handle) an on-demand
// deep-dive affordance. Split out of PipelineCandidateDrawer.tsx.

import { ExternalLink, GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";
import type { GithubEvidenceSummary } from "@/app/_lib/github-summary";

export function PipelineGithubEvidenceCard({
  github,
  githubHandle,
  ghBusy,
  ghErr,
  onRunDeepDive,
}: {
  github: GithubEvidenceSummary | null | undefined;
  githubHandle: string | null | undefined;
  ghBusy: boolean;
  ghErr: string | null;
  onRunDeepDive: () => void;
}) {
  const t = useTranslations("pipeline.drawer");
  if (github) {
    return (
      <div className="rounded-md border border-stone-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
            <GitBranch size={13} /> {t("githubEvidence")}
          </p>
          <a
            href={github.profileUrl}
            target="_blank"
            rel="noreferrer"
            className="focus-ring font-mono text-sm text-coral hover:underline"
          >
            @{github.username}
          </a>
        </div>
        {github.summary ? <p className="mt-1 text-sm text-ink">{github.summary}</p> : null}
        {github.confirmedSkills.length ? (
          <p className="mt-1.5 text-sm text-ink">
            <span className="font-semibold text-moss">{t("githubEvidenced")}</span> {github.confirmedSkills.join(", ")}
          </p>
        ) : null}
        {github.unverifiedClaims.length ? (
          <p className="mt-1 text-sm text-ink">
            <span className="font-semibold text-amber-700">{t("githubUnverified")}</span> {github.unverifiedClaims.join(", ")}
          </p>
        ) : null}
        {github.hiddenStrengths.length ? (
          <p className="mt-1 text-sm text-ink">
            <span className="font-semibold text-steel">{t("githubHidden")}</span> {github.hiddenStrengths.join(", ")}
          </p>
        ) : null}
        {github.topRepositories.length ? (
          <p className="mt-1.5 flex flex-wrap gap-2">
            {github.topRepositories.map((r) => (
              <a
                key={r.url}
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="focus-ring inline-flex items-center gap-1 rounded bg-paper px-1.5 py-0.5 font-mono text-sm text-steel hover:text-ink"
              >
                <ExternalLink size={11} aria-hidden /> {r.name}
              </a>
            ))}
          </p>
        ) : null}
        <p className="mt-1.5 text-meta text-steel">{t("githubEvidenceNote")}</p>
      </div>
    );
  }

  // Inbound applicants share only a handle at apply — offer the deep-dive on
  // demand here; a successful run renders as the evidence card above.
  if (!githubHandle) return null;
  return (
    <div className="rounded-md border border-stone-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
          <GitBranch size={13} /> {t("githubEvidence")}
        </p>
        <a
          href={`https://github.com/${githubHandle}`}
          target="_blank"
          rel="noreferrer"
          className="focus-ring font-mono text-sm text-coral hover:underline"
        >
          @{githubHandle}
        </a>
      </div>
      <p className="mt-1 text-sm text-steel">{t("githubRunHelp")}</p>
      <button
        type="button"
        onClick={onRunDeepDive}
        disabled={ghBusy}
        className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
      >
        <GitBranch size={13} className="text-coral" /> {ghBusy ? t("githubRunning") : t("githubRun")}
      </button>
      {ghErr ? <p role="alert" className="mt-1.5 text-sm text-red-700">{ghErr}</p> : null}
    </div>
  );
}
