"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CHIP } from "@/app/_components/ui/recipes";
import type { ChapterDef } from "./chapters";

/*
 * The deck's table of contents — and its progress indicator.
 *
 * Six mechanisms is more than a reader holds in their head at once, so the rail
 * answers "where am I and how much is left" continuously rather than only when
 * you look for it. It tracks the scene currently occupying the middle of the
 * viewport via one IntersectionObserver over all six sections, which is cheaper
 * and steadier than six `useInView` hooks racing each other at the boundaries.
 *
 * Anchors live on the `<section>` elements the scenes render (see `Scene`),
 * which are always mounted — so a deep link like `?tab=about#archetypes` works
 * even though the heavy art below is code-split.
 *
 * Two shapes, one reading position. The gutter rail needs a gutter, so it only
 * exists at `xl` and up; below that the deck used to have NO table of contents
 * at all, which is the width most readers arrive at and the width where six
 * full-height scenes are longest to scroll. `ChapterJumpList` is the same six
 * links as a horizontal chip row, on the CHIP recipe so it carries both themes
 * for free, and it is plain anchors — tab, enter, and the browser's own
 * find-on-page all work without a keydown handler.
 */

/**
 * Which chapter is currently under the reader's eye.
 *
 * Shared by the gutter rail and the compact jump list so the two never disagree
 * about the reading position. Both are mounted at every width (each is hidden
 * by a CSS breakpoint rather than unmounted, which is what keeps a resize from
 * dropping the reader's place), so this runs twice — two observers over the
 * same six sections, each doing a rootMargin test the browser was already
 * doing. That is the price of not lifting deck-wide state into AboutTab, where
 * every scroll would re-render all six chapters and their art.
 */
function useActiveChapter(chapters: readonly ChapterDef[]): string {
  const [active, setActive] = useState(chapters[0]?.id ?? "");

  useEffect(() => {
    const sections = chapters
      .map((c) => document.getElementById(c.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    // A band across the middle of the viewport: a section counts as "current"
    // only while it crosses the reader's actual focal area. Using the whole
    // viewport instead makes the rail flicker between neighbours on every
    // scroll, because tall scenes overlap at the edges for hundreds of pixels.
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        if (hit?.target.id) setActive(hit.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [chapters]);

  return active;
}

export function ChapterRail({ chapters }: { chapters: readonly ChapterDef[] }) {
  const t = useTranslations("about");
  const active = useActiveChapter(chapters);

  return (
    <nav aria-label={t("chaptersNav")} className="hidden xl:block">
      <ol className="sticky top-6 space-y-1 border-l border-stone-200 pl-4">
        {chapters.map((c) => {
          const current = c.id === active;
          return (
            <li key={c.id} className="relative">
              {/* The marker sits on the rail itself, so the active chapter reads
                  as a position on a line rather than as a highlighted list row. */}
              <span
                aria-hidden
                className={`absolute -left-[1.3125rem] top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full transition-colors duration-300 ${
                  current ? "bg-coral" : "bg-transparent"
                }`}
              />
              <a
                href={`#${c.id}`}
                // `location`, not `true`: this is the chapter the reader is
                // currently AT within a set of links, which is exactly what the
                // token means. `aria-current="true"` is the unspecific fallback
                // and makes a screen reader announce "current" with no noun.
                aria-current={current ? "location" : undefined}
                className={`focus-ring block rounded py-1 text-base transition-colors ${
                  current ? "font-medium text-ink" : "text-steel hover:text-ink"
                }`}
              >
                <span className="nums mr-2 text-meta text-stone-400">{String(c.n).padStart(2, "0")}</span>
                {t(`chapters.${c.key}.title`)}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The same table of contents for viewports with no gutter.
 *
 * A chip row rather than a `<details>` disclosure: six items fit on one line at
 * most tablet widths and scroll horizontally below that, so the whole deck's
 * shape stays visible without a click. It is `sticky` under the header so a
 * reader forty screens down can still jump — the one thing the gutter rail does
 * that a static list at the top of the page cannot.
 *
 * Chips print the chapter EYEBROW (two or three words), not the title: titles
 * here are full claims ("Cheap filters first, expensive judgement last") and
 * would make a row nobody can scan.
 */
export function ChapterJumpList({ chapters }: { chapters: readonly ChapterDef[] }) {
  const t = useTranslations("about");
  const active = useActiveChapter(chapters);

  return (
    <nav
      aria-label={t("chaptersNav")}
      className="sticky top-0 z-20 -mx-5 mt-6 border-b border-stone-200 bg-white/95 px-5 py-2 backdrop-blur sm:-mx-6 sm:px-6 xl:hidden"
    >
      <ul className="flex gap-2 overflow-x-auto pb-0.5">
        {chapters.map((c) => {
          const current = c.id === active;
          return (
            <li key={c.id} className="shrink-0">
              <a
                href={`#${c.id}`}
                aria-current={current ? "location" : undefined}
                className={`focus-ring ${CHIP} whitespace-nowrap ${
                  current ? "border-coral text-ink" : "hover:border-coral/40 hover:text-ink"
                }`}
              >
                <span className="nums text-meta text-stone-400">{String(c.n).padStart(2, "0")}</span>
                {t(`chapters.${c.key}.eyebrow`)}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
