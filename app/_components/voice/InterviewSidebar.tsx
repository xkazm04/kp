import { Check, Clock, Headphones, ListChecks, Mic, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { CHIP_QUIET, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
// The agenda labels are NOT trusted copy — see the scrub below. candidateSafeTopic
// is the shared shape-based sanitizer from the candidate-brief boundary; it is
// pure and dependency-free (only the persona constants ride along), so it is safe
// in this component's server AND client callers alike.
import { candidateSafeTopic } from "@/app/_lib/voice/candidate-brief";
import type { CandidateAgendaBlock } from "@/app/_lib/voice/director-types";

// Candidate-facing left rail shared by the interview portal (server-rendered,
// agenda + readiness tips paint instantly while the client-only voice bundle
// hydrates) and the client-side simulator tab. Kept sync with useTranslations,
// which next-intl resolves in both Server and Client Components — an async
// getTranslations() version would crash when imported from a "use client" tree.
//
// LIVE AGENDA (spark ai-interview-parity). Before the call connects this is exactly
// what it always was: the server-rendered run-of-show, painted with the page. Once
// /connect answers, the DIRECTOR's agenda takes over — the same blocks the
// interviewer is actually working through, by the ids every director exchange
// reports — and the rail becomes the candidate's map of where they are: what is
// done, what is happening now, what is left. That is the whole reason the sidebar
// moved into the client tree; nothing else about it changed.
export function InterviewSidebar({
  items,
  durationMin,
  className = "",
  blocks = null,
  activeBlockId = null,
  coveredBlockIds = [],
}: {
  items: string[];
  durationMin: number;
  className?: string;
  /** The connect's candidate agenda projection. Null before connect (and for an
   *  undirected session), and then `items` is what is shown. */
  blocks?: readonly CandidateAgendaBlock[] | null;
  activeBlockId?: string | null;
  coveredBlockIds?: readonly string[];
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
  //
  // The director's titles are built candidate-safe at the source (catalog strings,
  // or kit labels already scrubbed by this same function), but they pass through it
  // again anyway: one sanitizer on one boundary is a rule, two paths with different
  // guarantees is a thing to remember.
  const covered = new Set(coveredBlockIds);
  const agenda: Array<{ key: string; label: string; state: "covered" | "active" | "upcoming" }> =
    blocks && blocks.length > 0
      ? blocks
          .map((b) => ({
            key: b.id,
            label: candidateSafeTopic(b.title),
            state: (covered.has(b.id) ? "covered" : b.id === activeBlockId ? "active" : "upcoming") as
              | "covered"
              | "active"
              | "upcoming",
          }))
          .filter((b): b is { key: string; label: string; state: "covered" | "active" | "upcoming" } => b.label !== null)
      : items
          .map((raw, i) => ({ key: `i${i}`, label: candidateSafeTopic(raw), state: "upcoming" as const }))
          .filter((b): b is { key: string; label: string; state: "upcoming" } => b.label !== null);
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
            {agenda.map((step, i) => (
              <li
                key={step.key}
                // `aria-current="step"` is how a screen reader is told which topic is
                // live; the color change alone says it to nobody who cannot see it.
                aria-current={step.state === "active" ? "step" : undefined}
                className={`flex items-start gap-2.5 rounded-md text-base leading-6 transition-colors ${
                  step.state === "active"
                    ? "-mx-1.5 bg-limewash/60 px-1.5 py-1 font-medium text-ink dark:-rotate-1"
                    : step.state === "covered"
                      ? "text-steel"
                      : "text-ink"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                    step.state === "covered"
                      ? "bg-moss/15 text-moss"
                      : step.state === "active"
                        ? "bg-moss/20 text-moss ring-2 ring-moss"
                        : "bg-limewash text-moss"
                  }`}
                >
                  {step.state === "covered" ? <Check size={12} strokeWidth={3} /> : i + 1}
                </span>
                <span>
                  {step.label}
                  {step.state !== "upcoming" ? (
                    <span className="sr-only">{`, ${step.state === "covered" ? t("stepDone") : t("stepNow")}`}</span>
                  ) : null}
                </span>
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
