"use client";

// Variant B — "the opening move".
//
// Metaphor: an empty catalog is not a hole, it's a *briefing* — the first role is
// a move the recruiter is about to make, so the surface reads as an editorial
// brief: eyebrow + serif display title, the traced job-posting glyph as a hero
// beside the copy, two concrete routes to a first role (draft one, or import an
// ad you already have), and a trail of what a live role switches on downstream.
// Differs from the baseline and from Variant A by answering "what do I gain?" —
// the chain is shown *forwards* (job → channels → pipeline → decisions) as
// reachable destinations, not only backwards to the missing upstream step.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ClipboardPaste, FileText, type LucideIcon } from "lucide-react";
import { buildTabSwitchUrl, type WorkspaceTabId } from "@/app/features/shell/tabs";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { JOBS_GLYPH } from "@/app/_components/glyph/glyphs/jobsGlyph";
import { BTN_PRIMARY, CHIP, EYEBROW, PANEL, PANEL_SUNKEN, TITLE_DISPLAY, META_LABEL } from "@/app/_components/ui/recipes";

// One route to a first role. Either a real navigation (`tab`) or an in-page
// pointer (no `tab`) — a card that cannot navigate never renders as a button.
function RouteCard({
  step,
  icon: Icon,
  title,
  body,
  cta,
  tab,
  search,
}: {
  step: number;
  icon: LucideIcon;
  title: string;
  body: string;
  cta: string;
  tab?: WorkspaceTabId;
  search: string;
}) {
  return (
    <div className={`${PANEL} flex flex-col gap-2 p-4 text-left`}>
      <div className="flex items-center gap-2">
        <span className={META_LABEL}>Route {step}</span>
        <Icon size={14} className="text-moss" aria-hidden />
      </div>
      <p className="text-base font-semibold text-ink">{title}</p>
      <p className="text-sm text-steel">{body}</p>
      {tab ? (
        <Link href={buildTabSwitchUrl(tab, search)} className={`${BTN_PRIMARY} mt-1 h-9 self-start px-3 text-sm`}>
          {cta} <ArrowRight size={13} aria-hidden />
        </Link>
      ) : (
        <p className="mt-1 text-sm font-semibold text-coral">{cta}</p>
      )}
    </div>
  );
}

// What a single live role switches on downstream — the payoff, as real tabs.
const UNLOCKS: { tab: WorkspaceTabId; label: string }[] = [
  { tab: "channels", label: "Channels open" },
  { tab: "pipeline", label: "Candidates flow" },
  { tab: "decisions", label: "Decisions queue" },
];

export function JobsEmptyLaunchpad() {
  const search = useSearchParams();
  const searchStr = search.toString();
  return (
    <div className={`${PANEL_SUNKEN} p-6`}>
      <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:text-left">
        <MotionizedGlyph
          data={JOBS_GLYPH.data}
          viewBox={JOBS_GLYPH.viewBox}
          className="h-24 w-24 shrink-0 sm:h-28 sm:w-28"
        />
        <div>
          <p className={EYEBROW}>First role</p>
          <h3 className={`mt-1 ${TITLE_DISPLAY}`}>Your catalog is waiting for its opening move</h3>
          <p className="mt-2 max-w-xl text-body text-steel">
            Every hire in kp hangs off one open role. Post the first one and the rest of the workspace comes alive.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <RouteCard
          step={1}
          icon={FileText}
          title="Draft it from a JD template"
          body="Pick a job description in the library, tune the requirements, and publish it as an open role."
          cta="Open the JD library"
          tab="library"
          search={searchStr}
        />
        <RouteCard
          step={2}
          icon={ClipboardPaste}
          title="Import an ad you already have"
          body="Paste an existing job ad and kp parses it into a structured role — requirements, seniority, work mode."
          cta="Use the import panel above"
          search={searchStr}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 border-t border-stone-200 pt-4 sm:justify-start">
        <span className={META_LABEL}>One role unlocks</span>
        {UNLOCKS.map((u) => (
          <Link key={u.tab} href={buildTabSwitchUrl(u.tab, searchStr)} className={`${CHIP} hover:border-coral/40 hover:text-ink`}>
            {u.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
