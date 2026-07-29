"use client";

import { ExternalLink, Sparkles, X } from "lucide-react";
import type { useTranslations } from "next-intl";
import type { Popover, ReasonState } from "./matrixTabTypes";

// deec915c — the on-demand "why this score" popover. Anchored under the clicked
// cell (viewport-fixed); a full-screen catcher closes it on outside click. Kept
// out of the tab's stagger-children cascade — it's a user-triggered overlay,
// not a load-time section. Split out of MatrixTab.tsx to keep that file under
// the 200-line cap.
export function MatrixReasoningPopover({
  popover,
  reasoning,
  t,
  blockedLabel,
  closePopover,
  dialogRef,
  onViewFullMatch,
}: {
  popover: Popover;
  reasoning: Record<string, ReasonState>;
  t: ReturnType<typeof useTranslations<"matrix">>;
  blockedLabel: (c: { koKeys?: string[] }) => string;
  closePopover: () => void;
  dialogRef: React.RefObject<HTMLDivElement | null>;
  onViewFullMatch: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={closePopover} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("popoverAria", { cand: popover.cand.label, pos: popover.pos.title })}
        className="fixed z-50 max-h-[60vh] w-80 overflow-y-auto rounded-lg border border-stone-200 bg-white p-3 text-sm shadow-panel"
        style={{ top: popover.rect.top, left: popover.rect.left }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1 truncate font-semibold text-ink">
              <Sparkles size={13} className="shrink-0 text-coral" /> {popover.cand.label}
            </p>
            <p className="truncate text-steel">
              {popover.pos.title}
              {!popover.cell.blocked && popover.cell.score != null ? ` · ${t("matchVal", { score: popover.cell.score })}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={closePopover}
            aria-label={t("closePopover")}
            className="focus-ring shrink-0 rounded p-0.5 text-steel hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-2">
          {popover.cell.blocked ? (
            <p className="text-amber-800">{blockedLabel(popover.cell)}</p>
          ) : (
            (() => {
              const st = reasoning[`${popover.candId}|${popover.posId}`];
              // Tier 2: /api/match/reasoning is an LLM-backed call, so a genuine miss
              // can take a couple of seconds — long enough to earn one quiet line of
              // real copy rather than nothing. reveal-quiet still gates it behind the
              // 150ms anti-flash delay so a cached (fast) verdict never flashes it.
              if (!st || st.loading) return <p className="reveal-quiet text-steel">{t("reasoningLoading")}</p>;
              if (st.error) return <p className="text-red-700">{st.error}</p>;
              const d = st.data;
              if (!d) return <p className="text-steel">{t("noReasoning")}</p>;
              return (
                <div className="space-y-2">
                  {d.verdict ? <p className="text-ink">{d.verdict}</p> : null}
                  {d.strengths?.length ? (
                    <div>
                      <p className="text-meta font-semibold uppercase text-moss">{t("strengths")}</p>
                      <ul className="list-disc pl-4 text-steel">
                        {d.strengths.slice(0, 4).map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {d.gaps?.length ? (
                    <div>
                      <p className="text-meta font-semibold uppercase text-coral">{t("gaps")}</p>
                      <ul className="list-disc pl-4 text-steel">
                        {d.gaps.slice(0, 4).map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {d.interviewProbes?.length ? (
                    <div>
                      <p className="text-meta font-semibold uppercase text-steel">{t("probes")}</p>
                      <ul className="list-disc pl-4 text-steel">
                        {d.interviewProbes.slice(0, 3).map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {st.source && st.source !== "llm" ? (
                    <p className="text-meta text-stone-400">{t("reasoningDeterministic")}</p>
                  ) : null}
                </div>
              );
            })()
          )}
        </div>

        <button
          type="button"
          onClick={onViewFullMatch}
          className="focus-ring mt-3 inline-flex items-center gap-1 font-semibold text-coral hover:underline"
        >
          {t("viewFullMatch")} <ExternalLink size={12} />
        </button>
      </div>
    </>
  );
}
