/*
 * Shared surface recipes — the "write once, apply multiple times" seam
 * (docs/DESIGN.md). These are the canonical class strings for the recurring
 * visual patterns found across the workspace (panel ~94 call sites, meta
 * label ~101, secondary pill ~64, section header ~55 at extraction time).
 * Restyling a recipe here re-skins every consumer — in BOTH themes, because
 * each class resolves through the token seam in globals.css.
 *
 * Constants, not components, on purpose: these carry no behavior, so a plain
 * string keeps JSX shape unchanged, works on any element (section, button,
 * Link) and adds zero runtime. Patterns WITH behavior (Modal, Badge,
 * SegmentedControl, Skeleton) stay components in app/_components/.
 *
 * Sizing (p-*, h-*, px-*) stays at the call site — the recipes own identity
 * (shape, border, fill, type color), not layout. Compose: `${PANEL} p-5`.
 *
 * Migration is opportunistic: when touching a file, swap its literal recipe
 * strings for these constants. New components must compose them from day one.
 */

/** Raised card — the workspace's primary surface. Pair with p-4/p-5.
 *  In Spark Dark this becomes a sticker (drawn 2px outline, 16px radius) via
 *  the `[data-theme="dark"] .shadow-panel` ride in globals.css — which also
 *  catches the ~90 not-yet-migrated literal panels. */
export const PANEL = "rounded-lg border border-stone-200 bg-white shadow-panel";

/** Quiet well — empty states, placeholders, nested passive regions. */
export const PANEL_SUNKEN = "rounded-lg border border-stone-200 bg-paper/40 dark:rounded-2xl";

/** Section eyebrow above a display title ("PIPELINE", "INTERVIEW SIM"…). */
export const EYEBROW = "text-meta uppercase text-coral";

/** Display title under an eyebrow. */
export const TITLE_DISPLAY = "font-serif text-display text-ink";

/** Intro/lede paragraph under a display title. */
export const INTRO = "text-body text-steel";

/** Field/legend/data label — the neutral cousin of EYEBROW. */
export const META_LABEL = "text-meta uppercase text-steel";

/** Bordered chip: inline fact with optional leading icon. Rests a degree
 *  off-axis in Spark Dark, straightens under the cursor. */
export const CHIP =
  "inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-sm text-steel transition-transform dark:-rotate-1 dark:hover:rotate-0";

/** Filled quiet chip: non-semantic tag (semantic tones belong to Badge). */
export const CHIP_QUIET = "rounded-full bg-stone-100 px-2 py-0.5 text-sm text-steel dark:rotate-1 dark:inline-block";

/** Primary action. Pair with a height + horizontal padding (h-10 px-4).
 *  Spark Dark presses down like the landing's BTN: hard sticker shadow that
 *  shrinks as the button travels into it. */
export const BTN_PRIMARY =
  "focus-ring inline-flex items-center gap-1.5 rounded-md bg-coral font-semibold text-white transition-all hover:bg-coral/90 disabled:opacity-50 dark:rounded-lg dark:shadow-sticker-sm dark:hover:translate-x-[1px] dark:hover:translate-y-[1px] dark:hover:shadow-sticker-xs";

/** Secondary action. Same pairing rule + press-down as BTN_PRIMARY. */
export const BTN_SECONDARY =
  "focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 font-medium text-ink transition-all hover:border-coral/40 disabled:opacity-50 dark:rounded-lg dark:border-stone-300 dark:shadow-sticker-sm dark:hover:translate-x-[1px] dark:hover:translate-y-[1px] dark:hover:shadow-sticker-xs";

/** Text input / textarea / select base. */
export const FIELD = "rounded-md border border-stone-200 bg-white px-3 py-1.5 text-base text-ink";

/** Segmented aria-pressed toggle group wrapper (ThemeToggle / LanguageSwitcher
 *  sidebar footer toggles). The bordered pill rail; pair with role="group". Note
 *  these use button-group (aria-pressed) semantics — distinct from the shared
 *  SegmentedControl's radiogroup/roving-tabindex contract — so only the class
 *  strings are shared, not the component. */
export const TOGGLE_GROUP = "inline-flex items-center gap-0.5 rounded-md border border-stone-200 p-0.5";

/** Active/inactive treatment for a button inside a TOGGLE_GROUP — the app's
 *  bg-ink active pill. Sizing/padding stays at the call site. */
export const toggleBtn = (isActive: boolean): string =>
  isActive ? "bg-ink text-white" : "text-steel hover:bg-stone-100";
