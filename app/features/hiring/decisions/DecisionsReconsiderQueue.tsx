"use client";

// idea-e43fa801 — the safety valve over irreversible auto-rejection: a
// collapsed-by-default queue of auto-rejected candidates a recruiter can put
// back for review, with the sealed reject reason shown. Split out of
// DecisionsTab to keep that file's render shell under the 200-line cap.
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { Defer } from "@/app/_components/ui/Defer";
import { ScoreProvenanceLabel } from "@/app/_components/ScoreProvenanceLabel";
import type { ReconsiderReason, ReconsiderRow } from "./decisionsQueueTypes";
import type { ReinstateFailure } from "./decisionsReinstateOutcome";

export function DecisionsReconsiderQueue({
  reconsider,
  reconsiderRef,
  reconsiderOpen,
  setReconsiderOpen,
  reinstating,
  reinstate,
  reinstateErrors,
  fmtDate,
  reconsiderReasonText,
}: {
  reconsider: ReconsiderRow[];
  reconsiderRef: React.RefObject<HTMLDetailsElement | null>;
  reconsiderOpen: boolean;
  setReconsiderOpen: (open: boolean) => void;
  reinstating: ReadonlySet<string>;
  reinstate: (item: ReconsiderRow) => void;
  /** Per-row `{ code, status }` for a reinstate that did not land, keyed by entry id. */
  reinstateErrors: Readonly<Record<string, ReinstateFailure>>;
  fmtDate: (iso: string) => string;
  reconsiderReasonText: (r: ReconsiderReason) => string | null;
}) {
  const t = useTranslations("decisions");
  // The failure line is resolved from the machine code, in the reader's language —
  // never from the server's English `error` string.
  const errMsg = useErrorMessage();
  if (reconsider.length === 0) return null;
  return (
    // Tier 3: a secondary, collapsed-by-default region — deferred one idle
    // beat so it never competes with the primary queue's first paint. Its
    // data already loaded alongside the queue (loadReconsider fires with
    // load() at mount); this only staggers WHEN the section commits, not
    // when it's fetched.
    <Defer strategy="idle">
      <details
        ref={reconsiderRef}
        open={reconsiderOpen}
        onToggle={(ev) => setReconsiderOpen(ev.currentTarget.open)}
        className="rounded-lg border border-stone-200 bg-paper/40"
      >
        <summary className="focus-ring flex cursor-pointer items-center gap-1.5 px-4 py-2.5 text-meta uppercase tracking-wide text-steel">
          <RotateCcw size={13} className="text-coral" /> {t("reconsiderTitle", { count: reconsider.length })}
        </summary>
        <div className="space-y-2 px-4 pb-3">
          <p className="text-sm text-steel">{t("reconsiderHelp")}</p>
          <ul className="space-y-1.5">
            {reconsider.map((item) => {
              const reasonText = item.reason ? reconsiderReasonText(item.reason) : null;
              return (
                <li key={item.id} className="rounded-md border border-stone-100 bg-white px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-ink">{item.candidateLabel}</span>
                    {item.jobTitle ? <span className="text-steel">· {item.jobTitle}</span> : null}
                    {/* SD-L2-001 — the safety valve must tell a never-measured candidate
                        apart from a genuine low scorer: an absent score is flagged
                        "unscored", never rendered blank (or worse, as 0). */}
                    {item.matchScore != null ? (
                      <span className="inline-flex items-center gap-1 text-stone-400">
                        · {t("reconsiderMatch", { score: item.matchScore })}
                        {/* Score provenance strip (REC-01) — same label as the queue. */}
                        <ScoreProvenanceLabel provenance={item.scoreProvenance} className="text-meta text-stone-400" />
                      </span>
                    ) : (
                      <span className="text-stone-400">· {t("reconsiderUnscored")}</span>
                    )}
                    {item.rejectedAt ? (
                      <span className="text-stone-400">· {t("reconsiderRejected", { date: fmtDate(item.rejectedAt) })}</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void reinstate(item)}
                      disabled={reinstating.has(item.id)}
                      className="focus-ring ml-auto rounded-md border border-coral/40 bg-white px-2.5 py-1 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
                    >
                      {reinstating.has(item.id) ? t("reinstating") : t("reinstate")}
                    </button>
                  </div>
                  {/* reconsider-earns-keep — the machine reject reason, read back
                      from the sealed decision record. An auto-reject audit is no
                      longer a bare list: the recruiter sees WHY it fell out. */}
                  {/* reinstate-and-rules-say-when-they-fail — a reinstate that did not
                      land says so ON THE ROW. Before this the ok branch had no else and
                      the caller fired it as `void`: the button span, re-enabled, and the
                      row simply stayed, with the failure escaping as an unhandled
                      rejection. */}
                  {reinstateErrors[item.id] ? (
                    <p role="alert" className="mt-1 text-meta font-semibold text-coral">
                      {errMsg(reinstateErrors[item.id], t("reinstateFailed"))}
                    </p>
                  ) : null}
                  {reasonText ? (
                    <p className="mt-1 text-meta text-steel">
                      <span className="font-semibold uppercase tracking-wide text-stone-400">{t("reconsiderReasonLabel")}</span>{" "}
                      {reasonText}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </details>
    </Defer>
  );
}
