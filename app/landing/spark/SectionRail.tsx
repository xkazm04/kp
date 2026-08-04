"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";

/*
 * The homepage section nav. The topbar used to carry #how / #features /
 * #pricing next to the real destinations (/about, /market) — anchors into the
 * page you are already on, competing with the links that actually go
 * somewhere. They live here instead: a right-hand rail that stays out of the
 * way until you have scrolled past the hero, then rides along as a
 * you-are-here readout.
 *
 * Same Spark sticker idiom as the rest of the landing (ink outline, hard
 * offset shadow, spring entrance — literal hexes, the docs/design/README.md
 * art-direction exemption). Collapsed it is a column of dots; the active
 * section keeps its label pinned, and hovering the rail opens every label.
 */

// Section ids as they appear down the page — the order doubles as the
// scroll-spy tiebreak when two sections straddle the viewport midline.
const SECTIONS = [
  { id: "proof", key: "proof" },
  { id: "how", key: "how" },
  { id: "features", key: "features" },
  { id: "voice", key: "voice" },
  { id: "trust", key: "trust" },
  { id: "pricing", key: "pricing" }
] as const;

// Scroll past roughly the hero before the rail appears. Cheap and stable —
// the alternative (observe the hero) fights the section observer below.
const REVEAL_AT = 560;

/* Scroll position read as an external store rather than mirrored into state by
 * an effect. It is genuinely external (the browser owns it), so this reads the
 * live value on every render — including the first, which matters for a
 * restored scroll position or a deep link into #pricing, where an effect-based
 * mirror would paint the rail hidden and then pop it in. */
function subscribeScroll(onChange: () => void): () => void {
  window.addEventListener("scroll", onChange, { passive: true });
  window.addEventListener("resize", onChange);
  return () => {
    window.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}
const isScrolledPastHero = () => window.scrollY > REVEAL_AT;
// The server has no scroll position; the rail starts hidden either way.
const serverSnapshot = () => false;

export default function SectionRail() {
  // The typed catalog only exposes top-level namespaces, so scope to `landing`
  // and reach the nav keys by path.
  const t = useTranslations("landing");
  const reduceMotion = useReducedMotion();
  const shown = useSyncExternalStore(subscribeScroll, isScrolledPastHero, serverSnapshot);
  const [active, setActive] = useState<string | null>(null);
  // Which sections currently cross the viewport's middle band. A Set (not a
  // single id) so a short section handing off to a tall one can't flicker.
  const visible = useRef(new Set<string>());

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.current.add(id);
          else visible.current.delete(id);
        }
        const first = SECTIONS.find((s) => visible.current.has(s.id));
        setActive(first ? first.id : null);
      },
      // Only the middle 10% band of the viewport counts as "you are here".
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <AnimatePresence>
      {shown ? (
        <motion.nav
          aria-label={t("nav.sections")}
          // `y: "-50%"` rather than a `-translate-y-1/2` class: framer writes the
          // whole transform inline, so a Tailwind translate would be clobbered.
          initial={reduceMotion ? { opacity: 0, y: "-50%" } : { opacity: 0, x: 40, y: "-50%" }}
          animate={reduceMotion ? { opacity: 1, y: "-50%" } : { opacity: 1, x: 0, y: "-50%" }}
          exit={reduceMotion ? { opacity: 0, y: "-50%" } : { opacity: 0, x: 40, y: "-50%" }}
          transition={reduceMotion ? { duration: 0.15 } : { type: "spring", bounce: 0.35, duration: 0.5 }}
          className="group/rail fixed right-5 top-1/2 z-40 hidden rounded-2xl border-[3px] border-[#17202a] bg-[#fdf8ee] p-2 shadow-[6px_6px_0_#17202a] md:block"
        >
          <ul className="flex flex-col gap-1">
            {SECTIONS.map((s) => {
              const on = active === s.id;
              return (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    aria-current={on ? "true" : undefined}
                    className={`group/item flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-[15px] font-bold transition-colors focus-ring ${
                      on ? "bg-[#dce7d0]" : "hover:bg-[#dce7d0]/60"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`h-2.5 w-2.5 shrink-0 rounded-full border-[3px] border-[#17202a] transition-colors ${
                        on ? "bg-[#d65a4a]" : "bg-white group-hover/item:bg-[#caa54c]"
                      }`}
                    />
                    {/* The label is always in the a11y tree; only its width is
                        animated, so screen readers read the full nav while the
                        rail reads as a dot column until you approach it. */}
                    <span
                      className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out group-hover/rail:max-w-[12rem] group-hover/rail:opacity-100 group-focus-within/rail:max-w-[12rem] group-focus-within/rail:opacity-100 ${
                        on ? "max-w-[12rem] opacity-100" : "max-w-0 opacity-0"
                      }`}
                    >
                      {t(`nav.${s.key}`)}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" })}
            className="mt-1 flex w-full items-center gap-2.5 rounded-xl border-t-[3px] border-dashed border-[#dce7d0] px-2 pb-1 pt-2.5 text-[15px] font-bold transition-colors hover:text-[#d65a4a] focus-ring"
          >
            {/* Sized to the dots above so the labels share one column. */}
            <span aria-hidden className="grid h-2.5 w-2.5 shrink-0 place-items-center">
              <ArrowUp className="h-3.5 w-3.5" />
            </span>
            <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-300 ease-out group-hover/rail:max-w-[12rem] group-hover/rail:opacity-100 group-focus-within/rail:max-w-[12rem] group-focus-within/rail:opacity-100">
              {t("nav.top")}
            </span>
          </button>
        </motion.nav>
      ) : null}
    </AnimatePresence>
  );
}
