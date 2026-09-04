import { Clock, Headphones, ListChecks, Mic, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { CHIP_QUIET, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
// The agenda labels are NOT trusted copy — see the scrub below. candidateSafeTopic
// is the shared shape-based sanitizer from the candidate-brief boundary; it is
// pure and dependency-free (only the persona constants ride along), so it is safe
// in this component's server AND client callers alike.
import { candidateSafeTopic } from "@/app/_lib/voice/candidate-brief";

// Candidate-facing left rail shared by the interview portal (server-rendered,
// agenda + readiness tips paint instantly while the client-only voice bundle
// hydrates) and the client-side simulator tab. Kept sync with useTranslations,
// which next-intl resolves in both Server and Client Components — an async
// getTranslations() version would crash when imported from a "use client" tree.
export function InterviewSidebar({
  items,
  durationMin,
  className = "",
}: {
  items: string[];
  durationMin: number;
  className?: string;
}) {
  const t = useTranslations("interview.sidebar");
  // The portal hands `items` straight from `session.runOfShow`, and that IS
  // `chronology[].topic` verbatim (interview-run.ts::buildGroundedInterview) —
  // LLM free text written under an interviewer prompt that says "cover the
  // missing must-haves", so it arrives carrying the recruiter's private gap
  // verdict as a bracketed aside: "Test automation fundamentals (missing
  // must-have)", "Motivation (aspiration mismatch)". Rendering it raw showed the
  // candidate that verdict as an agenda item before the call even started;
  // /api/interview/complete's projection strips runOfShow for exactly this
  // reason. Scrub every label through the shared sanitizer — a SHAPE rule, so a
  // new annotation phrasing lands in the same bracket and is caught too, and a
  // label that is nothing but an aside scrubs to null and drops out entirely.
  const agenda = items.map((raw) => candidateSafeTopic(raw)).filter((label): label is string => label !== null);
  const hasAgenda = agenda.length > 0;
  return (
    <aside className={`space-y-4 ${className}`}>
      {hasAgenda ? (
        <section className={`${PANEL} p-4`}>
          <div className="flex items-center justify-between gap-2">
            <p className={`flex items-center gap-1.5 ${META_LABEL}`}>
              <ListChecks size={14} className="text-moss" /> {t("agendaTitle")}
            </p>
            <span className={`${CHIP_QUIET} inline-flex items-center gap-1 bg-paper`}>
              <Clock size={12} /> {t("durationChip", { min: durationMin })}
            </span>
          </div>
          <ol className="mt-3.5 space-y-2.5">
            {agenda.map((label, i) => (
              <li key={i} className="flex items-start gap-2.5 text-base leading-6 text-ink">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-limewash text-sm font-semibold text-moss">
                  {i + 1}
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3.5 border-t border-stone-200 pt-3 text-sm text-steel">{t("agendaFooter")}</p>
        </section>
      ) : null}

      {/* The readiness panel was the one surface here still hand-rolling the
          panel shell, so it missed Spark Dark's drawn outline entirely. */}
      <section className={`${PANEL} bg-paper/60 p-4`}>
        <p className={`flex items-center gap-1.5 ${META_LABEL}`}>
          <Headphones size={14} className="text-moss" /> {t("beforeTitle")}
        </p>
        <ul className="mt-3.5 space-y-3 text-base leading-6 text-ink">
          <li className="flex items-start gap-2.5">
            <Volume2 size={16} className="mt-0.5 shrink-0 text-steel" />
            <span>{t("tipQuiet")}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <Headphones size={16} className="mt-0.5 shrink-0 text-steel" />
            <span>{t("tipHeadphones")}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <Mic size={16} className="mt-0.5 shrink-0 text-steel" />
            <span>{t("tipMic")}</span>
          </li>
        </ul>
      </section>
    </aside>
  );
}
