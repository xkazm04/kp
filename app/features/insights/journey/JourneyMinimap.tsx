"use client";

// The whole board at a glance: a named span per role over a strip of ticks,
// with a viewport marker.
//
// WHAT IT WAS AND WHAT WAS WRONG WITH IT. An unlabelled strip of actor-coloured
// ticks. It scrolled the board and nothing else: the owner's finding B is that
// you cannot tell what is inside it. Two things were actually wrong.
//
//  1 NOTHING NAMED ANYTHING. A picture of 99 columns with no words on it is a
//    texture. Each cluster now carries its role's NAME and its column count
//    over its own span (`journey.minimap.roleColumns`), and those labels are
//    real buttons that travel to the role — so the strip is a map with a legend
//    of its own rather than a scrollbar in disguise.
//  2 THE SPANS LIED ABOUT WHERE THINGS WERE. Every cluster got `flex-1`, so a
//    role with one candidate and a role with forty-three drew the same width,
//    while the viewport marker is computed from the scroller's REAL extent. The
//    marker therefore sat over the wrong role for most of a sideways journey.
//    Each span's flex-grow is now its column count, which is what the scroll
//    extent is proportional to, so the marker lands where the reader is.
//
// STILL DOM RATHER THAN CANVAS, and still for the dual theme: a canvas has to be
// told its colours in JS, which means reading `--color-coral` out of
// `getComputedStyle` and repainting on every theme flip. The ticks per column
// are capped, so the strip is a few thousand 1px spans built once per filter
// change, not per scroll frame.
//
// THE TICK STRIP ITSELF STAYS `aria-hidden`, and now it has earned it: it is a
// pointer-drag surface whose every destination is reachable from the named role
// buttons above it and from the toolbar's find box. What is announced is the
// group (`journey.minimap.label`) and the buttons inside it.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { actorKind, type ActorKind } from "./journeyMarks";
import type { BoardPlan } from "./journeyLayout";

/** Enough ticks to show a column's shape; past this, depth is texture. */
const MAX_TICKS = 22;

const TICK_CLASS: Record<ActorKind, string> = {
  human: "bg-coral",
  machine: "bg-steel",
  unidentified: "bg-dial-stone",
};

export function JourneyMinimap({
  plan,
  scrollerRef,
  onJumpToRole,
}: {
  plan: BoardPlan;
  scrollerRef: { current: HTMLElement | null };
  onJumpToRole: (jobId: string) => void;
}) {
  const t = useTranslations("journey");
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 0 });
  const draggingRef = useRef(false);

  const sync = useCallback(() => {
    const scroller = scrollerRef.current;
    const strip = stripRef.current;
    if (!scroller || !strip || scroller.scrollWidth <= 0) return;
    const ratio = strip.clientWidth / scroller.scrollWidth;
    setViewport({ left: scroller.scrollLeft * ratio, width: Math.max(4, scroller.clientWidth * ratio) });
  }, [scrollerRef]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [scrollerRef, sync, plan]);

  const travel = useCallback(
    (clientX: number) => {
      const scroller = scrollerRef.current;
      const strip = stripRef.current;
      if (!scroller || !strip) return;
      const box = strip.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      scroller.scrollLeft = fraction * scroller.scrollWidth - scroller.clientWidth / 2;
    },
    [scrollerRef]
  );

  return (
    <div className="shrink-0 border-b border-stone-200 bg-stone-50">
      {/* The named half. One button per role, grown by the same column count as
          its span below, so the label sits over the ticks it describes — and
          WRAPPED rather than truncated, because at 43-of-50 columns in one role
          the other five spans are ~45px wide and one line of them is a single
          letter. Two lines of 10px turn "B…" back into "Business Analyst". A
          span too narrow even for that still carries the whole label as the
          button's accessible name, and the rail names the role the reader
          lands on. */}
      <div
        role="group"
        aria-label={t("minimap.label")}
        className="flex items-stretch gap-px px-1 pt-1"
      >
        {plan.clusters.map((cluster, index) => (
          <button
            key={cluster.cluster.jobId}
            type="button"
            onClick={() => onJumpToRole(cluster.cluster.jobId)}
            style={{ flexGrow: Math.max(1, cluster.columns.length), flexBasis: 0 }}
            className={`focus-ring line-clamp-2 min-w-0 rounded-sm px-1 text-left text-[0.625rem] leading-tight text-steel hover:bg-stone-100 hover:text-ink ${
              index > 0 ? "border-l border-ink" : ""
            }`}
          >
            {t("minimap.roleColumns", { role: cluster.cluster.title, count: cluster.columns.length })}
          </button>
        ))}
      </div>

      <div
        ref={stripRef}
        aria-hidden="true"
        onPointerDown={(event) => {
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          travel(event.clientX);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) travel(event.clientX);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        className="relative flex h-8 cursor-pointer touch-none select-none items-stretch gap-px px-1 pb-1"
      >
        {plan.clusters.map((cluster, index) => (
          <div
            key={cluster.cluster.jobId}
            style={{ flexGrow: Math.max(1, cluster.columns.length), flexBasis: 0 }}
            className="flex min-w-0 items-stretch gap-px"
          >
            {index > 0 ? <span className="w-0.5 shrink-0 bg-ink" /> : null}
            {cluster.columns.map((column) => {
              const events = column.column.events.slice(0, MAX_TICKS);
              return (
                <span
                  key={column.column.entryId}
                  className="flex min-w-px flex-1 flex-col justify-start gap-px pt-1"
                >
                  {events.length === 0 ? (
                    // A column with nothing in it is still a column. An empty slot
                    // would read as "not here"; a dashed box reads as "here, and
                    // holding nothing", which is the true statement.
                    <span className="h-2 w-full border border-dashed border-amber-400" />
                  ) : (
                    events.map((event) => (
                      <span key={event.id} className={`h-px w-full ${TICK_CLASS[actorKind(event.actor)]}`} />
                    ))
                  )}
                </span>
              );
            })}
          </div>
        ))}
        {/* Where the reader is. Coral rather than ink so it reads as the one
            moving thing on a strip of static texture, in both themes. */}
        <span
          className="pointer-events-none absolute inset-y-0 rounded-sm border-2 border-coral bg-coral/10"
          style={{ left: viewport.left, width: viewport.width }}
        />
      </div>
    </div>
  );
}
