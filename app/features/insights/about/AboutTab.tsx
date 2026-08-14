"use client";

import { useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, Play } from "lucide-react";
import { EYEBROW, INTRO, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { useSimulation } from "@/app/features/shell/simulation/SimulationProvider";
import { CHAPTERS } from "./chapters";
import { ChapterRail } from "./ChapterRail";
import { Scene } from "./stage/Scene";

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

// One chunk per chapter. The frames below are always in the server HTML, so the
// rail, the anchors and the whole argument survive with the art still in
// flight — only the moving parts stream in.
//
// The `{ loading }` object is repeated per call rather than hoisted to a shared
// const: next/dynamic's options are read at BUILD time by the compiler, so they
// must be an inline object literal. Hoisting it fails the build outright with
// "next/dynamic options must be an object literal".
const Loading = () => <div className="reveal-quiet min-h-[30rem]" aria-hidden />;

const JdScene = dynamic(() => import("./scenes/jd").then((m) => ({ default: m.JdScene })), { loading: Loading });
const ScoringScene = dynamic(() => import("./scenes/scoring").then((m) => ({ default: m.ScoringScene })), {
  loading: Loading,
});
const ScreeningScene = dynamic(() => import("./scenes/screening").then((m) => ({ default: m.ScreeningScene })), {
  loading: Loading,
});

/** Chapter id → its art. Chapters absent here render the honest placeholder. */
const SCENES: Record<string, React.ComponentType> = {
  "job-descriptions": JdScene,
  scoring: ScoringScene,
  screening: ScreeningScene,
};

/** Placeholder for a chapter whose art is not built yet. Honest about it. */
function Pending({ chapter }: { chapter: (typeof CHAPTERS)[number] }) {
  return (
    <div className="grid min-h-[14rem] place-items-center rounded-lg border border-dashed border-stone-300 p-6">
      <p className="text-base text-stone-400">Scene for “{chapter.title}” not built yet.</p>
    </div>
  );
}

/**
 * One chapter frame.
 *
 * A plain `useRef`, NOT a scene clock. The frame carries no motion of its own —
 * it only needs an element for the anchor and the rail's observer — and giving
 * it a clock was an actual bug, not just waste: each chapter then ran its own
 * 900ms interval whose `setTick` re-rendered the whole scene subtree on a
 * cadence unrelated to that scene's clock. Every `Part` inside was knocked back
 * to its `initial` (opacity 0) mid-flight, so labels flickered and most of the
 * diagram never became visible. One clock per scene, owned by the art.
 */
function Chapter({ chapter, children }: { chapter: (typeof CHAPTERS)[number]; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
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
          {CHAPTERS.map((chapter) => {
            const Art = SCENES[chapter.id];
            return (
              <Chapter key={chapter.id} chapter={chapter}>
                {Art ? <Art /> : <Pending chapter={chapter} />}
              </Chapter>
            );
          })}
        </div>

        {/* Rail parks in the right gutter and is last in the DOM on purpose:
            a table of contents is navigation, so a screen reader and a narrow
            viewport both meet the chapters first. */}
        <ChapterRail chapters={CHAPTERS} />
      </div>
    </section>
  );
}
