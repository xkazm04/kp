"use client";

import type { ReactNode, RefObject } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EYEBROW } from "@/app/_components/ui/recipes";

/*
 * Scene chrome — the constant frame around a chapter's animated art.
 *
 * Kept deliberately thin. Everything a chapter shares (its number, eyebrow,
 * title, lede, and the handoff into the live tab that actually does this work)
 * lives here; everything a chapter *argues* lives in its art component. That
 * split is what lets three directional variants of the same chapter sit behind
 * one switcher without re-typing the header three times — and what stops a
 * variant from winning on chrome polish rather than on the idea.
 *
 * The handoff link is not decoration. This deck explains mechanisms the product
 * really runs, and every chapter ends by pointing at the tab where the reader
 * can watch it happen on their own data.
 */

export type SceneChapter = {
  /** Stable id — also the anchor target and the variant-switcher key. */
  id: string;
  /** Two-digit ordinal shown in the rail and the scene marker. */
  n: number;
  eyebrow: string;
  title: string;
  lede: string;
  /** The live workspace tab that performs this mechanism, e.g. "library". */
  tab?: string;
  tabLabel?: string;
};

export function Scene({
  chapter,
  sceneRef,
  children,
  aside,
}: {
  chapter: SceneChapter;
  sceneRef: RefObject<HTMLDivElement | null>;
  /** The animated mechanism. */
  children: ReactNode;
  /** Optional extra copy column rendered under the lede. */
  aside?: ReactNode;
}) {
  return (
    <section
      ref={sceneRef}
      id={chapter.id}
      aria-labelledby={`${chapter.id}-title`}
      className="scroll-mt-8 border-t border-stone-200 py-12 first:border-t-0 first:pt-2"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-12">
        <header className="lg:pt-6">
          <p className="flex items-baseline gap-3">
            <span className="nums font-serif text-h2 leading-none text-stone-300" aria-hidden>
              {String(chapter.n).padStart(2, "0")}
            </span>
            <span className={EYEBROW}>{chapter.eyebrow}</span>
          </p>
          <h3 id={`${chapter.id}-title`} className="mt-3 font-serif text-h2 text-ink">
            {chapter.title}
          </h3>
          <p className="mt-3 text-base leading-7 text-steel">{chapter.lede}</p>
          {aside}
          {chapter.tab ? (
            <Link
              href={`/?tab=${chapter.tab}`}
              className="focus-ring mt-5 inline-flex items-center gap-1.5 text-base font-medium text-coral hover:underline"
            >
              {chapter.tabLabel ?? "Open the tab"} <ArrowRight size={15} aria-hidden />
            </Link>
          ) : null}
        </header>

        {/* The art column. `min-w-0` so an SVG that wants to be wide shrinks with
            the grid track instead of forcing the page to scroll sideways. */}
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}
