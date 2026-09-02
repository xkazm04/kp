"use client";

import { AlertTriangle, GitBranch, Loader2, Lock, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { normalizeMarketSalary } from "@/app/_lib/salary-band";
import { safeHttpLinks } from "@/app/_lib/safe-url";
import { dedupeBy } from "@/app/_lib/dedupe";
import { CHIP, CHIP_QUIET } from "@/app/_components/ui/recipes";
import { caseTaskLabel, type CaseArtifact, type SnapshotArtifact } from "./jdsLedgerArtifacts";

// In-progress placeholder shown in the detail while the detached build runs.
// Extracted verbatim from LibrarySavedJdsLedger.tsx so that file stays under the
// 200-line split threshold.
export function BuildingPanel() {
  const t = useTranslations("library.tab");
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-12 text-center">
      <Loader2 size={28} className="animate-spin text-blue-700" aria-hidden />
      <p className="text-sm font-semibold text-ink">{t("buildingTitle")}</p>
      <p className="max-w-sm text-sm text-steel">{t("buildingBody")}</p>
    </div>
  );
}

// Failed build — the error plus a one-click retry (replays the original inputs).
export function FailedPanel({ error, retrying, retryError, onRetry }: { error: string | null; retrying: boolean; retryError: string | null; onRetry: () => void }) {
  const t = useTranslations("library.tab");
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/60 p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-red-700">
        <AlertTriangle size={16} aria-hidden /> {t("buildFailedTitle")}
      </p>
      {error ? <p className="mt-2 break-words text-sm text-red-700/90">{error}</p> : null}
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="focus-ring mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
      >
        {retrying ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />}
        {t("retryBuild")}
      </button>
      {retryError ? <p className="mt-2 text-sm text-red-700">{retryError}</p> : null}
    </div>
  );
}

// Read-only market-salary card (the band is AI-fixed; editing lives on the public
// page) — the recruiter-facing surface for the grounded band + its cited sources.
export function SalaryCard({ salary, sources, source }: { salary: unknown; sources?: string[]; source?: string }) {
  const t = useTranslations("library.tab");
  // Reader-locale digit grouping (format.ts number-locale contract).
  const n = useNumberFormat();
  const s = normalizeMarketSalary(salary);
  const links = dedupeBy(safeHttpLinks(sources ?? []), (l) => l.href).slice(0, 3);
  const provenance = source === "llm" ? t("provWebGrounded") : source === "deterministic" ? t("provEstimated") : source ?? t("provEstimated");
  return (
    <div className="rounded-lg border border-stone-200 bg-paper/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta uppercase tracking-wide text-steel">{t("marketSalary")} · {provenance}</p>
        {s.available ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-sm font-semibold text-ink">
            <Lock size={12} className="text-steel" aria-hidden />
            {n.salaryRange(s.suggestedMinimum, s.suggestedMaximum, { currency: s.currency })} · {s.confidence}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-sm font-semibold text-steel">
            <AlertTriangle size={12} className="text-amber-500" aria-hidden /> {t("salaryUnavailable")}
          </span>
        )}
      </div>
      {s.summary ? <p className="mt-1.5 text-sm text-ink">{s.summary}</p> : null}
      {links.length ? (
        <p className="mt-1 text-sm text-steel">
          {t("sourcesLabel")}{" "}
          {links.map((l, i) => (
            <span key={l.href}>
              {i > 0 ? " · " : ""}
              <a href={l.href} target="_blank" rel="noreferrer" className="text-coral hover:underline">{l.hostname}</a>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

// The interview case (shown when "Case analysis" was ticked) — read-only overview.
// The repo the build actually READ, when the recruiter supplied one. runJdBuild has
// persisted this snapshot into analysis_json since repo grounding shipped and nothing
// ever rendered it, so a JD grounded in a real codebase looked exactly like one
// written from a paragraph of prose — the recruiter had no way to tell whether the
// must-haves came from the code or from the model's prior. Same read-only card shape
// as SalaryCard, because it answers the same kind of question: where did this come
// from?
export function RepoGroundingCard({ snapshot }: { snapshot: SnapshotArtifact }) {
  const t = useTranslations("library.tab");
  const n = useNumberFormat();
  // The ref is operator-supplied and rides through a Python child — link it only when
  // it is a safe http(s) URL, exactly like the salary sources above; otherwise it is
  // shown as plain text.
  const link = safeHttpLinks([snapshot.ref ?? ""])[0];
  // Deduped across the two lists: a scan routinely reports "typescript" as both a
  // detected language and an inferred stack entry, and two identical chips read as a
  // rendering bug rather than as agreement.
  const tags = dedupeBy(
    [...(snapshot.languages ?? []), ...(snapshot.inferredStack ?? [])].filter(Boolean),
    (tag) => tag.toLowerCase(),
  ).slice(0, 6);
  return (
    <div className="rounded-lg border border-stone-200 bg-paper/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta uppercase tracking-wide text-steel">{t("repoGrounding")}</p>
        {snapshot.ref ? (
          <span className={CHIP}>
            <GitBranch size={12} className="text-steel" aria-hidden />
            {link ? (
              <a href={link.href} target="_blank" rel="noreferrer" className="text-coral hover:underline">
                {snapshot.ref}
              </a>
            ) : (
              snapshot.ref
            )}
          </span>
        ) : null}
      </div>
      {tags.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className={CHIP_QUIET}>{tag}</span>
          ))}
        </div>
      ) : null}
      {typeof snapshot.loc === "number" && snapshot.loc > 0 ? (
        // Reader-locale digit grouping (format.ts number-locale contract).
        <p className="mt-2 text-sm text-steel">{t("repoLoc", { loc: n.grouped(snapshot.loc) })}</p>
      ) : null}
    </div>
  );
}

export function CaseCard({ kase }: { kase: CaseArtifact }) {
  const t = useTranslations("library.tab");
  const tasks = Array.isArray(kase.tasks) ? kase.tasks : [];
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <p className="text-meta uppercase tracking-wide text-coral">{t("interviewCase")}</p>
      {kase.title ? <h3 className="mt-1 font-serif text-h3 font-semibold text-ink">{kase.title}</h3> : null}
      {kase.brief ? <p className="mt-2 whitespace-pre-line text-sm text-steel">{kase.brief}</p> : null}
      {tasks.length ? (
        <ul className="mt-3 space-y-1">
          {tasks.map((task, i) => (
            <li key={i} className="text-sm text-ink">• {caseTaskLabel(task)}</li>
          ))}
        </ul>
      ) : null}
      {typeof kase.timeboxHours === "number" ? <p className="mt-2 text-sm text-steel">{t("timebox", { hours: kase.timeboxHours })}</p> : null}
    </div>
  );
}
