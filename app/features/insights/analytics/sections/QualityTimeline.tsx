"use client";

// VARIANT C — "Timeline". Metaphor: an incident chronology.
//
// The other two directions each pick a subject — the record (dossier) or the
// instrument (instrument check). This one argues the subject is the RELATIONSHIP
// between them, and that the baseline hides it structurally: threshold changes
// live in the calibration panel's floor strip, decisions live in the log two
// panels down, and the two never share an axis. So nobody can see the thing that
// actually matters for governance — "we lowered the screening floor on the 3rd,
// and the auto-rejections tripled on the 4th".
//
// What differs, structurally:
//   • ONE merged stream: policy changes and the decisions they governed,
//     interleaved by time, newest first;
//   • policy events are visually heavier than the decisions between them,
//     because a threshold apply is a cause and a decision is an effect;
//   • each policy event carries what it changed FROM and TO, so the reader can
//     attribute a shift in the rows beneath it without opening another panel.
//
// Honest about its own limit: this shows sequence, which is not causation. The
// copy says so rather than letting the layout imply a proof it cannot give.
import { useTranslations } from "next-intl";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { kindLabel } from "@/app/_lib/decision-attribution";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { PANEL } from "@/app/_components/ui/recipes";
import { Defer } from "@/app/_components/ui/Defer";
import { CalibrationPanel, DecisionRecordsPanel } from "./sectionChunks";
import type { Decision } from "../analyticsDecisionLogTypes";

type HistoryPoint = {
  seq: number;
  at: string;
  approvedBy: string | null;
  direction: "lower" | "raise" | null;
  previous: number | null;
  next: number | null;
  roleFamily: string | null;
};

type PolicyEvent = { kind: "policy"; at: string; point: HistoryPoint };
type DecisionEvent = { kind: "decision"; at: string; decision: Decision };
type Entry = PolicyEvent | DecisionEvent;

/** How many recent decisions to interleave. The stream is a reading surface, not
 *  the full audit trail — the paged log below stays the complete record. */
const DECISION_WINDOW = 40;

export function QualityTimeline() {
  const t = useTranslations("analytics.quality");
  const tLog = useTranslations("analytics.log");
  const enumLabel = useEnumLabel();
  // Same truthfulness gate the decision log uses: with no relay configured a
  // "sent" kind reads as QUEUED, because nothing actually left the building.
  const relayConfigured = useDeliveryCapability();

  const history = useJsonFetch<{ history: HistoryPoint[] }>("/api/analytics/calibration/threshold-history");
  const decisions = useJsonFetch<{ decisions: Decision[] }>(`/api/analytics/decisions?limit=${DECISION_WINDOW}`);

  const loading = !history.data && !history.error && !decisions.data && !decisions.error;

  const entries: Entry[] = [
    ...(history.data?.history ?? []).map((point): Entry => ({ kind: "policy", at: point.at, point })),
    ...(decisions.data?.decisions ?? []).map((decision): Entry => ({ kind: "decision", at: decision.createdAt, decision })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="animate-arrive-in space-y-6">
      <section className={`${PANEL} p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-serif text-h2 text-ink">{t("timelineTitle")}</h3>
          <p className="text-meta uppercase text-steel">{t("timelineLegend")}</p>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-steel">{t("timelineIntro")}</p>

        {loading ? (
          <div className="reveal-quiet mt-4 min-h-[16rem]" aria-hidden />
        ) : entries.length === 0 ? (
          <p className="mt-4 rounded-md bg-paper p-3 text-base text-steel">{t("timelineEmpty")}</p>
        ) : (
          <ol className="mt-4 space-y-0">
            {entries.map((e) =>
              e.kind === "policy" ? (
                // A policy change is a RULE, so it reads as a band across the
                // stream rather than another row in it.
                <li
                  key={`policy-${e.point.seq}`}
                  className="my-2 rounded-md border border-dial-amber/40 bg-dial-amber/10 px-3 py-2"
                >
                  <p className="flex flex-wrap items-center gap-2 text-base text-ink">
                    {e.point.direction === "lower" ? (
                      <ArrowDownRight size={16} className="shrink-0 text-coral" aria-hidden />
                    ) : (
                      <ArrowUpRight size={16} className="shrink-0 text-moss" aria-hidden />
                    )}
                    <span className="font-semibold">
                      {e.point.previous != null && e.point.next != null
                        ? t("policyMoved", { from: e.point.previous, to: e.point.next })
                        : t("policyChanged")}
                    </span>
                    {e.point.roleFamily ? (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-sm text-steel">
                        {enumLabel("family", e.point.roleFamily)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-sm text-steel">{t("policyGlobal")}</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-steel nums">
                    {t("policyStamp", { at: e.point.at.slice(0, 16).replace("T", " "), by: e.point.approvedBy ?? t("policyUnknownActor") })}
                  </p>
                </li>
              ) : (
                <li key={`decision-${e.decision.id}`} className="flex items-baseline gap-3 border-b border-stone-100 py-1.5 last:border-0">
                  <span className="w-36 shrink-0 whitespace-nowrap text-sm text-steel nums">
                    {e.at.slice(0, 16).replace("T", " ")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base text-ink">
                    {e.decision.candidateLabel ?? t("boardLevel")}
                    {e.decision.toStage ? (
                      <span className="text-steel"> · {enumLabel("stage", e.decision.toStage)}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-sm text-steel">{kindLabel(tLog, e.decision.kind, { relayConfigured })}</span>
                </li>
              )
            )}
          </ol>
        )}

        {/* The claim this layout could be read as making, denied explicitly. */}
        <p className="mt-4 border-t border-stone-200 pt-3 text-sm text-steel">{t("timelineCaveat")}</p>
      </section>

      <Defer strategy="idle">
        <CalibrationPanel />
      </Defer>

      <Defer strategy="visible">
        <DecisionRecordsPanel />
      </Defer>
    </div>
  );
}
