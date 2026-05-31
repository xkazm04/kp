"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Loader2, Save, Send } from "lucide-react";
import { Markdown } from "@/app/_components/Markdown";
import { buildUrl } from "@/app/features/tabs";

export type JdBuildResult = {
  markdown: string;
  role: Record<string, unknown>;
  salary: { suggestedMinimum: number; suggestedMaximum: number; currency: string; confidence: string; summary: string };
  salarySources?: string[];
  salarySource?: string;
  snapshot?: { ref?: string; inferredStack?: string[]; loc?: number } | null;
};

export function JdBuilderResult({ result, title, company, onSaved }: { result: JdBuildResult; title: string; company?: string; onSaved: () => void }) {
  const router = useRouter();
  const [markdown, setMarkdown] = useState(result.markdown);
  const [view, setView] = useState<"edit" | "preview">("preview");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saved, setSaved] = useState<{ slug: string; jobId: string } | null>(null);
  const [published, setPublished] = useState<{ sourced: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const s = result.salary;
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

  // Publish = go live + source candidates into the pipeline.
  const publish = async () => {
    if (!saved) return;
    setPublishing(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${saved.jobId}/publish`, { method: "POST" });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error ?? "Publish failed.");
      setPublished({ sourced: p.sourced ?? 0 });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="mt-4 border-t border-stone-200 pt-4">
      {/* Web-grounded market salary */}
      <div className="rounded-lg border border-stone-200 bg-paper/50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-meta uppercase tracking-wide text-steel">
            Market salary {result.salarySource === "llm" ? "· web-grounded" : "· estimated"}
          </p>
          <span className="rounded-md bg-white px-2 py-1 text-sm font-semibold text-ink">
            {s.suggestedMinimum.toLocaleString("cs-CZ")} – {s.suggestedMaximum.toLocaleString("cs-CZ")} {s.currency} · {s.confidence}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-ink">{s.summary}</p>
        {result.salarySources?.length ? (
          <p className="mt-1 text-sm text-steel">Sources: {result.salarySources.slice(0, 3).map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noreferrer" className="text-coral hover:underline">[{i + 1}]</a>
          ))}</p>
        ) : null}
        {result.snapshot?.ref ? (
          <p className="mt-1 text-sm text-steel">Analyzed repo: {result.snapshot.ref} · {(result.snapshot.inferredStack ?? []).slice(0, 5).join(", ")}</p>
        ) : null}
      </div>

      {/* Editable output + preview */}
      <div className="mt-3 flex items-center gap-1 border-b border-stone-200">
        {(["preview", "edit"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`focus-ring -mb-px border-b-2 px-3 py-2 text-sm font-semibold capitalize ${view === v ? "border-coral text-coral" : "border-transparent text-steel hover:text-ink"}`}
          >
            {v}
          </button>
        ))}
        <span className="ml-auto text-sm text-steel">Adjust salary, wording, or requirements before saving.</span>
      </div>

      {view === "edit" ? (
        <textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          rows={16}
          className="focus-ring mt-2 w-full rounded-md border border-stone-200 p-3 font-mono text-sm"
        />
      ) : (
        <article className="mt-2 rounded-lg border border-stone-200 bg-white p-4">
          <Markdown content={markdown} />
        </article>
      )}

      {error ? <p className="mt-2 rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}

      {published ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-moss/30 bg-moss/5 px-3 py-2 text-sm text-ink">
          <Check size={16} className="text-moss" />
          Published <span className="font-mono text-coral">{saved?.slug}</span> · sourced {published.sourced} candidate
          {published.sourced === 1 ? "" : "s"} into the Pipeline.
          <button type="button" onClick={() => router.push(buildUrl({ tab: "pipeline" }))} className="focus-ring inline-flex items-center gap-1 font-semibold text-coral hover:underline">
            Open Pipeline <ExternalLink size={13} />
          </button>
        </div>
      ) : saved ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-sm text-steel">
            <span className="rounded-full bg-stone-200 px-1.5 py-0.5 text-micro font-semibold uppercase text-steel">Draft</span>
            Saved as <span className="font-mono text-ink">{saved.slug}</span>
          </span>
          <button
            type="button"
            onClick={publish}
            disabled={publishing}
            data-sim-click="publish"
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {publishing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {publishing ? "Publishing & sourcing…" : "Publish (go live + source)"}
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
