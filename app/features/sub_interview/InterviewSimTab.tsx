"use client";

import { useState } from "react";
import { Briefcase, FlaskConical, GraduationCap, Loader2, Play, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, INTRO, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { InterviewSidebar } from "@/app/_components/voice/InterviewSidebar";
import { VoiceInterviewClient } from "@/app/_components/voice/VoiceInterviewClient";
import { QUICK_SCREEN_MIN } from "@/app/_lib/interview-duration.mjs";
import {
  DEMO_CASE_SCENARIO,
  REGULAR_DEMO_RUN_OF_SHOW,
  scenarioRunOfShow,
  STUDENT_SCRIPT,
  STUDENT_SCRIPT_MIN,
  studentRunOfShow,
} from "@/app/_lib/student-interview";

// Interview simulator: experience the AI-led first round exactly as a candidate
// would (the same VoiceInterview + sidebar the /interview/[token] portal uses),
// switched between the two lenses. "Student" runs the early-career thought-script
// — the agent LEADS phase by phase, including the deliberate coachability hint;
// "Regular" runs the standard quick screen. Demo sessions carry no pipeline
// entry: the transcript is stored, but no scorecard is synthesized and nothing
// in the pipeline moves.

type SimMode = "student" | "student-case" | "regular";
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
    <section className={`${PANEL} p-5`}>
      <header className="border-b border-stone-200 pb-4">
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <SectionTitle className="mt-1">{t("title")}</SectionTitle>
        <p className={`mt-2 max-w-3xl ${INTRO}`}>{t("intro")}</p>
      </header>

      <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("modeAria")}>
        {MODES.map((m, i) => {
          const active = m.id === mode;
          const Icon = m.icon;
          // Spark Dark: unpicked mode cards rest a degree off-axis like the
          // landing's feature stickers; choosing (or hovering) one rights it.
          const tilt = active ? "" : i % 2 ? "dark:rotate-1 dark:hover:rotate-0" : "dark:-rotate-1 dark:hover:rotate-0";
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(m.id)}
              className={`focus-ring rounded-lg border p-3 text-left transition-all dark:rounded-2xl ${tilt} ${
                active ? "border-coral/40 bg-coral/5 dark:shadow-sticker-sm" : "border-stone-200 bg-paper hover:border-stone-300"
              }`}
            >
              <p className="flex items-center gap-1.5 font-medium text-ink">
                <Icon size={16} className={active ? "text-coral" : "text-steel"} /> {t(`modes.${m.id}.label` as Parameters<typeof t>[0])}
              </p>
              <p className="mt-1 text-sm text-steel">{t(`modes.${m.id}.blurb` as Parameters<typeof t>[0])}</p>
            </button>
          );
        })}
      </div>

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
              <AiDisclosure className="mt-5" />
            </>
          ) : (
            <div className={`${PANEL_SUNKEN} p-5`}>
              {studentish ? (
                <>
                  {mode === "student-case" ? (
                    <p className="text-base text-ink">
                      {t.rich("caseDescCase", {
                        case: DEMO_CASE_SCENARIO.caseIntro.split(":")[0],
                        b: (chunks) => <span className="font-medium">{chunks}</span>,
                        em: (chunks) => <em className="text-steel">{chunks}</em>,
                      })}
                    </p>
                  ) : (
                    <p className="text-base text-ink">
                      {t.rich("caseDescGeneric", { b: (chunks) => <span className="font-medium">{chunks}</span> })}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1">
                    {constructs.map((c) => (
                      <span key={c} className="rounded-full bg-stone-100 px-2 py-0.5 text-meta font-medium text-steel">
                        {c}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-steel">{t("studentFooter")}</p>
                </>
              ) : (
                <p className="text-base text-ink">{t("regularDesc", { min: QUICK_SCREEN_MIN })}</p>
              )}
              {error ? <p className="mt-3 text-sm text-coral">{error}</p> : null}
              <button
                type="button"
                onClick={start}
                disabled={busy}
                className={`${BTN_PRIMARY} mt-4 h-10 px-4 text-base`}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                {busy ? t("creating") : t("startSim")}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
