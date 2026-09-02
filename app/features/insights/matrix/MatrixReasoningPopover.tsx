"use client";

import { ExternalLink, Sparkles, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Popover, ReasonState } from "./matrixTabTypes";

// deec915c — the on-demand "why this score" popover. Anchored under the clicked
// cell (viewport-fixed); a full-screen catcher closes it on outside click. Kept
// out of the tab's stagger-children cascade — it's a user-triggered overlay,
// not a load-time section. Split out of MatrixTab.tsx to keep that file under
// the 200-line cap.
//
// grid-narrative-says-what-it-is: the SAME narrative rendered here and in focus mode
// (MatchReasoningPanel) used to carry three facts on one surface and none on the other.
// The provenance strip below is that panel's, key for key — `match.shared.sourceLlm` /
// `sourceRuleBased` / `cachedSuffix` / `narrativeInLanguage` — because a reader who
// learns in focus mode that an answer is rule-based and cached must not have to
// re-learn a second vocabulary in the grid. Reused verbatim, not re-worded.
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
                  <ReasoningProvenance source={st.source} cached={st.cached} narrativeLang={st.narrativeLang} />
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

// The three facts focus mode has always stated about a narrative, in the grid's smaller
// register: which engine wrote it, whether it came from the cache, and — when the engine's
// language is not the reader's — that they are reading it in another language. Same keys
// as MatchReasoningPanel's ResolvedReasoning, so the two surfaces cannot drift apart.
function ReasoningProvenance({ source, cached, narrativeLang }: { source?: string; cached?: boolean; narrativeLang?: string }) {
  const ts = useTranslations("match.shared");
  const locale = useLocale();
  // The engine writes the narrative only in en/cs, so a de/fr reader gets English (or
  // Czech). Say so plainly rather than passing the text off as localized.
  const showLangNote = Boolean(narrativeLang) && narrativeLang !== locale;
  const narrativeLangName = showLangNote
    ? new Intl.DisplayNames([locale], { type: "language" }).of(narrativeLang as string) ?? narrativeLang
    : null;
  return (
    <div>
      <span className="rounded bg-paper px-1.5 py-0.5 text-meta text-steel">
        {source === "llm" ? ts("sourceLlm") : ts("sourceRuleBased")}
        {cached ? ts("cachedSuffix") : ""}
      </span>
      {showLangNote ? (
        <p className="mt-1 text-meta italic text-steel">{ts("narrativeInLanguage", { language: narrativeLangName as string })}</p>
      ) : null}
    </div>
  );
}
