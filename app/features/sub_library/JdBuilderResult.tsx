"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Check, ExternalLink, Loader2, Lock, RefreshCw, Save, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/app/_components/Markdown";
import { buildUrl } from "@/app/features/tabs";
import { JD_BODY_MAX_LENGTH, jdJobId } from "@/app/_lib/jd-limits";
import { formatSalaryRange } from "@/app/_lib/format";
import { normalizeMarketSalary, type MarketSalary } from "@/app/_lib/salary-band";
import { dedupeBy } from "@/app/_lib/dedupe";
import { safeHttpLinks } from "@/app/_lib/safe-url";
import { lintJd } from "@/app/_lib/jd-lint";
import { JdLintPanel } from "./JdLintPanel";

// Order = tab order; drives both the role="tablist" render and arrow-key nav.
const VIEWS = ["preview", "edit"] as const;

// Provenance of the market-salary band, as emitted by market_salary_cli: "llm" is a
// web-grounded lookup (live sources cited), "deterministic" is the rules-based
// fallback band. Typed as an explicit union + exhaustive label map so a new source
// kind can't silently collapse into the "estimated" bucket the way the old
// `=== "llm" ? "web-grounded" : "estimated"` two-way did.
export type SalarySource = "llm" | "deterministic";

type SalarySourceKey = "sourceWebGrounded" | "sourceEstimated" | "sourceUnverified";

const SALARY_SOURCE_KEY: Record<SalarySource, SalarySourceKey> = {
  llm: "sourceWebGrounded",
  deterministic: "sourceEstimated",
};

// Map the provenance flag to a catalog key (resolved via t() at the render site —
// this is module-level, so it can't call the hook itself). An absent source (legacy
// payloads) reads as the conservative "estimated"; an unrecognized source is labeled
// "unverified" so it stays visible instead of masquerading as the deterministic estimate.
function salarySourceKey(source: string | undefined): SalarySourceKey {
  if (source && source in SALARY_SOURCE_KEY) return SALARY_SOURCE_KEY[source as SalarySource];
  return source ? "sourceUnverified" : "sourceEstimated";
}

export type JdBuildResult = {
  markdown: string;
  role: Record<string, unknown>;
  // The grounded band, canonically shaped + trust-boundary normalized in
  // salary-band. Typed loosely (the producing field may be absent on a legacy /
  // malformed task result) and re-normalized at render below.
  salary: MarketSalary;
  salarySources?: string[];
  salarySource?: SalarySource;
  snapshot?: { ref?: string; inferredStack?: string[]; loc?: number } | null;
};

export function JdBuilderResult({
  result,
  title,
  company,
  onSaved,
  onEditedChange,
}: {
  result: JdBuildResult;
  title: string;
  company?: string;
  onSaved: () => void;
  // Reports whether the body has been hand-edited away from the template render.
  // The parent (JdBuilder) uses this to warn before a template switch — which
  // remounts this component and reformats the body — would discard those edits.
  // See the template-switch contract in JdBuilder.tsx / docs/JD_LIFECYCLE.md.
  onEditedChange?: (edited: boolean) => void;
}) {
  const t = useTranslations("library.result");
  const router = useRouter();
  const search = useSearchParams();
  const [markdown, setMarkdown] = useState(result.markdown);
  // True once the user types in the Edit tab. Resets to false on remount (this
  // component is keyed by templateId), so it tracks edits relative to the
  // *current* template render rather than the original generation.
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    onEditedChange?.(edited);
  }, [edited, onEditedChange]);
  // Re-seed the editor when the parent recomputes the body. Fixing the Role title / Company
  // after generation flows into result.markdown (a useMemo on title/company), but this
  // component is keyed only by templateId so it never remounts — without this the preview/edit
  // textarea and save() body keep the pre-correction title/company. Skip when the user has
  // hand-edited, so a genuine edit isn't clobbered. Done DURING render (tracking the last-seeded
  // value) — the React "adjust state when a prop changes" pattern — so it stays an in-render
  // sync rather than a setState-in-effect.
  const [seededMarkdown, setSeededMarkdown] = useState(result.markdown);
  if (result.markdown !== seededMarkdown) {
    setSeededMarkdown(result.markdown);
    if (!edited) setMarkdown(result.markdown);
  }
  const [view, setView] = useState<"edit" | "preview">("preview");
  const [saving, setSaving] = useState(false);
  const [sourcing, setSourcing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // jobIngested mirrors the save-vs-ingest contract (docs/JD_LIFECYCLE.md): the
  // draft is saved, but the best-effort structured-Job ingest may NOT have run.
  // When false the matchable jd-<slug> Job row doesn't exist, so "Source into
  // Pipeline" can't run — we disable it and offer a retry instead of a dead-end click.
  const [saved, setSaved] = useState<{ slug: string; jobId: string; jobIngested: boolean } | null>(null);
  // warning (non-null) = went live but the sourcing step errored — surfaced instead of a
  // misleading "sourced 0" success, which would look like an empty candidate pool.
  const [sourceResult, setSourceResult] = useState<{ sourced: number; warning: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-normalize at the render boundary (not just server-side in runMarketSalary):
  // `result` is cast from an untrusted task payload that may predate that
  // normalization or arrive partial, and an unguarded `s.suggestedMaximum` here
  // would white-screen the whole result panel AFTER the 1–2 minute build. The
  // normalizer is pure + idempotent, so re-running it costs nothing and turns a
  // missing/garbage band into a graceful `available: false` fallback below.
  const s = normalizeMarketSalary(result.salary);
  // salarySources are web-grounded URLs the LLM returns — untrusted at this
  // render boundary. Vet to http(s) only, drop the rest, dedupe by normalized
  // href, and take the first three (mirrors SalaryTab's market-evidence guard).
  const salaryLinks = dedupeBy(safeHttpLinks(result.salarySources ?? []), (link) => link.href).slice(0, 3);

  // E7 — live specificity lint over the EDITABLE body (re-runs as the recruiter
  // types; pure rules, so it's free). salaryAvailable: a known structured band
  // means the published artifacts carry a figure even before the prose does.
  const lintFindings = useMemo(() => lintJd({ body: markdown, salaryAvailable: s.available }), [markdown, s.available]);

  // Roving-tabindex arrow navigation across the preview/edit tabs (WAI-ARIA
  // tabs pattern), mirroring ResultPanel's onTabKeyDown.
  const onViewKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = VIEWS.indexOf(view);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % VIEWS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + VIEWS.length) % VIEWS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = VIEWS.length - 1;
    else return;
    e.preventDefault();
    setView(VIEWS[next]);
    document.getElementById(`jdview-tab-${VIEWS[next]}`)?.focus();
  };

  // The shared POST /api/jds/save call: same body for the initial save and the
  // in-place re-ingest retry, differing only by whether a slug is sent (present =
  // re-ingest the existing draft, absent = create a new one). Each caller keeps its
  // own response parsing / error message / state transition.
  const postSave = (slug?: string) =>
    fetch("/api/jds/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(slug ? { slug } : {}), title, body: markdown, role: result.role, salary: result.salary, company }),
    });

  // Save = create a DRAFT JD (no sourcing yet).
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await postSave();
      const p = await r.json();
      if (!r.ok) throw new Error(p.error ?? t("saveFailed"));
      setSaved({ slug: p.slug, jobId: p.jobId ?? jdJobId(p.slug), jobIngested: Boolean(p.jobIngested) });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // Retry the best-effort job ingestion that failed during save. The draft JD
  // already exists, so we re-POST with its slug to re-ingest in place (no
  // duplicate draft). On success the matchable jd-<slug> Job row now exists and
  // "Source into Pipeline" unblocks. See the save-vs-ingest contract in
  // docs/JD_LIFECYCLE.md.
  const retryIngest = async () => {
    if (!saved) return;
    setRetrying(true);
    setError(null);
    try {
      const r = await postSave(saved.slug);
      const p = await r.json();
      if (!r.ok) throw new Error(p.error ?? t("retryFailed"));
      if (!p.jobIngested) throw new Error(t("ingestFailedAgain"));
      setSaved({ slug: p.slug, jobId: p.jobId ?? jdJobId(p.slug), jobIngested: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("retryFailed"));
    } finally {
      setRetrying(false);
    }
  };

  // "Source into Pipeline" = mark the saved draft live and source matching
  // candidates into the Pipeline. This is the internal go-live action, NOT the
  // external "Publish to job boards" distribution (the disabled button on the
  // public /jds/[slug] page). The API route is still named /publish and the DB
  // status it flips to is 'published'. See docs/JD_LIFECYCLE.md.
  const sourceIntoPipeline = async () => {
    if (!saved) return;
    setSourcing(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${saved.jobId}/publish`, { method: "POST" });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error ?? t("sourcingFailed"));
      setSourceResult({ sourced: p.sourced ?? 0, warning: p.sourcingWarning ?? null });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sourcingFailed"));
    } finally {
      setSourcing(false);
    }
  };

  return (
    <div className="mt-4 border-t border-stone-200 pt-4">
      {/* Web-grounded market salary. The band is FIXED here — it carries the
          analysis's provenance/confidence/sources and is the band the Pipeline
          matches against (see ingestStructuredJob). It is intentionally not
          editable: a hand-typed override couldn't honestly wear the
          "web-grounded · high confidence" label. The note below tells the user
          that editing the salary in the markdown changes the published wording
          only, not this matchable band — so the copy never promises an edit the
          save path silently discards. */}
      <div className="rounded-lg border border-stone-200 bg-paper/50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-meta uppercase tracking-wide text-steel">
            {/* Drop the provenance suffix when there's no band — "· estimated"
                next to "Salary unavailable" reads as a contradiction. */}
            {s.available
              ? t("marketSalaryWithSource", { source: t(salarySourceKey(result.salarySource)) })
              : t("marketSalary")}
          </p>
          {s.available ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-sm font-semibold text-ink" title={t("fixedTitle")}>
              <Lock size={12} className="text-steel" aria-hidden />
              {formatSalaryRange(s.suggestedMinimum, s.suggestedMaximum, { currency: s.currency })} · {s.confidence}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-sm font-semibold text-steel" title={t("noBandTitle")}>
              <AlertTriangle size={12} className="text-amber-500" aria-hidden />
              {t("salaryUnavailable")}
            </span>
          )}
        </div>
        {s.summary ? <p className="mt-1.5 text-sm text-ink">{s.summary}</p> : null}
        {salaryLinks.length ? (
          <p className="mt-1 text-sm text-steel">{t("sources")}{salaryLinks.map((link, i) => (
            <span key={link.href}>{i > 0 ? " · " : ""}<a href={link.href} target="_blank" rel="noreferrer" className="text-coral hover:underline">{link.hostname}</a></span>
          ))}</p>
        ) : null}
        {result.snapshot?.ref ? (
          <p className="mt-1 text-sm text-steel">{t("analyzedRepo", { ref: result.snapshot.ref, stack: (result.snapshot.inferredStack ?? []).slice(0, 5).join(", ") })}</p>
        ) : null}
        <p className="mt-2 border-t border-stone-200 pt-2 text-sm text-steel">
          {s.available ? t("bandFixedNote") : t("noBandNote")}
        </p>
      </div>

      {/* E7 — specificity lint: boilerplate to replace + missing concretes (pay,
          place). Live against the editable body, so a fix clears its finding
          immediately; an all-clear is shown (not silence) so the recruiter knows
          the check ran. */}
      <JdLintPanel findings={lintFindings} />

      {/* Editable output + preview */}
      <div className="mt-3 flex items-center gap-1 border-b border-stone-200">
        <div role="tablist" aria-label={t("viewTablistAria")} onKeyDown={onViewKeyDown} className="flex items-center gap-1">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              id={`jdview-tab-${v}`}
              aria-selected={view === v}
              aria-controls={`jdview-panel-${v}`}
              tabIndex={view === v ? 0 : -1}
              onClick={() => setView(v)}
              className={`focus-ring -mb-px border-b-2 px-3 py-2 text-sm font-semibold capitalize ${view === v ? "border-coral text-coral" : "border-transparent text-steel hover:text-ink"}`}
            >
              {t(v === "preview" ? "viewPreview" : "viewEdit")}
            </button>
          ))}
        </div>
        <span className="ml-auto text-sm text-steel">{t("editHint")}</span>
      </div>

      <div
        role="tabpanel"
        id={`jdview-panel-${view}`}
        aria-labelledby={`jdview-tab-${view}`}
        tabIndex={0}
        className="focus-ring mt-2 rounded-md"
      >
        {view === "edit" ? (
          <>
            <textarea
              value={markdown}
              onChange={(e) => {
                setMarkdown(e.target.value);
                if (!edited) setEdited(true);
              }}
              maxLength={JD_BODY_MAX_LENGTH}
              rows={16}
              className="focus-ring w-full rounded-md border border-stone-200 p-3 font-mono text-sm"
            />
            <p className={`mt-1 text-sm ${markdown.length >= JD_BODY_MAX_LENGTH * 0.9 ? "text-coral" : "text-steel"}`}>
              {t("charCount", { used: markdown.length, max: JD_BODY_MAX_LENGTH })}
            </p>
          </>
        ) : (
          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <Markdown content={markdown} />
          </article>
        )}
      </div>

      {error ? <p role="alert" className="mt-2 rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}

      {sourceResult ? (
        sourceResult.warning ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle size={16} className="shrink-0" />
            <span>
              {t.rich("liveButSourcingFailed", {
                slug: saved?.slug ?? "",
                warning: sourceResult.warning,
                mono: (chunks) => <span className="font-mono text-coral">{chunks}</span>,
              })}
            </span>
            <button type="button" onClick={() => router.push(buildUrl({ tab: "pipeline" }, search.toString()))} className="focus-ring inline-flex items-center gap-1 font-semibold text-coral hover:underline">
              {t("openPipeline")} <ExternalLink size={13} />
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-moss/30 bg-moss/5 px-3 py-2 text-sm text-ink">
            <Check size={16} className="text-moss" />
            <span>
              {t.rich("liveSourced", {
                count: sourceResult.sourced,
                slug: saved?.slug ?? "",
                mono: (chunks) => <span className="font-mono text-coral">{chunks}</span>,
              })}
            </span>
            <button type="button" onClick={() => router.push(buildUrl({ tab: "pipeline" }, search.toString()))} className="focus-ring inline-flex items-center gap-1 font-semibold text-coral hover:underline">
              {t("openPipeline")} <ExternalLink size={13} />
            </button>
          </div>
        )
      ) : saved ? (
        <div className="mt-3 space-y-3">
          {/* Ingestion failed during save: the draft is saved but the matchable
              jd-<slug> Job row was never created, so "Source into Pipeline" below
              would dead-end (POST /publish → 404). Surface that at the moment it
              happens and offer a retry instead of a confusing dead-end click. */}
          {!saved.jobIngested ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle size={16} className="shrink-0" />
              <span>
                {t.rich("savedDraftIngestFailed", {
                  slug: saved.slug,
                  mono: (chunks) => <span className="font-mono">{chunks}</span>,
                })}
              </span>
              <button
                type="button"
                onClick={retryIngest}
                disabled={retrying}
                className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
              >
                {retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {retrying ? t("retrying") : t("retry")}
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-sm text-steel">
              <span className="rounded-full bg-stone-200 px-1.5 py-0.5 text-micro font-semibold uppercase text-steel">{t("draftBadge")}</span>
              {t.rich("savedAs", { slug: saved.slug, mono: (chunks) => <span className="font-mono text-ink">{chunks}</span> })}
            </span>
            <button
              type="button"
              onClick={sourceIntoPipeline}
              disabled={sourcing || !saved.jobIngested}
              data-sim-click="publish"
              title={saved.jobIngested ? t("sourceTitleLive") : t("sourceTitleBlocked")}
              className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {sourcing ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
              {sourcing ? t("sourcingIntoPipeline") : t("sourceIntoPipeline")}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? t("savingDraft") : t("saveAsDraft")}
          </button>
        </div>
      )}
    </div>
  );
}
