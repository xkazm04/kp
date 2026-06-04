"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutGroup, motion } from "framer-motion";
import { DAYS, styleFor, TIMES, type SchedEntry } from "./ScheduleTypes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
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
  selectedId,
  onSelect,
  onPickSlot,
}: {
  entries: SchedEntry[];
  picks: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPickSlot: (slot: string) => void;
}) {
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

  const fadeBase = `pointer-events-none absolute inset-y-px w-12 ${reduced ? "" : "transition-opacity duration-200"}`;

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        onScroll={measure}
        className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-panel"
      >
        <LayoutGroup>
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[64px_repeat(5,1fr)] border-b border-stone-200 bg-paper text-center text-meta uppercase text-steel">
              <div className="py-2" />
              {DAYS.map((d) => (
                <div key={d} className="py-2 font-semibold">
                  {d}
                </div>
              ))}
            </div>
            {TIMES.map((t) => (
              <div key={t} className="grid grid-cols-[64px_repeat(5,1fr)] border-t border-stone-100">
                <div className="px-2 py-3 text-sm text-steel">{t}</div>
                {DAYS.map((d) => {
                  const slot = `${d} ${t}`;
                  const here = inSlot(slot);
                  return (
                    // Cell is a plain container, not a button, so the chips below can be
                    // real buttons (no interactive-in-interactive nesting). A full-cell
                    // slot picker sits behind the chips; clicks on empty space fall
                    // through to it, while clicks on a chip select that candidate.
                    <div key={d} className="relative min-h-14 border-l border-stone-100">
                      <button
                        type="button"
                        onClick={() => onPickSlot(slot)}
                        aria-label={`Assign selected candidate to ${slot}`}
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
                                title={`${e.candidateLabel} · ${s.label}${e.jobTitle ? ` · ${e.jobTitle}` : ""}`}
                                aria-label={`${e.candidateLabel}, ${s.label}${e.jobTitle ? `, ${e.jobTitle}` : ""}`}
                                className={`focus-ring pointer-events-auto flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-sm font-medium text-white ${s.bg} ${
                                  selected ? "ring-2 ring-coral ring-offset-1" : ""
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
