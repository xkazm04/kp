"use client";

import { useCallback, useMemo, useRef, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";

/*
 * The shared pieces of the console panels (prototype land/mocks.js helpers):
 * the stroke icon set, chips, the five-dot rating, the machine / person /
 * candidate badge, the replay and pause keys, and the restart that replays a
 * panel's entrance. Class names are the prototype's; css/land-mocks*.css style
 * them (the panel root is `.mock`, renamed from B/3's `.mk` while scoping).
 */

/** Inline custom properties (`--w: 92%`), which CSSProperties does not type. */
export function vars(v: Record<`--${string}`, string | number>): CSSProperties {
  return v as CSSProperties;
}

const PATHS = {
  check: <path d="M4 12.5l5 5L20 6.5" />,
  clip: <path d="M20 11.5l-8 8a5 5 0 01-7-7l8.5-8.5a3.3 3.3 0 014.7 4.7L9.5 17a1.7 1.7 0 01-2.4-2.4l7.5-7.5" />,
  replay: <path d="M4 12a8 8 0 102.6-5.9M4 4v4.6h4.6" />,
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M8 5l11 7-11 7z" />,
  arrow: <path d="M4 12h15M13 6l6 6-6 6" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  link: <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  portal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M7 13h6M7 16h4" />
    </>
  ),
  boards: (
    <>
      <rect x="3" y="4" width="8" height="7" rx="1.5" />
      <rect x="13" y="4" width="8" height="7" rx="1.5" />
      <rect x="3" y="13" width="8" height="7" rx="1.5" />
      <rect x="13" y="13" width="8" height="7" rx="1.5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  plus: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  pen: (
    <>
      <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
  seal: (
    <>
      <circle cx="12" cy="9.5" r="6" />
      <path d="M9.6 9.6l1.7 1.7 3.2-3.6M8.7 14.4L7 21l5-2.6 5 2.6-1.7-6.6" />
    </>
  ),
  dup: (
    <>
      <rect x="3" y="3" width="12" height="12" rx="2" />
      <rect x="9" y="9" width="12" height="12" rx="2" />
    </>
  )
} as const;

export type IconName = keyof typeof PATHS;

export function Ico({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `mk-ico ${className}` : "mk-ico"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

export function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={className ? `mk-chip ${className}` : "mk-chip"}>{children}</span>;
}

/** Five rating dots, `n` of them on. */
export function Dots({ n }: { n: number }) {
  const t = useTranslations("siteFeatures");
  return (
    <span className="mk-dots" role="img" aria-label={t("kit.dots", { n })}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={i < n ? "on" : undefined} />
      ))}
    </span>
  );
}

export type Who = "machine" | "person" | "candidate";

/** Who does a step: the machine, a person, or the candidate. */
export function WhoBadge({ who }: { who: Who }) {
  const t = useTranslations("siteFeatures");
  return <span className={`mk-who is-${who}`}>{t(`kit.who.${who}`)}</span>;
}

export function ReplayButton({ onReplay }: { onReplay: () => void }) {
  const t = useTranslations("siteFeatures");
  return (
    <button type="button" className="mk-re mk-end" onClick={onReplay}>
      <Ico name="replay" />
      {t("kit.replay")}
    </button>
  );
}

export function PauseButton({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  const t = useTranslations("siteFeatures");
  return (
    <button type="button" className="mk-re mk-end" aria-pressed={paused} onClick={onToggle}>
      <Ico name={paused ? "play" : "pause"} />
      {paused ? t("kit.play") : t("kit.pause")}
    </button>
  );
}

/**
 * The panel root and its replay: the prototype re-ran a panel's CSS entrance by
 * toggling `mk-off` (every animation off) across one forced reflow, which keeps
 * the DOM, and so the focused replay key, in place. Returns the ref for the
 * panel's `.mock` root and the restart function.
 */
export function useRestart(): [RefObject<HTMLDivElement | null>, () => void] {
  const ref = useRef<HTMLDivElement | null>(null);
  const restart = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add("mk-off");
    void el.offsetWidth;
    el.classList.remove("mk-off");
  }, []);
  return [ref, restart];
}

/** Whether the visitor asked for reduced motion, read at the moment of a click
 *  (the prototype's reducedNow()). */
export function reducedNow(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  };
}

/**
 * A media query as external state (the pattern of the retired
 * app/landing/spark/useStillMotion.ts, which this replaces on the site; see
 * app/landing/spark/landing-motion.test.ts): the server and the hydrating render answer `false`, the truth
 * arrives on the next commit, so the markup never mismatches.
 */
export function useMedia(query: string): boolean {
  const subscribe = useMemo(() => subscribeMedia(query), [query]);
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}

export const MQ_REDUCED = "(prefers-reduced-motion: reduce)";
export const MQ_MOBILE = "(max-width: 1099px), (max-aspect-ratio: 5/4)";
