"use client";

import { META_LABEL } from "@/app/_components/ui/recipes";

// ATELIER — what is left of the plane's own file once the plane became the kit.
//
// `AtelierZone`, the house ease and the spring moved to the Studio kit
// (`app/_components/studio/StudioZone.tsx`, as `StudioZone` / `STUDIO_EASE` /
// `STUDIO_SPRING`) in WP1, where the job-seeker dialogs share them. What stays
// is the one piece that is about a BRIEF rather than about a desk: the exemplar
// the empty brief plane draws.

/** An empty region shows WHAT WILL FILL IT, named.
 *
 *  The first cut of this drew grey rules — the shape of rows without saying what
 *  a row would hold. That is a skeleton, and a skeleton tells a first-time reader
 *  nothing about what the conversation is for. So the empty state is an EXEMPLAR:
 *  the real section headings, in the type they will really wear, each holding a
 *  bracketed slot where its first entry will land. Reading it top to bottom is
 *  reading what this session is trying to extract, which is the one thing worth
 *  knowing before the first answer.
 *
 *  The brackets are the placeholder convention, so nothing here can be mistaken
 *  for captured content. Only the SLOT is muted: a heading nobody can read is
 *  not a heading, and the whole point of the exemplar is that it is read. It is NOT hidden from
 *  assistive tech — the structure is exactly as useful to someone who cannot see
 *  it, and a bracketed slot announces itself as a slot. */
export function AtelierExemplar({ slots }: { slots: readonly { label: string; slot: string }[] }) {
  return (
    <div className="space-y-4 pt-1">
      {slots.map((s) => (
        <div key={s.label} className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-stone-300" />
            <span className={META_LABEL}>{s.label}</span>
          </div>
          <p className="pl-3.5 text-body italic text-stone-400">{`<${s.slot}>`}</p>
        </div>
      ))}
    </div>
  );
}
