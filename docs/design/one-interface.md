# One — the AI-conducted home (spark `one-interface`, round 5)

One is the recruiter's AI-conducted home: ONE surface, conducted from a conversation, that
puts views from every module (pipeline, decisions, schedule, jobs, analytics, comms) in one
sight. Since round 5 it is a **workspace tab** (`/?tab=one`, first in the rail's hiring group)
and `/one` stays as its **full-page alias**. On `/one` the Workspace is reached as the
**Console** (top-right link, or Ctrl/⌘ K → `/?tab=pipeline`); inside the workspace there is no
Console link — the workspace is the console, and a panel's "Open in Console" switches tabs in
place.

Round 1 shipped one shared **core** and three layout directions; round 2 refined the winner
three ways (the owner picked **Split**); round 3 judged three finishes of it and the owner picked
**Dense**. Round 4 extended what the simplified UI can do — a candidate's profile, their held
outreach email, the interview calendar — as shared tools (real reads, preview acts) and judged
three LAYOUTS of them; the owner kept **Sheets** and round 5 consolidated on it: one layout, no
variants, no `?v=`, and the tab. See "Round 4 verdict" and "Round 5 — one layout, two frames,
the tab".

Governing standard: registry subject `model-composed-workspace` (golden path +
`composition-region`, `reversible-screen-ops`). Shape reference (not code):
`paypal/docs/design/conversational-home*.md`.

## Entry points

| Path | What |
| --- | --- |
| `/?tab=one` → `app/features/one/OneTab.tsx` | The workspace tab: `OneShell` in the `tab` frame, mounted through the lazy tab-chunk map (`TAB_CHUNKS.one` in `app/features/shell/tabChunks.ts`, `TAB_PANELS.one` in `WorkspaceTabChunks.tsx`). Rail: first item of the hiring group, label "One" (`nav.tabs.one`), icon `Sparkles`, chord `g f o`. Not the default tab (Overview stays `DEFAULT_TAB`). |
| `app/one/page.tsx` | The full-page alias, `page` frame. Server page. Not public (absent from `app/_lib/auth/public-routes.ts`); repeats the home gate (`hasEnteredWorkspace`, else redirect to `/`). `instant = false` (cookies per request). |
| `app/features/one/OneShell.tsx` | Owns the core and, per frame, the fixed chrome (page: brand + Console link + Ctrl/⌘ K; tab: none); hands the layout `LayoutProps`. Its root is the FINISH root (`data-one-root`, `data-finish`, `data-one-frame`, the Figtree + Caveat font variables): it imports `finish.css`, provides the motion flavor (`motion.ts`) and the frame (`OneFrameContext`, `panels/PanelShell.tsx`). Wrapped in `KitSurface` (calm density). |
| `app/features/one/layout/` | THE layout: `SheetsLayout.tsx`, the sheet-stack rules (`stack.ts`, tested), the view-placement rule (`side.ts`, tested) and its paint (`styles.ts`, the dense compaction folded in). |
| `app/features/one/tools/` | Round 4: the tools' reads (`reads.ts` hooks, `parse.ts` pure parsers) and views (`ProfileTool`, `LetterTool`); the interview tool is `panels/CalendarPanel.tsx` scoped to one entry. |
| `app/features/one/finish.css` · `motion.ts` · `Seg.tsx` | The finish hooks, the motion presets, the one segmented control (+ `CountTick`). See "Round 3 core". |

## The contract (`app/features/one/types.ts`)

Closed vocabularies in the repo's shape (literal array + derived union + runtime guard):
`PANEL_KINDS` (needs, pipelineSlice, scheduleAhead, funnel, jobDrafts, outbox,
decisionsQueue, roleCard; round 4: letters, calendar, profile, letter), `ACT_KINDS`
(entryAdvance, entryReject, wave, companion; round 4 previews: letterApprove, letterSend,
interviewBook, interviewLink), `CHIP_IDS` (+ letters, calendar), `SAY_KEYS`, `CHANGE_KEYS`,
`TOOL_KINDS` (profile, letter, interview). (`VARIANT_IDS` / `variantOf` were deleted in round 5.)

- `Op` = `show` (a panel, params) · `focus` (a panel on screen) · `propose` (an act, params)
  · `navigate` (a Console tab, params). There is no verb that moves, hides or resizes chrome.
- `Reply` = `{ say: { key, values? }, ops ≤ 4, chips ≤ 4, fallback? }`. `say` is a catalog key
  under `one.core.say.*`, never English, and carries **no figure**.
- `LayoutProps` (`layoutProps.ts`; `VariantProps` until round 5): `session` (state + hand
  actions), `submit`, `greeting`, `attention`, `renderPanel(panel, {look, className, onExpand})`,
  `renderConsent(proposal, {className})`, `words`; round 4: `selected`,
  `select`, `renderTool(tool, entry, {look, className})`, and `renderPanel`'s `group` option.
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

## Round 2 core

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
At `lg` and up the page never scrolls: a flex column, the header, then a `min-h-0 flex-1` body
the layout fills with `h-full`; regions scroll inside themselves. Below `lg` it stacks and the
page scrolls. `KIT_FILL` in `OneShell.tsx` passes the height through the kit surface's wrappers.
The column is `h-dvh` on `/one` and `h-full` of the box `OneTab` gives it in the workspace (see
"The tab").

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
figure; a changed figure tweens (`countTick`). Right: the Console as a link-styled button
("Console →"). Round 5: the switcher is gone, and in the `tab` frame the header is the counts
row alone (no mark, no Console link).

### The layout (round 2's Split; since round 5 the page of `layout/SheetsLayout.tsx`)
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
Named presets, each in three flavors — **calm** and **spring** (unused since round 4), **snap**
(every layout), `FLAVOR_OF` — and each with a STILL form under `useReducedMotion()` (no offset, no
stagger, no tween). Every move is ≤ ~300 ms; nothing loops (`motion.test.ts`).

| Preset | What moves | Wired in |
| --- | --- | --- |
| `answerSwap(dir)` | the reply + the card, keyed by answer id; back enters from the left, forward / new from the right; leaving is a quick fade | SheetsLayout (`AnimatePresence`) |
| `panelEnter` | the side's view when the primary or the tab changes | SheetsLayout side |
| `rowStagger(i)` | a mounted table's first 8 rows, 20–30 ms apart; later rows arrive with the 8th | PanelFrame `TableBody` |

Under reduced motion every preset returns its rest state at once. `rowStagger` returns an instant settle-to-rest spec, never `null`: `useReducedMotion()` starts `false` on mount, so a row may already sit at the stagger's opacity 0 when the preference arrives, and dropping `animate` would leave it invisible (found by the dense and spark finish builders, round 3).
| `consentEnter` | a consent card rises and settles; leaves with a fade | SheetsLayout consent stack |
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

Three finishes of the Split layout were judged (refined, spark, dense); the owner picked Dense, and
refined, spark and the split baseline were deleted in round 4 (their write-ups are in git history,
this file before round 4). Dense, as it stands:

### Dense — compact, keyboard-first (the finish One wears)

Round 5: the Dense LAYOUT is deleted; the finish lives on. Its compaction of the shared panels
(descendant variants, so `PanelFrame` is never forked) is `COMPACT` / `ASKING_TRIM` in
`layout/styles.ts`; its hooks are the `[data-finish="dense"]` block in `finish.css`; the copy it
shared with Sheets lives in `one.sheets`. The table below is as measured in round 3.

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

## Round 3 verdict

Owner (verbatim): "group candidates by role on right side in lists, lets now extend the
functionality available from the simplified UI related to what we can do now in the app: 1. Wire
email channel and approve AI generated draft email 2. Ability to view calendar and schedule
interview for those waiting for interview 3. Display candidate profile from the view (CV preview,
scoring if available on other half of the screen)... Create three variants with different visual
approaches ... after winning we can wire all the features to work end to end, together with LLM
engine".

The pick is the **Dense** finish. `variants/refined`, `variants/spark` and the round-2 `split`
layout were deleted with their catalog subtree (`one.split` — the keys Dense still used moved to
`one.dense`); `split/side.ts` (+ test) and `split/styles.ts` live on in `variants/shared/` (round 5: `layout/`).
`finish.css` keeps the dense block only and every layout sets `data-finish="dense"`; `FLAVOR_OF`
is `snap` for all four. Owner decisions for round 4: **real reads, preview acts** (everything
shown is real data; Approve / Send / Book / Send link arm a consent card whose confirm is disabled
with "Wired after the pick" — no write reaches any door), **one new read door**
(`GET /api/outreach-letters?state=drafted`), and only the outreach letter is shown as held (no
rejection or interview letter is a held draft today, so none is faked).

## Round 4 core (the contract the layout codes against)

(Round 4 judged it through four `?v=` layouts — dense, workbench, sheets, cards; since round 5
there is one.)

### Selection
`session.selected: { entryId, label } | null`, `session.select(entry | null)` — on `LayoutProps`
as `selected` / `select`. A row that names a candidate (pipeline slice, decisions queue, letters,
the calendar's waiting list, the agenda's interviews) is selectable: a press or Enter picks it,
Esc on a row clears it, and the picked row is marked (ink lead stroke, sunken fill,
`aria-selected` / `data-picked`; its quiet acts show). Selection is **navigation, not an undo
step**: the undo stack and the answer snapshots never record it; a **new answer clears it** (a
fresh question is a fresh context); stepping through answers, the user's hand on the region and
undo leave it (pinned by `engine/session.test.ts`).

### Tools — `renderTool(tool, entry, { look?, className? })`
`TOOL_KINDS` = `profile` · `letter` · `interview`. A tool is a panel bound to one candidate,
drawn by the host outside the session's region (no pin / close chrome — the layout closes it
with `select(null)`). Default look `pane` (fills its container — give it a height; **two columns
from 900px of its own width**, a container query, stacked below); `insight` = a compact card.

| Tool | Panel kind (params `entryId`, `label`) | Reads | Pane |
| --- | --- | --- | --- |
| profile | `profile` | `GET /api/pipeline/[id]/timeline` → the analysis it links (`labelOnly` = matched by name only, said in a caution note); none linked → `seed-<candidateId>` (the demo corpus); then `GET /api/analyses/[slug]` | the CV as the analysis read it (`candidate.rawText` — there is no CV file store, said under it) \| overall + job-fit (`resolveVerdict`, a blocked score is "Unscored"), the five parts against their maxima (25 / 30 / 23 / 12 / 10, `ScoreList`), job-fit matching / missing / unproven, strengths, gaps, soft signals; engine + analysed date |
| letter | `letter` | `GET /api/outreach-letters/by-entry/[entryId]` + `GET /api/comms?entry=<id>&limit=20` | the letter a release would SEND (state, revision, recipient, subject, body with the legal footers, the delivery forecast line) and its one next act — Approve (drafted) / Send (approved, delivery failed, held back) \| the thread with the one delivery verdict per message. No letter held → said, plus "only first-contact outreach is held today" |
| interview | `calendar` scoped to the entry | the ONE schedule read, `?slots=1`, the pipeline read | waiting or not (an unknown wait length is said, never "0 days"), their invitations, Send a link, the free times as Book buttons, the interview zone |

### Panels added (`PANEL_KINDS`)
| Kind | Reads | Looks |
| --- | --- | --- |
| `letters` | `GET /api/outreach-letters?state=drafted&limit=200` (the new door) | table / list: candidate (subject under), revision, drafted; rows selectable, grouped by role; the quiet ✓ or `a` arms a preview Approve. insight: letters per role, the one waiting longest, and one suggestion that is a READ (open the oldest in the email tool) |
| `calendar` | `GET /api/schedule?limit=200` (filtered client-side by week), `GET /api/schedule?slots=1`, `GET /api/pipeline` | table / pane: the week grid (Mon–Fri; booked = ok mark, awaiting the candidate = wait mark; free times; a pager from the first week with a day still ahead to the end of the 21-day offer horizon) beside the waiting list grouped by role (from 760px of its own width, under it below); with a waiting candidate selected the free times become Book buttons. list: the week as an agenda grouped by day. insight: this week's shape, who waits longest, ONE suggested booking (longest waiter × first free time → preview consent). `truncated`, a failed slots read and an unavailable calendar are notes; "no calendar connected" is said beside the zone |
| `profile`, `letter` | above | `pane`, `insight` |

`PanelLook` gains `pane`. Waiting for an interview = an active entry with
`approvalKind === "calendar"` (`useScheduleTab`'s rule); its `approvalDetail` ("Tue 14:00") is a
placeholder and is never drawn as a slot. Reads live in `tools/reads.ts` (hooks over
`panels/read.ts`) with the pure parsers in `tools/parse.ts` (`tools/parse.test.ts`).

### Role grouping
Pipeline rows in the `table` and `list` looks are grouped by role (`PanelRow.group`): a head per
role (title, count, "N stalled" with the caution mark when > 0) that sticks under the column
head (`--one-colhead-h`, finish.css) while its group is in view; groups sit where their first row
was and rows keep the view's own order inside; one group only → no head. Under a head the row's
role subline is hidden (it would say the role twice; the age stays). Group heads are not focus
stops — ↑ ↓ cross groups. `renderPanel(panel, { group: "none" })` keeps a view flat; views whose
rows carry no role (outbox, schedule) are never grouped.

### Preview acts (`ACT_KINDS`)
`letterApprove` (entryId, letterId, revision, label) · `letterSend` (entryId, letterId,
revision?, label) · `interviewBook` (entryId, dateSlot `YYYY-MM-DD HH:MM` in the interview zone,
label, when = the slot's server label, zone) · `interviewLink` (entryId, label). `consent/acts.ts`
`PREVIEW_ACTS` marks them: the card renders title + ONE consequence line from the real data
("Approves the letter to Ana (revision 2). Nothing is sent yet." / "Books Ana on Mon 9 Nov · 10:00
(Europe/Prague)." / "Emails Ana a link to pick a time."), a disabled confirm and the line
`one.core.consent.preview` "Wired after the pick". A malformed revision or a non-slot (`Tue 14:00`)
disarms. Wiring one later = drop it from `PREVIEW_ACTS` + its door in `doors.ts`
(`POST /api/outreach-letters/[id]/approve` `{revision}`, `…/release`, `POST /api/schedule`
`{action:"book", entryId, dateSlot}`, `POST /api/schedule/invite` `{entryId}`). The validation
door treats all four as entry acts (an id the user was never shown drops the act).

### Conductor and header
Intents + chips `letters` ("emails to approve", "drafts waiting", "letters", "outreach" — "draft /
write outreach to …" stays the companion's act) and `calendar` ("calendar", "schedule", "this
week", "who is waiting for an interview", "book", "slots"; plain "interviews" still answers with
`scheduleAhead`). `open <name>` / `profile of <name>` → the profile of the ONE active entry whose
label holds every word (case- and accent-insensitive, from the shared pipeline read the shell
passes as `ResolveContext.entries`); several, none, or the read not landed → `pipelineSlice
{ name }` with `profileMany` / `profileNone`. "open the pipeline" (a view word) is not a name.
Header: a **Letters** stat from the new door (a dash until it lands; its press asks `letters`);
the **Interviews** stat now asks `calendar`.

### The new read door
`GET /api/outreach-letters?state=drafted[&limit=]` → `{ letters: [{ id, entryId, candidateLabel,
jobTitle, subject, state, revision, createdAt, updatedAt }], state, limit, truncated }`.
`outreachLetterListByState` (`app/_lib/db/outreach-letters.ts`): workspace-bound, on
`idx_outreach_letters_open`, erased rows left out, oldest first, cap 200, one row past the cap read
for `truncated`; no body on the list. `withWorkspace` + `requireOperator` like the by-entry read.
Documented in `docs/features/comms/README.md` §8a.

### Sample letters (`?sample=letters`, development builds only)
The dev DB holds no drafted letter, so the email moments could not be judged. In a development
build opened with `?sample=letters`, `useLettersWaiting` (tools/reads.ts) answers an EMPTY real
list with three made-up drafts addressed to real candidates (the highest-scored new arrivals —
the axis's `entry` role, never someone hired or on an offer), each flagged `sample`; `useLetter` serves the matching draft
(`one.core.sample.subject|body`). The letters view's foot and the letter tool both say
`one.core.sample.note`. Nothing is stored, the acts stay preview-only, and a production build
never turns it on. Remove it when the hold mechanism is wired end to end.

Round-4 data seen (dev DB, 2026-11-07):
29 decisions in 8 role groups; 6 entries waiting for an interview (4 roles; 3 with no recorded
stage date); 0 outreach letters held in the dev DB (the letters view and the header say so); the
profile tool rendered a seeded analysis (`seed-cand-*`, matched by name only per the timeline).

## Round 4 verdict

Owner (verbatim): "lets keep it, remove other variants and migrate to the app." — then, asked,
keep **Sheets**; "migrate" = **add One as a workspace tab** (a nav rail entry alongside the
existing tabs; `/one` stays as a full-page alias).

History, one line each (the write-ups are in git history, this file at f4af53ad0):
- **Dense** (`?v=dense`) — the round-3 pick as the baseline; tools hosted in the card slot. Deleted.
- **Workbench** (`?v=workbench`) — the picked person took half the page. Deleted.
- **Sheets** (`?v=sheets`) — tools slide over the main column as stacked sheets. **Kept.**
- **Cards** (`?v=cards`) — the answer card became the tool. Deleted.

## Round 5 — one layout, two frames, the tab

**One layout.** `layout/SheetsLayout.tsx` is the layout; `OneShell` imports it directly (no
`next/dynamic` map, no `?v=`, no switcher, no `VARIANT_IDS`; `ONE_FLAVOR = "snap"` replaces
`FLAVOR_OF`). The `one.dense` / `one.workbench` / `one.cards` catalog subtrees and
`one.core.meta.layout|variants` were deleted (Sheets used none of them); `vocabulary.test.ts`
pins that only `one.sheets` and `one.core` remain. The page is the dense page (answer + insight
card left, role-grouped list right); tools open as sheets over the main column: letters ·
calendar · profile (CV | score, the main column widens to half) · letter · schedule. They stack
(two drawn, the lower one a 24px spine with its name, a breadcrumb names the stack), Esc pops one,
there is no scrim (the list stays live; another row swaps the top sheet's person), the header
counts open their sheet, and consent cards ride at the foot of the top sheet. The sheets are
`absolute` inside the main column, never `fixed`, so a transformed ancestor (the tab panel's
entrance animation) cannot capture them.

**Two frames** (`OneFrame = "page" | "tab"`, `panels/PanelShell.tsx`):

| | `page` (`/one`) | `tab` (`/?tab=one`) |
| --- | --- | --- |
| Size | owns the viewport: `h-dvh` from lg | fills `OneTab`'s box: `h-full min-h-0` from lg |
| Header | brand mark + "One", counts, "Console →" | the counts row alone (the tab's own head) |
| Ctrl/⌘ K | → `/?tab=pipeline` | not bound (the workspace palette owns it) |
| Console links (`ConsoleAnchor`) | plain links to `/?tab=…` (a real navigation) | same href; a primary click switches tabs in place through `useShellNavigate().push` (the URL inbox adopts `?tab=` and strips it; like every workspace tab switch it is not a Back step); a modified click keeps the browser's meaning |

### The tab
The workspace's content frame (`Workspace.tsx`: `py-8 pb-24` around the panel) is
content-sized, so the panel has no height to fill. `OneTab` gives it one from lg:
`calc(100dvh - 2rem - max(6rem, var(--sim-bar-h)))` — the frame's top padding, and at the foot
whichever is taller of the frame's padding and the fixed simulation dock's live strip
(`--sim-bar-h`, published by the dock), so One's composer is never under the raised dock. The
document stays one viewport tall; below lg One flows and the page scrolls.

Rail position: first in the hiring group. One summarises that group's queues (its counts row IS
their badges), so it sits above the tabs it asks across; it is not the default tab. Chord:
`chordOverflow`, so it lands on `g f o` and no existing chord moves (every letter of "one" is
already a single chord). Mounted through the lazy tab-chunk map like every tab — `app/page.tsx`
does not import it statically, but `npm run perf:budget` walks dynamic imports too, so One's
~45 modules count against `app/page.tsx` (see Known gaps).

Measured (dev data, 2026-11-07, the dock lowered and raised, both themes): scrollHeight equals
the viewport (900 / 800) in every capture of the tab and of `/one` — first beat, decisions,
profile sheet, letters sheet (`&sample=letters`), calendar sheet.

### Core debts the round-4 builders found (still owed)
- The tools go two-column only from 900px of their own width; the layout forces it locally
  (half a screen is 610–760px). Lower it to about 600px or give tools a `columns` option.
- The letters table's 5rem acts column overlaps the drafted date with "Open in Console" (Dense too).
- The calendar puts the waiting list beside the week only from 760px; the free-time buttons
  overflow ~85px day columns at 1280.
- A tool's own head repeats the name the host already shows; a headless `pane` would remove
  three local overrides.
- With a letter consent open, the tool's Approve and the card's disabled confirm are both coral.
- The letter body box collapses at 1280 while a consent card is open.
- Fixed by the Director: "waiting longest" sorted people with no recorded date FIRST (a `"~"`
  sentinel under locale collation); `byKnownTimeFirst` in `panels/pipelineRead.ts` now puts them last, in the
  calendar and the stalled slice.

## History

Round 1 (Greet, Stage, Brief), round 2 (Greet kept; Split, Spotlight, Ticker) and round 3's
refined / spark finishes and round 4's dense / workbench / cards layouts are recorded in git
history (this file before rounds 3, 4 and 5). Kept from them: the counts header, the answer
stepper instead of a transcript, one surface per panel, the no-scroll frame, Split's page,
Dense's finish and the Sheets layout.

## Known gaps

- **Companion acts cannot run from `/one`.** A companion proposal is only ever created
  inside a model turn of a Candi thread (`createProposal` in `app/_lib/db/companion.ts` has
  no caller outside that module; `/api/companion/**` exposes threads, messages, brain and
  resolve — no create). Round 1 adds no route, so the card hands off to the Console.
- **Single-entry acts have no undo here.** `reinstate` reverses only an auto-rejection;
  a hand reject is reopened through the Console's re-add door.
- **The conductor is keyword-matched**, English-only on the input side; the replies are
  catalogued. `cs` / `de` / `fr` carry the English `one.core` / `one.sheets` strings until
  promotion (`nav.tabs.one` is "One" in every locale — a name).
- **In the tab at 1280 the side list scrolls sideways.** The workspace rail + item panel take ~270px and the frame ~60px, so
  the side gets ~440px (~345px under a letters sheet) against the candidate table's 32rem
  floor; the score and acts columns sit past the edge (the table scrolls horizontally, nothing
  is lost). `/one` at 1280 is unaffected.
- **One's modules count against the `app/page.tsx` perf budget** (the budget walks the lazy tab
  loaders too): about +45 modules / +314 KB.
- **The greeting is the first beat only**; it does not re-read after a data act (panels do).
- **Undo of a reply is per step** (the last screen change), not "undo the whole reply".
- **Round-4 acts are previews.** Approve / Send / Book / Send link arm a card whose confirm is
  disabled; the doors exist and are wired after the layout pick.
- **No CV file is stored**; the profile's CV is the analysis text, and a corpus entry's analysis
  may be matched by name only (said on the tool).
