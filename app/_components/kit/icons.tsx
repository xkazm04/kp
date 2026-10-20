/*
 * The kit's 16px line icons (kit.js IC in the One Measure winner): stroke 1.7, round caps.
 * Ported as drawn rather than mapped to lucide, whose 24px grid and stroke 2 read heavier at 16px.
 */
export type KitIconName =
  | "search" | "copy" | "left" | "right" | "up" | "down" | "x" | "plus"
  | "resend" | "trash" | "open" | "check";

const PATHS: Record<KitIconName, string[]> = {
  search: ["M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z", "m10.5 10.5 3 3"],
  copy: ["M6.5 5h5A1.5 1.5 0 0 1 13 6.5v5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 5 11.5v-5A1.5 1.5 0 0 1 6.5 5Z", "M3 10.5V4a1 1 0 0 1 1-1h6.5"],
  left: ["M10 3 5 8l5 5"],
  right: ["m6 3 5 5-5 5"],
  up: ["m3 10 5-5 5 5"],
  down: ["m3 6 5 5 5-5"],
  x: ["m4 4 8 8M12 4l-8 8"],
  plus: ["M8 3v10M3 8h10"],
  resend: ["M13 8a5 5 0 1 1-1.5-3.6", "M13 2.5v3h-3"],
  trash: ["M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"],
  open: ["M6 3H3v10h10v-3", "M9 3h4v4M13 3 7.5 8.5"],
  check: ["m3 8.5 3 3 7-7"],
};

/** @catalog A 16px kit line icon (search, copy, arrows, x, plus, resend, trash, open, check). */
export function KitIcon({ name }: { name: KitIconName }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
