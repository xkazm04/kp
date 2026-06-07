"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { useLiveRefresh } from "@/app/features/live-refresh";

// Phase 1: authored-JD drafts awaiting sourcing. "Source into Pipeline" marks
// a draft live and pulls matching candidates in (the API route is /publish;
// the DB status it sets is 'published'). Distinct from external "Publish to
// job boards" distribution. See docs/JD_LIFECYCLE.md.
//
// Self-contained: owns its own drafts/sourcing state and live-refreshes itself,
// so JobsTab just drops it in. Renders nothing when there are no drafts.
export function DraftsPanel() {
  const [drafts, setDrafts] = useState<{ id: string; title: string; company: string | null }[]>([]);
  const [sourcingId, setSourcingId] = useState<string | null>(null);
  // tone "warn" = publish succeeded but sourcing errored (or the call failed) — styled
  // distinctly so a broken pipeline isn't mistaken for a clean "sourced 0" result.
  const [draftNote, setDraftNote] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const loadDrafts = () =>
    fetch("/api/jobs/status").then((r) => r.json()).then((p) => setDrafts(p.drafts ?? [])).catch(() => undefined);
  useEffect(() => {
    loadDrafts();
  }, []);
  useLiveRefresh(loadDrafts); // a JD saved elsewhere (e.g. the simulation) shows up here
  const sourceDraft = async (id: string) => {
    setSourcingId(id);
    setDraftNote(null);
    try {
      const r = await fetch(`/api/jobs/${id}/publish`, { method: "POST" });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error ?? "Sourcing failed.");
      if (p.sourcingWarning) {
        // Live, but sourcing broke — show why instead of a misleading "sourced 0".
        setDraftNote({ text: `Published, but sourcing failed: ${p.sourcingWarning}`, tone: "warn" });
      } else {
        setDraftNote({
          text: `Sourced ${p.sourced ?? 0} candidate${p.sourced === 1 ? "" : "s"} into the Pipeline.`,
          tone: "ok",
        });
      }
      loadDrafts();
    } catch (e) {
      setDraftNote({ text: e instanceof Error ? e.message : "Sourcing failed.", tone: "warn" });
    } finally {
      setSourcingId(null);
    }
  };

  if (drafts.length === 0) return null;

  return (
    <div data-sim="job-drafts" className="mt-4 rounded-lg border border-coral/30 bg-coral/5 p-3">
      <p className="text-meta uppercase tracking-wide text-coral">Drafts awaiting sourcing · {drafts.length}</p>
      <ul className="mt-2 space-y-1.5">
        {drafts.map((d) => (
          <li key={d.id} data-sim-entry={d.id} className="flex flex-wrap items-center gap-2 rounded-md bg-white px-3 py-1.5 text-sm">
            <span className="rounded-full bg-stone-200 px-1.5 py-0.5 text-micro font-semibold uppercase text-steel">Draft</span>
            <span className="min-w-0 flex-1 truncate text-ink">
              {d.title}
              {d.company ? <span className="text-steel"> · {d.company}</span> : null}
            </span>
            <button
              type="button"
              data-sim-click="publish"
              onClick={() => sourceDraft(d.id)}
              disabled={sourcingId === d.id}
              title="Mark this JD live and source matching candidates into the Pipeline"
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Users size={13} /> {sourcingId === d.id ? "Sourcing…" : "Source into Pipeline"}
            </button>
          </li>
        ))}
      </ul>
      {draftNote ? (
        <p
          aria-live="polite"
          className={
            draftNote.tone === "warn"
              ? "mt-2 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-sm text-amber-800"
              : "mt-2 text-sm text-steel"
          }
        >
          {draftNote.text}
        </p>
      ) : null}
    </div>
  );
}
