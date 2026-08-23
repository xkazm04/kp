# Operator companion (Candi)

The companion is the studio-side chat the operator talks to about their own
workspace. It has continuity across sessions, it is grounded in what the studio
actually holds, and it **never acts** — it proposes, and the operator accepts.

> **Status: WP1 + WP2.** The brain, the turn CLI, the model use case and the
> persistence layer landed in WP1. WP2 adds the transport (two routes), the
> client state, and a **prototype-round-1 dock** with two directional variants
> behind a switcher — see "Dock (prototype round 1)" below. The variants are
> scaffold: one wins and the loser is deleted.

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

Composition: constitution + identity (the system prompt) → recall of the six
best-matching episodes + the grounding blob + the last 12 turns (the user
prompt) → one plain-text completion under the **`assistant`** use case, capped at
1200 characters and answered in the operator's UI locale.

Output is one JSON line: `{reply, recallUsed, episodePaths, source,
indexSkipped[, fallbackReason]}`. Both halves of the exchange are appended as
episodes — the operator's message *before* the model is called, so a provider
timeout can never cost them their own words. Keyless or unreachable, the reply
says so in the operator's language rather than inventing an answer.

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

## Dock (prototype round 1)

Candi's home is a persistent RIGHT DOCK, mounted by `CompanionDockProvider` as a
fixed-positioned sibling of the workspace shell — inside every provider, outside
the keyed tab panel, so **a conversation survives tab switches**. Geometry is
`SimExplainDrawer`'s, deliberately: a full-height right rail at `sm+` whose bottom
clears `--sim-bar-h`, an inset bottom sheet below `sm`, the same `--z-sim-drawer`
layer, the same slide-in gated on `motion-reduce`. It is a complementary `<aside>`,
not a dialog: it does not trap focus or block the page, because the point is to
talk about the tab you are looking at.

Transport is BLOCKING (2–10s), so the waiting UI is honest rather than fake: a
thinking bubble, and after 8 seconds a second line naming the real wait. Messages
sent while a turn is in flight queue through the SHARED state machine
`voiceOrchestration.ts` (reused, not copied) — it already owns "never race a
second request" and "coalesce what arrived while busy", with tests for both.

Ways in:

- the command palette, from two characters: **"Ask Candi: <query>"**. It is a real
  ranked item, not a placeholder, so the palette's dead-end "No matches for …"
  line is now unreachable whenever the dock exists.
- an **Ask Candi** tile on the ControlDock's ops face.

Both go through `useOptionalCompanionDock()`, which is null on the deep-link pages
that render the palette without the workspace shell — the affordance is then
omitted rather than offered as a control that cannot work.

### The two directions (scaffold — one will be deleted)

A `SegmentedControl` in the dock header switches between them; default is A. The
collapsed rest state follows the variant too, so each direction is judged whole.

| | **A · Colleague** (`CompanionDockColleague.tsx`) | **B · Desk** (`CompanionDockDesk.tsx`) |
| --- | --- | --- |
| Metaphor | someone you share an office with | an ops register |
| Leads with | her name in the display face + one honest line about what she is holding ("thinking about 3 decisions…") | live STAT chips: decisions / aging / booked |
| Transcript | roomy conversation | compact |
| Provenance | marginalia — quiet "remembered: …" chips under her bubble, from `meta.recallUsed` | in the reading path — a ledger strip per answer: engine `Badge`, recall count, fallback flag |
| Composer | calm slow-hint sentence | keyboard-first, `Enter` / `Shift + Enter` stated in `KBD` hints |
| Rest state | a small pill with the Kandidate mark + unread dot | a thin edge tab |

Both carry the same empty state (a greeting written in the constitution's
register, not lorem), the same honest error surface (a degraded turn says so and
its `fallbackReason` is on the flag's title), and both themes.

**Unread is event-driven**, held in the provider: a reply landing while the dock
is closed sets it, opening clears it. No effect sets it, so there is no cascading
render — which is what the `react-hooks/set-state-in-effect` and
`react-hooks/refs` rules both rejected in the two earlier shapes.

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

- **The two dock variants are a prototype round, not a shipped design.** Both are
  live behind the header switcher until a direction is chosen; the loser's file,
  its import and its switcher entry get deleted then.
- The dock does not yet surface `companion_proposals`. Candi can say what she
  would do; there is no accept/decline affordance for it (WP3).
- No thread switcher. The dock always opens the most recent conversation and
  `POST /api/companion/threads` has no caller in the UI yet.
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
