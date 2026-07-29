"use client";

import { FlaskConical, Lightbulb, MessageCircleQuestion } from "lucide-react";
import { useTranslations } from "next-intl";
import { DEMO_CASE_SCENARIO, STUDENT_SCRIPT } from "@/app/_lib/student-interview";

// Tab 3 of the early-career About page: the interview thought-script. The
// phases live in app/_lib/student-interview — the SAME source the simulator's
// agent brief is built from, so this visualization can never drift from what
// the interviewer actually runs. Split out of StudentsAbout.tsx (now
// AboutStudents.tsx) to keep that file under the 200-line cap.
export function AboutStudentsInterviewScript() {
  const t = useTranslations("about.students");
  // Shown in its CASE-DESIGNED form: the fixed skeleton paired with the probes the
  // demo scenario instantiated from the case, so the combination is visible —
  // personal phases keep the generic probe; highlighted phases draw theirs from
  // the role's case (the generic template shown muted underneath).
  return (
    <div>
      <p className="text-base text-steel">
        {t.rich("scriptIntro", {
          min: DEMO_CASE_SCENARIO.durationMin,
          b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
        })}
      </p>

      <div className="mt-3 rounded-lg border border-coral/30 bg-coral/5 p-3">
        <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
          <FlaskConical size={13} aria-hidden /> {t("narratedCase")}
        </p>
        <p className="mt-1 text-sm text-ink">{DEMO_CASE_SCENARIO.caseIntro}</p>
      </div>

      <ol className="mt-4 space-y-3">
        {DEMO_CASE_SCENARIO.phases.map((p, i) => {
          const generic = STUDENT_SCRIPT[i];
          const fromCase = Boolean(p.caseRef);
          return (
            <li
              key={p.phase}
              className={`rounded-lg border p-3 ${fromCase ? "border-coral/30 bg-coral/5" : "border-stone-200 bg-paper/40"}`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-coral/10 text-sm font-semibold nums text-coral">
                  {i + 1}
                </span>
                <p className="font-medium text-ink">{p.phase}</p>
                <span className="text-meta text-steel nums">{p.minutes}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-meta font-medium ${
                    fromCase ? "bg-coral/10 text-coral" : "bg-stone-100 text-steel"
                  }`}
                >
                  {fromCase ? t("fromCase") : t("personal")}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-steel">{p.goal}</p>
              <p className="mt-2 flex items-start gap-1.5 text-sm text-ink">
                <MessageCircleQuestion size={15} className="mt-0.5 shrink-0 text-coral" aria-hidden />
                <span className="italic">{p.probe}</span>
              </p>
              {fromCase && generic ? (
                <p className="mt-1 pl-6 text-sm text-steel">
                  {t("genericReplaces")} <span className="italic">{generic.probe}</span>
                </p>
              ) : null}
              <p className="mt-1.5 flex items-start gap-1.5 text-sm text-steel">
                <Lightbulb size={14} className="mt-0.5 shrink-0 text-dial-amber" aria-hidden />
                <span>
                  <span className="font-medium text-ink">{t("listenFor")}</span> {p.listenFor}
                </span>
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {p.feeds.map((f) => (
                  <span key={f} className="rounded-full bg-stone-100 px-2 py-0.5 text-meta font-medium text-steel">
                    {f}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-sm text-steel">{t("scriptFootnote")}</p>
    </div>
  );
}
