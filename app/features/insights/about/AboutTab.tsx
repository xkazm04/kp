"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, Pause, Play } from "lucide-react";
import { EYEBROW, INTRO, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { useSimulation } from "@/app/features/shell/simulation/SimulationProvider";
import { useCapabilities } from "@/app/features/shell/useCapabilities";
import { commandAllowed } from "@/app/features/shell/navCapabilities";
import { CHAPTERS, type ChapterDef } from "./chapters";
import { ChapterJumpList, ChapterRail } from "./ChapterRail";
import { Scene } from "./stage/Scene";
import { SceneTransportContext } from "./stage/useSceneClock";
import { DECK_STOP_KEY, createDeckTransport, loadDeckStop, type DeckTransport } from "./stage/transport";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";

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
const ArchetypesScene = dynamic(() => import("./scenes/archetypes").then((m) => ({ default: m.ArchetypesScene })), {
  loading: Loading,
});
const AssignmentsScene = dynamic(() => import("./scenes/assignments").then((m) => ({ default: m.AssignmentsScene })), {
  loading: Loading,
});
const GatesScene = dynamic(() => import("./scenes/gates").then((m) => ({ default: m.GatesScene })), {
  loading: Loading,
});

/** Chapter id to its art. Every chapter in CHAPTERS must have an entry. */
const SCENES: Record<string, React.ComponentType> = {
  "job-descriptions": JdScene,
  scoring: ScoringScene,
  screening: ScreeningScene,
  archetypes: ArchetypesScene,
  assignments: AssignmentsScene,
  "human-gates": GatesScene,
};

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
function Chapter({
  chapter,
  deck,
  children,
}: {
  chapter: ChapterDef;
  deck: DeckTransport;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The chapter's transport store: stable per id, so providing it re-renders
  // nothing. The scene's clock and the controls beside it both read it; this
  // frame never subscribes, so it still never re-renders per tick.
  const transport = deck.chapter(chapter.id);
  return (
    <Scene chapter={chapter} sceneRef={ref}>
      <SceneTransportContext value={transport}>{children}</SceneTransportContext>
    </Scene>
  );
}

/** The header's text actions (architecture link, tour, stop-all). */
const HEADER_ACTION = "focus-ring inline-flex items-center gap-1.5 text-base font-medium text-coral hover:underline";

/**
 * Per-viewer memory of the deck-wide stop. Every storage touch is guarded: a
 * private window or blocked site data makes the accessor THROW, and losing a
 * convenience must never cost the page (the deck then simply plays).
 */
function writeDeckStop(value: string | null): void {
  if (typeof window === "undefined") return;
  if (value === null) window.localStorage.removeItem(DECK_STOP_KEY);
  else window.localStorage.setItem(DECK_STOP_KEY, value);
}

function readDeckStop(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(DECK_STOP_KEY);
}

/**
 * Stop every chapter / play them again. One-directional acts with their own
 * labels, never a key toggle. Hidden under OS reduced motion: nothing moves for
 * those readers in any state, so the control would do nothing.
 */
function DeckToggle({ deck }: { deck: DeckTransport }) {
  const t = useTranslations("about");
  const reduced = useReducedMotion();
  const anyPlaying = useSyncExternalStore(deck.subscribe, deck.anyPlaying, () => true);
  if (reduced) return null;
  return anyPlaying ? (
    <button type="button" onClick={() => deck.stopAll()} className={HEADER_ACTION}>
      <Pause size={15} aria-hidden /> {t("transport.stopAll")}
    </button>
  ) : (
    <button type="button" onClick={() => deck.playAll()} className={HEADER_ACTION}>
      <Play size={15} aria-hidden /> {t("transport.playAll")}
    </button>
  );
}

export function AboutTab() {
  const t = useTranslations("about");
  const sim = useSimulation();
  // /perfect wave 21b: /diagrams is now operator-only (it draws this repository's own
  // module paths and its off-spec admissions), so the door stops being offered to a seat
  // the route will 404 at. `read` is the floor a demo cookie does NOT clear - it resolves
  // to the empty set - while every real member and the open-dev/operator caller holds it.
  // Unknown caps still show the link, the same fail-open the nav takes: hiding a door from
  // the person holding the key over one blipped GET is the worse failure.
  const caps = useCapabilities();
  const canSeeArchitecture = commandAllowed("read", caps);

  // One transport per deck: the header's stop-all and each chapter's controls
  // share it. The remembered stop is applied after hydration (the server has no
  // storage), and applying it is not a new choice, so it is not written back.
  const [deck] = useState(() => createDeckTransport({ write: writeDeckStop }));
  useEffect(() => {
    if (loadDeckStop(readDeckStop)) deck.stopAll({ remember: false });
  }, [deck]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel sm:p-6">
      <header className="max-w-3xl border-b border-stone-200 pb-6">
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <h2 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h2>
        <p className={`mt-3 ${INTRO}`}>{t("intro")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          {canSeeArchitecture ? (
            <Link
              href="/diagrams"
              className={HEADER_ACTION}
            >
              {t("archLink")} <ArrowRight size={15} aria-hidden />
            </Link>
          ) : null}
          {!sim.running ? (
            <button
              type="button"
              onClick={sim.start}
              title={t("tourTitle")}
              className={HEADER_ACTION}
            >
              <Play size={15} aria-hidden /> {t("tourLink")}
            </button>
          ) : null}
          <DeckToggle deck={deck} />
        </div>
      </header>

      {/* Below `xl` there is no gutter for the rail, so the same six links ride
          above the deck as a sticky chip row. It sits here rather than beside
          the rail because a jump list a reader has to scroll to the BOTTOM to
          find is not a jump list. */}
      <ChapterJumpList chapters={CHAPTERS} />

      <div className="mt-8 grid gap-10 xl:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="min-w-0">
          {CHAPTERS.map((chapter) => {
            const Art = SCENES[chapter.id];
            return (
              <Chapter key={chapter.id} chapter={chapter} deck={deck}>
                <Art />
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
