import type { useTranslations } from "next-intl";
import type { ScorecardEntities } from "@/app/_lib/interview-scorecard";

// The closing read-back turned into a cue (scorecard-v5): the technologies the
// candidate confirmed (neutral), the ASR mishears they corrected ("heard → meant"),
// and the ones only heard earlier and never confirmed (flagged as a possible
// transcription error). Structural distinctions (arrow, struck heard text, an
// explicit flag) carry meaning so it never rests on color alone; renders nothing
// when there was no read-back — no empty chrome, exactly like the telemetry strip.
//
// ONE component for both surfaces (idea: dedupe the two near-identical copies that
// had shipped in sub_schedule/InterviewTranscriptModal and sub_pipeline/
// CandidateDrawer — the exact copy-drift class the shared normalizer was built to
// end). The two only ever differed in the surrounding density: the transcript modal
// spaces its strips a touch roomier than the drawer bundle. `density` selects that
// spacing so each surface renders byte-identically to before.

type Density = "roomy" | "compact";

// Per-density spacing — the ONLY thing that varied between the two former copies.
// roomy = InterviewTranscriptModal (mt-3 / p-2.5 / mt-1.5),
// compact = CandidateDrawer bundle (mt-2 / p-2 / mt-1).
const SPACING: Record<Density, { container: string; body: string; note: string }> = {
  roomy: { container: "mt-3 p-2.5", body: "mt-1.5", note: "mt-1.5" },
  compact: { container: "mt-2 p-2", body: "mt-1", note: "mt-1" },
};

export function ReadbackEntitiesStrip({
  entities,
  t,
  density = "roomy",
}: {
  entities: ScorecardEntities;
  t: ReturnType<typeof useTranslations<"scheduleTab.transcript">>;
  density?: Density;
}) {
  const { confirmed, corrected, unconfirmed } = entities;
  const s = SPACING[density];
  return (
    <div className={`${s.container} rounded-md border border-stone-200 bg-stone-50`}>
      <p className="text-meta uppercase tracking-wide text-steel">{t("readbackHeading")}</p>
      <div className={`${s.body} flex flex-wrap gap-1.5`}>
        {confirmed.map((tech, i) => (
          <span key={`c${i}`} className="rounded-full bg-stone-100 px-2 py-0.5 text-meta font-semibold text-ink">
            {tech}
          </span>
        ))}
        {corrected.map((c, i) => (
          <span
            key={`x${i}`}
            className="rounded-full bg-dial-amber/15 px-2 py-0.5 text-meta font-semibold text-ink"
            title={t("readbackCorrectedHint")}
          >
            <span className="text-steel line-through">{c.heard}</span> → {c.meant}
          </span>
        ))}
        {unconfirmed.map((tech, i) => (
          <span
            key={`u${i}`}
            className="rounded-full bg-dial-amber/15 px-2 py-0.5 text-meta font-semibold text-ink"
            title={t("readbackUnconfirmedHint")}
          >
            {tech} · {t("readbackUnconfirmedFlag")}
          </span>
        ))}
      </div>
      <p className={`${s.note} text-meta text-steel`}>{t("readbackNote")}</p>
    </div>
  );
}
