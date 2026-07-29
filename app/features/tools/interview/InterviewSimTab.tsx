"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Briefcase, FlaskConical, GraduationCap, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { BTN_SECONDARY, EYEBROW, INTRO, PANEL } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { InterviewSidebar } from "@/app/_components/voice/InterviewSidebar";
import { QUICK_SCREEN_MIN } from "@/app/_lib/interview-duration.mjs";
import {
  DEMO_CASE_SCENARIO,
  REGULAR_DEMO_RUN_OF_SHOW,
  scenarioRunOfShow,
  STUDENT_SCRIPT,
  STUDENT_SCRIPT_MIN,
  studentRunOfShow,
} from "@/app/_lib/student-interview";
import { InterviewModeCards, type SimMode } from "./InterviewModeCards";
import { InterviewStartPanel } from "./InterviewStartPanel";
import { InterviewAttachToCandidate } from "./InterviewAttachToCandidate";

// Tier 3 (docs/LOADING_CHOREOGRAPHY.md): the realtime voice surface (WebRTC /
// AudioContext client, transcript, controls) is only needed once a session is
// started, so it gets its own chunk instead of riding in the tab's entry
// bundle. VoiceInterviewClient already skips SSR and lazy-loads the actual
// VoiceInterview implementation internally; importing it dynamically here
// keeps even that thin wrapper out of the first paint's module graph. The
// loading gap is a quiet reserved box, sized to the interview panel it fills.
const VoiceInterviewClient = dynamic(
  () => import("@/app/_components/voice/VoiceInterviewClient").then((m) => ({ default: m.VoiceInterviewClient })),
  { ssr: false, loading: () => <div className="reveal-quiet min-h-[20rem]" aria-hidden /> }
);

// Interview simulator: experience the AI-led first round exactly as a candidate
// would (the same VoiceInterview + sidebar the /interview/[token] portal uses),
// switched between the two lenses. "Student" runs the early-career thought-script
// — the agent LEADS phase by phase, including the deliberate coachability hint;
// "Regular" runs the standard quick screen. Demo sessions carry no pipeline
// entry: the transcript is stored, but no scorecard is synthesized and nothing
// in the pipeline moves.

type Session = { token: string; candidateLabel: string | null; jobTitle: string | null };

// Structural mode definitions; label/blurb come from the `interviewSim.modes.<id>.*` catalog.
const MODES: { id: SimMode; icon: typeof GraduationCap }[] = [
  { id: "student", icon: GraduationCap },
  { id: "student-case", icon: FlaskConical },
  { id: "regular", icon: Briefcase },
];

export function InterviewSimTab() {
  const t = useTranslations("interviewSim");
  const [mode, setMode] = useState<SimMode>("student");
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const studentish = mode !== "regular";
  const runOfShow =
    mode === "student" ? studentRunOfShow() : mode === "student-case" ? scenarioRunOfShow(DEMO_CASE_SCENARIO) : REGULAR_DEMO_RUN_OF_SHOW;
  const durationMin =
    mode === "student" ? STUDENT_SCRIPT_MIN : mode === "student-case" ? DEMO_CASE_SCENARIO.durationMin : QUICK_SCREEN_MIN;
  const constructs = Array.from(new Set(STUDENT_SCRIPT.flatMap((p) => p.feeds)));

  function pick(next: SimMode) {
    if (next === mode) return;
    setMode(next);
    setSession(null);
    setError(null);
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/interview/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        token?: string;
        candidateLabel?: string | null;
        jobTitle?: string | null;
        error?: string;
      };
      if (!res.ok || !data.token) throw new Error(data.error || t("createFailed"));
      setSession({ token: data.token, candidateLabel: data.candidateLabel ?? null, jobTitle: data.jobTitle ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    // Tier 1 (docs/LOADING_CHOREOGRAPHY.md): header, mode picker and the
    // sidebar/panel grid are the tab's three real sections — none depend on a
    // fetch, so they all commit on the first frame and cascade in via
    // stagger-children. No aria-busy: nothing here is ever "loading" on tab
    // entry (the pipeline fetch below is a user-triggered widget, not a gate).
    <section className={`stagger-children ${PANEL} p-5`}>
      <header className="border-b border-stone-200 pb-4">
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <SectionTitle className="mt-1">{t("title")}</SectionTitle>
        <p className={`mt-2 max-w-3xl ${INTRO}`}>{t("intro")}</p>
      </header>

      <InterviewModeCards modes={MODES} mode={mode} onPick={pick} />

      <div className="mt-5 grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <InterviewSidebar items={runOfShow} durationMin={durationMin} className="lg:sticky lg:top-6" />

        <div>
          {session ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm text-steel">
                  {t.rich("simulating", {
                    name: session.candidateLabel ?? "",
                    job: session.jobTitle ? ` · ${session.jobTitle}` : "",
                    b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
                  })}
                </p>
                <button
                  type="button"
                  onClick={() => setSession(null)}
                  className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}
                >
                  <RotateCcw size={13} /> {t("startOver")}
                </button>
              </div>
              <div className={`${PANEL} p-5`}>
                <VoiceInterviewClient
                  token={session.token}
                  candidateLabel={session.candidateLabel ?? undefined}
                  jobTitle={session.jobTitle ?? undefined}
                />
              </div>
              {/* d95fed6d — practice runs used to evaporate ("Start over" was the
                  only exit). Attaching notes the session on a real candidate's
                  record (an event in their drawer history) — annotation only,
                  the sim still moves nothing in the pipeline. */}
              <InterviewAttachToCandidate token={session.token} />
              <AiDisclosure className="mt-5" />
            </>
          ) : (
            <InterviewStartPanel
              mode={mode}
              studentish={studentish}
              constructs={constructs}
              busy={busy}
              error={error}
              onStart={start}
            />
          )}
        </div>
      </div>
    </section>
  );
}
