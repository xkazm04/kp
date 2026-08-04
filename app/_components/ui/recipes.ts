/*
 * Shared surface recipes — the "write once, apply multiple times" seam
 * (docs/design/README.md). These are the canonical class strings for the recurring
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

/** Quiet well — empty states, placeholders, nested passive regions. A faint
 *  stone fill (not the near-invisible paper/40 tint) so it reads as genuinely
 *  recessed against a white PANEL. */
export const PANEL_SUNKEN = "rounded-lg border border-stone-200 bg-stone-50 dark:rounded-2xl";

/* ── Composition (Option C) — the studio rhythm. One spacing scale, one card
 *    padding default, one ruled header, so sections read as a deliberate
 *    editorial grid on the cream canvas instead of ad-hoc clusters. ── */

/** Vertical rhythm between the major sections of a tab/page. */
export const SECTION = "space-y-8";

/** Default padding for a primary card surface. Compose `${PANEL} ${CARD_PAD}`. */
export const CARD_PAD = "p-5";

/** Ruled divider between sections within a panel/header. Warm hairline in light;
 *  the globals.css ride turns `.border-t` dashed in Spark Dark. */
export const DIVIDER = "border-t border-stone-200";

/** Page/tab header — eyebrow + display title + intro on the left, actions/stats
 *  on the right, ruled off from the content below and generously spaced. Compose
 *  the title trio inside (EYEBROW / TITLE_DISPLAY / INTRO). */
export const PAGE_HEADER =
  "flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-stone-200 pb-5";

/** Section eyebrow above a display title ("PIPELINE", "INTERVIEW SIM"…). */
export const EYEBROW = "text-meta uppercase text-coral";

/** Display title under an eyebrow. */
export const TITLE_DISPLAY = "font-serif text-display text-ink";

/** Intro/lede paragraph under a display title. */
export const INTRO = "text-body text-steel";

/** Field/legend/data label — the neutral cousin of EYEBROW. */
export const META_LABEL = "text-meta uppercase text-steel";

/** Toggle chip — filter pills / quick filters. Active = coral-tinted; inactive
 *  = neutral with a coral hover hint. Replaces the hand-rolled toggle pattern
 *  repeated across the filter bars (pair with aria-pressed at the call site). */
export const CHIP_TOGGLE = (isActive: boolean): string =>
  `focus-ring inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
    isActive ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40 hover:text-ink"
  }`;

/** Tertiary / ghost action — the quiet "cancel" gap between BTN_SECONDARY and a
 *  bare link. No border; a soft hover wash. Pair with a height + padding. */
export const BTN_GHOST =
  "focus-ring inline-flex items-center gap-1 rounded-md font-medium text-steel transition-colors hover:bg-stone-100 hover:text-ink disabled:opacity-50";

/** Icon sticker — a framed icon container with 2D depth (feature marks, step
 *  badges, verdict glyphs). Pair with a size (h-10 w-10). */
export const ICON_STICKER =
  "inline-grid place-items-center rounded-xl border-2 border-stone-200 bg-white shadow-sticker-sm dark:border-stone-300";

/** Stat card — a small accent surface for a labelled number. Pair with
 *  STAT_LABEL + STAT_VALUE and sizing (e.g. `${STAT} min-w-[5rem] px-3 py-2`). */
export const STAT = "flex flex-col gap-0.5 rounded-lg border border-stone-200 bg-white shadow-pop";

/** Uppercase label above a STAT value. */
export const STAT_LABEL = "text-meta uppercase text-steel";

/** The number itself — serif display voice brought inside. Add the tone color
 *  (text-ink / text-coral / text-amber-700 …) at the call site. */
export const STAT_VALUE = "font-serif text-h2 leading-none nums";

/** Bordered chip: inline fact with optional leading icon. Rests a degree
 *  off-axis in Spark Dark, straightens under the cursor. */
export const CHIP =
  "inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-sm text-steel transition-transform dark:-rotate-1 dark:hover:rotate-0";

/** Filled quiet chip: non-semantic tag (semantic tones belong to Badge). */
export const CHIP_QUIET = "rounded-full bg-stone-100 px-2 py-0.5 text-sm text-steel dark:rotate-1 dark:inline-block";

/** Primary action. Pair with a height + horizontal padding (h-10 px-4).
 *  Light gets a restrained tactility — a faint offset that the button presses
 *  into on hover (0.5px travel). Spark Dark presses down harder, like the
 *  landing's BTN: a full sticker shadow that shrinks as the button travels. */
export const BTN_PRIMARY =
  "focus-ring inline-flex items-center gap-1.5 rounded-md bg-coral font-semibold text-white shadow-sticker-xs transition-all hover:bg-coral/90 hover:translate-x-[0.5px] hover:translate-y-[0.5px] hover:shadow-none disabled:opacity-50 dark:rounded-lg dark:shadow-sticker-sm dark:hover:translate-x-[1px] dark:hover:translate-y-[1px] dark:hover:shadow-sticker-xs";

/** Secondary action. Same pairing rule + press-down as BTN_PRIMARY. */
export const BTN_SECONDARY =
  "focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 font-medium text-ink transition-all hover:border-coral/40 disabled:opacity-50 dark:rounded-lg dark:border-stone-300 dark:shadow-sticker-sm dark:hover:translate-x-[1px] dark:hover:translate-y-[1px] dark:hover:shadow-sticker-xs";

/** Text input / textarea / select base. Carries the dual-theme fill/text plus a
 *  steel placeholder and coral caret so a raw field reads correctly in Spark Dark
 *  even before it's migrated to the TextInput/TextArea/Select primitives. New
 *  fields should prefer those components over this string. */
export const FIELD =
  "rounded-md border border-stone-200 bg-white px-3 py-1.5 text-base text-ink placeholder:text-steel caret-coral";

/** Segmented aria-pressed toggle group wrapper (`LanguageSwitcher` on the public
 *  pages, the org language picker). The bordered pill rail; pair with role="group". Note
 *  these use button-group (aria-pressed) semantics — distinct from the shared
 *  SegmentedControl's radiogroup/roving-tabindex contract — so only the class
 *  strings are shared, not the component. */
export const TOGGLE_GROUP = "inline-flex items-center gap-0.5 rounded-md border border-stone-200 p-0.5";

/** Active/inactive treatment for a button inside a TOGGLE_GROUP — the app's
 *  bg-ink active pill. Sizing/padding stays at the call site. */
export const toggleBtn = (isActive: boolean): string =>
  isActive ? "bg-ink text-white" : "text-steel hover:bg-stone-100";

/** First-level (sidebar rail) icon-only control — the appearance/language popup
 *  triggers and Sign out. Square hit area on the 4.75rem rail, quiet by default,
 *  coral wash when open/active, matching the rail's section buttons. Always pair
 *  with an aria-label/sr-only name: there is no visible text. */
export const railIconBtn = (isActive: boolean): string =>
  `focus-ring relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
    isActive ? "bg-coral/10 text-coral" : "text-steel hover:bg-stone-100 hover:text-ink"
  }`;

/** Keycap chip (`<kbd>`) — command palette + keyboard-shortcuts overlay.
 *  Pair with a type size at the call site (`${KBD} text-sm` / `text-[11px]`). */
export const KBD = "rounded border border-stone-200 bg-paper px-1.5 py-0.5 font-semibold text-steel";
