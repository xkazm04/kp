"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ExternalLink, Loader2, Save, Users } from "lucide-react";
import { Markdown } from "@/app/_components/Markdown";
import { buildUrl } from "@/app/features/tabs";
import { JD_BODY_MAX_LENGTH } from "@/app/_lib/jd-limits";
import { formatSalaryRange } from "@/app/_lib/format";
import { dedupeBy } from "@/app/_lib/dedupe";
import { safeHttpLinks } from "@/app/_lib/safe-url";

// Order = tab order; drives both the role="tablist" render and arrow-key nav.
const VIEWS = ["preview", "edit"] as const;

// Provenance of the market-salary band, as emitted by market_salary_cli: "llm" is a
// web-grounded lookup (live sources cited), "deterministic" is the rules-based
// fallback band. Typed as an explicit union + exhaustive label map so a new source
// kind can't silently collapse into the "estimated" bucket the way the old
// `=== "llm" ? "web-grounded" : "estimated"` two-way did.
export type SalarySource = "llm" | "deterministic";

const SALARY_SOURCE_LABEL: Record<SalarySource, string> = {
  llm: "web-grounded",
  deterministic: "estimated",
};

// Map the provenance flag to its label. An absent source (legacy payloads) reads as
// the conservative "estimated"; an unrecognized source is labeled "unverified" so it
// stays visible instead of masquerading as the deterministic estimate.
function salarySourceLabel(source: string | undefined): string {
  if (source && source in SALARY_SOURCE_LABEL) return SALARY_SOURCE_LABEL[source as SalarySource];
  return source ? "unverified" : "estimated";
}

export type JdBuildResult = {
  markdown: string;
  role: Record<string, unknown>;
  salary: { suggestedMinimum: number; suggestedMaximum: number; currency: string; confidence: string; summary: string };
  salarySources?: string[];
  salarySource?: SalarySource;
  snapshot?: { ref?: string; inferredStack?: string[]; loc?: number } | null;
};

export function JdBuilderResult({ result, title, company, onSaved }: { result: JdBuildResult; title: string; company?: string; onSaved: () => void }) {
  const router = useRouter();
  const [markdown, setMarkdown] = useState(result.markdown);
  const [view, setView] = useState<"edit" | "preview">("preview");
  const [saving, setSaving] = useState(false);
  const [sourcing, setSourcing] = useState(false);
  const [saved, setSaved] = useState<{ slug: string; jobId: string } | null>(null);
  // warning (non-null) = went live but the sourcing step errored — surfaced instead of a
  // misleading "sourced 0" success, which would look like an empty candidate pool.
  const [sourceResult, setSourceResult] = useState<{ sourced: number; warning: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const s = result.salary;
  // salarySources are web-grounded URLs the LLM returns — untrusted at this
  // render boundary. Vet to http(s) only, drop the rest, dedupe by normalized
  // href, and take the first three (mirrors SalaryTab's market-evidence guard).
  const salaryLinks = dedupeBy(safeHttpLinks(result.salarySources ?? []), (link) => link.href).slice(0, 3);

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

  // Save = create a DRAFT JD (no sourcing yet).
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/jds/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body: markdown, role: result.role, salary: result.salary, company }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error ?? "Save failed.");
      setSaved({ slug: p.slug, jobId: p.jobId ?? `jd-${p.slug}` });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
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
      if (!r.ok) throw new Error(p.error ?? "Sourcing failed.");
      setSourceResult({ sourced: p.sourced ?? 0, warning: p.sourcingWarning ?? null });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sourcing failed.");
    } finally {
      setSourcing(false);
    }
  };

  return (
    <div className="mt-4 border-t border-stone-200 pt-4">
      {/* Web-grounded market salary */}
      <div className="rounded-lg border border-stone-200 bg-paper/50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-meta uppercase tracking-wide text-steel">
            Market salary · {salarySourceLabel(result.salarySource)}
          </p>
          <span className="rounded-md bg-white px-2 py-1 text-sm font-semibold text-ink">
            {formatSalaryRange(s.suggestedMinimum, s.suggestedMaximum, { currency: s.currency })} · {s.confidence}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-ink">{s.summary}</p>
        {salaryLinks.length ? (
          <p className="mt-1 text-sm text-steel">Sources: {salaryLinks.map((link, i) => (
            <span key={link.href}>{i > 0 ? " · " : ""}<a href={link.href} target="_blank" rel="noreferrer" className="text-coral hover:underline">{link.hostname}</a></span>
          ))}</p>
        ) : null}
        {result.snapshot?.ref ? (
          <p className="mt-1 text-sm text-steel">Analyzed repo: {result.snapshot.ref} · {(result.snapshot.inferredStack ?? []).slice(0, 5).join(", ")}</p>
        ) : null}
      </div>

      {/* Editable output + preview */}
      <div className="mt-3 flex items-center gap-1 border-b border-stone-200">
        <div role="tablist" aria-label="Job description view" onKeyDown={onViewKeyDown} className="flex items-center gap-1">
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
              {v}
            </button>
          ))}
        </div>
        <span className="ml-auto text-sm text-steel">Adjust salary, wording, or requirements before saving.</span>
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
              onChange={(e) => setMarkdown(e.target.value)}
              maxLength={JD_BODY_MAX_LENGTH}
              rows={16}
              className="focus-ring w-full rounded-md border border-stone-200 p-3 font-mono text-sm"
            />
            <p className={`mt-1 text-sm ${markdown.length >= JD_BODY_MAX_LENGTH * 0.9 ? "text-coral" : "text-steel"}`}>
              {markdown.length.toLocaleString("en-US")} / {JD_BODY_MAX_LENGTH.toLocaleString("en-US")} characters
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
              <span className="font-mono text-coral">{saved?.slug}</span> is live, but sourcing failed: {sourceResult.warning}
            </span>
            <button type="button" onClick={() => router.push(buildUrl({ tab: "pipeline" }))} className="focus-ring inline-flex items-center gap-1 font-semibold text-coral hover:underline">
              Open Pipeline <ExternalLink size={13} />
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-moss/30 bg-moss/5 px-3 py-2 text-sm text-ink">
            <Check size={16} className="text-moss" />
            <span className="font-mono text-coral">{saved?.slug}</span> is live · sourced {sourceResult.sourced} candidate
            {sourceResult.sourced === 1 ? "" : "s"} into the Pipeline.
            <button type="button" onClick={() => router.push(buildUrl({ tab: "pipeline" }))} className="focus-ring inline-flex items-center gap-1 font-semibold text-coral hover:underline">
              Open Pipeline <ExternalLink size={13} />
            </button>
          </div>
        )
      ) : saved ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-sm text-steel">
            <span className="rounded-full bg-stone-200 px-1.5 py-0.5 text-micro font-semibold uppercase text-steel">Draft</span>
            Saved as <span className="font-mono text-ink">{saved.slug}</span>
          </span>
          <button
            type="button"
            onClick={sourceIntoPipeline}
            disabled={sourcing}
            data-sim-click="publish"
            title="Mark this JD live and source matching candidates into the Pipeline"
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {sourcing ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
            {sourcing ? "Sourcing into Pipeline…" : "Source into Pipeline"}
          </button>
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
            {saving ? "Saving draft…" : "Save as draft"}
          </button>
        </div>
      )}
    </div>
  );
}
