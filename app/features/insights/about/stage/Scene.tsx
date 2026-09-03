"use client";

import type { ReactNode, RefObject } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { EYEBROW, SECTION } from "@/app/_components/ui/recipes";
import type { ChapterDef } from "../chapters";

/*
 * Scene chrome. The constant frame around a chapter's animated art.
 *
 * Kept deliberately thin. Everything a chapter shares (its number, eyebrow,
 * title, lede, and the handoff into the live tab that actually does this work)
 * lives here; everything a chapter *argues* lives in its art component. That
 * split is what let three directional variants of the same chapter sit behind
 * one switcher without re-typing the header three times, and what stopped a
 * variant from winning on chrome polish rather than on the idea.
 *
 * The handoff link is not decoration. This deck explains mechanisms the product
 * really runs, and every chapter ends by pointing at the tab where the reader
 * can watch it happen on their own data.
 */

export function Scene({
  chapter,
  sceneRef,
  children,
}: {
  chapter: ChapterDef;
  sceneRef: RefObject<HTMLDivElement | null>;
  /** The animated mechanism. */
  children: ReactNode;
}) {
  const t = useTranslations("about");
  const c = `chapters.${chapter.key}` as const;

  return (
    <section
      ref={sceneRef}
      id={chapter.id}
      aria-labelledby={`${chapter.id}-title`}
      className="scroll-mt-8 border-t border-stone-200 py-12 first:border-t-0 first:pt-2"
    >
      {/* Copy above, art full width below, NOT side by side.
          These diagrams are laid out in percent-of-field, so every column the
          copy takes is width the geometry loses; at a 22rem copy column the art
          had about 600px and every label inside it truncated. Stacking gives
          the mechanism the full measure and costs only vertical space, which a
          scroll-driven deck has plenty of. */}
      <div className={SECTION}>
        <header className="max-w-2xl">
          <p className="flex items-baseline gap-3">
            <span className="nums font-serif text-h2 leading-none text-stone-300" aria-hidden>
              {String(chapter.n).padStart(2, "0")}
            </span>
            <span className={EYEBROW}>{t(`${c}.eyebrow`)}</span>
          </p>
          <h3 id={`${chapter.id}-title`} className="mt-3 font-serif text-h2 text-ink">
            {t(`${c}.title`)}
          </h3>
          <p className="mt-3 text-base leading-7 text-steel">{t(`${c}.lede`)}</p>
          <Link
            href={`/?tab=${chapter.tab}`}
            className="focus-ring mt-5 inline-flex items-center gap-1.5 text-base font-medium text-coral hover:underline"
          >
            {t(`${c}.tab`)} <ArrowRight size={15} aria-hidden />
          </Link>
        </header>

        {/* `min-w-0` so an SVG that wants to be wide shrinks with its parent
            instead of forcing the page to scroll sideways. */}
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}
