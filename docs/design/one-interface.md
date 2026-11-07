# /one — the AI-conducted home (spark `one-interface`, round 2)

`/one` is a signed-in alternative home for the recruiter: ONE surface, conducted from a
conversation, that puts views from every module (pipeline, decisions, schedule, jobs,
analytics, comms) in one sight. Today's Workspace (`/` with `?tab=`) stays exactly where it
is and is reached from `/one` as the **Console** (top-right link, or Ctrl/⌘ K →
`/?tab=pipeline`).

Round 1 shipped one shared **core** and three layout directions (Greet, Stage, Brief).
Round 2 keeps Greet as the baseline and adds three refinements — Split, Spotlight, Ticker —
chosen with `?v=greet|split|spotlight|ticker` (unknown or absent → **split**, the round-2
lead). They share one core and differ only in WHERE the current answer lands; the core is
the part that must already be complete and honest.

Governing standard: registry subject `model-composed-workspace` (golden path +
`composition-region`, `reversible-screen-ops`). Shape reference (not code):
`paypal/docs/design/conversational-home*.md`.

## Entry points

| Path | What |
| --- | --- |
| `app/one/page.tsx` | Server page. Not public (absent from `app/_lib/auth/public-routes.ts`); repeats the home gate (`hasEnteredWorkspace`, else redirect to `/`). Reads `?v=` server-side. `instant = false` (cookies + searchParams per request). The layout switcher shows only outside production builds. |
| `app/features/one/OneShell.tsx` | Owns the core and the fixed chrome (Console link, Ctrl/⌘ K, switcher); hands the selected variant `VariantProps`. Wrapped in `KitSurface` (calm density) so kit tips and tokens work in every variant. |
| `app/features/one/variants/index.ts` | `VARIANTS: Record<VariantId, ComponentType<VariantProps>>`, each `next/dynamic`-loaded from `variants/<id>/<Id>Variant.tsx`. A builder replaces only its own file. |
| `app/features/one/variants/PlaceholderLayout.tsx` | The plain reference wiring every variant starts from: greeting, turns, chips, composer (Send / Stop), change line + Undo, region of views, consent cards. |

## The contract (`app/features/one/types.ts`)

Closed vocabularies in the repo's shape (literal array + derived union + runtime guard):
`PANEL_KINDS` (needs, pipelineSlice, scheduleAhead, funnel, jobDrafts, outbox,
decisionsQueue, roleCard), `ACT_KINDS` (entryAdvance, entryReject, wave, companion),
`CHIP_IDS`, `SAY_KEYS`, `CHANGE_KEYS`, `VARIANT_IDS`.

- `Op` = `show` (a panel, params) · `focus` (a panel on screen) · `propose` (an act, params)
  · `navigate` (a Console tab, params). There is no verb that moves, hides or resizes chrome.
- `Reply` = `{ say: { key, values? }, ops ≤ 4, chips ≤ 4, fallback? }`. `say` is a catalog key
  under `one.core.say.*`, never English, and carries **no figure**.
- `VariantProps` (`variantProps.ts`): `variant`, `session` (state + hand actions), `submit`,
  `greeting`, `attention`, `renderPanel(panel, {look, className})`,
  `renderConsent(proposal, {className})`, `words`, `consoleHref`.

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
(columns, rows, headline) to `panels/PanelFrame.tsx`, which draws it as ONE surface in the
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

### Panel looks (round 2)

`renderPanel(panel, { look, className, onExpand })`. A panel is one surface — the frame paints
the border (`PANEL`), the host only gives it a cell. Hairline row dividers in light, the kit's
dashed rows and 2px rules in dark. 14px floor, tabular figures, 44px rows.

| Look | Shape | Use |
| --- | --- | --- |
| `table` | fills its container (`h-full min-h-0`): head, sticky column head, dense aligned rows on ONE CSS grid template per panel, the body scrolls inside the panel; rows take keyboard focus (↑ ↓ move, Enter selects); the Console door appears on hover / focus | the main answer region |
| `summary` | a compact card: the headline figure, ≤ 3 rows, a **See all** button (`onExpand`) or the Console link; never scrolls | a secondary answer beside the main one |
| `list` | a dense single column for a narrow side (≤ 320px): one line + a meta line per item, no table chrome, the Console link in a foot row | a rail |
| `default` / `compact` / `spotlight` | round 1 (Greet): the list drawn bare inside the host's own frame | Greet only |

Per kind, as a table (columns) and as a list (line · meta · trail):

| Kind | Table columns | List / summary |
| --- | --- | --- |
| needs | Area · Waiting · (Console door) — a row press opens the view that answers it | bucket · its companion line · numeral |
| pipelineSlice | Candidate+role · Stage chip · Score (right figure + tier bar) · In stage (age, ⚠ when stalled) · door | name · stage · role · score |
| decisionsQueue | the same four + **Advance / Reject** (hand proposals) | name · stage · role · score, acts under it |
| scheduleAhead | When · Candidate · Role · door | time · candidate · role |
| funnel | Stage · Reached (figure + bar) · Conversion | stage · conversion · reached |
| jobDrafts | Role · Company · door | role · company |
| outbox | Candidate+subject · Status (mark + verdict) · Sent; relay-off note above the rows | name · verdict · subject · time |
| roleCard | Field · Value | field · value |

The score bar is the board's tier (`scoreTone`), never a second scale; a missing score is a
dash with no bar. The ConsentCard is one compact surface that fits a ~360px column (primary
button never wraps).

## Round 2 core (shared by every variant)

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
written back into that answer. Stepping back stops at the first answer. `OneSession` exposes
`current: { asked, reply, panels, proposals } | null` (the pending turn while its beat runs)
and `position: { index (0-based), total, canBack, canForward }`. The full turn list stays in
`session.turns` for a variant that wants a history drawer.

### The header (`OneHeader`, every variant)
Left: the mark and "One". Centre: the **decisions** — the counts from `/api/attention`
(decisions waiting · stalled · new arrivals · interviews ahead · drafts to publish) as
clickable stats. A press asks the same question the chip does and the stat whose chip is the
current question is marked (`aria-pressed`). A count the read did not return is "—", never 0;
the most urgent non-zero stat (that order) is the only one in coral. Right: the layout
switcher (outside production builds, a quiet segmented control), then Console. Size comes from
`HEADER_SIZE` in `variants/index.ts`: `compact` = inline stats (64px), `hero` = big stat
tiles with the figure in display type (ticker).

### The fixed-viewport shell
At `lg` and up the page never scrolls: `h-dvh` flex column, the header, then a
`min-h-0 flex-1` body (`overflow-y-auto`) the variant fills with `h-full`; regions scroll
inside themselves. Below `lg` the page stacks and scrolls. The kit surface's three wrappers
are given the viewport height by `KIT_FILL` in `OneShell.tsx`.

### `VariantProps`
`variant, session, submit, greeting, attention, current, position, stepBack, stepForward,
renderPanel(panel, { look?, className?, onExpand? }), renderConsent(proposal, { className? }),
words, consoleHref`.

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

## Round 1 verdict

Owner: "Keep Greet variant … the visual quality is mediocre in both main components and
right sidebar. We should move number of decisions into the header, using side space for
lists and tables, keeping experience in one page sight without scrolling — avoiding infinite
chat but rather displaying last message + component or section related to the answer."

Director's diagnosis of r1 Greet at 1440x900: (1) the header was a bare wordmark and
switcher pills; (2) a panel rendered inside an empty outer card — a double frame; (3) table
rows were sparse, a lone score floated mid-row, 72px rows, no column grid; (4) the page was
~1430px tall on a 900px viewport; (5) the side index was a bare list with orphan counts.
Round 2's core answers each: the header carries the counts, a panel is one surface, tables
sit on a real grid, the shell does not scroll, and the answer stepper replaces the transcript.

## Round 1 variants

Greet is the baseline kept for round 2 (`?v=greet`).

### Stage — retired after round 1.

### Brief — retired after round 1.

### Greet — the home is a conversation (`?v=greet`, round 1)

**Files.** `app/features/one/variants/greet/` — `GreetVariant.tsx` (layout), `placement.ts`
(+ `placement.test.ts`: which reply owns which view), `styles.ts` (the sticker paint). Copy in
`one.greet.*` (en authored; cs/de/fr carry the English for now).

**What the user sees first.** An eyebrow ("Today"), the status line set big in Bricolage
(`text-display`, extrabold), and the first need as ONE tilted sticker card (ink outline, hard ink
offset, coral dot) with a Caveat "start here" note above it and "Show me" inside. The greeting's
≤ 4 chips sit under it until the first reply arrives; after that the chips always sit under the
newest reply.

**Where answers land.** Inline. The user's words are a limewash sticker on the right; One's reply
is a line beside the Kandidate mark, and the views it opened render UNDER that reply as sticker
cards. `placement.ts` records, per view id, the reply that was newest when the view first
appeared (or the greeting, for "Show me" before any reply). Owners are never forgotten, so Undo
restores a view under the reply it came from, not at the bottom. Consent cards render in their
reply turn (hand-proposed acts below the conversation), Console links in the turn.

**Side.** A slim index of the 8 modules — a click is a question (the module's chip; the role card
starts "Show me the role for " in the composer and focuses it, because it needs a role in the
user's words). Each row says in words when its view is "on screen" or "pinned" and carries the
attention read's numeral for decisions / interviews / drafts ("—" when the read is absent).
Pinned views (≤ 2) LEAVE the conversation and sit under the index as "Kept beside you"; unpinning
returns them to their reply. The Console link + "Ctrl K / ⌘K" hint closes the side.

**What changed + Undo.** Docked: a sticky strip at the bottom of the conversation column holds the
"what changed" line as a Caveat hand note (`↳ Showing Decisions.`, `role="status"`, with an
sr-only "What changed:" label) and its Undo, directly above the composer — so it is in reach
after every screen change however far the conversation scrolled. While a reply's change is
pending, the reply shows "Opening the views…" and Send becomes Stop.

**Focus.** The view in front (only when ≥ 2 are on screen) is drawn in coral AND tagged "in front"
in hand — never colour alone; it is scrolled into reach.

**Motion.** Turns and views arrive with the shared `animate-tab-in` (springy in Spark Dark), all
behind `motion-safe:`; scroll-into-view is `auto` under reduced motion. No framer-motion — the
variant stays lean.

**Register.** The landing's sticker sheet in both themes: Studio Light = ink outline + hard ink
offset on white over paper; Spark Dark = stone-300 drawn outline + `shadow-pop`, 16px radius.
Faces: Bricolage (app-wide `--font-bricolage`), Figtree body and Caveat hand from
`app/landing/site/chrome/fonts.ts` (variables applied on the variant root; no landing CSS).
Coral is reserved for acts: the only coral primary on screen is the ConsentCard's; "Show me" and
Send are secondary.

**Deviations from the shared contract.**
- Pinned views move to the side rather than staying in place — "pin" reads as "keep beside me".
- Below `lg` the side stacks after the conversation (index + pins at the page foot); a round-2
  phone layout should fold the index into a chip row at the top.
- The chips' 4-limit and the ≤ 3 views are the core's; nothing re-imposed here.

## Round 2 variants

Three Greet refinements on the round-2 core (counts header, stepper, no-scroll frame). Greet stays as the round-1 baseline.

### Split — the answer on the left, its full list on the right (`?v=split`, round 2)

**Files.** `app/features/one/variants/split/` — `SplitVariant.tsx` (layout), `side.ts` (+ `side.test.ts`:
which view is the answer's primary, the tab order, which tab the side shows), `styles.ts` (the
sticker paint, re-using Greet's faces). Copy in `one.split.*` (en authored; cs/de/fr carry the English).

**Frame.** A two-column grid filling the body (`h-full`, nothing scrolls the page at 1280x800 or
1440x900). Main = `max(30rem, 34vw)` on the left; the side takes the rest. Edges: 16px gutters,
the same as the header's mark and Console button, so header, main and side share left and right edges.

**Main column (top to bottom).**
- A fixed row: the eyebrow "YOU ASKED · <the question>" (or "TODAY" on the first beat) and the
  ‹ n of m › stepper at its right. It sits outside the scroll region, so the stepper is always in reach.
- The reply in Bricolage `text-display` extrabold, the ONE display-size line on screen (the first
  beat shows the status line here). A fallback adds "not built yet, honestly"; dropped parts and
  Console links follow.
- The answer's **summary** (`look: "summary"`): the only sticker on screen (ink outline + hard ink
  offset; Spark Dark: drawn stone-300 outline + `shadow-pop`). The sticker replaces PANEL's outline
  via important modifiers, so it is still ONE surface. Its session chrome is hidden (pin/close live
  once, on the side table). See all → the side shows that view's table and focus lands on its first row.
- Consent cards under it. While one is open the summary keeps only headline + See all (on a
  ≤ 56rem-tall viewport its head goes too), and a new card is scrolled into reach.
- The dock (pinned to the column foot, a hairline / dashed rule above it): follow-up chips, the
  composer (2px outline, no offset), and under it the "what changed" line as the Caveat hand note
  + Undo, indented 48px so it clears the bottom-left corner.

**Side.** The primary view's full **table** (`look: "table"`, content height, scrolls inside
itself). When more than one view is on screen, a segmented tab strip (`TOGGLE_GROUP` +
`toggleBtn`, `useTablist`: arrows, Home/End) lists them: primary first, then the pinned ones
("· pinned"), then the rest. Picking a tab is local state: it never focuses a panel in the session,
so the main column does not change. A new answer resets the pick to its primary.

**First beat.** Main = "TODAY", the status line, the first need as the sticker summary with a
Caveat "start here" (See all = Show me). Side = the needs table, and under it the first need's full
table filling the rest of the height. Both are drawn by the host (they are not on the session's
screen), so their pin/close chrome is hidden. Nothing waiting / read failed → status line + needs table.

**Short viewport (≤ 56rem tall).** The summary shows headline + 2 rows (See all still names the
full count). That is what keeps 1280x800 in one sight with a decision summary, whose rows carry
Advance / Reject.

**Coral.** Send is the primary only while no consent card is open; with a card, the card's button
is the one coral primary and Send turns secondary.

**Deviations.**
- Width split is ~36/64 at 1440 and ~40/60 at 1280, not 55/45: the core's entry tables have 31.5rem
  of fixed tracks plus an 11rem acts column, so at 45% of 1280 the candidate column collapsed to
  "F…". Core fix that would allow 55/45: give the name track a floor (`minmax(9rem,1.6fr)` in
  `useEntryCols`, `PipelineSlicePanel.tsx`) and let the table scroll sideways.
- Chips moved from under the summary into the dock (above the composer), so they never fall below
  the fold of the scroll region.
- The "what changed" note sits UNDER the composer (indented), not above it, so the composer can run
  to the column's left edge while the bottom-left corner stays clear.
- Tab labels use the module name (`words.panel`), so a stalled pipeline view reads "Pipeline"
  while its table title says "Stalled candidates".

### Spotlight: one answer at a time, on a stage (`?v=spotlight`, round 2)

**Files.** `app/features/one/variants/spotlight/`: `SpotlightVariant.tsx` (layout), `stage.ts`
(+ `stage.test.ts`: which view is the hero, which sit beside it, which are pinned), `styles.ts`
(faces + the hero sticker). Copy lives in `one.spotlight.*` (en authored; cs/de/fr carry the English for now).

**Grid.** Two columns, `minmax(0,1fr) | 18rem` (20rem at xl), and two rows, `auto | minmax(0,1fr)`,
inside the shell's fixed body. The page does not scroll at 1440x900 or 1280x800. Each region scrolls
inside itself. Row 1 is the caption band, split on the same column line as the body:
- **Left:** "You asked" plus the asked words (small), then the reply sentence as the screen's one
  display line (Bricolage, `text-display`, at most two lines). Under it in steel: pending, not-yet,
  dropped and Console links.
- **Right (the answer cell):** the `‹ Answer n of m ›` stepper, then the "what changed" line as the
  one Caveat hand note (truncated to one line, full text on its tip) with Undo inline.
On the first beat, the left side holds an eyebrow, the status line and the first need. The right
side holds the hand note "start here ↓", which points at the stage.

**Stage (row 2, left).** The hero view in `look:"table"` fills the stage. It is the ONLY sticker on
screen: ink outline with a hard ink offset in Studio Light, and a cream outline with `shadow-pop` in
Spark Dark, applied as `!` overrides on the panel's own surface so no frame sits inside another. The
hero is the focused unpinned view, or else the newest one. Other unpinned views sit beside it in a
17rem/20rem column as `look:"list"` (filling the height, scrolling inside). The first beat previews
the first need's view (or the funnel when all is clear) as a host-rendered table with no chrome. An
answer that left nothing on stage shows a stated empty ("Nothing on the stage").

**Dock (under the stage).** A "Next" eyebrow and the reply's chips, then the composer: the Kandidate
mark, a 44px field and Send. Send is primary unless a consent card is on screen, so there is one coral
primary per view. The field starts 56px in, which keeps it clear of the dev badge's corner.

**Standing side (row 2, right).** It looks the same on every answer:
1. Consent cards (reply and hand proposals).
2. The worklist: the needs view in `look:"list"`, host-rendered with no pin or close, so it never
   uses up one of the region's three slots. Its rows open views on the stage.
3. "Kept beside you": pinned views as list looks, or a one-line hint.
4. "Open a view": an index of the 8 modules where a click is a question. The role module pre-fills
   the composer. The index shows only when there are no pins and no consent, and its bottom edge
   lines up with the composer.

**Why consent sits on the side.** Putting consent above the composer would shrink the stage, the
data the act is about. Putting it in the caption band would make the display line jump. At the top
of the side, the card sits directly under the answer cell, beside the rows it acts on, in the column
that is already "what is waiting on me". The worklist below it shrinks and scrolls.

**Deviations.**
- The side's needs list repeats the header's counts (the brief asks for it). Its rows add the
  route to the stage and the Console door. Next round could drop the numerals there.
- Pins render only on the side, never on the stage, as in Greet.
- I added the "Open a view" index. Without it the side had about 250px of dead band under the
  "Kept beside you" hint.

**Motion.** A new answer's caption arrives with `motion-safe:animate-tab-in`. The still form is the element itself.

### Ticker (`?v=ticker`) — a data page under the hero header

Files: `app/features/one/variants/ticker/` — `TickerVariant.tsx` (layout), `pick.ts` (+ `pick.test.ts`:
which view is the table, which are sheet tabs, which are pins), `styles.ts` (paint). Copy in `one.ticker.*`.

**The header is the navigation.** The core draws the hero stat tiles; a press asks. Ticker draws no counts.

**Main column (left, fills to the side rail).**
1. The reply line: `YOU ASKED · <question>` (META_LABEL, the question in ink), then One's sentence in
   Bricolage `text-h2` extrabold. Right of it: the stepper (‹ Answer n of m ›) over the "what changed"
   hand note (Caveat, the screen's one hand-written aside) with Undo; while a beat runs the note reads
   "Opening the views…". Fallback / dropped-ops / Console links sit on a micro line under the sentence.
   First beat: eyebrow "Today", the status line bold + the first need in steel on the same line.
2. Consent cards (current answer's + hand proposals) in a horizontal strip, 22rem each, above the table.
3. THE answer: one `look:"table"` in the sticker frame (ink 2px outline + hard ink offset in light;
   stone-300 outline + `shadow-pop` in dark) — the only sticker on the screen. The panel's own PANEL
   border is stripped by a child selector, so there is one frame. When the answer left more than one
   unpinned view open, the others are sheet tabs attached to the table's top edge (focus on press);
   a pipeline slice is named by its filter ("What is stalled?" / "New arrivals"), not "Pipeline".
   Nothing unpinned on screen → a PANEL_SUNKEN stated empty state.
4. The dock: follow-up chips, then a slim bar (Kandidate mark · 48px field · Send). Send is the coral
   primary only when no consent card is on screen (one coral primary per view).

**Side rail (20rem).** "Kept beside you" (n of 2): up to two pinned views in `look:"list"`, sharing the
height and scrolling inside; empty → an invitation ("Pin a table to keep it here"). "This session": the
answers asked, newest first, the one in view marked; a press walks the stepper there. While nothing is
pinned, "More to ask" offers the four questions the tiles do not (needs, pipeline, funnel, outbox).
Console link + Ctrl K at the foot.

**First beat.** When the attention read lands and nothing is on screen, Ticker presses the core's own
"Show me" once (`session.show(first need)`; the needs view when nothing waits / the read failed) so the
table is never empty on arrival. It is a real hand action: the change line says it and Undo reverts it.

**Fixed viewport.** 1440x900 and 1280x800: scrollHeight equals the viewport before and after a chip,
a tile press, a pin and a consent card. The table, the pinned lists and the session index scroll inside.

## Known gaps

- **Companion acts cannot run from `/one`.** A companion proposal is only ever created
  inside a model turn of a Candi thread (`createProposal` in `app/_lib/db/companion.ts` has
  no caller outside that module; `/api/companion/**` exposes threads, messages, brain and
  resolve — no create). Round 1 adds no route, so the card hands off to the Console.
- **Single-entry acts have no undo here.** `reinstate` reverses only an auto-rejection;
  a hand reject is reopened through the Console's re-add door.
- **The conductor is keyword-matched**, English-only on the input side; the replies are
  catalogued. `cs` / `de` / `fr` carry the English `one.core` strings until promotion.
- **The greeting is the first beat only**; it does not re-read after a data act (panels do).
- **Undo of a reply is per step** (the last screen change), not "undo the whole reply".
