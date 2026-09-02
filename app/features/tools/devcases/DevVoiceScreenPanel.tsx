"use client";

// ONE THREAD (gap 4) — the voice screen, next to the evaluation it verifies.
//
// The evaluation's own follow-up questions exist to be asked OUT LOUD: an artifact can
// be wholly LLM-produced, so the questions verify live that the candidate owns the
// decisions in their submission. Until now the surface holding those questions could
// not start the call that asks them — a screen was mintable only from the pipeline
// board, for an entry, which the reviewer here has no id for. So the two halves of one
// candidate's evidence sat on two screens with no path between them.
//
// This renders the missing half in place: the screen's status and its scorecard verdict
// when one exists, and otherwise the SAME minting affordance the board drawer uses
// (PipelineVoiceScreenPanel), pointed at this submission. Deliberately not a second
// create button of its own — one affordance, one endpoint, one set of semantics
// (billing gate, reissue guard, delivery truth), because a copy is how two doors drift
// into two behaviours.

import { useCallback, useEffect, useState } from "react";
import { Check, CircleDashed, Loader2, MicVocal, Phone, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTokenLink } from "@/app/features/hiring/pipeline/PipelineTokenLink";
import { PipelineVoiceScreenPanel } from "@/app/features/hiring/pipeline/PipelineVoiceScreenPanel";
import { StatusChip } from "@/app/_components/StatusChip";
import { interviewStatusTone } from "@/app/_lib/status-tone";
import { RATING_MAX } from "@/app/_lib/format";
import type { Scorecard } from "@/app/_lib/interview-scorecard";
import { isInterviewRecommendation } from "@/app/_lib/interview-recommendation";
import { observedMean } from "./DevHelpers";

/** The session shape this panel reads off `GET /api/interview/by-entry?submission=`.
 *  A deliberately narrow view of InterviewSession — everything else on that row is
 *  either the candidate's verbatim transcript or transport plumbing, neither of which
 *  belongs on a reviewer's assignment surface. */
type ScreenSession = {
  id: string;
  status: string;
  endedAt: string | null;
  scorecard: unknown | null;
};

// ONE THREAD (gap 8) — the local STATUS_TONE table that stood here is gone. It
// painted `created` and `revoked` the same neutral stone, which are opposite facts
// (a link waiting to be dialled vs one that will never be), and `failed` coral,
// which read as an accusation on a surface that also renders real accusations.
// The five states now resolve through app/_lib/status-tone.ts like every other
// axis on the thread. The VERDICT keeps its own colours below, deliberately: a
// recommendation is a judgement, not a status, and the two must not read alike.
const REC_TONE: Record<string, string> = {
  advance: "bg-moss/10 text-moss",
  hold: "bg-amber-100 text-amber-700",
  reject: "bg-coral/15 text-coral",
};

// `observedMean` moved to DevHelpers.ts: the number a reviewer reads as the
// interview's verdict is worth a test, and a "use client" .tsx cannot carry one
// under this runner (node:test + type stripping, no jsdom).

export function DevVoiceScreenPanel({ submissionId }: { submissionId: string }) {
  const t = useTranslations("devcase.voiceScreen");
  // The verdict vocabulary is app-wide (`enums.recommendation`), not this panel's —
  // a second copy of "Advance / Hold / Reject" in the devcase namespace would be four
  // more strings to keep saying the same thing in four languages.
  const tRec = useTranslations("enums.recommendation");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<ScreenSession | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [voiceProvider, setVoiceProvider] = useState<"openai" | "elevenlabs">("openai");
  const voice = useTokenLink("/api/interview/create");

  // A REFETCH does not re-enter the loading state: `loading` is only ever the FIRST
  // read, so a re-read after minting keeps the panel's chrome on screen instead of
  // replacing it with a spinner (a fetch never hides what is already rendered).
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/interview/by-entry?submission=${encodeURIComponent(submissionId)}`);
        const payload = (await r.json()) as { session?: ScreenSession | null };
        if (alive) setSession(r.ok ? payload.session ?? null : null);
      } catch {
        // A lookup failure is not evidence of absence, but the only honest thing this
        // surface can render either way is "no screen on file" plus the affordance to
        // start one. /create's own reissue guard refuses a duplicate live link, so the
        // failure mode of guessing wrong here is a 409, not a second call.
        if (alive) setSession(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [submissionId, reloadKey]);

  if (loading) {
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-md border border-stone-200 bg-paper/60 px-2 py-1.5 text-micro text-steel" aria-live="polite">
        <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden /> {t("loading")}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mt-2">
        <PipelineVoiceScreenPanel
          target={{ submissionId }}
          voiceProvider={voiceProvider}
          onProviderChange={setVoiceProvider}
          voice={voice}
          onCreated={reload}
        />
        {/* The one thing the board drawer never has to say: creating this link also
            puts the candidate on the board, because a screen hangs off a pipeline
            entry and this submission may not have one yet. Stated up front rather
            than discovered afterwards. */}
        <p className="mt-1 text-micro text-steel">{t("promotesHint")}</p>
      </div>
    );
  }

  const scorecard = (session.scorecard ?? null) as Scorecard | null;
  const mean = observedMean(scorecard);
  const rec = isInterviewRecommendation(scorecard?.recommendation) ? scorecard!.recommendation! : null;

  return (
    <div className="mt-2 rounded-md border border-stone-200 bg-white p-2.5 text-micro text-ink">
      <p className="flex flex-wrap items-center gap-1.5 text-micro font-semibold uppercase tracking-wide text-coral">
        <MicVocal size={12} aria-hidden /> {t("title")}
        <StatusChip
          tone={interviewStatusTone(session.status)}
          label={t(`status.${session.status}` as "status.created")}
          className="uppercase"
        />
      </p>

      {rec || mean != null ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {rec ? (
            <span className={`rounded px-1.5 py-0.5 font-semibold uppercase ${REC_TONE[rec]}`}>{tRec(rec)}</span>
          ) : null}
          {mean != null ? (
            <span className="nums rounded bg-paper px-1.5 py-0.5 font-semibold text-ink">
              {t("mean", { mean: mean.toFixed(1), max: RATING_MAX })}
            </span>
          ) : null}
        </div>
      ) : null}

      {scorecard?.summary ? <p className="mt-1.5 text-micro text-steel">{scorecard.summary}</p> : null}

      {/* Three states, kept apart on purpose — a call that has not happened, one that
          happened but was never scored, and one that was. Collapsing the middle into
          "no verdict" is what makes a recruiter wait for a scorecard that is not coming. */}
      {!scorecard ? (
        <p className="mt-1.5 flex items-center gap-1 text-micro text-steel">
          {session.status === "completed" ? (
            <>
              <TriangleAlert size={11} aria-hidden /> {t("completedUnscored")}
            </>
          ) : session.status === "failed" || session.status === "revoked" ? (
            <>
              <TriangleAlert size={11} aria-hidden /> {t("noVerdict")}
            </>
          ) : (
            <>
              <CircleDashed size={11} aria-hidden /> {t("awaitingCall")}
            </>
          )}
        </p>
      ) : (
        <p className="mt-1.5 flex items-center gap-1 text-micro text-steel">
          <Check size={11} aria-hidden /> {t("verdictNote")}
        </p>
      )}

      {/* No re-mint affordance here on purpose: a live link already exists for this
          candidate and reissuing it is an entry-scoped decision the board drawer owns,
          where the recruiter can also see the delivery state and revoke. */}
      <p className="mt-1.5 flex items-center gap-1 text-micro text-steel">
        <Phone size={11} aria-hidden /> {t("boardHint")}
      </p>
    </div>
  );
}
