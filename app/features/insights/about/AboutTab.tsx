"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, Play } from "lucide-react";
import { EYEBROW, INTRO, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { useSimulation } from "@/app/features/shell/simulation/SimulationProvider";
import { CHAPTERS } from "./chapters";
import { ChapterRail } from "./ChapterRail";
import { Scene } from "./stage/Scene";
import { useSceneClock } from "./stage/useSceneClock";

/*
 * About — how the six mechanisms actually work.
 *
 * This replaces a 24-item capability browser that rendered a PlantUML diagram
 * and a paragraph per item. That surface answered "what is in here"; nobody
 * needed that answer, because the nav already gives it. This one answers the
 * question a reader actually arrives with: *why should I believe any of this
 * works*. Six chapters, each a self-playing diagram of a real mechanism, with
 * the product's own identifiers on the parts.
 *
 * Loading: each chapter's art is its own chunk. The chapter frames (heading,
 * lede, anchor) are always in the server HTML, so the rail, deep links and the
 * whole argument survive with JavaScript still in flight — only the moving
 * parts stream in.
 */

const JdScene = dynamic(() => import("./scenes/jd").then((m) => ({ default: m.JdScene })), {
  loading: () => <div className="reveal-quiet min-h-[30rem]" aria-hidden />,
});

/** Placeholder for a chapter whose art is not built yet. Honest about it. */
function Pending({ chapter }: { chapter: (typeof CHAPTERS)[number] }) {
  return (
    <div className="grid min-h-[14rem] place-items-center rounded-lg border border-dashed border-stone-300 p-6">
      <p className="text-base text-stone-400">Scene for “{chapter.title}” not built yet.</p>
    </div>
  );
}

/**
 * One chapter. Owns its clock ref via `Scene` so the art below can be swapped
 * without the frame losing its anchor or its place in the rail.
 */
function Chapter({ chapter, children }: { chapter: (typeof CHAPTERS)[number]; children: React.ReactNode }) {
  // The frame itself doesn't animate; it only needs an element to hang the
  // anchor and the observer on. Each art component runs its own clock.
  const { ref } = useSceneClock(1);
  return (
    <Scene chapter={chapter} sceneRef={ref}>
      {children}
    </Scene>
  );
}

export function AboutTab() {
  const sim = useSimulation();

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel sm:p-6">
      <header className="max-w-3xl border-b border-stone-200 pb-6">
        <p className={EYEBROW}>How it works</p>
        <h2 className={`mt-1 ${TITLE_DISPLAY}`}>Six mechanisms, shown running</h2>
        <p className={`mt-3 ${INTRO}`}>
          Hiring software asks you to trust a number. These are the six places this product produces one — how a role
          gets written, how a person gets scored, who gets filtered and by what, how different kinds of candidate are
          kept from being flattened into one rule, what a work sample can still prove, and where a human has to decide.
          Every threshold named below is a constant in the running code.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            href="/diagrams"
            className="focus-ring inline-flex items-center gap-1.5 text-base font-medium text-coral hover:underline"
          >
            Architecture diagrams <ArrowRight size={15} aria-hidden />
          </Link>
          {!sim.running ? (
            <button
              type="button"
              onClick={sim.start}
              title="Walk the pipeline live, across the real tabs"
              className="focus-ring inline-flex items-center gap-1.5 text-base font-medium text-coral hover:underline"
            >
              <Play size={15} aria-hidden /> Watch the guided tour
            </button>
          ) : null}
        </div>
      </header>

      <div className="mt-8 grid gap-10 xl:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="min-w-0">
          {CHAPTERS.map((chapter) => (
            <Chapter key={chapter.id} chapter={chapter}>
              {chapter.id === "job-descriptions" ? <JdScene /> : <Pending chapter={chapter} />}
            </Chapter>
          ))}
        </div>

        {/* Rail parks in the right gutter and is last in the DOM on purpose:
            a table of contents is navigation, so a screen reader and a narrow
            viewport both meet the chapters first. */}
        <ChapterRail chapters={CHAPTERS} />
      </div>
    </section>
  );
}
