# Operator companion (Candi)

The companion is the studio-side chat the operator talks to about their own
workspace. It has continuity across sessions, it is grounded in what the studio
actually holds, and it **never acts** — it proposes, and the operator accepts.

> **Status: WP1 + WP2 (dock round 2).** The brain, the turn CLI, the model use
> case and the persistence layer landed in WP1. WP2 added the transport (two
> routes) and the client state. Round 1 prototyped two directional docks;
> **Colleague won, Desk was deleted**, and round 2 moved the window to the LEFT,
> gave it a header toolbar, and made **rich turn components** (tables and small
> charts) part of the reply contract — see "Rich turn components" below.

## Where the companion's self lives

Not in the database. Identity, constitution and every exchange are markdown
files under `~/.personas/companion-brain` (`PERSONAS_HOME` overrides the root):

```
companion-brain/
├── constitution.md              how Candi behaves — authored once, then the operator's
├── identity.md                  who she is, and what she knows about the operator
├── index.sqlite                 the brain's OWN FTS5 index (BM25 recall)
└── episodes/YYYY/MM/DD/ep_<8 hex>_<role>.md
```

The tree is **shared with Personas' Athena** on purpose: the episode markdown,
the id shape, the 500-byte excerpt and the content hash are byte-compatible with
that app's episodic store (`brain/episodic.rs`), so a kp exchange is a
first-class episode for Athena's recall and sleep cycle when the desktop app is
installed. `pipeline/jobfit/tests/test_companion_brain.py` pins the markdown
header so a drift is loud rather than silent.

## Write order — disk first, indexes after

`append_episode` writes the markdown file, then fans out to three indexes:

| Lane | Where | Required |
| --- | --- | --- |
| brain-local | `companion-brain/index.sqlite` (FTS5) | yes — the only one `recall()` reads |
| kp mirror | `kp.sqlite` `companion_brain_index` | best effort |
| Personas | `personas_data.db` `companion_node` + `companion_fts` | best effort |

An index that cannot be written is named in the return value's `skipped` list
and never fails the append. Deleting a database loses an index; only deleting
the tree loses a memory.

The kp mirror is a plain table, **not** fts5: a virtual table drops five shadow
tables into `sqlite_master`, which the fail-closed tenancy guard
(`app/_lib/tenancy.ts`) and the whole-DB dump/restore (`app/_lib/db-portability.ts`)
both enumerate. Ranked recall lives in the brain's own index, which is also what
makes memory work with kp shut down entirely.

## One turn

```bash
python -m pipeline.jobfit.companion_cli --workdir <dir>   # reads <dir>/turn.json
```

`turn.json` carries `{workspace_id, session_id, message, transcript, grounding,
locale}`. The CLI never queries kp — the caller decides what the companion may
see, and hands it over as `grounding`.

Composition: constitution + identity + the **tone contract** and the **block
contract** (the system prompt) → recall of the six best-matching episodes + the
grounding blob + the last 12 turns (the user prompt) → one completion under the
**`assistant`** use case, answered in the operator's UI locale.

Output is one JSON line: `{reply, blocks, blockErrors, recallUsed, episodePaths,
source, indexSkipped[, fallbackReason]}`. Both halves of the exchange are appended as
episodes — the operator's message *before* the model is called, so a provider
timeout can never cost them their own words. Keyless or unreachable, the reply
says so in the operator's language rather than inventing an answer.

## Rich turn components (blocks)

The dock is a 26rem column, and an enumeration of three or more comparable
things reads badly in one. So a completion may carry **fenced blocks** beside
its prose; `pipeline/jobfit/companion_blocks.py` pulls them out, validates each
against a strict schema, and returns the prose with the fences removed.

````
```kp:table
{"title": "Top candidates",
 "columns": [{"key": "name", "label": "Candidate"}, {"key": "fit", "label": "Fit"}],
 "rows": [{"name": "A. Novak", "fit": "82"}, {"name": "J. Rimmer", "fit": "74"}]}
```

```kp:chart
{"title": "Pipeline by stage", "kind": "bar",
 "x": {"label": "Stage", "values": ["Screen", "Interview", "Offer"]},
 "y": {"label": "Candidates"},
 "series": [{"label": "Active", "values": [12, 5, 2]}]}
```
````

| | `kp:table` | `kp:chart` |
| --- | --- | --- |
| Optional | `title` (≤80 chars) | `title` (≤80 chars) |
| Required | `columns[{key,label}]` **max 4** · `rows[{<key>: cell}]` **max 8** | `kind` `"bar"`\|`"line"` · `x{label, values[]}` **max 8** · `y{label}` · `series[{label, values[]}]` **max 2** |
| Rules | every row is keyed by the column keys; a missing cell renders a placeholder, never a 0 | every series carries exactly as many values as `x`, and every value is a number |

**Two failure modes, two different answers.** A block that is structurally wrong
(bad JSON, unknown `kind`, a string in a series, no columns, an unterminated
fence) is **dropped whole** and counted in `blockErrors` — the operator still
gets the prose, and the dock says quietly that a block was dropped. A block that
is merely too LONG is **truncated** to the cap, because an eight-row answer is
still an answer. Nothing here can raise: a reply that reaches the operator beats
a reply that was right.

The prose is cut AFTER the fences come out (~700 chars when blocks are present,
1200 otherwise) — cutting first would slice a fence in half and turn a valid
table into a dropped one plus a paragraph of raw JSON. A completion that was
*only* blocks gets a one-line deterministic lead-in, because a blank bubble above
a table reads as a bug.

Blocks ride to the client in the turn's `meta_json` (`CompanionTurnMeta.blocks`),
are re-coerced at that boundary by `app/_lib/companion-blocks.ts` (a `meta_json`
row written by an older build is untrusted input), and render through
`app/_components/chat/ChatBlocks.tsx` → `ChatTable.tsx` / `ChatMiniChart.tsx`.
**The caps live in three places and must move together**: `companion_blocks.py`,
`app/_components/chat/chatBlockTypes.ts`, and the renderers built to them.

`ChatMiniChart` is hand-rolled inline SVG — no chart library. recharts needs
literal color strings for its chrome and therefore a `useTheme()` fork (see
`FactorChart`); at 240px inside a bubble that costs more than the drawing is
worth. A presentation attribute is parsed as CSS, so `fill="var(--color-coral)"`
resolves per theme with no JS at all. Geometry is fixed 1:1 (240px wide, viewBox
240) on purpose: a scaling viewBox would quietly print 9px axis labels, below the
design law's 14px floor.

### The tone contract

The block syntax only pays off if the model reaches for it, so the system prompt
states the register as checkable rules rather than adjectives: lead with the
answer in one or two sentences, never restate the question, paragraphs of at most
three sentences, bullets over walls, every number carries its unit or noun, no
headings and no sign-off, and **prefer a block to any enumeration of three or
more comparable items**. It applies to every reply, not only the ones that draw.

## Model routing

`assistant` is a full BYOM use case: it appears in `LLM_USE_CASES`
(`app/_lib/llm-config.ts`), in `USE_CASE_REQUIREMENTS`
(`pipeline/jobfit/llm/capabilities.py`, `frozenset()` — prose, no JSON
capability needed) with a 4096-token ceiling, and in Settings → Models under its
own **Companion** section. An operator can pin any provider or model for it,
same as every other call site.

## Data model

All four tables are workspace-scoped with no by-id exemptions
(`app/_lib/db/companion-tenancy.test.ts`); the store is `app/_lib/db/companion.ts`.

| Table | Holds |
| --- | --- |
| `companion_threads` | one conversation; titles are derived, never typed |
| `companion_turns` | the transcript, plus per-turn provenance in `meta_json` |
| `companion_proposals` | what the companion offered — `open` until the operator accepts or declines |
| `companion_brain_index` | the pointer mirror of the markdown brain |

`companion_brain_index` is classed **not portable** in the org export
(`ORG_EXPORT_OVERRIDES`): its rows point at files on the operator's own machine,
and the excerpts beside them are private conversation, not the org's hiring
record. Threads and proposals carry normally.

## Transport (WP2)

Two operator-gated routes, both workspace-scoped through the store's own tenancy.

| Route | Does |
| --- | --- |
| `GET /api/companion/threads` | the ledger, PLUS the newest thread's turns — the dock always opens on the most recent conversation, so a second request for what was just listed would be a wasted hop |
| `POST /api/companion/threads` | start a conversation. No opener, no LLM call: unlike JD intake, Candi does not speak first. The dock renders a static greeting from the catalog and the first spend happens when the operator actually says something |
| `POST /api/companion/[id]/message` | one exchange |

`app/_lib/companion-run.ts` spawns `companion_cli` with the whole turn in
`turn.json` (nothing about the studio travels on argv, where it would land in a
process listing) and wraps the spawn in `withLlmRequestId(threadId)`, so companion
spend is attributable to the conversation that caused it instead of landing as an
anonymous ledger row.

**Grounding is assembled in exactly one function** — `companionGrounding()` —
which is the whole blast radius of "what Candi may see": the sidebar's own
attention counts plus a compact board summary (active entries, a stage histogram,
the five busiest roles, the mean match score). Candidate labels are deliberately
absent; a stage histogram is not a candidate record. The pure half lives in
`app/_lib/companion-turn.ts` (clamp, derived title, transcript window, summary)
and is unit-tested without a database or `next/server`.

The assistant turn's `meta_json` carries its provenance AND its blocks: one
answer has two halves now, and a transcript reload has to repaint the same thing
it painted live.

**Write order: the operator's words land first**, before the model is called —
the same contract `companion_cli.py` keeps for episodes, and the reason a provider
timeout costs a reply but never the question. A spawn failure therefore leaves a
user turn with no answer; that is the honest record, not a bug. The message
response carries the thread's FULL turn list so the client replaces optimistic
bubbles with server truth on every exchange.

Throttle: per-IP 30/10min on the message route, pinned in
`app/api/rate-limit-contract.test.ts`. It runs after the cheap refusals (404 for
an unknown or other-tenant thread, 400 for an empty message) so a rejected call
never consumes budget.

## Dock

Candi's home is a persistent **LEFT dock**, mounted by `CompanionDockProvider` as
a fixed-positioned sibling of the workspace shell — inside every provider, outside
the keyed tab panel, so **a conversation survives tab switches**.

**It overlays the nav sidebar, not the page.** That is round 2's central move: the
operator asks about the pipeline while the pipeline is still on screen, so the
chat and the work are legible at the same time. Navigation is the one region of
the shell that is redundant *during* a conversation, and it is exactly one control
away — which is why the close affordance is a real icon button in the header
toolbar rather than a scrim or an edge gesture.

Geometry: a fixed full-height rail at `sm+` whose bottom clears the live control
bar (`--sim-bar-h`), an inset bottom sheet below `sm` (where there is no permanent
sidebar to cover), the shared `--z-sim-drawer` layer — above the `<aside>`, below
the Modal at `z-50`, because a dialog the operator opened is the more recent
intent. It is a complementary `<aside>`, not a dialog: it does not trap focus or
block the page.

Transport is BLOCKING (2–10s), so the waiting UI is honest rather than fake: a
thinking bubble, and after 8 seconds a second line naming the real wait. Messages
sent while a turn is in flight queue through the SHARED state machine
`voiceOrchestration.ts` (reused, not copied) — it already owns "never race a
second request" and "coalesce what arrived while busy", with tests for both.

### The header toolbar

A slim band: the `Companion` eyebrow on the left, icon-only actions on the right
(icon-only because the toolbar competes with a conversation for a 26rem column —
it wins on height and loses on ink).

| Action | Does |
| --- | --- |
| New conversation | `POST /api/companion/threads`, then swaps the dock to the fresh thread (clears the transcript, resets the orchestration machine and its queue). **Disabled while a turn is in flight** — the reply is already paid for, and dropping it to paint an empty thread is the one outcome nobody asked for. The old conversation is not deleted; it stays in the ledger, which is what makes this cheap and undoable. |
| Close | Collapses to the rest pill. |

`CompanionToolbar` takes an `extra` slot — the extension point for future actions
(a thread switcher, pin, export). They render *ahead* of the two window controls,
so the close button never moves out from under the operator's cursor.

### The body (round 1's "Colleague", promoted)

Candi is a person you share an office with, not a console. The body leads with her
NAME in the display face and one honest line about what she is holding right now
("thinking about 3 decisions…"), from the same attention counts the sidebar badges
use. The transcript is a conversation, not a log: roomy bubbles, no timestamps, no
provenance chrome in the reading path.

Under one assistant turn, in reading order: **what she drew** (the blocks), then
**what she stood on** — quiet marginalia chips, the way a colleague says "you told
me last week…" rather than citing a source id. A degraded turn says so in the same
quiet voice, and a dropped block is admitted rather than hidden.

Rest state is a small pill with the Kandidate mark and the unread dot. It sits at
the bottom of the nav panel (clear of the 4.75rem icon rail, so it can never cover
the appearance controls) — where the window itself will open. Below `md` the
sidebar is off-canvas and the pill moves to the screen edge.

> **Round 1's `Desk` direction was rejected and deleted** (`CompanionDockDesk.tsx`,
> the `SegmentedControl` switcher, `companionVariants.ts`, and the `companion.desk.*`
> catalog keys). Its premise — provenance IN the reading path, an ops register
> rather than a colleague — lost on purpose: the operator reads an answer first and
> audits it second.

Ways in:

- the command palette, from two characters: **"Ask Candi: <query>"**. It is a real
  ranked item, not a placeholder, so the palette's dead-end "No matches for …"
  line is now unreachable whenever the dock exists.
- an **Ask Candi** control in the ControlDock's layer-1 toolbar (it moved out of
  the ops face when the dock became two-layer; it is the row's one ACTION, so it
  closes the open panel instead of becoming one).

Both go through `useOptionalCompanionDock()`, which is null on the deep-link pages
that render the palette without the workspace shell — the affordance is then
omitted rather than offered as a control that cannot work.

**Unread is event-driven**, held in the provider: a reply landing while the dock
is closed sets it, opening clears it. No effect sets it, so there is no cascading
render — which is what the `react-hooks/set-state-in-effect` and `react-hooks/refs`
rules both rejected in the two earlier shapes.

### The shared chat primitive

`JdsIntakeChat` was lifted into `app/_components/chat/ChatTranscript.tsx` (+
`ChatComposer.tsx`), which now serves both surfaces: bubble geometry and both-theme
colors, the dark radius bump, reduced-motion-gated presence, `aria-live` polite,
autoscroll, Enter / Shift+Enter, the `FIELD` + `BTN_PRIMARY` composer, and the
send-failure draft restore. Which ROLE sits on which side is a caller decision
(`side(role) => left | right | center`), so intake's
`interviewer | candidate | system` and the companion's `user | assistant` both work
without the primitive knowing either vocabulary. Every string is a prop — it lives
under `app/_components`, where `i18n:check` forbids a literal accessible name.
`JdsIntakeChat` is now the intake ADAPTER; nothing about the rendered intake
surface changed.

## Known gaps

- **No block has been drawn by a real model yet.** The parser, the renderers and
  both schemas are unit-tested end to end, but whether the prompt actually makes
  the model reach for `kp:table` instead of a numbered list is an empirical
  question this worktree cannot answer (see "Not verified in a running app").
- The dock does not yet surface `companion_proposals`. Candi can say what she
  would do; there is no accept/decline affordance for it (WP3).
- No thread switcher. The toolbar can START a conversation, but the dock always
  opens the most recent one and there is no way back to an older thread — the
  ledger keeps them, nothing lists them.
- Not verified in a running app. This worktree has no `node_modules` of its own
  (it resolves upward to the main checkout), which Turbopack refuses, so the dock
  has been type-checked and linted but never painted.
- The kp thread id does not reach the brain. Episodes carry the workspace
  session tag (`kp-<workspace>`) only, matching the shared format; linking a
  turn back to its episode is done through `episodePaths` on the CLI's output.
- No reindex command. If `companion_brain_index` is truncated, nothing rebuilds
  it from the tree yet.
- Nothing prunes or consolidates episodes on the kp side. With Personas
  installed, its sleep cycle does that for the shared tree.
