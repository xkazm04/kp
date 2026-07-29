"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlarmClock, Archive, Eye, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { Markdown } from "@/app/_components/Markdown";
import { caseToMarkdown } from "./DevHelpers";
import { ProbeRow } from "./DevShared";
import { ProbeStrengthBanner } from "./ProbeStrengthBanner";
import { lifecycleStall } from "@/app/_lib/devcase-sla";
import { LIFECYCLE_STEPS, LIVE_STAGES, STAGE_LABEL } from "./DevTypes";
import type { CaseScenario, Lifecycle } from "./DevTypes";

export function LifecycleRow({
  lc,
  submissionCount = 0,
  onApprove,
  onChanged,
}: {
  lc: Lifecycle;
  // d8a0c4cf — submissions across this lifecycle's postings, for the stall check.
  submissionCount?: number;
  onApprove: () => void;
  onChanged?: () => void;
}) {
  const t = useTranslations("devcase");
  // Stage ids are DB values; STAGE_LABEL stays the last-resort fallback for a stage the
  // catalog doesn't know yet (the engine can introduce one before its strings land).
  const stageLabel = (stage: string) => {
    const key = `stage.${stage}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : STAGE_LABEL[stage] ?? stage;
  };
  const mapped = lc.stage === "awaiting_approval" ? "designed" : lc.stage === "published" ? "collecting" : lc.stage;
  const idx = LIFECYCLE_STEPS.indexOf(mapped);
  const awaiting = lc.stage === "awaiting_approval";
  const done = lc.stage === "promoted";
  // W5-3 — human-gated close-out. Offered once the case is live (collecting or
  // beyond): wraps up non-promoted submitters with a courteous comm, closes the
  // postings (apply page + webhook answer honestly) and flips the lifecycle to
  // its terminal stage instead of parking at `promoted` forever.
  const closable = (LIVE_STAGES as readonly string[]).includes(lc.stage);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // d8a0c4cf — flag a lifecycle that's been open and empty past the SLA (client
  // read of the pure rule; no cron). A stalled row offers a one-click re-source.
  // `now` is snapshotted once at mount (Date.now() is impure in render).
  const [nowMs] = useState(() => Date.now());
  const stall = lifecycleStall(
    { stage: lc.stage, updatedAt: lc.updatedAt, createdAt: lc.createdAt, submissionCount },
    nowMs
  );
  const [sourcing, setSourcing] = useState(false);
  const reSource = async () => {
    if (sourcing || !lc.caseId) return;
    setSourcing(true);
    try {
      const r = await fetch("/api/devcase/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: lc.caseId }),
      });
      if (r.ok) onChanged?.();
    } finally {
      setSourcing(false);
    }
  };
  const closeCase = async () => {
    if (closing) return;
    if (typeof window !== "undefined" && !window.confirm(t("lifecycle.closeConfirm"))) return;
    setClosing(true);
    setCloseError(null);
    try {
      const r = await fetch(`/api/devcase/lifecycle/${encodeURIComponent(lc.id)}/close`, { method: "POST" });
      const payload = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(payload?.error ?? t("lifecycle.closeFailed"));
      onChanged?.();
    } catch (caught) {
      setCloseError(caught instanceof Error ? caught.message : t("lifecycle.closeFailed"));
    } finally {
      setClosing(false);
    }
  };
  // Describe the dot-rail for screen readers, since the steps are otherwise
  // conveyed purely by color/position.
  const railLabel = t("lifecycle.railLabel", {
    steps: LIFECYCLE_STEPS.map((s, i) =>
      t("lifecycle.railStep", {
        step: stageLabel(s),
        state: t(`stepState.${i < idx ? "done" : i === idx ? "current" : "upcoming"}` as Parameters<typeof t>[0]),
      })
    ).join(", "),
  });
  return (
    <div className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel transition-shadow motion-reduce:animate-none hover:shadow-lg">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{lc.title || t("lifecycle.untitledRole")}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-micro font-semibold uppercase ${
            awaiting ? "bg-amber-100 text-amber-700" : done ? "bg-moss/15 text-moss" : "bg-paper text-steel"
          }`}
        >
          {stageLabel(lc.stage)}
        </span>
        {stall.stalled ? (
          <span
            title={t("lifecycle.stalledTitle", { days: stall.ageDays ?? 0 })}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral/15 px-2 py-0.5 text-micro font-semibold uppercase text-coral"
          >
            <AlarmClock size={11} aria-hidden /> {t("lifecycle.stalledBadge", { days: stall.ageDays ?? 0 })}
          </span>
        ) : null}
        {stall.stalled && lc.caseId ? (
          <button
            type="button"
            onClick={reSource}
            disabled={sourcing}
            title={t("lifecycle.reSourceTitle")}
            className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-coral/40 bg-white px-2.5 text-micro font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
          >
            <RefreshCw size={12} /> {sourcing ? t("lifecycle.reSourcing") : t("lifecycle.reSource")}
          </button>
        ) : null}
        {awaiting ? (
          // W5-4 — the gate's primary action is REVIEW, not a blind sign-off:
          // the designed role/case/analysis were always persisted and served,
          // but the UI showed one detail line and an Approve button.
          <button
            type="button"
            onClick={() => setReviewOpen((o) => !o)}
            aria-expanded={reviewOpen}
            className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-moss px-2.5 text-micro font-semibold text-white hover:opacity-90"
          >
            <Eye size={12} /> {reviewOpen ? t("lifecycle.hideReview") : t("lifecycle.review")}
          </button>
        ) : null}
        {closable ? (
          <button
            type="button"
            onClick={closeCase}
            disabled={closing}
            title={t("lifecycle.closeTitle")}
            className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-steel hover:border-coral/40 hover:text-ink disabled:opacity-50"
          >
            <Archive size={12} /> {closing ? t("lifecycle.closing") : t("lifecycle.close")}
          </button>
        ) : null}
      </div>
      {closeError ? (
        <p role="alert" className="mt-1 text-micro text-red-700">
          {closeError}
        </p>
      ) : null}
      {awaiting && reviewOpen ? (
        <ReviewPanel
          // Reseed the edit fields when a redesign lands a new case on the row.
          key={`${lc.id}:${lc.updatedAt ?? ""}`}
          lc={lc}
          onApprove={onApprove}
          onChanged={onChanged}
        />
      ) : null}
      <div className="mt-2 flex items-center" role="img" aria-label={railLabel}>
        {LIFECYCLE_STEPS.map((s, i) => (
          <div key={s} aria-hidden className={`flex items-center ${i < LIFECYCLE_STEPS.length - 1 ? "flex-1" : ""}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${i <= idx ? "bg-coral" : "bg-stone-200"}`} title={s} />
            {i < LIFECYCLE_STEPS.length - 1 ? <span className={`h-0.5 flex-1 ${i < idx ? "bg-coral/40" : "bg-stone-200"}`} /> : null}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-micro text-steel">{lc.detail}</p>
    </div>
  );
}

// W5-4 (DEVP1) — the review drawer behind the human approval gate. Everything
// here was already persisted on the lifecycle record and served by the GET;
// the UI just dropped it, so a recruiter signed off on an assignment they
// couldn't see. Shows the flagging analysis, the candidate-safe preview (live
// against the edits), and the INTERNAL probe panel; allows bounded edits
// (title/brief/tasks/timebox — probes and rubric stay engine-owned, change
// those via Regenerate); "Regenerate with note" re-runs ONLY the design step
// with the reviewer's feedback instead of a full lifecycle re-run from intake.
function ReviewPanel({ lc, onApprove, onChanged }: { lc: Lifecycle; onApprove: () => void; onChanged?: () => void }) {
  const t = useTranslations("devcase.review");
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
        if (!r.ok) throw new Error(payload?.error ?? t("approveFailed"));
        onChanged?.();
      } else {
        // No edits — the parent's existing approve flow (POST + reload).
        onApprove();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("approveFailed"));
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
      if (!r.ok) throw new Error(payload?.error ?? t("redesignFailed"));
      onChanged?.(); // reload brings the revised case; key= reseeds the fields
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("redesignFailed"));
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
            {confidence != null ? t("flaggedWithConfidence", { pct: Math.round(confidence * 100) }) : t("flagged")}
          </p>
          {[...gaps, ...risks].map((g) => (
            <p key={g} className="mt-0.5">• {g}</p>
          ))}
        </div>
      ) : null}

      <div className="grid gap-2 lg:grid-cols-2">
        <div className="space-y-1.5">
          <label className="block text-micro font-semibold text-steel">
            {t("fieldTitle")}
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-micro font-semibold text-steel">
            {t("fieldBrief")}
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} className={inputClass} />
          </label>
          <label className="block text-micro font-semibold text-steel">
            {t("fieldTasks")}
            <textarea value={tasksText} onChange={(e) => setTasksText(e.target.value)} rows={4} className={inputClass} />
          </label>
          <label className="block text-micro font-semibold text-steel">
            {t("fieldTimebox")}
            <input value={timebox} onChange={(e) => setTimebox(e.target.value)} inputMode="numeric" className={inputClass} />
          </label>
          {probes.length > 0 ? (
            <div className="rounded border border-stone-200 bg-paper/50 p-2">
              <p className="flex items-center gap-1 text-micro font-semibold uppercase tracking-wide text-steel">
                <Lock size={10} aria-hidden /> {t("internalProbes", { count: probes.length })}
              </p>
              <ul className="mt-1 space-y-1 text-micro text-ink">
                {probes.map((p, i) => (
                  <li key={p.id ?? i}>
                    <ProbeRow probe={p} tone="stone" />
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-micro text-steel">{t("engineOwned")}</p>
              {/* bb4f5494 — certify the probes discriminate BEFORE approving. */}
              <ProbeStrengthBanner probes={probes} />
            </div>
          ) : null}
        </div>
        <div className="rounded border border-stone-200 bg-white p-2">
          <p className="text-micro font-semibold uppercase tracking-wide text-steel">{t("previewTitle")}</p>
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
          <ShieldCheck size={12} /> {busy === "approve" ? t("approving") : hasEdits ? t("approveWithEdits") : t("approve")}
        </button>
        <div className="flex min-w-0 flex-1 items-start gap-1.5">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={1}
            placeholder={t("feedbackPlaceholder")}
            className="focus-ring min-w-0 flex-1 rounded border border-stone-200 bg-white px-2 py-1 text-micro text-ink caret-coral placeholder:text-steel"
          />
          <button
            type="button"
            onClick={redesign}
            disabled={busy !== null || !feedback.trim()}
            title={t("redesignTitle")}
            className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
          >
            <RefreshCw size={12} className={busy === "redesign" ? "animate-spin" : ""} />
            {busy === "redesign" ? t("redesigning") : t("redesign")}
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
