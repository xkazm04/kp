"use client";

import { useState } from "react";
import { Briefcase, GraduationCap, Loader2, Play, RotateCcw } from "lucide-react";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { InterviewSidebar } from "@/app/_components/voice/InterviewSidebar";
import { VoiceInterviewClient } from "@/app/_components/voice/VoiceInterviewClient";
import { QUICK_SCREEN_MIN } from "@/app/_lib/interview-duration.mjs";
import {
  REGULAR_DEMO_RUN_OF_SHOW,
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

type SimMode = "student" | "regular";
type Session = { token: string; candidateLabel: string | null; jobTitle: string | null };

const MODES: { id: SimMode; label: string; blurb: string; icon: typeof GraduationCap }[] = [
  {
    id: "student",
    label: "Student (early-career script)",
    blurb: "Agent leads the six-phase thought-script — mental model, coachability, calibration.",
    icon: GraduationCap,
  },
  {
    id: "regular",
    label: "Regular candidate",
    blurb: "Standard quick screen — a few questions on recent experience with follow-ups.",
    icon: Briefcase,
  },
];

export function InterviewSimTab() {
  const [mode, setMode] = useState<SimMode>("student");
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const student = mode === "student";
  const runOfShow = student ? studentRunOfShow() : REGULAR_DEMO_RUN_OF_SHOW;
  const durationMin = student ? STUDENT_SCRIPT_MIN : QUICK_SCREEN_MIN;
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
      if (!res.ok || !data.token) throw new Error(data.error || "Couldn't create the simulation.");
      setSession({ token: data.token, candidateLabel: data.candidateLabel ?? null, jobTitle: data.jobTitle ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the simulation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">Interview simulator</p>
        <h2 className="mt-1 font-serif text-display text-ink">Take the screen yourself</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          The exact AI-led first round a candidate gets at their tokenized link — switched between the two
          evaluation lenses. Demo sessions aren&apos;t linked to a pipeline entry: the transcript is captured,
          but no scorecard is generated and nothing in the pipeline moves.
        </p>
      </header>

      <div className="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Simulation mode">
        {MODES.map((m) => {
          const active = m.id === mode;
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(m.id)}
              className={`focus-ring rounded-lg border p-3 text-left transition-colors ${
                active ? "border-coral/40 bg-coral/5" : "border-stone-200 bg-paper hover:border-stone-300"
              }`}
            >
              <p className="flex items-center gap-1.5 font-medium text-ink">
                <Icon size={16} className={active ? "text-coral" : "text-steel"} /> {m.label}
              </p>
              <p className="mt-1 text-sm text-steel">{m.blurb}</p>
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
                  Simulating <span className="font-medium text-ink">{session.candidateLabel}</span>
                  {session.jobTitle ? <> · {session.jobTitle}</> : null}
                </p>
                <button
                  type="button"
                  onClick={() => setSession(null)}
                  className="focus-ring inline-flex h-8 items-center gap-1 rounded-md border border-stone-200 px-2.5 text-sm font-medium text-ink hover:border-coral/40"
                >
                  <RotateCcw size={13} /> Start over
                </button>
              </div>
              <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
                <VoiceInterviewClient
                  token={session.token}
                  candidateLabel={session.candidateLabel ?? undefined}
                  jobTitle={session.jobTitle ?? undefined}
                />
              </div>
              <AiDisclosure className="mt-5" />
            </>
          ) : (
            <div className="rounded-lg border border-stone-200 bg-paper/40 p-5">
              {student ? (
                <>
                  <p className="text-base text-ink">
                    The agent <span className="font-medium">leads</span> the conversation through the six-phase
                    early-career script — concrete → mechanism → counterfactual → metacognitive — and injects one
                    deliberate hint mid-problem to read coachability live. Every phase exists to produce a
                    quotable observation for a rubric construct:
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {constructs.map((c) => (
                      <span key={c} className="rounded-full bg-stone-100 px-2 py-0.5 text-meta font-medium text-steel">
                        {c}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-steel">
                    In the real flow this transcript is scored on the early-career BARS rubric and compared
                    within the student cohort. The full script is documented in About → Early-career students.
                  </p>
                </>
              ) : (
                <p className="text-base text-ink">
                  The standard ungrounded quick screen: the agent asks a few short questions about recent
                  experience with brief follow-ups, under {QUICK_SCREEN_MIN} minutes. In the real flow the
                  transcript is scored on the five experienced-hire axes.
                </p>
              )}
              {error ? <p className="mt-3 text-sm text-coral">{error}</p> : null}
              <button
                type="button"
                onClick={start}
                disabled={busy}
                className="focus-ring mt-4 inline-flex h-10 items-center gap-1.5 rounded-md bg-coral px-4 text-base font-semibold text-white hover:bg-coral/90 disabled:opacity-50"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                {busy ? "Creating session…" : "Start simulation"}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
