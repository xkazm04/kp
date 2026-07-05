"use client";

import { useRef, useState } from "react";
import { Briefcase, FlaskConical, GraduationCap, Link2, Loader2, Play, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { Select } from "@/app/_components/Select";
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

// d95fed6d — note this practice session on a real candidate's record. Lazy:
// the board is fetched only when the recruiter opens the control. Posting
// records a `sim_attached` event (drawer history); nothing else moves.
function AttachToCandidate({ token }: { token: string }) {
  const t = useTranslations("interviewSim.attach");
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<{ id: string; candidateLabel: string; jobTitle: string | null }[] | null>(null);
  const [sel, setSel] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  // A failed fetch must NOT read as "no candidates" (the prior `.catch(setEntries([]))`).
  const [loadError, setLoadError] = useState(false);

  const loadEntries = () => {
    setLoadError(false);
    setEntries(null); // back to the loading state for a retry
    fetch("/api/pipeline")
      .then(async (r) => {
        if (!r.ok) throw new Error("pipeline fetch failed");
        return r.json();
      })
      .then((p) => {
        const list = ((p.entries ?? []) as { id: string; candidateLabel: string; jobTitle: string | null; status: string }[])
          .filter((e) => e.status === "active")
          .map((e) => ({ id: e.id, candidateLabel: e.candidateLabel, jobTitle: e.jobTitle }));
        setEntries(list);
        setSel((cur) => cur || list[0]?.id || "");
      })
      .catch(() => {
        setLoadError(true);
        setEntries([]); // leave the loading state; loadError drives the error UI
      });
  };

  const toggle = () => {
    setOpen((o) => !o);
    if (entries === null && !loadError) loadEntries();
  };

  const attach = async () => {
    if (state === "busy" || !sel) return;
    setState("busy");
    try {
      const r = await fetch("/api/interview/simulate/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, entryId: sel }),
      });
      if (!r.ok) throw new Error();
      setState("done");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="mt-3">
      {state === "done" ? (
        <p className="text-sm font-medium text-moss">{t("done")}</p>
      ) : (
        <>
          <button type="button" onClick={toggle} aria-expanded={open} className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}>
            <Link2 size={13} /> {t("toggle")}
          </button>
          {open ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {loadError ? (
                <p className="text-sm text-coral" role="alert">
                  {t("loadFailed")}{" "}
                  <button type="button" onClick={loadEntries} className="focus-ring font-semibold underline">
                    {t("retry")}
                  </button>
                </p>
              ) : entries === null ? (
                <p className="text-sm text-steel">{t("loading")}</p>
              ) : entries.length === 0 ? (
                <p className="text-sm text-steel">{t("noCandidates")}</p>
              ) : (
                <>
                  <label className="sr-only" htmlFor="sim-attach-entry">
                    {t("selectAria")}
                  </label>
                  <Select
                    id="sim-attach-entry"
                    ariaLabel={t("selectAria")}
                    value={sel}
                    onChange={setSel}
                    size="sm"
                    className="h-8"
                    options={entries.map((e) => ({ value: e.id, label: `${e.candidateLabel}${e.jobTitle ? ` — ${e.jobTitle}` : ""}` }))}
                  />
                  <button type="button" onClick={attach} disabled={state === "busy"} className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}>
                    {state === "busy" ? t("attaching") : t("attach")}
                  </button>
                </>
              )}
              {state === "error" ? <p className="text-sm text-coral">{t("failed")}</p> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

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

  // Roving-tabindex keyboard support for the mode radiogroup (the cards already carry
  // role="radio"/aria-checked but were Tab-only): arrow keys move + select the next mode.
  const modeCardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  function onModeKeyDown(e: React.KeyboardEvent) {
    const idx = MODES.findIndex((m) => m.id === mode);
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % MODES.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + MODES.length) % MODES.length;
    else return;
    e.preventDefault();
    pick(MODES[next].id);
    modeCardRefs.current[next]?.focus();
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

      <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("modeAria")} onKeyDown={onModeKeyDown}>
        {MODES.map((m, i) => {
          const active = m.id === mode;
          const Icon = m.icon;
          // Spark Dark: unpicked mode cards rest a degree off-axis like the
          // landing's feature stickers; choosing (or hovering) one rights it.
          const tilt = active ? "" : i % 2 ? "dark:rotate-1 dark:hover:rotate-0" : "dark:-rotate-1 dark:hover:rotate-0";
          return (
            <button
              key={m.id}
              ref={(el) => {
                modeCardRefs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
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
              {/* d95fed6d — practice runs used to evaporate ("Start over" was the
                  only exit). Attaching notes the session on a real candidate's
                  record (an event in their drawer history) — annotation only,
                  the sim still moves nothing in the pipeline. */}
              <AttachToCandidate token={session.token} />
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
