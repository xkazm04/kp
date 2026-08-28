"use client";

// LLM-era anti-delegation controls #1 + #4, made visible.
//
// The hash chain over the observed event log and the per-session watermark scan
// were computed at evaluation (devcase-run.ts) and persisted with the bundle, but
// the only trace a human could see was the folded `authenticity` number in a
// `title=` tooltip — a -70 penalty with no stated cause. This strip states the
// cause: is the chain intact, where did it break, did any client timestamp
// contradict its server receive window, and did a FOREIGN session's marker turn up
// in the submitted tree.
//
// Two rules this component exists to honour:
//   1. `chain.valid === null` is UNVERIFIABLE, not "clean" and not "tampered".
//      A legacy or empty log must never render as a pass.
//   2. The watermark MECHANISM is never shown. We render the verdict (intact /
//      absent / a foreign marker was found) and never the marker string itself —
//      printing `watermark.expected` would teach a candidate exactly what to strip.
//   3. The JUDGE seat is reported only when it is the GENERATOR. `devcase_judge` is
//      the gate over this pipeline's own output; when it resolves to the same
//      engine+model that produced the artifacts, the gate is self-grading and the
//      reviewer is told. The independent case renders NOTHING — the runtime
//      evaluation is not itself judged, so a green "judge independent" chip would
//      claim a check this bundle never had. See app/_lib/devcase-judge-independence.ts.
import { Link2, Link2Off, ShieldCheck, ShieldAlert, ShieldQuestion, Clock, Gavel, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { judgeSeatState } from "@/app/_lib/devcase-judge-independence";
import type { Integrity } from "./DevTypes";

type Tone = "ok" | "alert" | "unknown";

const TONE: Record<Tone, string> = {
  ok: "bg-moss/10 text-moss",
  alert: "bg-coral/15 text-coral",
  unknown: "bg-stone-100 text-steel",
};

function Fact({ tone, Icon, label, title }: { tone: Tone; Icon: LucideIcon; label: string; title: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-micro font-semibold uppercase ${TONE[tone]}`}>
      <Icon size={11} aria-hidden /> {label}
    </span>
  );
}

export function DevEvalPanelIntegrity({
  integrity,
  judgeIndependence,
}: {
  /** null for a REPO submission (there is no observed event log to verify). The strip
   *  still renders when the judge seat has something to say — the two facts are
   *  independent, and gating one on the other is what would hide it. */
  integrity: Integrity | null;
  judgeIndependence?: unknown;
}) {
  const t = useTranslations("devcase.integrity");
  const locale = useLocale();
  const judge = judgeSeatState(judgeIndependence);
  const chain = integrity?.chain ?? null;
  const backdatedEvents = integrity?.backdatedEvents ?? 0;
  const watermark = integrity?.watermark ?? null;
  // Seconds, one decimal — the raw ms figure is precise noise to a recruiter.
  const driftSeconds = Math.round((integrity?.maxClockDriftMs ?? 0) / 100) / 10;
  // Locale-formatted unit (grouping, decimal separator and "s" abbreviation all
  // vary by reader locale), fed into the message as one placeholder rather than
  // gluing a hardcoded "s" onto the raw number in the catalog.
  const driftLabel = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "second",
    unitDisplay: "narrow",
    maximumFractionDigits: 1,
  }).format(driftSeconds);

  return (
    <div className="mt-2 border-t border-stone-100 pt-2">
      {/* The heading names what is actually below it. "Log integrity" and its
          footnote are both about the recorded event log, so a repo submission — which
          has no log, and reaches this strip only because the judge seat has something
          to say — gets the wider heading and no log footnote. */}
      <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-steel">
        {integrity ? t("title") : t("judgeTitle")}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* The judge seat, and ONLY when it is the generator (rule 3 above). */}
        {judge === "self_grading" ? (
          <Fact tone="alert" Icon={Gavel} label={t("judgeSelfGrading")} title={t("judgeSelfGradingTitle")} />
        ) : null}

        {/* Chain: three states, never two. `null` means we cannot say. */}
        {chain == null ? null : chain.valid === true ? (
          <Fact tone="ok" Icon={Link2} label={t("chainVerified", { count: chain.events })} title={t("chainVerifiedTitle")} />
        ) : chain.valid === false ? (
          <Fact
            tone="alert"
            Icon={Link2Off}
            label={chain.brokenAtSeq != null ? t("chainBrokenAt", { seq: chain.brokenAtSeq }) : t("chainBroken")}
            title={t("chainBrokenTitle")}
          />
        ) : (
          <Fact tone="unknown" Icon={ShieldQuestion} label={t("chainUnverifiable")} title={t("chainUnverifiableTitle")} />
        )}

        {/* Client clock vs server receive window. 0 flagged events is a real
            positive result here (the log was checked and agreed), unlike the
            null-chain case above. */}
        {chain == null ? null : backdatedEvents > 0 ? (
          <Fact
            tone="alert"
            Icon={Clock}
            label={t("backdated", { count: backdatedEvents })}
            title={t("backdatedTitle", { count: backdatedEvents, seconds: driftLabel })}
          />
        ) : chain.events > 0 ? (
          <Fact tone="ok" Icon={Clock} label={t("clockConsistent")} title={t("clockConsistentTitle")} />
        ) : null}

        {/* Watermark VERDICT only — never the marker. A foreign marker is the
            circulation tell; a merely-absent own marker is a note, not a finding
            (deleting a line proves nothing), so it renders neutral, never coral. */}
        {watermark == null ? null : watermark.foreign.length > 0 ? (
          <Fact
            tone="alert"
            Icon={ShieldAlert}
            label={t("markerForeign", { count: watermark.foreign.length })}
            title={t("markerForeignTitle")}
          />
        ) : watermark.present ? (
          <Fact tone="ok" Icon={ShieldCheck} label={t("markerIntact")} title={t("markerIntactTitle")} />
        ) : (
          <Fact tone="unknown" Icon={ShieldQuestion} label={t("markerAbsent")} title={t("markerAbsentTitle")} />
        )}
      </div>
      {integrity ? <p className="mt-1 text-micro italic text-steel">{t("footnote")}</p> : null}
    </div>
  );
}
