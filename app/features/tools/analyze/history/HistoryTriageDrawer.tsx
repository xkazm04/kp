"use client";

// History's triage drawer (challenge-r09 cv-analyze-workspace/B): decide on a saved
// analysis without leaving the list, then walk to the next run still owed a decision.
//
// It is a Modal (shared focus trap + Escape stack), not a new primitive, and it adds
// no write path: the decision is the report's own DispositionEditor against the same
// PATCH /api/analyses/[slug], whose acknowledgement gate and compare-and-swap decide
// what lands. The editor is keyed by slug, so moving on remounts it and its keepalive
// flush still saves a half-typed reason. The list repaints only through
// shouldApplySave: a refused save (DISPOSITION_ACK_REQUIRED, a viewer's 403) leaves
// the row as it was and the drawer on that analysis, its open flags in view.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { DispositionEditor, type DispositionOutcome } from "@/app/_components/results/DispositionEditor";
import { BTN_SECONDARY, CHIP_QUIET, KBD, META_LABEL, NOTICE } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { AnalysisRow } from "./HistoryTypes";
import {
  isTypingTarget,
  shouldApplySave,
  stepTriage,
  triageKey,
  triageProgress,
  triageQueueAround,
  type TriageDecision,
  type TriageMode,
} from "./historyTriage";

type Loaded = {
  slug: string;
  candidateLabel: string;
  disposition: string | null;
  decisionNote: string | null;
  analysis: unknown;
};

type LoadState = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; data: Loaded };

export function HistoryTriageDrawer({
  rows,
  slug,
  mode,
  onModeChange,
  truncated,
  onNavigate,
  onDecided,
  onClose,
}: {
  rows: AnalysisRow[];
  slug: string;
  mode: TriageMode;
  onModeChange: (mode: TriageMode) => void;
  /** The list is a window: more runs match than are loaded. */
  truncated: boolean;
  onNavigate: (slug: string) => void;
  /** A decision the server holds for `slug` (an accepted save, or what the read found). */
  onDecided: (slug: string, decision: TriageDecision) => void;
  onClose: () => void;
}) {
  const t = useTranslations("history");
  const errorMessage = useErrorMessage();
  const enumLabel = useEnumLabel();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const row = rows.find((r) => r.slug === slug) ?? null;
  const queue = triageQueueAround(rows, mode, slug);
  const prev = stepTriage(queue, slug, -1);
  const next = stepTriage(queue, slug, 1);
  const progress = triageProgress(rows, truncated);
  const allDecided = mode === "undecided" && progress.undecided === 0;

  // One generation per read: moving on (or retrying) mid-load drops the older answer.
  const gen = useRef(0);
  const onDecidedRef = useRef(onDecided);
  useEffect(() => {
    onDecidedRef.current = onDecided;
  }, [onDecided]);
  useEffect(() => {
    const mine = ++gen.current;
    fetch(`/api/analyses/${encodeURIComponent(slug)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (gen.current !== mine) return;
        if (!response.ok) {
          setState({ status: "failed", message: errorMessage(payload, t("triageLoadFailed")) });
          return;
        }
        const data = payload as Loaded;
        setState({ status: "ready", data });
        // The list may be older than the row: repaint it with what the server holds now.
        onDecidedRef.current(slug, { disposition: data.disposition ?? "", note: data.decisionNote ?? "" });
      })
      .catch(() => {
        if (gen.current === mine) setState({ status: "failed", message: t("triageLoadFailed") });
      });
  }, [slug, attempt, errorMessage, t]);

  const go = useCallback(
    (target: string | null) => {
      if (!target || target === slug) return;
      setState({ status: "loading" });
      onNavigate(target);
    },
    [slug, onNavigate]
  );

  // Every settled save of the editor; only an accepted one repaints the list.
  const onSettled = useCallback(
    (outcome: DispositionOutcome) => {
      if (!shouldApplySave(outcome)) return;
      onDecided(slug, { disposition: outcome.disposition, note: outcome.note });
    },
    [slug, onDecided]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const action = triageKey(e.key, isTypingTarget(e.target as HTMLElement));
    if (!action) return;
    e.preventDefault();
    go(action === "next" ? next : prev);
  };

  const position = queue.indexOf(slug) + 1;

  return (
    <Modal
      title={t("triageTitle")}
      subtitle={t(progress.ofLoaded ? "triageProgressOfLoaded" : "triageProgress", {
        undecided: progress.undecided,
        decided: progress.decided,
      })}
      onClose={onClose}
      size="3xl"
    >
      <div onKeyDown={onKeyDown} className="space-y-4">
        <label className="inline-flex items-center gap-2 text-sm text-steel">
          <input
            type="checkbox"
            checked={mode === "undecided"}
            onChange={(e) => onModeChange(e.target.checked ? "undecided" : "all")}
            className="focus-ring"
          />
          {t("triageSkipDecided")}
        </label>

        {allDecided ? (
          <p role="status" className={`${NOTICE("info")} p-3 text-sm`}>
            {t(progress.ofLoaded ? "triageDoneOfLoaded" : "triageDone")}
          </p>
        ) : null}

        {row ? (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <p className={META_LABEL}>{row.jd_slug ?? "—"}</p>
              <p className="truncate text-h3 font-semibold text-ink">
                {state.status === "ready" ? state.data.candidateLabel : row.candidate_label}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className={CHIP_QUIET}>
                  {t("colScore")}: <span className="nums">{row.score ?? "—"}</span>
                </span>
                {row.role_family ? <span className={CHIP_QUIET}>{enumLabel("family", row.role_family)}</span> : null}
                {row.seniority ? <span className={CHIP_QUIET}>{enumLabel("seniority", row.seniority)}</span> : null}
                {row.review_flags ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-sm font-semibold text-amber-800">
                    {t("reviewFlags", { count: row.review_flags })}
                  </span>
                ) : null}
              </div>
            </div>
            <Link href={`/history/${slug}`} className="text-sm font-semibold text-coral hover:underline">
              {t("triageOpenReport")}
            </Link>
          </div>
        ) : null}

        {state.status === "loading" ? (
          <LoadingGap className="min-h-[8rem]" />
        ) : state.status === "failed" ? (
          <div role="alert" className={`${NOTICE("critical")} p-3 text-sm`}>
            <p>{state.message}</p>
            <button
              type="button"
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((n) => n + 1);
              }}
              className={`${BTN_SECONDARY} mt-2 h-8 px-3 text-sm`}
            >
              {t("retry")}
            </button>
          </div>
        ) : (
          <DispositionEditor
            key={state.data.slug}
            slug={state.data.slug}
            initialDisposition={state.data.disposition}
            initialNote={state.data.decisionNote}
            analysis={state.data.analysis}
            onSettled={onSettled}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-3">
          <p className="text-sm text-steel">
            {t.rich("triageKeys", { kbd: (chunks) => <kbd className={`${KBD} text-sm`}>{chunks}</kbd> })}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-steel nums">{t("triagePosition", { index: position, total: queue.length })}</span>
            <button type="button" onClick={() => go(prev)} disabled={!prev} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
              {t("triagePrev")}
            </button>
            <button type="button" onClick={() => go(next)} disabled={!next} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
              {t("triageNext")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
