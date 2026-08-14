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
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { PANEL } from "@/app/_components/ui/recipes";
import { Defer } from "@/app/_components/ui/Defer";
import { CalibrationPanel, DecisionRecordsPanel, DecisionLog } from "./sectionChunks";

type Payload = {
  n: number;
  positives: number;
  brier: number | null;
  calibrated: boolean;
  minOutcomes: number;
};

// Brier is a mean squared error: LOWER is better, 0.25 is the score you get by
// guessing 50% every time. So "better than a coin" is the floor a screening
// score has to clear before anyone should let it auto-decide.
const COIN_FLIP_BRIER = 0.25;
const GOOD_BRIER = 0.18;

export function QualityInstrument() {
  const t = useTranslations("analytics.quality");
  // The pipeline match score — the number screening auto-decisions actually act
  // on. Deliberately not the analysis score, which gates nothing.
  const { data, error } = useJsonFetch<Payload>("/api/analytics/calibration?source=pipeline");

  const verdict = (() => {
    if (error || data == null) return null;
    if (!data.calibrated) return "unknown" as const;
    if (data.brier == null) return "unknown" as const;
    if (data.brier <= GOOD_BRIER) return "trustworthy" as const;
    if (data.brier <= COIN_FLIP_BRIER) return "weak" as const;
    return "untrustworthy" as const;
  })();

  const TONE = {
    trustworthy: { icon: CheckCircle2, cls: "text-moss", title: "verdictGood", body: "verdictGoodBody" },
    weak: { icon: AlertTriangle, cls: "text-dial-amber", title: "verdictWeak", body: "verdictWeakBody" },
    untrustworthy: { icon: AlertTriangle, cls: "text-coral", title: "verdictBad", body: "verdictBadBody" },
    unknown: { icon: HelpCircle, cls: "text-steel", title: "verdictUnknown", body: "verdictUnknownBody" },
  } as const;

  return (
    <div className="animate-arrive-in space-y-6">
      {/* ---- The verdict ---------------------------------------------------- */}
      <section className={`${PANEL} p-5`}>
        <p className="text-meta uppercase text-coral">{t("instrumentEyebrow")}</p>

        {error ? (
          <p className="mt-2 text-base text-steel">{t("calibrationUnavailable")}</p>
        ) : verdict == null ? (
          <div className="reveal-quiet mt-2 min-h-[5rem]" aria-hidden />
        ) : (
          (() => {
            const v = TONE[verdict];
            const Icon = v.icon;
            return (
              <>
                <p className="mt-2 flex flex-wrap items-center gap-3">
                  <Icon size={28} className={`shrink-0 ${v.cls}`} aria-hidden />
                  <span className="text-balance font-serif text-h1 leading-tight text-ink">{t(v.title)}</span>
                </p>
                <p className="mt-2 max-w-3xl text-body leading-relaxed text-steel">
                  {verdict === "unknown"
                    ? t(v.body, { n: data!.n, min: data!.minOutcomes })
                    : t(v.body, { brier: data!.brier!.toFixed(3), n: data!.n })}
                </p>
                {/* The sample is the caveat that governs every other number on
                    this page, so it is stated beside the verdict rather than
                    left for the reader to find in the diagram's footnote. */}
                <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-3 border-t border-stone-200 pt-3">
                  <div>
                    <dt className="text-meta uppercase text-steel">{t("statOutcomes")}</dt>
                    <dd className="font-serif text-h2 leading-none text-ink nums">{data!.n}</dd>
                  </div>
                  <div>
                    <dt className="text-meta uppercase text-steel">{t("statAdvanced")}</dt>
                    <dd className="font-serif text-h2 leading-none text-ink nums">{data!.positives}</dd>
                  </div>
                  <div>
                    <dt className="text-meta uppercase text-steel">{t("statBrier")}</dt>
                    <dd className="font-serif text-h2 leading-none text-ink nums">
                      {data!.brier == null ? "—" : data!.brier.toFixed(3)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-meta uppercase text-steel">{t("statCoin")}</dt>
                    <dd className="font-serif text-h2 leading-none text-steel nums">{COIN_FLIP_BRIER.toFixed(2)}</dd>
                  </div>
                </dl>
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
