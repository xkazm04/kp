"use client";

// The pre-session panel (mode description + constructs + Start button), split
// out of InterviewSimTab.tsx.
import { Loader2, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { QUICK_SCREEN_MIN } from "@/app/_lib/interview-duration.mjs";
import { DEMO_CASE_SCENARIO } from "@/app/_lib/student-interview";
import type { SimMode } from "./InterviewModeCards";

export function InterviewStartPanel({
  mode,
  studentish,
  constructs,
  busy,
  error,
  onStart,
}: {
  mode: SimMode;
  studentish: boolean;
  constructs: string[];
  busy: boolean;
  error: string | null;
  onStart: () => void;
}) {
  const t = useTranslations("interviewSim");

  return (
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
        onClick={onStart}
        disabled={busy}
        className={`${BTN_PRIMARY} mt-4 h-10 px-4 text-base`}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
        {busy ? t("creating") : t("startSim")}
      </button>
    </div>
  );
}
