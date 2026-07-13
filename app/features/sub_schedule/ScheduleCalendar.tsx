"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { LayoutGroup, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { DAYS, styleFor, TIMES, type SchedEntry } from "./ScheduleTypes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { initials } from "@/app/_lib/initials";

// One shared week grid holding every pending interview. Each candidate sits in
// their (picked) slot; selecting a candidate and clicking a cell re-proposes
// that slot for them. A coral ring marks the currently selected candidate.
//
// Motion: each chip carries a `layoutId`, so re-proposing a slot glides the
// candidate's chip from its old cell to the new one instead of jump-cutting.
// The grid scrolls horizontally on narrow viewports, so gradient edge-fades
// (keyed to scroll offset) hint that the Fri column is off-screen. Both snap to
// a static state under the OS "reduce motion" preference.
export function ScheduleCalendar({
  entries,
  picks,
  bookedMarkers = [],
  selectedId,
  onSelect,
  onPickSlot,
}: {
  entries: SchedEntry[];
  picks: Record<string, string>;
  // Direction 3 — read-only confirmed bookings from the invite engine (self- or
  // recruiter-booked), rendered as occupied cells so the grid reflects one source
  // of truth and a taken time is visible before the recruiter double-books it.
  bookedMarkers?: { id: string; gridSlot: string; candidateLabel: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPickSlot: (slot: string) => void;
}) {
  const tCal = useTranslations("scheduleTab.calendar");
  const enumLabel = useEnumLabel();
  const reduced = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  // Recompute which edge-fades to show from the scroller's current offset. Run
  // on scroll, on mount, and on resize (the grid is min-width, so a narrower
  // container changes how much overflows).
  const measure = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 });
  };
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const inSlot = (slot: string) => entries.filter((e) => (picks[e.id] ?? "") === slot);
  const bookedInSlot = (slot: string) => bookedMarkers.filter((m) => m.gridSlot === slot);

  const fadeBase = `pointer-events-none absolute inset-y-px w-12 ${reduced ? "" : "transition-opacity duration-200"}`;

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        onScroll={measure}
        // tabIndex makes the horizontally-scrolling region keyboard-focusable so it can
        // be scrolled without a mouse.
        tabIndex={0}
        className="focus-ring overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-panel"
      >
        <LayoutGroup>
          {/* role="table" + row/columnheader/rowheader/cell give SR the day×time spatial
              structure the CSS grid only conveyed visually — without a <table> rewrite. */}
          <div className="min-w-[760px]" role="table" aria-label={tCal("calendarAria")}>
            <div role="row" className="grid grid-cols-[64px_repeat(5,1fr)] border-b border-stone-200 bg-paper text-center text-meta uppercase text-steel">
              <div role="columnheader" className="py-2">
                <span className="sr-only">{tCal("timeColumn")}</span>
              </div>
              {DAYS.map((d) => (
                <div key={d} role="columnheader" className="py-2 font-semibold">
                  {enumLabel("day", d)}
                </div>
              ))}
            </div>
            {TIMES.map((t) => (
              <div key={t} role="row" className="grid grid-cols-[64px_repeat(5,1fr)] border-t border-stone-100">
                <div role="rowheader" className="px-2 py-3 text-sm text-steel">{t}</div>
                {DAYS.map((d) => {
                  const slot = `${d} ${t}`;
                  const here = inSlot(slot);
                  const booked = bookedInSlot(slot);
                  return (
                    // Cell is a plain container, not a button, so the chips below can be
                    // real buttons (no interactive-in-interactive nesting). A full-cell
                    // slot picker sits behind the chips; clicks on empty space fall
                    // through to it, while clicks on a chip select that candidate.
                    <div key={d} role="cell" className="relative min-h-14 border-l border-stone-100">
                      <button
                        type="button"
                        onClick={() => onPickSlot(slot)}
                        aria-label={tCal("assignAria", { slot: `${enumLabel("day", d)} ${t}` })}
                        className="focus-ring absolute inset-0 transition-colors hover:bg-coral/5"
                      />
                      {here.length > 0 ? (
                        <div className="pointer-events-none relative space-y-1 p-1.5">
                          {here.map((e) => {
                            const s = styleFor(e.archetype);
                            const selected = e.id === selectedId;
                            return (
                              <motion.button
                                key={e.id}
                                // Shared layoutId → the chip glides to its new cell when
                                // its slot is re-proposed. Dropped under reduced motion so
                                // it simply re-appears in place.
                                layoutId={reduced ? undefined : `sched-chip-${e.id}`}
                                transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 42 }}
                                type="button"
                                onClick={() => onSelect(e.id)}
                                aria-pressed={selected}
                                title={tCal("chipTitle", { name: e.candidateLabel, archetype: enumLabel("archetype", e.archetype), job: e.jobTitle ? ` · ${e.jobTitle}` : "" })}
                                aria-label={tCal("chipAria", { name: e.candidateLabel, archetype: enumLabel("archetype", e.archetype), job: e.jobTitle ? `, ${e.jobTitle}` : "" })}
                                // Spark Dark: the selected chip is "peeled" — tilted with a
                                // hard sticker shadow. Tailwind's rotate-* is the standalone
                                // `rotate` property, so it composes with the framer glide's
                                // inline transform instead of fighting it.
                                className={`focus-ring pointer-events-auto flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-sm font-medium text-white transition-transform dark:hover:-rotate-1 ${s.bg} ${
                                  selected ? "ring-2 ring-coral ring-offset-1 dark:-rotate-2 dark:shadow-sticker-xs" : ""
                                }`}
                              >
                                <span
                                  aria-hidden
                                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/25 text-[10px]"
                                >
                                  {initials(e.candidateLabel)}
                                </span>
                                <span className="truncate">{e.candidateLabel}</span>
                              </motion.button>
                            );
                          })}
                        </div>
                      ) : null}
                      {booked.length > 0 ? (
                        // Read-only occupied markers (Direction 3). pointer-events-none so
                        // a click still falls through to the slot picker — the collision
                        // check on confirm is the real guard; this is the visible hint.
                        <div className="pointer-events-none relative space-y-1 p-1.5">
                          {booked.map((m) => (
                            <span
                              key={m.id}
                              title={tCal("bookedTitle", { name: m.candidateLabel })}
                              className="flex w-full items-center gap-1 rounded-md border border-dashed border-moss/50 bg-moss/10 px-1.5 py-1 text-sm font-medium text-moss"
                            >
                              <Check size={12} className="shrink-0" aria-hidden />
                              <span className="truncate">{m.candidateLabel}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </LayoutGroup>
      </div>
      <div
        aria-hidden
        className={`${fadeBase} left-px rounded-l-lg bg-gradient-to-r from-white to-transparent ${edges.left ? "opacity-100" : "opacity-0"}`}
      />
      <div
        aria-hidden
        className={`${fadeBase} right-px rounded-r-lg bg-gradient-to-l from-white to-transparent ${edges.right ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
