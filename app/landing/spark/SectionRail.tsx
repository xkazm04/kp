"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";

/*
 * The homepage section nav. The topbar used to carry #features / #pricing next
 * to the real destinations (/about, /market) — anchors into the page you are
 * already on, competing with the links that actually go somewhere. They live
 * here instead: a right-hand rail that stays out of the way until you have
 * scrolled past the hero, then rides along as a you-are-here readout.
 *
 * Same Spark sticker idiom as the rest of the landing (ink outline, hard
 * offset shadow, spring entrance — literal hexes, the docs/design/README.md
 * art-direction exemption).
 *
 * Every label is legible at rest. The rail used to collapse to a column of
 * bare dots with only the active label pinned, which made it a scroll-position
 * READOUT rather than a nav: you cannot choose a destination you cannot read,
 * so the five inactive entries were dead weight until you happened to hover
 * them. Inactive entries now sit at reduced opacity — present enough to aim
 * at, quiet enough that the active one still reads as active.
 *
 * The rail is no longer the homepage's alone: /about is one eight-step
 * scroll-drawn line, and a visitor who came to read about Offer or Hired had
 * to scroll past six phases to find out they exist. So the list of entries is
 * a PROP (`sections`), defaulting to this file's own SECTIONS — the homepage
 * renders `<SectionRail />` exactly as before and gets the same five bands, the
 * same labels and the same reveal. A caller that owns its own copy (AboutCurve
 * builds its labels out of the step eyebrows) passes LABELS rather than keys,
 * because the `landing` namespace this file reads is not where their copy
 * lives. Everything else — the reveal threshold, the scroll-spy band, the
 * glide, the back-to-top — is shared and stays here.
 *
 * ── Why there are two PLACEMENTS ──────────────────────────────────────────────
 *
 * The rail is a vertically-centred fixed overlay in the right gutter, and that
 * gutter only exists when the viewport can hold the `max-w-7xl` column AND the
 * rail: `left` takes the first branch only from 1696px up for /about's
 * 12.5rem (see `gutterMinRem`, which derives that number rather than assuming
 * it). Below it the `min()` clamps the rail INSIDE the content band, and
 * on the homepage that is harmless — its bands are text and cards with slack at
 * the edges.
 *
 * On /about it is not. That page's step rows are `[1fr auto 1fr]` and the art
 * card fills its column, so the illustration's painted right edge lands 5.2px
 * from the viewport edge at 1024 and 7.9px at 1280 — measured. The rail's box
 * (151.5–181.3px wide, 335.8px tall) therefore sat ON the right-hand
 * illustrations by 194.8px at 1024, 192.1px at 1280 and 112.1px at 1440.
 *
 * There was no version of "move the rail" that fixes it while it stays on the
 * right, and the numbers say so rather than a hunch:
 *   • Anywhere on the right edge collides: the art reaches within 5.2px of the
 *     viewport edge, so even a 44px handle overlaps.
 *   • Moving it off the vertical centre does not help either. The art and the
 *     rail are both centred on the viewport's midline; the tallest art is
 *     377.9px and the rail 335.8px, so separating them vertically needs a
 *     viewport ≥ 1098px TALL. Laptops are 700–900.
 *   • Laying the entries out horizontally along the bottom needs 967px (en) /
 *     1027 (cs) / 1083 (de) / 1139 (fr) against the 992px a 1024 viewport has.
 * And the content cannot yield instead: reserving the rail's band with track
 * padding shrinks the art column to 301px at 1024 and 425px at 1280 — smaller
 * than it was before the art was enlarged, which is the one thing this page is
 * not allowed to do.
 *
 * So BELOW the gutter width /about's rail becomes a DOCK: the same entries, the
 * same scroll-spy, the same glide, collapsed into a bottom-right pill that reads
 * out the phase you are in — a full label, never a dot or a truncation — and
 * opens the whole labelled list on click. Bottom-right is the one place a
 * persistent affordance fits: the art bottom sits 151px above the pill at an
 * 800px viewport and 51px at 600px. It retires while the footer is on screen so
 * it can never cover the footer's own controls.
 *
 * AT AND ABOVE the gutter width the rail is what renders, unchanged. 1920×1080
 * is the commonest desktop size and the gutter branch wins there — the rail
 * fits, shows all eight destinations at rest and overlaps nothing, so trading it
 * for a one-line pill would charge the largest group of readers for a defect
 * they never had. `placement="adaptive"` is that fork; `"rail"` (the default,
 * what the homepage gets) is the rail at every width, exactly as before.
 *
 * The two are mutually exclusive by construction: ONE `matchMedia` store decides
 * which branch renders, so only one nav is ever in the document — rather than
 * rendering both and hiding one, which would leave a second `aria-label="Page
 * sections"` nav and a second scroll-spy on the page at every width. The
 * threshold is DERIVED from the same three numbers that build `left` (see
 * `gutterMinRem`) rather than typed as a literal `min-[1696px]` next to them.
 */

/** One rail entry: the element id it scrolls to, and the label it shows. */
export type RailSection = { id: string; label: string };

/**
 * Where the nav sits. `"rail"` is the right-gutter rail at every width — the
 * homepage's shape. `"adaptive"` keeps that rail wherever the gutter genuinely
 * exists and falls back to the bottom-right dock below it. See the placement
 * note in the header comment.
 */
export type RailPlacement = "rail" | "adaptive";

/*
 * ── The one place the rail's geometry is written down ─────────────────────────
 *
 * The bands are `max-w-7xl` (80rem), so the content column's right edge sits at
 * `50% + 40rem`, and the rail parks RAIL_GAP_REM past it. Those two constants
 * plus the caller's `widthRem` build the `left` expression below AND the width
 * at which the first branch of its `min()` starts winning. Solve
 *
 *     50%·vw + CONTENT_HALF + RAIL_GAP  ≤  100%·vw − width
 *
 * for vw and the gutter exists from `vw ≥ 2·(CONTENT_HALF + RAIL_GAP + width)`:
 * 106rem = 1696px for /about's 12.5rem rail, 99.5rem = 1592px for the
 * homepage's 9.25rem. Deriving it is the point — a literal `min-[1696px]` in a
 * class string beside `calc(100% - 12.5rem)` is the same fact written twice,
 * and the second copy is the one that goes stale when a caller's width changes.
 *
 * `rem` in a media query resolves against the browser's INITIAL font size while
 * the `left` calc resolves against the root element's; this app sets neither, so
 * both are 16px and the two agree exactly (asserted below in `gutterQuery`'s
 * unit — and if a root font-size is ever introduced, that is the line to fix).
 */
const CONTENT_HALF_REM = 40;
const RAIL_GAP_REM = 0.5;
const gutterMinRem = (widthRem: number) => 2 * (CONTENT_HALF_REM + RAIL_GAP_REM + widthRem);

/* One subscription per query string, so `useSyncExternalStore` gets stable
 * identities and the homepage — which never asks — registers no listener. */
function subscribeMedia(query: string | null) {
  return (onChange: () => void) => {
    if (!query) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  };
}
function readMedia(query: string | null) {
  return () => (query ? window.matchMedia(query).matches : false);
}

// Section ids as they appear down the page — the order doubles as the
// scroll-spy tiebreak when two sections straddle the viewport midline.
// Exported so the phone-width disclosure (sections/MobileNav.tsx) offers the
// SAME five destinations: the rail is `lg:block`, so below that breakpoint this
// list is the only in-page navigation there is, and two copies of it would
// drift the moment a band is added.
export const SECTIONS = [
  { id: "proof", key: "proof" },
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

/*
 * The dock's disclosure. Its own component so `useDialogA11y` mounts WITH the
 * panel — the same non-modal contract MobileNav's panel uses (focus moves in on
 * open, Escape closes, focus returns to the toggle) rather than a second
 * hand-rolled one.
 */
function DockPanel({
  id,
  widthRem,
  onClose,
  children
}: {
  id: string;
  widthRem: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogA11y(ref, onClose, { trap: false, lockScroll: false });
  return (
    <div
      id={id}
      ref={ref}
      tabIndex={-1}
      style={{ minWidth: `${widthRem}rem` }}
      className="absolute bottom-full right-0 mb-2 rounded-2xl border-[3px] border-[#17202a] bg-[#fdf8ee] p-1.5 shadow-[6px_6px_0_#17202a] outline-none"
    >
      {children}
    </div>
  );
}

/*
 * The list itself — the eight/five entries plus back-to-top. Shared verbatim by
 * both placements: the rail renders it directly inside its fixed panel, the
 * dock renders it inside the disclosure. One copy, so a dot, an opacity or an
 * `aria-current` can never mean two different things on the two pages.
 */
function RailBody({
  items,
  active,
  onSelect,
  onTop
}: {
  items: RailSection[];
  active: string | null;
  onSelect: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
  onTop?: () => void;
}) {
  const t = useTranslations("landing");
  const reduceMotion = useReducedMotion();
  return (
    <>
      <ul className="flex flex-col gap-1">
        {items.map((s) => {
          const on = active === s.id;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(e) => onSelect(e, s.id)}
                aria-current={on ? "true" : undefined}
                className={`group/item flex items-center gap-1.5 rounded-xl px-1.5 py-1 text-sm font-bold transition-colors focus-ring ${
                  on ? "bg-[#dce7d0]" : "hover:bg-[#dce7d0]/60"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full border-[3px] border-[#17202a] transition-colors ${
                    on ? "bg-[#d65a4a]" : "bg-white group-hover/item:bg-[#caa54c]"
                  }`}
                />
                {/* Inactive labels stay readable at 55% — a destination you
                    can't read isn't one you can choose. Opacity alone
                    carries the state, so nothing reflows as you scroll. */}
                <span
                  className={`whitespace-nowrap transition-opacity duration-200 ease-out group-hover/item:opacity-100 ${
                    on ? "opacity-100" : "opacity-55"
                  }`}
                >
                  {s.label}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => {
          window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
          onTop?.();
        }}
        className="group/item mt-1 flex w-full items-center gap-1.5 rounded-xl border-t-[3px] border-dashed border-[#dce7d0] px-1.5 pb-1 pt-2 text-sm font-bold transition-colors hover:text-[#d65a4a] focus-ring"
      >
        {/* Sized to the dots above so the labels share one column. */}
        <span aria-hidden className="grid h-2.5 w-2.5 shrink-0 place-items-center">
          <ArrowUp className="h-3.5 w-3.5" />
        </span>
        <span className="whitespace-nowrap opacity-55 transition-opacity duration-200 ease-out group-hover/item:opacity-100">
          {t("nav.top")}
        </span>
      </button>
    </>
  );
}

export default function SectionRail({
  sections,
  // Room the widest label needs, in rem; see the `left` style below. The
  // homepage's widest is "Voice interview" at ~9.25rem. A NUMBER rather than a
  // CSS length because `gutterMinRem` has to do arithmetic on it — one value,
  // two derivations, no parsing.
  widthRem = 9.25,
  placement = "rail"
}: { sections?: RailSection[]; widthRem?: number; placement?: RailPlacement } = {}) {
  // The typed catalog only exposes top-level namespaces, so scope to `landing`
  // and reach the nav keys by path.
  const t = useTranslations("landing");
  const reduceMotion = useReducedMotion();
  const shown = useSyncExternalStore(subscribeScroll, isScrolledPastHero, serverSnapshot);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Whether the page footer is on screen. Only the dock consults it — a fixed
  // pill in the bottom-right corner would otherwise sit on top of the footer's
  // own links and language switch once the reader reaches the end. Observing
  // the landmark rather than reserving N pixels of document tail: the footer
  // wraps to 151px at 1024 and 107px above it, and a constant would be wrong
  // for one of them.
  const [footerInView, setFooterInView] = useState(false);
  const panelId = useId();
  /*
   * Does this viewport have the gutter the rail needs? Only `"adaptive"` asks —
   * `"rail"` passes `null` and so subscribes to nothing, which is why the
   * homepage's behaviour is untouched rather than merely unchanged-looking.
   *
   * A media STORE and not a `min-[…]:hidden` pair: CSS would need both navs in
   * the document at every width, and a `display:none` nav is still a second
   * scroll-spy, a second IntersectionObserver over the same eight rows and a
   * second thing to keep in step. This way exactly one exists, and the swap on
   * resize is a single React commit — never a frame with both or neither.
   */
  const gutterQuery = placement === "adaptive" ? `(min-width: ${gutterMinRem(widthRem)}rem)` : null;
  const hasGutter = useSyncExternalStore(
    useMemo(() => subscribeMedia(gutterQuery), [gutterQuery]),
    useMemo(() => readMedia(gutterQuery), [gutterQuery]),
    // The server has no viewport. It also renders nothing (`shown` is false
    // there), so this value never reaches the DOM — the first CLIENT render
    // already reads the real match and picks the right branch.
    serverSnapshot
  );
  // The fork, in one place: the dock is the fallback for an adaptive caller on a
  // viewport with no gutter. Everything below reads THIS, never `placement`.
  const asDock = placement === "adaptive" && !hasGutter;
  // Which sections currently cross the viewport's middle band. A Set (not a
  // single id) so a short section handing off to a tall one can't flicker.
  const visible = useRef(new Set<string>());

  const items: RailSection[] = sections ?? SECTIONS.map((s) => ({ id: s.id, label: t(`nav.${s.key}`) }));
  // The observer is re-armed when the DESTINATIONS change, not when their
  // labels do (a locale switch re-renders every label and must not tear down
  // the scroll-spy). A joined string rather than the array so the dependency
  // compares by value.
  const ids = items.map((s) => s.id).join(",");

  useEffect(() => {
    // Page order, which doubles as the tiebreak when two sections straddle
    // the midline. Read from the dependency so the effect closes over nothing
    // that can go stale.
    const order = ids.split(",");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.current.add(id);
          else visible.current.delete(id);
        }
        const first = order.find((id) => visible.current.has(id));
        setActive(first ?? null);
      },
      // Only the middle 10% band of the viewport counts as "you are here".
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );
    for (const id of order) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    // No need to clear `visible` on teardown: the lookup below only ever asks
    // about ids in the CURRENT `order`, so a stale entry cannot be chosen.
    return () => observer.disconnect();
  }, [ids]);

  /*
   * Glide to the section instead of teleporting. A bare `href="#id"` jump-cuts
   * (the page sets no `scroll-behavior`, and setting it globally would also
   * change every other anchor in the app), so the rail drives the scroll
   * itself and keeps the anchor href as the no-JS fallback.
   *
   * `history.replaceState` rather than pushState: the rail is a scrubber, not
   * a trail of destinations — six entries would otherwise bury the page the
   * visitor arrived from under six back-presses. The hash still updates, so
   * the URL stays shareable mid-page.
   */
  const scrollToSection = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return; // Section not on the page — let the browser try the anchor.
    event.preventDefault();
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
    // A dock entry is inside a disclosure, so choosing one closes it. The rail
    // has nothing open, and `setOpen(false)` on an already-false state is a
    // no-op React bails out of — so this costs the homepage nothing.
    setOpen(false);
  };

  useEffect(() => {
    if (!asDock) return;
    const footer = document.querySelector("footer");
    if (!footer) return;
    const observer = new IntersectionObserver(([entry]) => setFooterInView(entry.isIntersecting), {
      threshold: 0
    });
    observer.observe(footer);
    return () => observer.disconnect();
  }, [asDock]);

  if (asDock) {
    const activeLabel = items.find((s) => s.id === active)?.label ?? t("nav.sections");
    // Retire the pill while the footer is on screen — see `footerInView`.
    const dockShown = shown && !footerInView;
    return (
      <AnimatePresence onExitComplete={() => setOpen(false)}>
        {dockShown ? (
          <motion.nav
            aria-label={t("nav.sections")}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
            transition={reduceMotion ? { duration: 0.15 } : { type: "spring", bounce: 0.35, duration: 0.5 }}
            /* Bottom-right, and `lg:` for the same reason the rail is: below
               that breakpoint the page's own header disclosure is the nav. */
            className="fixed bottom-5 right-5 z-40 hidden lg:block"
          >
            {/* Toggle FIRST in the DOM, panel second — a disclosure's trigger
                precedes what it discloses, so Tab reaches the entries after it
                (the panel is `absolute`, so it still paints above). */}
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((v) => !v)}
              /* `width` is the room the LONGEST label needs, so the pill is the
                 same size on every step and nothing twitches as you scroll. */
              style={{ minWidth: `${widthRem}rem` }}
              className="flex w-full items-center gap-2 rounded-2xl border-[3px] border-[#17202a] bg-[#fdf8ee] px-3 py-2 text-sm font-bold shadow-[6px_6px_0_#17202a] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[4px_4px_0_#17202a] focus-ring"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full border-[3px] border-[#17202a] bg-[#d65a4a]"
              />
              {/* The pill IS the you-are-here readout: the phase you are in,
                  spelled out. The sr-only prefix says what the button opens
                  without hiding the visible label from the accessible name. */}
              <span className="sr-only">{t("nav.sections")}: </span>
              <span className="flex-1 whitespace-nowrap text-left">{activeLabel}</span>
              <ChevronUp
                aria-hidden
                className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              />
            </button>
            {open ? (
              <DockPanel id={panelId} widthRem={widthRem} onClose={() => setOpen(false)}>
                <RailBody items={items} active={active} onSelect={scrollToSection} onTop={() => setOpen(false)} />
              </DockPanel>
            ) : null}
          </motion.nav>
        ) : null}
      </AnimatePresence>
    );
  }

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
          /*
           * Parked in the gutter beside the content column, not pinned to the
           * viewport edge. Open labels make the rail ~9rem wide, and a plain
           * `right-5` put that straight over the third feature card on a
           * 1440px laptop — the bands are `max-w-7xl` (80rem), so the content's
           * right edge is at `50% + 40rem` and the rail can start just past it.
           * The `min()` clamps it back to the viewport on screens too narrow to
           * have a gutter, where an overlay is the only option left — and on a
           * 1440px laptop that clamp is the branch that WINS (the gutter there
           * is 72px), so `width` is the rail's real right-edge position, not a
           * fallback. A caller with longer labels than the homepage's must say
           * so or have them cut off at the viewport edge.
           */
          style={{
            left: `min(calc(50% + ${CONTENT_HALF_REM}rem + ${RAIL_GAP_REM}rem), calc(100% - ${widthRem}rem))`
          }}
          className="fixed top-1/2 z-40 hidden rounded-2xl border-[3px] border-[#17202a] bg-[#fdf8ee] p-1.5 shadow-[6px_6px_0_#17202a] lg:block"
        >
          <RailBody items={items} active={active} onSelect={scrollToSection} />
        </motion.nav>
      ) : null}
    </AnimatePresence>
  );
}
