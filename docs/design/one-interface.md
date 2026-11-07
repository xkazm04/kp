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

<!-- The Director fills this once Split, Spotlight and Ticker are built. -->

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
