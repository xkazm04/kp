"use client";

// W5-4 (DEVP1) — the review drawer behind the human approval gate, split out of
// DevLifecycleRow.tsx. Everything here was already persisted on the lifecycle
// record and served by the GET; the UI just dropped it, so a recruiter signed
// off on an assignment they couldn't see. Shows the flagging analysis, the
// candidate-safe preview (live against the edits), and the INTERNAL probe panel;
// allows bounded edits (title/brief/tasks/timebox — probes and rubric stay
// engine-owned, change those via Regenerate); "Regenerate with note" re-runs
// ONLY the design step with the reviewer's feedback instead of a full lifecycle
// re-run from intake.
import { useState } from "react";
import { Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { Markdown } from "@/app/_components/Markdown";
import { caseToMarkdown } from "./DevHelpers";
import { ProbeRow } from "./DevShared";
import { ProbeStrengthBanner } from "./DevProbeStrengthBanner";
import type { CaseScenario, Lifecycle } from "./DevTypes";

export function DevLifecycleReviewPanel({ lc, onApprove, onChanged }: { lc: Lifecycle; onApprove: () => void; onChanged?: () => void }) {
  const kase: CaseScenario = lc.case ?? {};
  const [title, setTitle] = useState(kase.title ?? "");
  const [brief, setBrief] = useState(kase.brief ?? "");
  const [tasksText, setTasksText] = useState((kase.tasks ?? []).join("\n"));
  const [timebox, setTimebox] = useState(kase.timeboxHours != null ? String(kase.timeboxHours) : "");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"approve" | "redesign" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editedTasks = tasksText.split("\n").map((t) => t.trim()).filter(Boolean);
  const timeboxNum = Number(timebox);
  const edits: Record<string, unknown> = {};
  if (title.trim() && title.trim() !== (kase.title ?? "")) edits.title = title.trim();
  if (brief.trim() && brief.trim() !== (kase.brief ?? "")) edits.brief = brief.trim();
  if (editedTasks.join("\n") !== (kase.tasks ?? []).join("\n") && editedTasks.length > 0) edits.tasks = editedTasks;
  if (timebox.trim() && Number.isFinite(timeboxNum) && timeboxNum > 0 && timeboxNum !== kase.timeboxHours) edits.timeboxHours = timeboxNum;
  const hasEdits = Object.keys(edits).length > 0;

  // Live candidate-safe preview: what the candidate would actually receive,
  // including the reviewer's in-flight edits. caseToMarkdown excludes probes
  // by construction.
  const preview = caseToMarkdown(
    { ...kase, title: title.trim() || kase.title, brief: brief.trim() || kase.brief, tasks: editedTasks.length ? editedTasks : kase.tasks, timeboxHours: Number.isFinite(timeboxNum) && timeboxNum > 0 ? timeboxNum : kase.timeboxHours },
    lc.role ?? null
  );

  const approve = async () => {
    if (busy) return;
    setBusy("approve");
    setError(null);
    try {
      if (hasEdits) {
        const r = await fetch(`/api/devcase/lifecycle/${encodeURIComponent(lc.id)}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ case: edits }),
        });
        const payload = (await r.json().catch(() => null)) as { error?: string } | null;
        if (!r.ok) throw new Error(payload?.error ?? "Approve failed.");
        onChanged?.();
      } else {
        // No edits — the parent's existing approve flow (POST + reload).
        onApprove();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Approve failed.");
    } finally {
      setBusy(null);
    }
  };

  const redesign = async () => {
    if (busy || !feedback.trim()) return;
    setBusy("redesign");
    setError(null);
    try {
      const r = await fetch(`/api/devcase/lifecycle/${encodeURIComponent(lc.id)}/redesign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: feedback.trim() }),
      });
      const payload = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(payload?.error ?? "Redesign failed.");
      onChanged?.(); // reload brings the revised case; key= reseeds the fields
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Redesign failed.");
    } finally {
      setBusy(null);
    }
  };

  const gaps = lc.analysis?.statedVsRealGaps ?? [];
  const risks = lc.analysis?.riskAreas ?? [];
  const confidence = lc.analysis?.confidence;
  const probes = kase.coverProbes ?? [];
  const inputClass = "focus-ring mt-0.5 w-full rounded border border-stone-200 bg-white px-2 py-1 text-micro text-ink caret-coral placeholder:text-steel";

  return (
    <div className="mt-2 space-y-2 border-t border-stone-100 pt-2">
      {gaps.length > 0 || risks.length > 0 || confidence != null ? (
        <div className="rounded bg-amber-50 p-2 text-micro text-amber-900">
          <p className="font-semibold uppercase tracking-wide">
            Why this was flagged{confidence != null ? ` · confidence ${Math.round(confidence * 100)}%` : ""}
          </p>
          {[...gaps, ...risks].map((g) => (
            <p key={g} className="mt-0.5">• {g}</p>
          ))}
        </div>
      ) : null}

      <div className="grid gap-2 lg:grid-cols-2">
        <div className="space-y-1.5">
          <label className="block text-micro font-semibold text-steel">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-micro font-semibold text-steel">
            Brief
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} className={inputClass} />
          </label>
          <label className="block text-micro font-semibold text-steel">
            Tasks (one per line)
            <textarea value={tasksText} onChange={(e) => setTasksText(e.target.value)} rows={4} className={inputClass} />
          </label>
          <label className="block text-micro font-semibold text-steel">
            Timebox (hours)
            <input value={timebox} onChange={(e) => setTimebox(e.target.value)} inputMode="numeric" className={inputClass} />
          </label>
          {probes.length > 0 ? (
            <div className="rounded border border-stone-200 bg-paper/50 p-2">
              <p className="flex items-center gap-1 text-micro font-semibold uppercase tracking-wide text-steel">
                <Lock size={10} aria-hidden /> Internal — cover probes ({probes.length})
              </p>
              <ul className="mt-1 space-y-1 text-micro text-ink">
                {probes.map((p, i) => (
                  <li key={p.id ?? i}>
                    <ProbeRow probe={p} tone="stone" />
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-micro text-steel">Probes and rubric are engine-owned — to change them, regenerate with a note.</p>
              {/* bb4f5494 — certify the probes discriminate BEFORE approving. */}
              <ProbeStrengthBanner probes={probes} />
            </div>
          ) : null}
        </div>
        <div className="rounded border border-stone-200 bg-white p-2">
          <p className="text-micro font-semibold uppercase tracking-wide text-steel">Candidate-safe preview (live)</p>
          <div className="mt-1 max-h-72 overflow-y-auto">
            <Markdown content={preview} className="text-micro" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={busy !== null}
          className="focus-ring inline-flex h-7 items-center gap-1 rounded-md bg-moss px-2.5 text-micro font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          <ShieldCheck size={12} /> {busy === "approve" ? "Approving…" : hasEdits ? "Approve with edits" : "Approve"}
        </button>
        <div className="flex min-w-0 flex-1 items-start gap-1.5">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={1}
            placeholder="What should change? e.g. 'too broad for a junior — narrow task 2 to one endpoint'"
            className="focus-ring min-w-0 flex-1 rounded border border-stone-200 bg-white px-2 py-1 text-micro text-ink caret-coral placeholder:text-steel"
          />
          <button
            type="button"
            onClick={redesign}
            disabled={busy !== null || !feedback.trim()}
            title="Re-run only the design step with this note — no full lifecycle re-run"
            className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
          >
            <RefreshCw size={12} className={busy === "redesign" ? "animate-spin" : ""} />
            {busy === "redesign" ? "Redesigning…" : "Regenerate with note"}
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-micro text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
