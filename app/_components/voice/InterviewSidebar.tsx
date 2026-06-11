import { Clock, Headphones, ListChecks, Mic, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { durationChip } from "@/app/_lib/interview-duration.mjs";

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
  const hasAgenda = items.length > 0;
  return (
    <aside className={`space-y-4 ${className}`}>
      {hasAgenda ? (
        <section className={`${PANEL} p-4`}>
          <div className="flex items-center justify-between gap-2">
            <p className={`flex items-center gap-1.5 ${META_LABEL}`}>
              <ListChecks size={14} className="text-moss" /> {t("agendaTitle")}
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-sm text-steel">
              <Clock size={12} /> {durationChip(durationMin)}
            </span>
          </div>
          <ol className="mt-3.5 space-y-2.5">
            {items.map((t, i) => (
              <li key={i} className="flex items-start gap-2.5 text-base leading-6 text-ink">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-limewash text-sm font-semibold text-moss">
                  {i + 1}
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3.5 border-t border-stone-200 pt-3 text-sm text-steel">{t("agendaFooter")}</p>
        </section>
      ) : null}

      <section className="rounded-lg border border-stone-200 bg-paper/60 p-4">
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
