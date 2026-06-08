"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, Plus } from "lucide-react";

// The ingest route's own floor — pasted text shorter than this isn't a job ad.
// Mirrored client-side so an obviously-empty paste is rejected before the spawn.
const MIN_AD_CHARS = 30;

type IngestResult = { jobId: string; created: boolean; title: string };

// "Paste a job ad" → POST /api/jobs/ingest. The parse backend (Claude CLI →
// structured, deduped, matchable Job) was fully built but had no UI caller, so a
// recruiter could only get roles in via the seed corpus or the JD builder — never
// the ad they were handed. Self-contained like DraftsPanel; threads an
// AbortController so navigating away mid-parse SIGKILLs the child (the route
// honors request.signal). On a content-hash hit the route returns created:false,
// surfaced as "already in the catalog" rather than a phantom second add.
export function IngestAdPanel({ onIngested }: { onIngested?: (result: IngestResult) => void }) {
  const [open, setOpen] = useState(false);
  const [adText, setAdText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort an in-flight parse if the panel unmounts (tab switch) — otherwise the
  // fetch + its Claude CLI child outlive a result nobody will read.
  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = async () => {
    const text = adText.trim();
    if (text.length < MIN_AD_CHARS) {
      setError(`Paste the full job ad — at least ~${MIN_AD_CHARS} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/jobs/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adText: text }),
        signal: controller.signal,
      });
      const data = (await res.json()) as { jobId?: string; created?: boolean; title?: string; error?: string };
      if (!res.ok || !data.jobId) throw new Error(data.error ?? `Ingest failed (${res.status}).`);
      const result: IngestResult = { jobId: data.jobId, created: Boolean(data.created), title: data.title ?? "Role" };
      setNote(
        result.created
          ? `Added “${result.title}” to the catalog.`
          : `“${result.title}” is already in the catalog — opened the existing role.`
      );
      setAdText("");
      onIngested?.(result);
    } catch (caught) {
      if (controller.signal.aborted) return; // intentional teardown, not a failure
      setError(caught instanceof Error ? caught.message : "Ingest failed.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      abortRef.current = null;
    }
  };

  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-base font-semibold text-ink hover:border-coral/40"
        >
          <ClipboardPaste size={15} className="text-coral" /> Paste a job ad
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-coral/30 bg-coral/5 p-3">
      <label htmlFor="ingest-ad" className="text-meta uppercase tracking-wide text-coral">
        Paste a job ad
      </label>
      <p className="mt-1 text-sm text-steel">
        Drop in the full prose ad — it&apos;s parsed into a structured, matchable role (must / nice-to-have
        requirements, seniority, the graduate lens) and added to the corpus. Duplicates are detected automatically.
      </p>
      <textarea
        id="ingest-ad"
        value={adText}
        onChange={(e) => setAdText(e.target.value)}
        rows={6}
        disabled={busy}
        placeholder="Paste the job ad text here…"
        className="focus-ring mt-2 w-full rounded-md border border-stone-200 bg-white p-2 text-sm text-ink disabled:opacity-60"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || adText.trim().length < MIN_AD_CHARS}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          <Plus size={14} /> {busy ? "Parsing the ad…" : "Add to catalog"}
        </button>
        <button
          type="button"
          onClick={() => {
            abortRef.current?.abort();
            setOpen(false);
            setAdText("");
            setError(null);
            setNote(null);
          }}
          disabled={busy}
          className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
        >
          Cancel
        </button>
        <span className="text-meta text-steel">Parsing runs the Claude CLI locally — it can take a moment.</span>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
      {note ? <p aria-live="polite" className="mt-2 text-sm text-steel">{note}</p> : null}
    </div>
  );
}
