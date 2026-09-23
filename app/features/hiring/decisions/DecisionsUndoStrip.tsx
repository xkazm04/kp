"use client";

// The commit window's strip (decisions-review-ui/B): "Rejecting Ana in 8 s. Nothing
// has been sent yet." with an Undo, while a quick reject waits in its window
// (decisionsCommitWindow.ts); "Sending…" while it commits; and, when the commit did
// not land, that it did not and why (resolved from the refusal's CODE).
//
// Announced ONCE: the role=status sentence states the full interval and does not
// change while the visible count ticks (the ticking copy is aria-hidden) — a
// per-second live region would talk over the recruiter. The Undo is a real button;
// when the decided row took keyboard focus with it, focus lands on Undo.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Undo2, X } from "lucide-react";
import { BTN_SECONDARY, NOTICE, PANEL_ACCENT } from "@/app/_components/ui/recipes";
import { capabilityAwareReason, useErrorMessage } from "@/app/_lib/use-error-message";
import { DECISION_UNDO_MS, type WindowState } from "./decisionsCommitWindow";

const secondsLeft = (deadline: number, now: number) => Math.max(0, Math.ceil((deadline - now) / 1000));

export function DecisionsUndoStrip({
  state,
  onUndo,
  onDismissFailure,
}: {
  state: WindowState;
  onUndo: () => void;
  onDismissFailure: () => void;
}) {
  const t = useTranslations("decisions.undo");
  const errMsg = useErrorMessage();
  const undoRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const pendingId = state.kind === "pending" ? state.entryId : null;

  // The visible count. Ticks only while a decision is pending.
  useEffect(() => {
    if (!pendingId) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [pendingId]);

  // The decided row left the DOM; if it held focus, give it to Undo instead of <body>.
  useEffect(() => {
    if (!pendingId || typeof document === "undefined") return;
    const active = document.activeElement;
    if (!active || active === document.body) undoRef.current?.focus();
  }, [pendingId]);

  const failure = state.lastFailure;
  if (state.kind === "idle" && !failure) return null;
  const total = Math.round(DECISION_UNDO_MS / 1000);

  return (
    <div className="space-y-2">
      {state.kind === "pending" ? (
        <div className={`${PANEL_ACCENT} flex flex-wrap items-center justify-between gap-2 px-4 py-2.5`}>
          <span role="status" className="sr-only">
            {t("pending", { name: state.label, seconds: total })}
          </span>
          <p aria-hidden="true" className="text-sm text-ink">
            {t("pending", { name: state.label, seconds: Math.min(total, secondsLeft(state.deadline, now)) })}
          </p>
          <button
            ref={undoRef}
            type="button"
            onClick={onUndo}
            aria-label={t("undoLabel", { name: state.label })}
            className={`${BTN_SECONDARY} h-8 px-3 text-sm`}
          >
            <Undo2 size={14} aria-hidden="true" /> {t("undo")}
          </button>
        </div>
      ) : state.kind === "committing" ? (
        <p role="status" className={`${PANEL_ACCENT} px-4 py-2.5 text-sm text-steel`}>
          {t("committing", { name: state.label })}
        </p>
      ) : null}

      {failure ? (
        <div role="alert" className={`${NOTICE("critical")} flex items-start justify-between gap-2 px-4 py-2.5 text-sm`}>
          <p className="inline-flex items-start gap-1.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {t("failed", { name: failure.label })}{" "}
              {capabilityAwareReason(errMsg, failure.failure, "")}
            </span>
          </p>
          <button type="button" onClick={onDismissFailure} aria-label={t("dismiss")} className="focus-ring shrink-0 rounded-md p-0.5 hover:opacity-80">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
