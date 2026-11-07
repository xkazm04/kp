# /one — the AI-conducted home (spark `one-interface`, round 3)

`/one` is a signed-in alternative home for the recruiter: ONE surface, conducted from a
conversation, that puts views from every module (pipeline, decisions, schedule, jobs,
analytics, comms) in one sight. Today's Workspace (`/` with `?tab=`) stays exactly where it
is and is reached from `/one` as the **Console** (top-right link, or Ctrl/⌘ K →
`/?tab=pipeline`).

Round 1 shipped one shared **core** and three layout directions; round 2 refined the winner
three ways; the owner picked **Split**. Round 3 is visual polish only: the Split LAYOUT is
fixed and three **finishes** of it are judged, `?v=refined|spark|dense` (`?v=split` is the
round-2 baseline with the round-3 core flowing through; unknown or absent → **refined**). They
share one core and differ only in finish (type, spacing, surfaces, motion), never in where
things are.

Governing standard: registry subject `model-composed-workspace` (golden path +
`composition-region`, `reversible-screen-ops`). Shape reference (not code):
`paypal/docs/design/conversational-home*.md`.

## Entry points

| Path | What |
| --- | --- |
| `app/one/page.tsx` | Server page. Not public (absent from `app/_lib/auth/public-routes.ts`); repeats the home gate (`hasEnteredWorkspace`, else redirect to `/`). Reads `?v=` server-side. `instant = false` (cookies + searchParams per request). The direction switcher shows only outside production builds. |
| `app/features/one/OneShell.tsx` | Owns the core and the fixed chrome (Console link, Ctrl/⌘ K, switcher); hands the selected variant `VariantProps`. Its root is the FINISH root (`data-one-root`, `data-finish`, the Figtree + Caveat font variables): it imports `finish.css` and provides the motion flavor (`motion.ts`). Wrapped in `KitSurface` (calm density). |
| `app/features/one/variants/index.ts` | `VARIANTS: Record<VariantId, ComponentType<VariantProps>>`, each `next/dynamic`-loaded from `variants/<id>/<Id>Variant.tsx`. A builder replaces only its own folder. |
| `app/features/one/variants/split/SplitLayout.tsx` | The Split layout every direction renders (`finish?` sets `data-finish` on its root). A finish may fork it into its own folder. |
| `app/features/one/finish.css` · `motion.ts` · `Seg.tsx` | The finish hooks, the motion presets, the one segmented control (+ `CountTick`). See "Round 3 core". |

## The contract (`app/features/one/types.ts`)

Closed vocabularies in the repo's shape (literal array + derived union + runtime guard):
`PANEL_KINDS` (needs, pipelineSlice, scheduleAhead, funnel, jobDrafts, outbox,
decisionsQueue, roleCard), `ACT_KINDS` (entryAdvance, entryReject, wave, companion),
`CHIP_IDS`, `SAY_KEYS`, `CHANGE_KEYS`, `VARIANT_IDS` (`split`, `refined`, `spark`, `dense`).

- `Op` = `show` (a panel, params) · `focus` (a panel on screen) · `propose` (an act, params)
  · `navigate` (a Console tab, params). There is no verb that moves, hides or resizes chrome.
- `Reply` = `{ say: { key, values? }, ops ≤ 4, chips ≤ 4, fallback? }`. `say` is a catalog key
  under `one.core.say.*`, never English, and carries **no figure**.
- `VariantProps` (`variantProps.ts`): `variant`, `session` (state + hand actions), `submit`,
  `greeting`, `attention`, `renderPanel(panel, {look, className, onExpand})`,
  `renderConsent(proposal, {className})`, `words`, `consoleHref`.
- `ChangeLine` carries the view's `params` (and `previousParams`) when it has any, so
  `words.change` names a view by its TITLE (`words.view(kind, params)`: "Stalled candidates",
  "Pipeline · backend"), never by its module ("Pipeline").

## The turn

1. **Greeting** (`engine/greeting.ts`) — composed by the host from `GET /api/attention`:
   a status line, the FIRST need by priority (decisions > pipeline aging > channels/new
   arrivals > schedule > job drafts) and ≤ 4 chips. Nothing waiting → "all clear". A failed
   read → "could not read", never "all clear". Its counts are fetched data, which is why
   the greeting may carry a number and a `Reply` may not.
2. **Resolve** (`engine/resolve.ts`) — pure and deterministic. A chip is its intent; typed
   words go through an ordered keyword matcher (the specific before the general: "reject
   below", "draft a JD" before "drafts"). Intents: needs, decisions, pipeline (optionally
   "for <role>"), stalled, interviews, funnel, new arrivals, drafts, outbox, role, reject
   below N% [on role], advance top N, the four companion acts, console. Anything else →
   `notYet` + three chips, never a guess. The user's own words (a role, a threshold) travel
   as op **params**.
3. **Validate** (`engine/validate.ts`) — the one door every reply passes, even the
   deterministic one: unknown verbs/panels/acts/chips/tabs are dropped and **counted** (the
   turn discloses "N parts could not be shown"); > 4 ops are cut; a `propose` with any
   undeclared field is dropped whole; an entry act bound to an id not on screen is dropped;
   a digit in `say.values` refuses the say (falls back to `notYet`).
4. **Session** (`engine/session.ts`, wrapped by `useOneSession.ts`) — a reply's screen ops
   are pending for 450 ms (the "opening the views" line), then applied as steps. ≤ 3 views;
   a 4th replaces the oldest **unpinned** one in its slot and says which; showing a view
   already on screen focuses it. Pins ≤ 2. Every step records the arrangement first, sets a
   one-line `lastChange`, and `undo()` restores the arrangement before the last step
   (screen changes only, never data acts). The user's hand on a panel (pin, close, focus,
   show) drops pending ops and the change line says so. `stop()` drops pending ops and
   restores the screen from before the turn. Proposals land with the turn (an offer is not
   a rearrangement) and `navigate` is drawn as a Console link on the turn — the conductor
   never moves the user off `/one` by itself.

## Panels (module views)

Each panel reads an EXISTING GET route through `panels/read.ts` (keeps the error body's
`code`; an unrecognised body is an error, never "empty"; two panels on the same URL share
one request; `epoch` re-reads after a data act). Every panel hands one `PanelData`
(columns, rows, an insight reading) to `panels/PanelFrame.tsx`, which draws it as ONE surface in the
requested look (below): loading = the quiet `LoadingGap`, no skeleton; error = critical note
with Retry, text from `useErrorMessage()`; a real empty sentence; and "Open in Console" via
`buildUrl` / `clearedTabScopedParams` (`app/features/shell/tabs.ts`). A count the read did
not return is "—" with its reason, never 0. Layout hooks: `look` → `data-look`,
`className` on the panel root (the frame paints the border; `className` only places and sizes it).

| Kind | Reads | Shows | Empty / error | Console |
| --- | --- | --- | --- | --- |
| needs | `/api/attention` | one row per bucket (+ Candi's open proposals), numeral, press opens the view | "Nothing is waiting on you." / coded | each bucket's tab |
| pipelineSlice | `/api/pipeline` | active entries; `role` (title/id match), `filter` aging (same tier as the badge, `agingTierAt`) or new (axis `entry` role); ≤ 8 + "first N of M" | per-filter sentence / coded | `pipeline` (+`role`, row: `q=<label>`) |
| decisionsQueue | `/api/pipeline` (what `useDecisionsQueue` reads) | active entries on a human gate (`needsHumanDecision`); Advance / Reject → hand proposal | "No candidate is waiting…" / coded | `decisions` |
| scheduleAhead | `/api/schedule?limit=200` | confirmed invites with a future slot, soonest first, in the server's `interviewTz`; says when the read was `truncated` | "No interviews…" / coded | `schedule` |
| funnel | `/api/analytics?days=30` | reached + conversion per stage; the entry stage's conversion is a dash with its reason | "No candidates entered…" / coded | `analytics` |
| jobDrafts | `/api/jobs/status` | draft roles | "No draft roles…" / generic (that route has no coded failure) | `jobs` (+`job`) |
| outbox | `/api/comms?limit=8` | newest messages with `commsVerdict`; a caution note when no relay is configured | "Nothing has been sent…" / coded | `channels` |
| roleCard | `/api/jobs?q=<role>&limit=1` | company, location, seniority, lifecycle, hired / target; "N more match" | "Name a role…" / "No role matches…" / coded | `jobs` (+`job`), its pipeline (`role=<id>`) |

### Panel looks (round 3)

`renderPanel(panel, { look, className, onExpand })`. A panel is one surface — the frame paints
the border (`PANEL`), the host only gives it a cell. Corner, outline width, row height and inner
padding follow the finish hooks (`finish.css`). Hairline row dividers in light, the kit's dashed
rows and 2px rules in dark. 14px floor, tabular figures.

| Look | Shape | Use |
| --- | --- | --- |
| `table` | fills its container: head (title + count), sticky column head, rows on ONE CSS grid template per panel (`--one-row-h`, default 44px), the body scrolls inside. Rows take keyboard focus: ↑ ↓ move, Enter selects, a row's own keys (`a` advance, `r` reject on decisions) arm its acts; the key hint sits in the table foot. Row acts are QUIET: icon buttons shown on the first row, on hover, on focus-within and on the selected row only. The Console door appears on hover / focus. | the side's answer |
| `insight` | the answer's card — "insight, not rows": the SHAPE of the answer (a stacked part bar + legend, a spread that grows into the card's spare height and folds into a one-line strip when squeezed, a few facts) and at most ONE suggested act. It never repeats the table's count. It is the screen's one sticker (`data-one-sticker`); `data-grows` marks a card that has a spread to grow into; `onExpand` adds a See-all link. | the main column's card |
| `list` | a dense single column for a narrow side (≤ 320px): one line + a meta line per item, no table chrome, the Console link in a foot row | kept for a rail |

`summary` and the round-1 bare looks were removed with Greet / Spotlight / Ticker.

Per kind (the insight is computed by `panels/insight.ts`, pure, from the read the panel already
made — no new route, never a number from the reply):

| Kind | Table columns | Insight |
| --- | --- | --- |
| needs | Area · Waiting · door — a row press opens the view that answers it | the buckets as parts; the biggest bucket and why (its greeting line) |
| pipelineSlice | Candidate (name over role · age, ⚠ when stalled) · Stage chip · Score (figure + tier bar) · door | where they stand (count per stage, ≤ 4 parts + other), score spread (5 bins: <40, 40–49, 50–64, 65–74, 75+ — edges on the command bar's usual lines and the board tiers), waiting longest (name, stage, days), most from one role (only when rows span roles); at most one suggested single-entry advance on a row of the slice |
| decisionsQueue | the same three + a 5rem acts track (✓ advance / ✕ reject, hand proposals) | as pipelineSlice, over the queue |
| scheduleAhead | When · Candidate · Role · door | how soon (24 hours · 7 days · 30 days · later) and the next interview (when, who, role); `truncated` noted |
| funnel | Stage · Reached (figure + bar) · Conversion | reached per step as the spread, the biggest stage-to-stage drop (share lost), overall conversion first → last |
| jobDrafts | Role · Company · door | the oldest draft (the route lists newest first), the company with most drafts |
| outbox | Candidate+subject · Status (mark + verdict) · Sent; relay-off note above | delivery of the newest N as parts, the latest message, how many failed or bounced |
| roleCard | Field · Value | its key fields |

**The suggested act** (`suggestEntry`) only ever touches a candidate the card describes: a
SINGLE-ENTRY advance through the existing door (`entryAdvance` → `POST /api/pipeline/[id]`, the
row's stage as `expectedStage`), armed as a hand proposal, so it still goes through the
ConsentCard. The highest-scoring row at or above 65 → "Advance <name>" (reason: the score and the
days waiting); else the longest waiter when stalled → "Advance <name>" (reason: days past the
limit); else nothing. Never a board-wide wave and never a reject: an adverse act is the
recruiter's own pick from the table. Pinned by `panels/insight.test.ts`.

The score bar is the board's tier (`scoreTone`), never a second scale; a missing score is a
dash with no bar.

## Round 2 core (shared by every direction)

### The answer stepper — no infinite chat
Every submitted turn becomes an `AnswerSnapshot { id, asked, turnId, arrangement,
proposalIds }`, captured when its pending ops apply (a reply with no screen ops is captured
at once; one whose ops the user's hand superseded is captured with the hand's arrangement; a
`stop` or a superseding question captures nothing). State carries `answers` (cap 20) and
`cursor` (the index in view, -1 before anything is asked). `stepBack` / `stepForward` move the
cursor and restore that answer's arrangement, reply and proposals; they are **navigation**,
not undo steps (the undo stack is untouched; the change line reads "Showing answer 2 of 5")
and they wait out a pending beat. A submit while an older answer is in view appends at the
END and moves the cursor there; a hand change to the arrangement while an answer is current is
written back into that answer. `OneSession` exposes `current: { asked, reply, panels, proposals }
| null` and `position: { index (0-based), total, canBack, canForward }`.

### The fixed-viewport shell
At `lg` and up the page never scrolls: `h-dvh` flex column, the header, then a
`min-h-0 flex-1` body the variant fills with `h-full`; regions scroll inside themselves. Below
`lg` the page stacks and scrolls. `KIT_FILL` in `OneShell.tsx` passes the height through the kit
surface's wrappers.

## Round 2 verdict

Owner: "lets go with /one?v=split, focus now one round on visual polish only, motion
transitions, UI quality, component design and spacing efficiency". Greet, Spotlight and Ticker
were deleted (folders and their `one.greet` / `one.spotlight` / `one.ticker` catalog subtrees).

The Director's shared defects at 1440x900 / 1280x800, each answered in the round-3 core:
(1) the left summary repeated the table's rows and Advance / Reject, and "29" appeared four times
→ the `insight` look; (2) 15 rows × Advance + Reject → quiet icon acts + row keys; (3) a mostly
empty "In stage" column → age folded into the subline, column dropped, name floor
`minmax(9rem,1.6fr)`; (4) three type voices → one display face per finish, panel titles in the
body face; (5) a tab said "Pipeline" over "Stalled candidates" → views named by title
everywhere; (6) three control styles in the header → one segmented language; (7) losers pruned;
(8) finishes scaffolded; (9) finish hooks; (10) motion presets; (11) a four-line consent card →
title, one line, a tag, Details; (12) a dead band in the left column → a stack that distributes.

## Round 3 core (the polish contract every finish inherits)

### The header (`OneHeader`)
Left: the Kandidate mark and "One" in the display face (`--one-display-font`). Centre: the
decisions — the counts from `/api/attention` as ONE segmented group (`Seg.tsx`); a press asks the
same question the chip does, and the stat whose chip is the question in view carries the sliding
pill (framer `layoutId`, the repo's segmented-control standard) and `aria-pressed`. A count the
read did not return is "—", never 0; the most urgent non-zero stat's figure is the one coral
figure; a changed figure tweens (`countTick`). Right: the direction switcher in the same
segmented style (outside production), then the Console as a link-styled button ("Console →").

### The Split layout (`variants/split/SplitLayout.tsx`)
Two columns filling the body: main `max(32rem, 36vw)` on the left, the side takes the rest (the
name track's floor is what allows the wider main column).
- **Main** is a vertical stack that DISTRIBUTES — no spacer: the "YOU ASKED · …" / "TODAY" row
  with the ‹ n of m › stepper; the reply (or the greeting's status line) in the display face;
  the answer's `insight` card; consent cards; and, anchored to the foot, the chips (ONE line —
  they scroll sideways rather than wrap), the composer (drawn outline, a coral focus ring around
  the whole bar) and the "what changed" hand note + Undo. A card that has a spread
  (`data-grows`) takes the spare height, so its chart grows; a card of facts alone keeps its size.
- **While a consent card is open** (`ASKING_TRIM`): the card drops its suggestion, its spread may
  shrink (folding into the one-line strip), and on a ≤ 56rem-tall viewport the spread goes, so
  card + consent fit one sight at 1280x800.
- **Side**: the primary view's `table`; with more than one view on screen, a `Seg` tab strip
  (shared-layout pill, `useTablist` keys) names each view by its TITLE, primary first, then the
  pinned ones ("· pinned"). Picking a tab is local. First beat: the needs table and the first
  need's table under it (host-drawn, chrome hidden).
- **Coral**: Send is primary only while no consent card is open.

### The consent card
Title (act + who) with a quiet tag ("Final: no undo here", or "Undo available" on a reject wave),
ONE consequence line, the buttons, and a "Details" disclosure at the end of the button row that
holds the rest (what reaches the inbox, the offer step, the wave's board-wide scope, the cost).
The preview rows and the result lines still render in the body.

### Finish hooks (`app/features/one/finish.css`)
Custom properties with defaults at zero specificity (`:where([data-one-root])`, dark values under
`:where([data-theme="dark"]) :where([data-one-root])`), so a finish's plain
`[data-finish="<id>"] { … }` block wins in both themes (a dark-only value:
`[data-theme="dark"] [data-finish="<id>"]`). Colour, shadow and face resolve to tokens.

| Hook | Default (light / dark) | Read by |
| --- | --- | --- |
| `--one-display-font` | Bricolage | brand, the reply line |
| `--one-title-font` | `--one-body-font` | panel + consent titles (h3, semibold) |
| `--one-body-font` | Figtree, then the app sans | the whole surface |
| `--one-row-h` | 44px | table rows |
| `--one-pad` | 1rem | panel heads, insight body, table cell edges, consent |
| `--one-gap` | 2rem | the layout's column gap |
| `--one-radius` | 0.5rem / 16px | every `[data-one-surface]` (panels, insight, consent), the composer |
| `--one-surface-border` | 1px / 2px | every `[data-one-surface]` |
| `--one-sticker-shadow` | ink 5px offset / `--pop-shadow` | the answer card (`[data-one-sticker]`) |
| `--one-sticker-border` | ink / stone-300 | the answer card, the composer outline |

### Motion (`app/features/one/motion.ts`)
Named presets, each in three flavors — **calm** (split, refined), **spring** (spark), **snap**
(dense), `FLAVOR_OF` — and each with a STILL form under `useReducedMotion()` (no offset, no
stagger, no tween). Every move is ≤ ~300 ms; nothing loops (`motion.test.ts`).

| Preset | What moves | Wired in |
| --- | --- | --- |
| `answerSwap(dir)` | the reply + the card, keyed by answer id; back enters from the left, forward / new from the right; leaving is a quick fade | SplitLayout (`AnimatePresence mode="wait"`) |
| `panelEnter` | the side's view when the primary or the tab changes | SplitLayout side |
| `rowStagger(i)` | a mounted table's first 8 rows, 20–30 ms apart; later rows arrive with the 8th | PanelFrame `TableBody` |

Under reduced motion every preset returns its rest state at once. `rowStagger` returns an instant settle-to-rest spec, never `null`: `useReducedMotion()` starts `false` on mount, so a row may already sit at the stagger's opacity 0 when the preference arrives, and dropping `animate` would leave it invisible (found by the dense and spark finish builders, round 3).
| `consentEnter` | a consent card rises and settles; leaves with a fade | SplitLayout consent stack |
| `countTick` | a header figure tweening to its new value | `CountTick` in OneHeader |
| `tabIndicator` | the segmented pill sliding (stats, switcher, side tabs) | `Seg` |

## Acts and their doors (`consent/`)

The ConsentCard renders from the **resolved** act (`consent/acts.ts`), never from reply text:
title, consequence, what reaches the candidate's inbox, any cost, and whether an undo
exists. One primary (coral) button per card; "Not now" dismisses. Rendering runs nothing.

| Act | Door (no new route) | Emails | After |
| --- | --- | --- | --- |
| entryAdvance / entryReject | `POST /api/pipeline/[id]` `{action: "accept"/"reject", expectedStage}` | reject: the rejection letter; advance: may send the next step's invitation | result line; final (no undo from here). `PIPELINE_STAGE_CHANGED` / `PIPELINE_MOVE_CONFLICT` / not-found → "this moved — refresh" |
| wave | `POST /api/pipeline/command` `{text}` preview (rows + total), then `{text, confirm: true, confirmIds}` | reject: each a letter; advance: may invite | counts from the response; reject wave → Undo via `POST /api/pipeline/command/reverse` `{ids, text}` (≤ 200 ids, else "reverse from the Console"); advance is final |
| companion | **downgraded** to a Console hand-off (`run_analysis` → analyze, `draft_jd` → intake, `draft_outreach` / `generate_digest` → pipeline, where the candidate drawer and Candi's dock live) | — | the card states the model-call cost and why it cannot start here |

The wave's text is built so the existing parser (`app/_lib/pipeline-command.ts`) reads it
back to the same intent (pinned by `consent/acts.test.ts`).

## Round 3 finishes

Three finishes of the Split layout on the round-3 core; `?v=split` stays as the round-2 baseline. Each sets its `[data-finish]` block in `finish.css` and forks `SplitLayout` only where markup differs.

### Finish: refined (`?v=refined`, the default) — calm editorial

Files: `variants/refined/RefinedLayout.tsx` (a fork of SplitLayout; same layout),
`variants/refined/styles.ts` (the paint), `variants/refined/motion.ts` (+ `motion.test.ts`),
`finish.css` `[data-finish="refined"]`. No catalog keys of its own (reuses `one.split.*`, `one.core.*`).

| Axis | Refined |
| --- | --- |
| Type | ONE display face, once: the reply line, `--one-display-font: var(--font-serif)` — Fraunces in Studio Light, Bricolage in Spark Dark (each theme's own register), `text-display` medium, `leading-[1.12]`, `text-balance`. The asked line is `META_LABEL` (steel, not a coral eyebrow); the "what changed" note is body face `text-micro` steel (no Caveat hand note, no "start here" scribble). |
| Spacing | 8-pt rhythm: 16px page edge (the header's own, so header / left / right edges align), `--one-gap` 24px, 16px stack gap, 8px dock gap. Table rows 2px tighter (`py-0.5`, `--one-row-h` 2.75rem). |
| Surfaces | Light: 1px hairlines, `rounded-lg`, the answer card wears the soft `--panel-shadow` and a stone-200 outline — the same weight as the table, a page, not a sticker. Dark keeps its register (16px, 2px, the offset). Composer: hairline field + soft shadow, coral border + 30% coral ring on focus. |
| Colour | Ink, steel, stone; coral only for the act (Send / a consent's primary) and the score tiers. Panel "Open in Console" links are steel; the rows' coral lead stroke is dropped (every decision row carried it, so it said nothing — marks and ⚠ ages still do). |
| Insight card | Stacked bar a 6px rule; the spread a SMALL chart — slim columns (≤ 2rem) centred in their bins, so the card still grows into the column without ochre slabs; facts on a hairline. While a consent card is open the spread folds to the one-line strip; at ≤ 56rem tall the spread goes and the card stops growing (`SHORT_STILL`), so no half-clipped strip and no blank band in the surface. |
| Motion | `answerSwap` 6px + fade 200 ms, leave 80 ms fade; `panelEnter` 4px rise 180 ms; `consentEnter` 8px rise 220 ms, no scale; all one ease-out curve, no spring. The side (tables + tab strip) is provided the `snap` flavor: rows rise 2px 20 ms apart (all 8 in ~240 ms) and the tab pill is a 120 ms tween. Still under reduced motion (rows also pinned at rest in CSS). Header count tick / header pills follow the shell's calm flavor. |

Measured (dev DB, 2026-11-07): decisions table rows fully visible 15 at 1440x900 (baseline 13), 12 at
1280x800; left column empty ≈ 0 (the stack's 8px bottom padding; no overflow); scrollHeight == viewport
in every state, both themes.

### Spark (`?v=spark`) — bold landing stickers, springy

Files: `app/features/one/variants/spark/` — `SparkVariant.tsx` (entry), `SparkLayout.tsx` (fork of
`split/SplitLayout.tsx`, same regions, same order), `styles.ts` (the finish's class strings, tokens
only), `motion.ts` (finish-local springs on top of the `spring` flavor); the `[data-finish="spark"]`
block in `finish.css`.

| Part | Spark |
| --- | --- |
| Type | ONE display face, Bricolage, for the brand, the reply (`text-display`, extrabold, `leading-[1.05]`, `text-balance`) AND panel titles (`--one-title-font`, bold). Caveat only for the one hand note: the change line (and "start here" on the first beat, when there is no change line). "Opening the views…" and "not yet" are body text. |
| Spacing | `--one-gap 1.5rem`, `--one-pad 0.875rem`, page padding `py-3`, table head `min-h-11`; table rows are content-height — two 18px lines + 2px padding = 41px (core: 49px), so 16 rows sit fully in sight at 1440x900 and 14 at 1280x800 (core: 13 / 11). Left column: 8px below the stack (its padding for the sticker's offset), no empty band. |
| Surfaces | The insight card is THE sticker: 2px ink outline, 4px hard ink offset (dark: stone-300 outline + `--pop-shadow`), resting tilt -0.6deg (`CARD_TILT`). The table keeps the hairline (1px light / 2px dark); corners 14px light / 16px dark. Chips are small stickers: 2px ink outline + 2px hard offset that presses flat on `:active`, neutral fill (candy is meaning, not decoration). The user's asked words sit on a limewash highlighter — limewash means "your words", nowhere else. |
| While asking | `SPARK_TRIM` replaces Split's `ASKING_TRIM`: the suggestion goes, insight gaps tighten, and the spread folds to its one-line strip instead of vanishing at ≤56rem tall — so card (shape + strip + facts) and the consent card fit one sight at 1280x800 with no clip. |
| Motion | `answerSwap`: x ±24px on a 520/30 spring, opacity 120ms. `cardSettle`: the card drops from +1.2deg/+10px onto its tilt, 40ms behind the reply. `consentEnter`: rise 18px + untilt 1.5deg → 0 on a 460/26 spring. Tab indicator, count tick, panel enter and row stagger: the core `spring` presets. All settle < ~300ms; nothing loops. The pending line moved into the asked row so the card never jumps. `MotionConfig reducedMotion="user"` wraps the layout so transforms are dropped from a component's first frame. |

Known gap (core): `useReducedMotion` seeds `false` per mount, so a freshly mounted table's row
stagger starts its opacity fade before the preference is known; framer's `reducedMotion="user"`
removes the transform but keeps the staggered fade.

### Dense (`?v=dense`) — compact, keyboard-first

Folder `app/features/one/variants/dense/`: `DenseVariant.tsx` → `DenseLayout.tsx` (a fork of
`SplitLayout`, same regions) + `styles.ts` (descendant-variant compaction of the shared panels,
so `PanelFrame` is never forked). Hooks: the `[data-finish="dense"]` block in `finish.css`.
Copy: `one.dense` (`keysLabel`, `keyStep`, `keyList`, `keyEsc`; English in all four catalogs).

| Concern | Dense |
| --- | --- |
| Type | One display face (Bricolage) for the brand and the reply, the reply at **h2** (bold, `text-balance`) rather than display; panel titles in the body face; the hand face (Caveat) is not used — pending / "not built yet" / the change line are plain micro text. `tabular-nums` on the whole surface. |
| Spacing | `--one-row-h: 36px`, `--one-pad: .75rem`, `--one-gap: 1.25rem`; main column `max(30rem, 34vw)` (Split: `max(32rem, 36vw)`); panel heads 40px, column head 32px, table foot `py-1.5`. A row is ONE line: name, then role · age on the same baseline (the name never truncates, the subline gives way). Candidate tables' tracks tightened (`minmax(12rem,1fr) 7rem 7.5rem <acts>`) so the name/role track takes the spare width. |
| Surfaces | Quiet: light 1px hairlines, 8px corners, the answer card keeps its ink outline but wears `--sticker-sm-shadow` instead of the 5px ink pop; dark keeps the drawn 2px outline, steps the corner to 12px and the offset to the small sticker. |
| Insight card | Same reading as the core (stage mix bar, score spread, longest waiter, top role, one suggestion). The spread's bars are drawn at 3/5 of their bin so a tall card reads as a chart, not a wall of colour. While a consent card is open the spread never disappears: it folds into the one-line strip (its size container), so the card has no dead band at 1280x800 (Split hides it there). |
| Keys | `/` → composer (a `/` keycap sits inside the bar); `[` `]` → step answers; `Esc` (or `↓` on an empty composer) → the table's selected/first row, where the core's `↑↓ a r` work. Page keys are ignored while a field has the cursor or a modifier is held. Named in one status line under the composer, beside "↳ what changed" + Undo. |
| Motion | The `snap` flavor unchanged (≤120ms per element, 4–8px position + opacity, no spring). Row stagger 20ms apart (last of 8 rows lands ~240ms). Under reduced motion rows are forced at rest (see core gap below). |

Measured (dev data, 29 decisions): rows fully visible in the side table — **19 at 1440x900 light /
18 dark**, **16 at 1280x800** (Split baseline ≈ 13 / ≈ 11). Left column empty px: **4** (the card's
shadow room) in every state, consent open or not. scrollHeight == viewport (900 / 800) in all
12 captures.

Core gap found: `useReducedMotion()` starts `false` in every newly mounted component, so a table
mounted under reduced motion first renders rows with `rowStagger`'s `initial` (opacity 0); the
hook then flips, `rowStagger` returns `null`, `animate` disappears and framer leaves the rows
invisible (seen on `?v=split` too after stepping back). Dense guards it in CSS
(`motion-reduce:` opacity-100!/transform-none! on `[data-row]`). The core fix: make the still
form of `rowStagger` a spec, not null — `{ initial: false, animate: { opacity: 1, y: 0 },
transition: { duration: 0 } }` — in `motion.ts`.

## History

Round 1 (Greet, Stage, Brief) and round 2 (Greet kept; Split, Spotlight, Ticker) are recorded in
git history (this file before round 3). Kept from them: the counts header, the answer stepper
instead of a transcript, one surface per panel, the no-scroll frame, and Split's layout.

## Known gaps

- **Companion acts cannot run from `/one`.** A companion proposal is only ever created
  inside a model turn of a Candi thread (`createProposal` in `app/_lib/db/companion.ts` has
  no caller outside that module; `/api/companion/**` exposes threads, messages, brain and
  resolve — no create). Round 1 adds no route, so the card hands off to the Console.
- **Single-entry acts have no undo here.** `reinstate` reverses only an auto-rejection;
  a hand reject is reopened through the Console's re-add door.
- **The conductor is keyword-matched**, English-only on the input side; the replies are
  catalogued. `cs` / `de` / `fr` carry the English `one.core` / `one.split` strings until promotion.
- **The greeting is the first beat only**; it does not re-read after a data act (panels do).
- **Undo of a reply is per step** (the last screen change), not "undo the whole reply".
