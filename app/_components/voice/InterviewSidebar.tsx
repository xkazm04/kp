import { Clock, Headphones, ListChecks, Mic, Volume2 } from "lucide-react";

// Candidate-facing left rail for the interview portal. Rendered on the server
// (no realtime SDK), so the agenda + readiness tips paint instantly while the
// client-only voice bundle hydrates in the main column. Moving the run-of-show
// here (it used to be a 260px column inside VoiceInterview) hands the live
// transcript the full remaining width.
export function InterviewSidebar({ items, className = "" }: { items: string[]; className?: string }) {
  const hasAgenda = items.length > 0;
  return (
    <aside className={`space-y-4 ${className}`}>
      {hasAgenda ? (
        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-meta uppercase text-steel">
              <ListChecks size={14} className="text-moss" /> Today’s agenda
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-sm text-steel">
              <Clock size={12} /> ~5 min
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
          <p className="mt-3.5 border-t border-stone-200 pt-3 text-sm text-steel">
            Your interviewer guides you through each step — there’s nothing to prepare.
          </p>
        </section>
      ) : null}

      <section className="rounded-lg border border-stone-200 bg-paper/60 p-4">
        <p className="flex items-center gap-1.5 text-meta uppercase text-steel">
          <Headphones size={14} className="text-moss" /> Before you start
        </p>
        <ul className="mt-3.5 space-y-3 text-base leading-6 text-ink">
          <li className="flex items-start gap-2.5">
            <Volume2 size={16} className="mt-0.5 shrink-0 text-steel" />
            <span>Find a quiet spot with little background noise.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <Headphones size={16} className="mt-0.5 shrink-0 text-steel" />
            <span>Use headphones if you can — it keeps the turn-taking clean.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <Mic size={16} className="mt-0.5 shrink-0 text-steel" />
            <span>Allow microphone access when your browser prompts you.</span>
          </li>
        </ul>
      </section>
    </aside>
  );
}
