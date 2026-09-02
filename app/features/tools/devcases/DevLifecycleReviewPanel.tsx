"use client";

// W5-4 (DEVP1) — the review drawer behind the human approval gate, split out of
// DevLifecycleRow.tsx.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { clampTimeboxHours, timeboxClamp } from "@/app/_lib/devcase-timebox";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { Markdown } from "@/app/_components/Markdown";
import { approveFallbackFor, caseEdits, caseToMarkdown } from "./DevHelpers";
import { ProbeRow } from "./DevShared";
import { ProbeStrengthBanner } from "./DevProbeStrengthBanner";
import type { CaseScenario, Lifecycle } from "./DevTypes";

// W5-4 (DEVP1) — the review drawer behind the human approval gate. Everything
// here was already persisted on the lifecycle record and served by the GET;
// the UI just dropped it, so a recruiter signed off on an assignment they
// couldn't see. Shows the flagging analysis, the candidate-safe preview (live
// against the edits), and the INTERNAL probe panel; allows bounded edits
// (title/brief/tasks/timebox — probes and rubric stay engine-owned, change
// those via Regenerate); "Regenerate with note" re-runs ONLY the design step
// with the reviewer's feedback instead of a full lifecycle re-run from intake.
export function DevLifecycleReviewPanel({ lc, onApprove, onChanged }: { lc: Lifecycle; onApprove: () => void; onChanged?: () => void }) {
  const t = useTranslations("devcase.review");
  const tProbe = useTranslations("devcase.probeAudit");
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  // …but the ONE refusal this gate can raise — 422 probe_audit_failed, a case whose
  // probes can't tell a strong submission from a naive one — has no `errors` catalog
  // entry, so the resolver fell through to the generic "Approve failed." and the
  // reviewer lost both the cause and the way out. The banner two panels up already
  // states that cause in their language, and `engineOwned` names the exit (Regenerate
  // with note — the button beside Approve), so the refusal answers itself.
  const approveFallback = (payload: { code?: string | null } | null) =>
    approveFallbackFor(payload?.code, { probeGate: `${tProbe("none")} ${t("engineOwned")}`, generic: t("approveFailed") });
  const kase: CaseScenario = lc.case ?? {};
  const [title, setTitle] = useState(kase.title ?? "");
  const [brief, setBrief] = useState(kase.brief ?? "");
  const [tasksText, setTasksText] = useState((kase.tasks ?? []).join("\n"));
  const [timebox, setTimebox] = useState(kase.timeboxHours != null ? String(kase.timeboxHours) : "");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"approve" | "redesign" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editedTasks = tasksText.split("\n").map((t) => t.trim()).filter(Boolean);
  // The timebox is POLICY, and the server clamps it to the 2h cap on a candidate's
  // unpaid work. The panel used to send the raw typed number and preview it verbatim,
  // so a reviewer typed 8, saw "~8h" in the candidate-safe preview, approved, and the
  // candidate received 2h with no notice on either screen. Clamp HERE too, with the
  // same shared rule the route uses (never a second copy of the bound), and show the
  // rewrite inline as it happens rather than burying it in the audit trail.
  const timeboxRaw = timebox.trim();
  const timeboxHours = timeboxRaw ? clampTimeboxHours(timeboxRaw) : null;
  const clamped = timeboxRaw ? timeboxClamp(timeboxRaw) : null;
  // What would actually be SENT, decided by the pure rule in DevHelpers (and tested
  // there) rather than by four `if`s in a render. `blocked` is the one draft this
  // panel refuses: emptying the task list used to produce no `tasks` key at all, so
  // the assignment shipped with the tasks the reviewer had just deleted.
  const { edits, blocked } = caseEdits(kase, { title, brief, tasks: editedTasks, timeboxHours });
  const hasEdits = Object.keys(edits).length > 0;

  // Live candidate-safe preview: what the candidate would actually receive,
  // including the reviewer's in-flight edits. caseToMarkdown excludes probes
  // by construction.
  const preview = caseToMarkdown(
    { ...kase, title: title.trim() || kase.title, brief: brief.trim() || kase.brief, tasks: editedTasks.length ? editedTasks : kase.tasks, timeboxHours: timeboxHours ?? kase.timeboxHours },
    lc.role ?? null
  );

  const approve = async () => {
    if (busy || blocked) return;
    setBusy("approve");
    setError(null);
    try {
      if (hasEdits) {
        const r = await fetch(`/api/devcase/lifecycle/${encodeURIComponent(lc.id)}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ case: edits }),
        });
        const payload = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
        if (!r.ok) throw new Error(errMsg(payload, approveFallback(payload)));
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
      const payload = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
      if (!r.ok) throw new Error(errMsg(payload, t("redesignFailed")));
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
            <textarea
              value={tasksText}
              onChange={(e) => setTasksText(e.target.value)}
              rows={4}
              aria-invalid={blocked === "tasksCleared"}
              className={inputClass}
            />
          </label>
          {/* The refusal, stated where the draft that caused it is. Silently keeping
              the stored tasks is what this replaces. */}
          {blocked === "tasksCleared" ? (
            <p role="alert" className="text-micro text-coral">{t("tasksRequired")}</p>
          ) : null}
          <label className="block text-micro font-semibold text-steel">
            {t("fieldTimebox")}
            <input value={timebox} onChange={(e) => setTimebox(e.target.value)} inputMode="numeric" className={inputClass} />
          </label>
          {clamped ? (
            <p className="text-micro text-amber-700">{t("timeboxClamped", { from: clamped.from, to: clamped.to })}</p>
          ) : null}
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
          disabled={busy !== null || blocked !== null}
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
