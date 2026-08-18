"use client";

// VARIANT B — "Instrument check". Metaphor: a gauge being calibrated before you
// trust what it reads.
//
// The dossier variant answers "can I prove what we decided". This one answers
// the question that comes BEFORE any of those decisions: should this thing be
// allowed to decide at all? It leads with a single trust verdict derived from
// the calibration — sample size, Brier score, and whether the curve is even
// admissible — and states plainly what the workspace should do about it.
//
// What differs, structurally:
//   • one computed verdict with a recommended action, not a diagram to read;
//   • the honesty gate is the HEADLINE, not a caveat: below the minimum-outcomes
//     floor the verdict is "we cannot tell you yet", which is the most useful
//     thing this section can say and the baseline buries it inside a panel;
//   • the decision trail is demoted to evidence — you look at it to check the
//     instrument's claims, not the other way round.
//
// UAT KAT-ANA-1 / LUC-ANA-2 (drain 2026-08-17) — this headline read
// „Automatická rozhodnutí na tomto skóre jsou obhajitelná" over the PIPELINE arm,
// whose outcome labels the score itself produced, while the payload behind the
// same number said the curve "largely validates the score against its own
// decisions". Three things changed, and all three are structural rather than
// editorial: the verdict is computed from the CLEAN arm whenever that arm can be
// judged; a high-leakage arm cannot reach a trustworthy verdict at all; and the
// yardstick is this cohort's own base rate, not a coin flip (the seeded arm
// scores −33 % against it).
//
// UAT KAT-L1-003 (drain 2026-08-17, recurrence 2) — the verdict is a claim about
// ADVANCING PAST SCREENING, where Interview, Offer and Hired are one label. That
// scope lived only in a small „what counts" line inside the panel below, so the
// headline read as a verdict on the score in general. It is now stated where the
// verdict is read, and the hire axis (a real second measurement, computable from
// stage data alone) reports its own status beside it instead of being invisible.
import { useTranslations } from "next-intl";
import { AlertTriangle, Ban, CheckCircle2, HelpCircle } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { PANEL } from "@/app/_components/ui/recipes";
import { Defer } from "@/app/_components/ui/Defer";
import type { CalibrationLeakage, CalibrationSource } from "@/app/_lib/calibration";
import {
  CalibrationAccrualNote,
  CalibrationLeakageNote,
  calibrationSkill,
} from "../AnalyticsCalibrationHeader";
import { CalibrationPanel, DecisionRecordsPanel, DecisionLog } from "./sectionChunks";

type Payload = {
  n: number;
  positives: number;
  brier: number | null;
  calibrated: boolean;
  minOutcomes: number;
  // Declared at last: the route has shipped this on every request since the
  // KAT-L1-001 fix and no Payload type named it, so no surface could render it.
  leakage?: CalibrationLeakage;
};

// UAT KAT-L1-002 (blocker, recurrence 2) — the THIRD question, and the one neither
// axis above can answer: did the people we hired actually work out? That needs a
// signal the pipeline cannot derive, an on-the-job rating a human enters, and until
// this drain nothing in the recruiting workspace could write one.
//
// What ships here is the accrual counter ONLY, and that restraint is the point: a
// quality-of-hire calibration arm paired against a rating nobody has entered yet
// would be a fifth arm reading n:0 — the exact "correct mechanism that reaches no
// surface" defect this whole drain was about. So the section states the horizon
// honestly (G1: a stated horizon, never an empty chart) and names where the data
// comes from; the arm follows when the corpus can say something.
type HireRatings = { rated: number; hires: number; minOutcomes: number };

// The verdict logic itself lives in `../calibrationVerdict.ts` — a plain module,
// deliberately React-free, because `npm run test:unit` runs node:test over
// `app/**/*.test.ts` and cannot import a `.tsx`. While the structural bar lived
// here it could only be pinned by a test that read this file as TEXT, and an
// unenforced guarantee is the exact defect class this drain was about. Re-exported
// so existing importers of `./QualityInstrument` keep working.
import { verdictFor, type Verdict } from "../calibrationVerdict";
export { verdictFor, type Verdict };

const TONE = {
  trustworthy: { icon: CheckCircle2, cls: "text-moss", title: "verdictGood", body: "verdictGoodBody" },
  weak: { icon: AlertTriangle, cls: "text-dial-amber", title: "verdictWeak", body: "verdictWeakBody" },
  untrustworthy: { icon: AlertTriangle, cls: "text-coral", title: "verdictBad", body: "verdictBadBody" },
  circular: { icon: Ban, cls: "text-coral", title: "verdictCircular", body: "verdictCircularBody" },
  unknown: { icon: HelpCircle, cls: "text-steel", title: "verdictUnknown", body: "verdictUnknownBody" },
} as const;

export function QualityInstrument() {
  const t = useTranslations("analytics.quality");
  // The pipeline match score — the number screening auto-decisions actually act on.
  const pipeline = useJsonFetch<Payload>("/api/analytics/calibration?source=pipeline");
  // …and the holdout, the arm whose outcomes the score did NOT produce. When it can
  // be judged it LEADS, because it is the only arm a trust claim can be falsified
  // against; until then it supplies the accrual horizon printed below the verdict.
  const holdout = useJsonFetch<Payload>("/api/analytics/calibration?source=holdout");
  // KAT-L1-003 — the OTHER question, and the one the analytics Character opens the
  // tab with: did the high scorers get HIRED, not merely interviewed? Read here so
  // the headline can answer it (or state its horizon) instead of leaving it to a
  // reader who first has to discover a selector two panels down. Same route, same
  // short-TTL memo, so this is a cache hit once the panel below has asked for it.
  const hired = useJsonFetch<Payload>("/api/analytics/calibration?source=pipeline&outcome=hired");
  // KAT-L1-002 — how much on-the-job ground truth actually exists. Operator-gated
  // (it counts this workspace's hires), so a session that may not read it simply
  // gets no line rather than a zero that would read as "nobody worked out".
  const ratings = useJsonFetch<HireRatings>("/api/pipeline/outcomes");

  const holdoutVerdict = verdictFor(holdout.data);
  const leadsWithHoldout = holdoutVerdict != null && holdoutVerdict !== "unknown";
  const arm: CalibrationSource = leadsWithHoldout ? "holdout" : "pipeline";
  const data = leadsWithHoldout ? holdout.data : pipeline.data;
  const error = leadsWithHoldout ? holdout.error : pipeline.error;
  const verdict = leadsWithHoldout ? holdoutVerdict : verdictFor(pipeline.data);

  const { baseRate, baseBrier, skill } = calibrationSkill(data);
  const basePct = baseRate == null ? 0 : Math.round(baseRate * 100);
  const skillPct = skill == null ? null : `${skill > 0 ? "+" : ""}${Math.round(skill * 100)}`;
  // The clean arm still accruing — the horizon Kateřina asked for in place of an
  // empty chart ("the honest curve needs ≈N more decisions").
  const accruing = !leadsWithHoldout && holdout.data != null && !holdout.data.calibrated ? holdout.data : null;

  return (
    <div className="animate-arrive-in space-y-6">
      {/* ---- The verdict ---------------------------------------------------- */}
      <section className={`${PANEL} p-5`}>
        <p className="text-meta uppercase text-coral">{t("instrumentEyebrow")}</p>

        {error ? (
          <p className="mt-2 text-base text-steel">{t("calibrationUnavailable")}</p>
        ) : verdict == null || data == null ? (
          <div className="reveal-quiet mt-2 min-h-[5rem]" aria-hidden />
        ) : (
          (() => {
            const v = TONE[verdict];
            const Icon = v.icon;
            const body =
              verdict === "unknown"
                ? data.calibrated
                  ? // Calibrated but degenerate: enough outcomes, nothing to discriminate.
                    t("verdictDegenerateBody", { n: data.n, basePct })
                  : t("verdictUnknownBody", { n: data.n, min: data.minOutcomes })
                : t(v.body, { brier: data.brier!.toFixed(3), n: data.n, skillPct: skillPct ?? "0", basePct });
            return (
              <>
                <p className="mt-2 flex flex-wrap items-center gap-3">
                  <Icon size={28} className={`shrink-0 ${v.cls}`} aria-hidden />
                  <span className="text-balance font-serif text-h1 leading-tight text-ink">{t(v.title)}</span>
                </p>
                <p className="mt-2 max-w-3xl text-body leading-relaxed text-steel">{body}</p>
                {/* KAT-L1-003 — WHAT THE VERDICT IS ABOUT, beside the verdict. Both
                    arms above are read on the default (advance) axis by construction
                    (neither fetch passes ?outcome), so this scope is unconditional:
                    Interview, Offer and Hired are ONE success label here, and the
                    headline may not read as a verdict on the score in general. */}
                <p className="mt-2 max-w-3xl text-body leading-relaxed text-ink">
                  <span className="font-medium">{t("scopeLabel")}</span> {t("scopeAdvance")}
                </p>
                {/* …and the hire question itself, answered or given a horizon (G1:
                    a stated horizon, never an empty chart). It needs only stage data,
                    so it is a real measurement today, not a promise. */}
                {hired.data ? (
                  <p className="mt-1 max-w-3xl text-body leading-relaxed text-steel">
                    {hired.data.calibrated && hired.data.brier != null
                      ? t("hiredAxisReady", { brier: hired.data.brier.toFixed(3), n: hired.data.n })
                      : t("hiredAxisPending", { n: hired.data.n, min: hired.data.minOutcomes })}{" "}
                    {t("hiredAxisWhere")}
                  </p>
                ) : null}
                {/* KAT-L1-002 — and the third question, which is a MEASUREMENT
                    NOT TAKEN rather than one still accruing: an on-the-job rating
                    is data a human enters, so this states how much of it exists
                    and how much a curve would need, never a curve. */}
                {ratings.data ? (
                  <p className="mt-1 max-w-3xl text-body leading-relaxed text-steel">
                    {ratings.data.hires === 0
                      ? t("hireRatingNone")
                      : ratings.data.rated >= ratings.data.minOutcomes
                        ? t("hireRatingReady", { rated: ratings.data.rated })
                        : t("hireRatingPending", {
                            rated: ratings.data.rated,
                            hires: ratings.data.hires,
                            remaining: ratings.data.minOutcomes - ratings.data.rated,
                          })}{" "}
                    {ratings.data.hires > 0 ? t("hireRatingWhere") : null}
                  </p>
                ) : null}
                {/* The sample is the caveat that governs every other number on
                    this page, so it is stated beside the verdict rather than
                    left for the reader to find in the diagram's footnote. */}
                <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-3 border-t border-stone-200 pt-3">
                  <div>
                    <dt className="text-meta uppercase text-steel">{t("statArm")}</dt>
                    <dd className="font-serif text-h2 leading-none text-ink">
                      {arm === "holdout" ? t("armHoldout") : t("armPipeline")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-meta uppercase text-steel">{t("statOutcomes")}</dt>
                    <dd className="font-serif text-h2 leading-none text-ink nums">{data.n}</dd>
                  </div>
                  <div>
                    <dt className="text-meta uppercase text-steel">{t("statAdvanced")}</dt>
                    <dd className="font-serif text-h2 leading-none text-ink nums">{data.positives}</dd>
                  </div>
                  <div>
                    <dt className="text-meta uppercase text-steel">{t("statBrier")}</dt>
                    <dd className="font-serif text-h2 leading-none text-ink nums">
                      {data.brier == null ? "—" : data.brier.toFixed(3)}
                    </dd>
                  </div>
                  {/* LUC-ANA-2 — the coin-flip tile that used to sit here compared the
                      score against a yardstick this cohort never resembled. */}
                  <div>
                    <dt className="text-meta uppercase text-steel">{t("statBaseBrier")}</dt>
                    <dd className="font-serif text-h2 leading-none text-steel nums">
                      {baseBrier == null ? "—" : baseBrier.toFixed(3)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-meta uppercase text-steel">{t("statSkill")}</dt>
                    <dd className="font-serif text-h2 leading-none text-ink nums">
                      {skillPct == null ? "—" : t("skillValue", { pct: skillPct })}
                    </dd>
                  </div>
                </dl>

                {/* The disclosure the payload has always carried, beside the number
                    it qualifies. Same component the panel below renders, one source. */}
                {data.leakage ? <CalibrationLeakageNote source={arm} leakage={data.leakage} /> : null}

                {accruing ? (
                  <CalibrationAccrualNote
                    source="holdout"
                    n={accruing.n}
                    minOutcomes={accruing.minOutcomes}
                    className="mt-3 rounded-md border border-dashed border-stone-300 bg-stone-50 p-3"
                  />
                ) : null}
              </>
            );
          })()
        )}
      </section>

      {/* ---- The instrument's own readout ----------------------------------- */}
      <Defer strategy="idle">
        <CalibrationPanel />
      </Defer>

      {/* ---- Evidence: what it actually decided ------------------------------ */}
      <section className="border-t border-stone-300 pt-6">
        <p className="text-meta uppercase text-steel">{t("evidenceLabel")}</p>
        <p className="mb-4 mt-1 max-w-2xl text-body leading-relaxed text-steel">{t("evidenceBody")}</p>
        <div className="space-y-6">
          <Defer strategy="visible">
            <DecisionRecordsPanel />
          </Defer>
          <Defer strategy="visible">
            <DecisionLog />
          </Defer>
        </div>
      </section>
    </div>
  );
}
