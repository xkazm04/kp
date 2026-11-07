# /one — the AI-conducted home (spark `one-interface`, round 1)

`/one` is a signed-in alternative home for the recruiter: ONE surface, conducted from a
conversation, that puts views from every module (pipeline, decisions, schedule, jobs,
analytics, comms) in one sight. Today's Workspace (`/` with `?tab=`) stays exactly where it
is and is reached from `/one` as the **Console** (top-right link, or Ctrl/⌘ K →
`/?tab=pipeline`).

Round 1 ships one shared **core** and three **layout directions** on it — Greet, Stage,
Brief — chosen with `?v=greet|stage|brief` (unknown or absent → greet). The round judges
shape and visual register; the core is the part that must already be complete and honest.

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
one request; `epoch` re-reads after a data act). Every panel renders in a kit `Section`
(loading = the quiet line, no skeleton; error = critical note with Retry, text from
`useErrorMessage()`), states a real empty sentence, and offers "Open in Console" via
`buildUrl` / `clearedTabScopedParams` (`app/features/shell/tabs.ts`). A count the read did
not return is "—" with its reason, never 0. Layout hooks: `look` → `data-look`,
`className` on the panel root.

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

## Round 1 variants

Three layout directions on the one core, chosen with `?v=` (a switcher shows outside production builds). Each is judged in both themes; the owner's pick is recorded here when the round closes.

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

## Variant: Stage (`?v=stage`) — composed region, pinned sticker-sheet register

**Files:** `app/features/one/variants/stage/StageVariant.tsx` (layout), `slots.ts` (+ `slots.test.ts`, 7 tests: seating and slot stability), `stage.css` (the pinned register); strings under `one.stage.*`.

### Layout
- **Composer bar on top.** Cause reads before effect (ask, then answer, then stage). No docked bar ever covers the stage, and tab order runs input → chips (≤ 4) → views. While a change is pending, Send turns into Stop. Send drops to secondary while a consent card is open, so each view has only one coral primary.
- **Conversation strip** under the bar. It holds one display-size sentence: the greeting status first, then the last reply. Under it: "You asked: …", the dropped-ops line, Console links from `navigate` ops and the "opening the views…" status. A fallback reply carries a "Not in this prototype yet" tag. History opens on demand with "History (n)" (`aria-expanded`). Consent cards from replies and from the user's own panel actions render here in place, under "Waiting on you", through `renderConsent`.
- **Stage.** Its edge is a 2px ink rule holding the "Stage" heading, the what-changed line (`role=status`, `aria-live`; before any change it reads "Nothing has moved on the stage yet.") and Undo. Below it is a declared 3-slot grid: **A = lead** (`lg:col-span-4 row-span-2`), **B / C = side** (`lg:col-span-2`). It is one column in A, B, C order below `lg`.
- **Seating** (`slots.ts`, pure). A view keeps the slot it holds. A close frees its slot and the neighbours do not slide. When the stage is full, the reducer replaces the oldest unpinned view in place, so the newcomer lands in that view's slot. Every seat is remembered, so Undo puts a restored view back where it was.
- **First beat.** Before anything is placed, slot A holds the first need as a card ("First up", the need sentence, "Show me"). The free side slots show dashed outlines with "The next view lands here." This is the fixed default layout composition-region §4 asks for.
- **Focus dims, never removes.** With more than one view on stage, the focused view lifts (ink offset shadow, `spotlight` look, an "In focus" tag). The others lie flat with no shadow. The tags carry the state in words, so nothing depends on colour, and there is no opacity dimming because it would cost text contrast. "Pinned" is also a text tag in the slot head.
- **Motion.** A view entering a slot drops in like a sticker: framer spring, y −8 → 0 and rotate −0.6° → 0, keyed on the panel id so a replacement re-drops. Under `useReducedMotion` it appears in place with no motion.

### Register (pinned) — how, and its limit
Without a hex value, the look can only be pinned by deriving from tokens. `stage.css` uses two scopes:
- `.one-stage` captures a `--sheet-*` palette. In light it uses the tokens as they are. In dark it inverts the brand pair (dark `--color-ink` is within a few points of light paper, dark `--color-paper` within a few points of light ink) and builds the other roles with `color-mix()` toward their light values (steel, coral, coral-ink/solid, moss, limewash, coralwash, dial-*, stone-50..300, red-600/700, amber-800).
- `.one-stage__sheet` re-points `--color-*` at that capture. It also re-declares the `score-*` aliases and the kit's `--k-*` variables, because both are computed on ancestors and would otherwise keep the theme's values. It pins Bricolage as `--font-serif`, the ink hard-offset shadows (`--panel/sticker/pop-shadow`), 2px lines and 12/16px radii.

**Limits:** in dark the colours are approximations, not the light hex values. Status shades other than red-600/700 and amber-800 still follow the theme, but their tinted boxes stay legible because background and text flip together. Kit rules gated on `[data-theme="dark"]` (dashed rows, 2px section heads) only add their structure in dark. The OneShell nav above the variant is core and still follows the theme.

**Exact pin (Director's call, globals.css + brand.ts):** add theme-invariant sheet tokens, as `--color-white-fixed` and `--color-cv-*` already are. Declare them identically in `@theme` and in `[data-theme="dark"]` (`--color-sheet-paper: #fdf8ee; --color-sheet-card: #ffffff; --color-sheet-ink: #17202a; --color-sheet-steel: #42606f; --color-sheet-coral: #d65a4a; --color-sheet-coral-ink: #a53626; --color-sheet-coral-solid: #b8412f; --color-sheet-moss: #526b4f; --color-sheet-limewash: #dce7d0; --color-sheet-coralwash: #f7d4ce; --color-sheet-stone-50..300` = the light ramp), and mirror them in `brand.ts`. `stage.css` then drops its dark block and points `--sheet-*` at those tokens. The kit's dark-only structural selectors stay as they are.

## Variant: Brief (editorial bands) — `?v=brief`

Files: `app/features/one/variants/brief/BriefVariant.tsx` (the page), `BriefDesk.tsx` (the
conversation dock), `bands.ts` (pure front-page model) + `bands.test.ts`. Copy under
`one.brief.*` (cs/de/fr carry the English for now).

**Metaphor.** Today's hiring as a front page. Reading order, top to bottom:

| Part | What it holds | Source |
| --- | --- | --- |
| Masthead | kicker "Today's brief · <reader's own date>", the status line as a `SectionTitle` (amber squiggle in Spark Dark) | `words.greeting` |
| The lead | the first need as the lead story: kicker, a `HandNote` ("start here"), the need sentence at `text-h2`, "Open the lead" (secondary) + the greeting's ≤ 4 chips, on a `LitGround` | `greeting.first` |
| On the page now | the views on screen, inserted under the lead as bands; a "n of 3 views · p of 2 pinned" capacity line; hand-pressed consent cards first; the brought-forward view is outlined in ink and labelled | `session.panels`, `renderPanel`, `renderConsent` |
| The news | one band per OTHER bucket with news: a tilted sticker kicker, the numeral at display size, the core's own need sentence, 2-3 ask-chips; buckets at zero collapse into ONE quiet line ("Nothing new in Decisions and Drafts.") | `frontPage(attention)` |
| Regular columns | funnel / outbox / pipeline chips: questions with no attention bucket behind them | `COLUMN_CHIPS` |
| The desk | side column ≥ lg, sticky bottom dock below it: what changed + Undo (always first), the latest answer (the user's question, One's sentence, fallback line, dropped ops, Console links), reply consent cards ("Waiting for your yes"), follow-up chips, composer (Send is the view's ONE coral primary; Stop while pending), earlier turns folded behind a toggle | `session`, `words` |

**Decisions.**
- *A band never renders a panel of its own.* The brief asked for "one band per module, each with
  its panel", but the region contract is ≤ 3 views and `renderPanel` always attaches the host's
  pin/close/focus chrome, which only acts on panels in `session.panels`. A band therefore ASKS
  (its chips go through the conductor, so the transcript records the question) and, when the view
  that answers it is already on the page (`answeringPanel`: same kind and the bucket's filter),
  says "<View> is on the page above" with a "Jump to it" control that focuses it.
- *The lead is not repeated as a band.* `frontPage` takes the greeting's priority order, so the
  lead and the band list can never disagree.
- *Unknown is not quiet.* A failed attention read draws no bands and no quiet line, only a
  sentence saying the news desk could not be read; the regular columns still work.
- *Proposals stay findable.* Reply acts live in the dock outside the folded transcript; hand
  acts (a panel row's press) land at the top of "On the page now", next to the row that raised them.
- *Scroll follows focus.* When `focusId` changes (a reply's show, a jump, a hand focus) the page
  scrolls the view into sight (`block: nearest`) and moves keyboard focus to its wrapper
  (`tabIndex -1`, a coral focus ring).
- *Dateline* comes from `useSyncExternalStore` with a null server snapshot, so the server's clock
  and time zone never reach the markup.

**Register.** Spark Dark is the hero: 2px ink outlines, sticker shadows, a slight tilt on the
lead card (-0.4deg) and the band kickers (-2deg, amber sticker), dashed rules between parts,
Bricolage through `--font-serif`, the amber squiggle. Studio Light uses the same markup with
hairlines, `shadow-panel` and no tilt. All colour comes from tokens (`ink paper coral-ink steel
stone-200/300 white dial-amber`). The landing fonts module was NOT imported: the register's face
already flips to Bricolage through `--font-serif`, and `HandNote` forbids a new font.

**Motion.** Inserted views enter on a spring (opacity, y 14px, rotate -0.6deg to rest), re-flow
with `layout`, and leave with a short fade-up (`AnimatePresence mode="popLayout"`). Under reduced
motion (`useReducedMotion`) there is no initial offset, no layout animation, a 0-duration
transition and an instant scroll. Hand notes are static.

**Known gaps (round 1).** No module band for funnel/outbox: they have no attention count, so they
cannot claim news. The band numeral is the attention read's, not a live panel read, so it can lag
an open view by one re-read. Not yet checked in a browser (no kp dev server was running).

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
