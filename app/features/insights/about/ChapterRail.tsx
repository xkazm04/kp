"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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
 */

export function ChapterRail({ chapters }: { chapters: readonly ChapterDef[] }) {
  const t = useTranslations("about");
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
                aria-current={current ? "true" : undefined}
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
