"use client";

import { useState } from "react";
import { Check, CornerDownLeft, Terminal, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";

type PreviewRow = { id: string; label: string; score: number | null; jobTitle: string | null; stage: string };
type CommandResult =
  | { phase: "preview"; kind: string; description: string; mutating: boolean; preview: PreviewRow[]; total: number | null; matchedIds: string[] }
  | { phase: "info"; description: string }
  | {
      phase: "done";
      description: string;
      count?: number;
      // Targets the command did NOT apply: the guarded write refused (someone
      // moved or closed the candidate in the gap) or the action threw. Counted
      // server-side so a bulk reject can never claim more than it did.
      failed?: number;
      // Of the rejections that DID apply, how many the candidate was not told
      // about — the reject stands, the note has to go out by hand.
      commsFailed?: number;
      // advance_top targets already at Offer, HELD instead of silently hired —
      // the recruiter is pointed at the offer flow for them.
      heldAtOffer?: number;
      // reject_below — previewed candidates that dropped out of the matching set
      // between preview and confirm (advanced/rejected/no longer below the line),
      // so were skipped rather than acted on (bug-ui pipeline #3).
      droppedOut?: number;
      // advance_top accepts the hiring plan routed back to the human interview round:
      // ratified, but the candidate did not move a column (challenge-r05 A).
      routedToHumanRound?: number;
      summary?: { advanced: number; rejected: number; held: number };
      // reject_below only: the reviewed id set and the typed command, KEPT past the
      // confirm so the wave can be undone from here (challenge-r05 B). The server
      // restores only ids this wave still owns, so sending the whole reviewed set is safe.
      undo?: { ids: string[]; text: string };
    };

// The undo's truthful outcome: who came back, who had already been told (a sent
// letter cannot be recalled), and who was left alone because they moved since.
type UndoOutcome = { restored: number; notified: number; skipped: number } | { error: string };

// Natural-language pipeline command bar (#7). The recruiter types a command; it's
// parsed server-side and PREVIEWED (nothing runs) until they confirm. Every action
// maps to the existing guarded pipeline/automation paths — this is a parse + preview
// convenience, not a new privilege. `onExecuted` refreshes the board after a run.
export function CommandBar({ onExecuted }: { onExecuted: () => void }) {
  const t = useTranslations("pipeline.command");
  // Codes, never messages: the command route answers TOO_MANY_REQUESTS /
  // COMMAND_FAILED, and painting `p.error` shipped its canonical English to every
  // locale.
  const errorMessage = useErrorMessage();
  const [text, setText] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [undone, setUndone] = useState<UndoOutcome | null>(null);

  const post = async (confirm: boolean) => {
    setBusy(true);
    try {
      // bug-ui pipeline #3 — a reject_below confirm carries the id set the recruiter
      // reviewed, so the server rejects only still-matching candidates and never
      // emails someone who slipped below the line after the preview. Bind to the FULL
      // matched set (matchedIds), not the 50 RENDERED rows: the preview says "affects
      // N" and confirming must act on all N, not silently stop at the render cap
      // (pipeline-board-candidate-drawer #2).
      const confirmIds =
        confirm && result?.phase === "preview" && result.kind === "reject_below"
          ? result.matchedIds
          : undefined;
      const r = await fetch("/api/pipeline/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, confirm, ...(confirmIds ? { confirmIds } : {}) }),
      });
      const p = await r.json();
      if (p.error) {
        setResult({ phase: "info", description: errorMessage(p, t("failed")) });
      } else if (confirm || p.executed) {
        setResult({
          phase: "done",
          description: p.description,
          count: p.count,
          failed: p.failed,
          commsFailed: p.commsFailed,
          heldAtOffer: p.heldAtOffer,
          droppedOut: p.droppedOut,
          routedToHumanRound: p.routedToHumanRound,
          summary: p.summary,
          ...(confirmIds && (p.count ?? 0) > 0 ? { undo: { ids: confirmIds, text } } : {}),
        });
        setUndone(null);
        onExecuted();
      } else if (p.kind === "help" || p.kind === "unknown") {
        setResult({ phase: "info", description: p.description });
      } else {
        setResult({ phase: "preview", kind: p.kind, description: p.description, mutating: p.mutating, preview: p.preview ?? [], total: p.total, matchedIds: p.matchedIds ?? [] });
      }
    } catch {
      // A network-level failure (offline, the dev server restarting, an unparseable
      // body) threw straight out of an un-awaited promise: the bar just went quiet
      // and the browser logged an unhandled rejection. There is no code to resolve
      // here — nothing reached the route — so say the generic line and let the
      // recruiter retry rather than leaving a submitted command with no outcome.
      setResult({ phase: "info", description: t("failed") });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setUndone(null);
    setText("");
  };

  // Undo the reject wave just confirmed: restore each still-unchanged member to the
  // stage they stood on. Each restore is a new decision sealed to this session.
  const undoWave = async (undo: { ids: string[]; text: string }) => {
    setBusy(true);
    try {
      const r = await fetch("/api/pipeline/command/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: undo.ids, text: undo.text }),
      });
      const p = await r.json();
      if (p.error) {
        setUndone({ error: errorMessage(p, t("undoFailed")) });
      } else {
        setUndone({ restored: p.restored ?? 0, notified: p.notified ?? 0, skipped: p.skipped ?? 0 });
        onExecuted();
      }
    } catch {
      // Nothing reached us — the undo may or may not have applied, so say that.
      setUndone({ error: t("undoFailed") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-stone-200 bg-white p-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !busy) void post(false);
        }}
        className="flex items-center gap-2"
      >
        <Terminal size={15} className="shrink-0 text-steel" />
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (result) setResult(null);
          }}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          className="focus-ring min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-stone-400"
        />
        <button
          type="submit"
          disabled={!text.trim() || busy}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-meta font-semibold text-steel hover:text-ink disabled:opacity-40"
        >
          <CornerDownLeft size={13} /> {t("run")}
        </button>
      </form>

      {result?.phase === "info" ? (
        <div className="mt-2 border-t border-stone-100 pt-2 text-sm text-steel">
          <p>{result.description}</p>
          <p className="mt-1 text-meta text-stone-400">{t("examples")}</p>
        </div>
      ) : null}

      {result?.phase === "preview" ? (
        <div className="mt-2 border-t border-stone-100 pt-2">
          <p className="text-sm text-ink">{result.description}</p>
          {result.total != null ? (
            <p className="mt-1 text-meta text-steel">{t("affects", { count: result.total })}</p>
          ) : null}
          {result.preview.length > 0 ? (
            <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto" role="list">
              {result.preview.map((row) => (
                <li key={row.id} className="flex items-baseline justify-between gap-2 text-meta">
                  <span className="text-ink">{row.label}</span>
                  <span className="shrink-0 text-steel">
                    {row.score != null ? `${row.score}%` : "—"} · {row.jobTitle ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy || (result.total === 0 && result.kind !== "run_policy")}
              onClick={() => void post(true)}
              className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-white disabled:opacity-40 ${
                result.kind === "reject_below" ? "bg-red-600 hover:opacity-90" : "bg-coral hover:opacity-90"
              }`}
            >
              <Check size={13} /> {busy ? t("running") : t("confirm")}
            </button>
            <button
              type="button"
              onClick={reset}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel hover:text-ink"
            >
              <X size={13} /> {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {result?.phase === "done" ? (
        <div className="mt-2 border-t border-stone-100 pt-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-moss">
              <Check size={14} />
              {result.summary
                ? t("doneSummary", { advanced: result.summary.advanced, rejected: result.summary.rejected, held: result.summary.held })
                : t("doneCount", { count: result.count ?? 0 })}
            </span>
            <button type="button" onClick={reset} className="focus-ring text-meta font-semibold text-steel hover:text-ink">
              {t("dismiss")}
            </button>
          </div>
          {/* The two truthful counts a bulk action owes the recruiter: who was NOT
              actioned, and who was actioned but never told. Both are silent
              otherwise — a lost CAS looks identical to a success from here. */}
          {result.failed ? <p className="mt-1 text-meta text-coral">{t("doneFailed", { count: result.failed })}</p> : null}
          {result.commsFailed ? <p className="mt-1 text-meta text-coral">{t("doneCommsFailed", { count: result.commsFailed })}</p> : null}
          {/* advance-top stops at Offer: say who was held and where the work continues,
              instead of silently swallowing part of the requested N. */}
          {result.heldAtOffer ? <p className="mt-1 text-meta text-steel">{t("doneHeldAtOffer", { count: result.heldAtOffer })}</p> : null}
          {/* reject_below bound to the preview: name anyone shown who dropped out of
              the matching set before confirm, so a smaller count isn't a mystery. */}
          {result.droppedOut ? <p className="mt-1 text-meta text-steel">{t("doneDroppedOut", { count: result.droppedOut })}</p> : null}
          {result.routedToHumanRound ? (
            <p className="mt-1 text-meta text-steel">{t("doneRoutedToHumanRound", { count: result.routedToHumanRound })}</p>
          ) : null}
          {/* A reject wave is undoable while the recruiter is still looking at it. */}
          {result.undo && !undone ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void undoWave(result.undo!)}
              aria-label={t("undoWaveLabel", { count: result.count ?? 0 })}
              className={`${BTN_SECONDARY} mt-2 h-8 px-3 text-sm`}
            >
              <Undo2 size={13} /> {busy ? t("undoRunning") : t("undoWave")}
            </button>
          ) : null}
          {undone && "error" in undone ? <p className="mt-1 text-meta text-coral">{undone.error}</p> : null}
          {undone && !("error" in undone) ? (
            <div className="mt-2 border-t border-stone-100 pt-2">
              <p className="text-meta text-ink">{t("undoneRestored", { count: undone.restored })}</p>
              {undone.notified ? <p className="mt-1 text-meta text-coral">{t("undoneNotified", { count: undone.notified })}</p> : null}
              {undone.skipped ? <p className="mt-1 text-meta text-steel">{t("undoneSkipped", { count: undone.skipped })}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
