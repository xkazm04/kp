# Operator companion (Candi)

The companion is the studio-side chat the operator talks to about their own
workspace. It has continuity across sessions, it is grounded in what the studio
actually holds, and it **never acts** — it proposes, and the operator accepts.

> **Status: WP1 + WP2 (dock round 2) + WP3 (actor rails) + WP4 (first-run
> consent).** The brain, the turn
> CLI, the model use case and the persistence layer landed in WP1. WP2 added the
> transport (two routes) and the client state. Round 1 prototyped two directional
> docks; **Colleague won, Desk was deleted**, and round 2 moved the window to the
> LEFT, gave it a header toolbar, and made **rich turn components** (tables and
> small charts) part of the reply contract — see "Rich turn components" below.
> WP3 made her an **actor on existing rails**: she can now propose four concrete
> actions, each of which lands as a `companion_proposals` row the operator accepts
> or declines, plus a scheduled-by-acceptance **digest**. She still never acts —
> see "The action catalog" and "The proposal lifecycle" below. WP4 put a
> **consent gate** in front of the brain: a first-run wizard step asks before kp
> reads, adopts or creates anything on the operator's disk, and a workspace that
> has not agreed runs the dock **memoryless** — see "Consent: who may have a
> memory" below.

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

## Consent: who may have a memory (WP4)

The brain is **markdown in the operator's own home directory**, and the tree is
shared with Personas' Athena. So kp is not entitled to read it, adopt it, or
create it until somebody says yes. Until WP4 the first companion turn on a fresh
machine silently birthed a mind on the operator's disk; now a first-run wizard
step asks.

### The probe — the one door that creates nothing

Every other reader in `companion_brain.py` goes through `ensure_brain()`, which
is exactly why the question could not be asked before: *looking* birthed the
thing being asked about. `probe_brain()` is the exception, and its whole contract
is that it creates nothing:

```bash
python -m pipeline.jobfit.companion_cli --probe
# {"root": "…", "present": true, "episodes": 41, "identitySections": 2,
#  "constitutionOrigin": "kp"}
python -m pipeline.jobfit.companion_cli --birth   # ensure_brain behind a flag
```

| Field | Means |
| --- | --- |
| `present` | a constitution, an identity or an `episodes/` directory exists |
| `episodes` | episode files on disk, **capped at 999** (`EPISODE_PROBE_CAP`) — the walk stops there, because a human reads "hundreds" exactly as well as an exact five-digit count |
| `identitySections` | `## ` headings in `identity.md` — how much of a self is written down |
| `constitutionOrigin` | `kp` when the constitution carries this repo's `<!-- kp-constitution v1 -->` marker · `personas` when one exists WITHOUT it (Athena's own, or one the operator rewrote) · `none` when there is no constitution |

`personas` is deliberately provenance rather than authorship: what the caller
needs to decide is "was this mind made somewhere else", and an Athena tree and a
hand-edited one answer that the same way.

### The rule

`companionMemoryEnabled(workspaceId)` (`app/_lib/companion-brain.ts`) is the
single authority, and it has **two arms**:

| Arm | Condition | Why |
| --- | --- | --- |
| explicit | `workspaces.companion_brain_consent` is `'connected'` or `'birthed'` | the operator answered the step |
| implicit | `companion_brain_index` holds ≥ 1 row for this workspace | a row lands there only because `append_episode` put it there, so it is proof kp has **already written** to this brain with this workspace's session tag |

The implicit arm exists for installs that predate the gate: an operator who has
been talking to Candi for weeks must not have their memory switched off by a
feature that arrived afterwards. It is keyed on **kp's own writes**, NOT on the
probe's `present` — a brain that exists because Athena made it is somebody else's
mind, and adopting it silently is the exact thing the gate is for. It is also
per-TENANT: another team's episodes on the same disk enable nothing here.

Skipping is a **stable** answer, not a delay: with memory off no episode is
written, so the implicit arm can never bootstrap itself into a yes.

There is deliberately **no stored "declined" state**. A null column and an
explicit refusal behave identically (the dock runs memoryless), so the
distinction would be a claim about which one a pre-existing row was.

### Memory off is working software, not a failure

`companion-run.ts` resolves the rule and ships the answer as `turn.json`'s
`memory` flag — on the side of the boundary that has a database, because the CLI
has no workspace to ask about. With it false the turn:

- writes **no** episode (neither half of the exchange),
- recalls **nothing**,
- and does **not read** `constitution.md` / `identity.md` — `read_constitution`
  calls `ensure_brain`, so reading them would have created the tree the refusal
  was about. The **shipped** template and the empty identity skeleton stand in,
  so she is still Candi and still keeps every rule.

An ABSENT `memory` key means yes, which keeps every pre-WP4 caller (and a
developer's plain `--workdir` invocation) behaving exactly as before. The payload
reports `memoryEnabled` rather than letting the caller infer it from an empty
`recallUsed`: "she remembered nothing" and "she may not remember" are different
facts and only one of them is fixable.

`GET /api/companion/threads` carries `memoryEnabled` on the dock's one boot
request, and the dock prints a single quiet line under the state line — the same
register as "watching 3 things", naming where the switch is, because a limitation
with no stated remedy just reads as a defect.

### The wizard step

`app/features/shell/setup/SetupCompanionStep.tsx`, slotted between **Pipeline**
and **Hand-off**. The host runs the probe once on mount
(`useSetupCompanionBrain`) in BOTH modes — the probe creates nothing, so the
Settings walkthrough can show the machine's real state without having caused it.

Four outcomes, four different questions:

| Probe says | The step asks |
| --- | --- |
| memory already on for this workspace | nothing — it says so. Offering to connect what is already connected is a control with nothing to do |
| a brain is present | *"I found a memory already on this machine (N memories). Connect it?"* — **Connect it** / **Skip for now** |
| no brain | *"Candi starts with a blank memory."* — **Create her memory** / **Skip for now** |
| the probe failed | it says it could not look, and lets the operator past |

**"Start a fresh one alongside" is never offered.** One mind per machine is the
doctrine; a second tree would silently split her continuity in two.

`stepSatisfied` stays default-true, and for a stronger reason than the other
optional steps: a consent question that blocks the door is not a question.

Nothing is written when the tile is clicked. The choice rides in the wizard's
state and `finish()` POSTs it (`setupOnboardingFinish.persistCompanionConsent`),
which is what makes the Settings walkthrough **incapable** of birthing a brain —
preview's `finish()` persists nothing at all. A null choice posts nothing. The
POST is silent on failure by design: the question is re-askable and nothing
downstream breaks, so a red toast about the companion at the end of a successful
setup would be noise.

`POST /api/companion/brain` re-runs the probe itself rather than trusting the
GET the wizard made minutes ago — a proposal-time check is a claim, an
execution-time check is the guarantee — and `birth` runs *before* the stamp, so
consent is only ever recorded over a brain that exists.

> **No Getting-started checklist item was added.** `STEPS` in
> `setupGettingStartedModel.ts` is "the four core steps a workspace genuinely
> cannot hire without", and connecting Candi's memory gates no hiring. `team`
> was removed from that list for precisely this reason ("the one step that never
> gated anything"), and re-introducing the shape one step later would undo a
> decision this repo already made.

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
locale, memory}`. The CLI never queries kp — the caller decides what the
companion may see, and hands it over as `grounding`. `memory` is the consent flag
(above): false means recall nothing, write nothing, and do not even READ the
brain files.

Composition: constitution + identity + the **tone contract**, the **block
contract** and — when the caller shipped an action catalog — the **action
contract** (the system prompt) → recall of the six best-matching episodes + the
grounding blob + the last 12 turns (the user prompt) → one completion under the
**`assistant`** use case, answered in the operator's UI locale.

Output is one JSON line: `{reply, blocks, blockErrors, actions, actionErrors,
recallUsed, episodePaths, memoryEnabled, source, indexSkipped[, fallbackReason]}`, where each
`recallUsed` entry is `{path, excerpt, insight}` (see **What she is allowed to
remember at you** below). Both halves of
the exchange are appended as episodes — the operator's message *before* the model is called, so a provider
timeout can never cost them their own words. Keyless or unreachable, the reply
says so in the operator's language rather than inventing an answer.

## What she is allowed to remember at you

**Storage is never filtered. Surfacing is.** Every exchange is written and
indexed — episodes are the consolidation substrate, and a memory nobody keeps
cannot become an insight later. What is narrowed is what a turn may STAND ON and
what the dock may SHOW.

BM25 answers "what is textually closest to this query", and the closest thing to
a question is the question itself: `run_turn` appends the operator's message as
an episode *before* it recalls, so the top hit for "Please prepare a digest of
the workspace for me" is that same sentence, one second old. Round 5's operator
click-through caught the dock printing exactly that back as
`remembered: Please prepare a digest of the workspace for me`.

`companion_brain.surface_recall(query, hits, today)` sits in front of
`recall()` and applies two drops and one derivation:

| | rule | why |
|---|---|---|
| drop | **near-echo** — the hit sits inside the normalized query, or ≥ `ECHO_OVERLAP` (0.6) of the HIT's tokens are already in the query | it is the operator's own words coming back; it grounds nothing. The ratio is DIRECTIONAL on purpose: the digest leg's query is a dozen words built from the board's own role names, and a symmetric ratio would call the most grounding episode in the index an echo of the question |
| drop | **the operator's own bare command, dated today** — role from the episode filename, day from `created_at`, command shape from the first sentence (a question mark, or an opener in `COMMAND_OPENERS`) | an instruction is a thing asked, not a thing learned |
| keep | everything else, including a command from an EARLIER day — it still grounds, it just earns no chip | |
| derive | **`insight`** — role prefixes and markdown scaffolding stripped, collapsed to the first sentence, cut on a word boundary at `INSIGHT_CHARS` (90) | mechanical, inside the same turn: a chip that costs a second model leg is a chip that gets turned off |

`INSIGHT_MARKERS` is the escape hatch that keeps a preference out of the command
bucket: "Can you always put Czech roles first" opens like an instruction and is a
standing rule, so ` always `, ` never `, ` i prefer `, ` from now on ` and friends
override the opener test.

The dock prints **at most two chips**, each the `insight` and never the excerpt,
and prints **nothing at all** when no surviving hit carried one — absence is
honest, and an empty strip beats an echo. A turn stored before round 5 carries no
`insight`, so it correctly shows no chip rather than a raw excerpt.

The tone contract closes the loop from the other side: when memory informs the
answer she is told to weave it into a short natural sentence ("Yesterday this
queue was 16") rather than block-quoting the past.

Pinned by `test_companion_brain.py` (echo, command shape, role-from-filename,
shortening, the whole surfacing pass) and `test_companion_cli.py` (the operator's
own message never returns as a memory; `recallUsed` ships the short form).

## Rich turn components (blocks)

The dock is a 30rem column, and an enumeration of three or more comparable
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

**Blocks are FULL-BLEED.** The bubble keeps the 85 % cap a paragraph needs to
read as speech; a table or a chart is a drawing, and every pixel it hands back to
the identity gutter is a column it cannot show. So `ChatBlocks` renders at the
transcript's full width, beneath the bubble. Round 5 changed this after an
operator click-through: a three-column table inside the old 26rem, 85 %-capped
slot wrapped every cell to three lines and read as illegible chrome.

`ChatMiniChart` is hand-rolled inline SVG — no chart library. recharts needs
literal color strings for its chrome and therefore a `useTheme()` fork (see
`FactorChart`); inside a chat turn that costs more than the drawing is worth. A
presentation attribute is parsed as CSS, so `fill="var(--color-coral)"` resolves
per theme with no JS at all. The drawing is RESPONSIVE — `w-full` over an intact
viewBox — with a 420-wide base chosen from the dock's real inner column (30rem
minus the body padding, the scroller gutter and the block frame ≈ 426 CSS px), so
SVG `<text>` lands at a true 14px, the design law's floor. A wider container
scales it up; `min-w-[420px]` stops a narrow one from scaling it down and hands
the overflow to the block's own horizontal scroller instead. Category ticks
anchor `middle` when every tick is drawn and inward only when they have been
thinned to first/middle/last — pulling the first tick rightward beside its
neighbour is what made "Screened" sit on top of "Accepted".

### The tone contract

The block syntax only pays off if the model reaches for it, so the system prompt
states the register as checkable rules rather than adjectives: lead with the
answer in one or two sentences, never restate the question, paragraphs of at most
three sentences, bullets over walls, every number carries its unit or noun, no
headings and no sign-off, and **prefer a block to any enumeration of three or
more comparable items**. It applies to every reply, not only the ones that draw.

## The action catalog (WP3)

Candi is an **actor on rails that already exist**. She invents no operation: every
action below dispatches machinery the operator already has a button for, and every
one lands as a proposal they resolve. Nothing sends, publishes or decides on its
own.

**One array is the source of truth.** `app/_lib/companion-actions.ts` holds the
whole catalog, and three things derive from it:

| Derivation | Where | How |
| --- | --- | --- |
| the PROMPT that teaches the model to emit `kp:action` | `companion_cli.py` `_action_contract` | built from `turn.json`'s `actions`, which is `companionActionWire()` |
| the VALIDATOR that decides whether a fence is real | `companion_blocks.py` `split_reply_actions`, then `coerceCompanionAction` at the TS boundary | validated against the same shipped `actions` array |
| the EXECUTOR that runs an accepted proposal | the resolve route → `spec.execute` | looked up by id in the same array |

**No Python file names an action.** The catalog crosses the process boundary in
`turn.json`; a caller that ships no catalog teaches nothing and the model never
proposes, which is the correct default. `app/_lib/companion-actions.test.ts` pins
the derivation as a set-equality (catalog ids == wire ids == validator-accepted ids
== executor-resolvable ids), so the moment someone writes a second list one of them
goes red. The anti-pattern is the cockpit post-mortem: a prompt listing one set of
verbs, a parser accepting a second, a dispatcher implementing a third.

The v1 actions:

| id | Params | Accepting it dispatches |
| --- | --- | --- |
| `run_analysis` | `candidate` *(req)* · `role` | the board's own per-entry AI screening (`automation` task, `task: "screen"`) |
| `generate_digest` | — | the `companion_digest` task (below) |
| `draft_jd` | `title` *(req)* · `need` *(req)* · `seniority` | the Generate flow byte for byte: `insertAnalyzingJd` + the `jd_build` task. The JD appears in the library **unpublished**; publishing stays a separate act |
| `draft_outreach` | `candidate` *(req)* · `role` | the board's cohort drafter with a cohort of one (`batch_outreach`), whose output lands in the Outbox |

**Candidates are addressed by NAME, not by id** — the grounding hands the model
labels and no ids at all, so an id-keyed action would be one it cannot address.
`resolveEntryByLabel` resolves against `listPipeline(workspaceId)`: a label that
matches nothing refuses, and a label matching two people (or one person on two
roles) refuses as *ambiguous* rather than guessing which human was meant.

> **The Outbox note.** `draft_outreach` reuses `batch_outreach` rather than
> reimplementing the letter, so Candi adds **no send path of her own**. That means
> it inherits `dispatchOutreach`'s behaviour exactly: `queued` in the local outbox
> by default, and **relayed if the deploy has `COMMS_WEBHOOK_URL` configured** —
> identical to pressing "Draft outreach" on the board. The companion introduces no
> new relay and no new bypass; it also does not introduce a second, stricter rule
> for the same action, which would have been the more surprising outcome. If a
> deploy wants "the companion may never relay", that is a change to
> `dispatchOutreach`'s contract, not to this path.

## The proposal lifecycle

A `kp:action` fence becomes a `companion_proposals` row **in the same transaction
as the assistant turn that offered it** (`appendTurnWithProposals`). Two rows that
must not exist without each other: a proposal whose turn was never written is an
Accept button under nothing, and a turn whose `meta.proposalIds` point at rows that
were never inserted is a card the dock paints empty.

```
model emits ```kp:action``` → validated against the shipped catalog (Python)
   → re-validated at the TS boundary (coerceCompanionAction)
   → companion_proposals row, status "open", kind = the action id
   → the dock renders a card under the bubble that offered it
   → POST /api/companion/proposals/[id]/resolve  {decision: accept|decline}
```

**The resolve route is the ONE DOOR.** Nothing Candi says executes until a request
arrives there, and that handler re-validates from scratch: the proposal is still
open, its stored payload still parses, its action still exists in the catalog, its
parameters still satisfy the declared shape, and — inside `execute` — the thing it
names still exists in this tenant. A proposal-time check is a claim; an
execution-time check is the guarantee, because everything interesting about a
proposal (a candidate is hired, a role is closed, an action is retired) can change
between the reply and the click. A proposal whose action this build no longer
carries is declined on the operator's behalf with the `retired` outcome, rather
than left as an Accept button that can never succeed.

**Accepting is three steps, not one.** Write-then-work leaves a failed accept
marked done; work-then-write runs a double-click twice. So:

| Step | Store fn | Guard |
| --- | --- | --- |
| claim | `claimProposal` | `status = 'open'` — one caller wins, a second gets 409 |
| run | `spec.execute` | refusals return an outcome, they do not throw |
| stamp | `stampProposalOutcome` | `resolved_at IS NULL` — merges the outcome into the payload |
| (on failure) release | `releaseProposal` | `status = 'accepted' AND resolved_at IS NULL` — can only ever undo a claim |

A **resolved** proposal can never be re-opened, re-stamped or flipped by anything,
which is what makes the dock re-open safe: `status` comes from the live row, not
from the turn that produced it, so a reloaded conversation paints an outcome chip
and no buttons.

**The outcome lives in `payload_json`, not in a column.** `companion_proposals` has
`status` and `resolved_at` and no free field, and adding one means a DDL migration
in `db/core.ts` — a file this work package does not own and that concurrent
sessions share. The payload is already the proposal's whole story (what was
offered, in what parameters), so the outcome joins it there. Like the summary it is
a **catalog reference** (`{key, values}` under `companion.outcome.*`), never a
sentence: the row is written by a server with no reader attached and read later by
whoever has the dock open, in their language — the same contract `task-label.ts`
keeps for a task row.

## The digest

`companion_digest` is a background task (`tasks.ts`) — one metered `assistant` call
through the same brain door, appended as an episode like anything else Candi said,
that files a message into the newest companion thread plus whatever it proposed.
It is the companion **speaking first**, made safe by the fact that its whole output
is a message the operator can ignore and proposals they resolve.

- `companion_cli.py --digest` is the same CLI with nobody on the other side of it:
  no `message`, a `_DIGEST_CONTRACT` in the system prompt, and recall keyed off the
  board's own busiest roles rather than a fixed phrase.
- It writes **one** episode, and it is Candi's. Writing a user episode would put
  words in the operator's mouth in a store their own recall reads back.
- Grounding is `companionGrounding()` plus the **open proposals**, so "what is
  still waiting on your answer" is answerable. The digest resolves nothing; the ids
  it was shown are recorded on the turn as `meta.proposalsSeen`.
- Dedupe is `stableKey("companion_digest", workspaceId, dayIso)` — one digest per
  tenant per day, so a second accept coalesces onto the run already in flight. The
  workspace is in the params explicitly: a dedupe builder only ever sees `params`,
  so without it the day alone would be the identity and two tenants would share one
  digest.
- Where it lands is decided **before** the model call, so a completion is never
  spent on a message with nowhere to go. With no thread at all one is minted and
  named from the digest's own first line — titles stay derived.

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
| `companion_proposals` | what the companion offered — `kind` is the action id, `payload_json` carries `{actionId, params, summary}` and (once answered) `outcome`; `open` until the operator accepts or declines |
| `companion_brain_index` | the pointer mirror of the markdown brain |

Consent itself is **not** one of these tables: it is
`workspaces.companion_brain_consent`, a per-workspace scalar in the same shape as
`default_locale` and `onboarding_state`. This repo has no key-value settings
store, and one word per tenant does not earn a table.

`companion_brain_index` is classed **not portable** in the org export
(`ORG_EXPORT_OVERRIDES`): its rows point at files on the operator's own machine,
and the excerpts beside them are private conversation, not the org's hiring
record. Threads and proposals carry normally.

## Transport

Operator-gated routes, all workspace-scoped through the store's own tenancy.

| Route | Does |
| --- | --- |
| `GET /api/companion/threads` | the ledger, PLUS the newest thread's turns, its proposals AND `memoryEnabled` — the dock always opens on the most recent conversation, so a second request for what was just listed would be a wasted hop, and without the proposals it would paint an Accept button for something answered one round trip ago |
| `POST /api/companion/threads` | start a conversation. No opener, no LLM call: unlike JD intake, Candi does not speak first. The dock renders a static greeting from the catalog and the first spend happens when the operator actually says something |
| `POST /api/companion/[id]/message` | one exchange. Returns the thread's full turn list AND its live proposals |
| `GET /api/companion/brain` | **WP4.** The probe (`companion_cli --probe`, which CREATES NOTHING) plus this workspace's `consent` and `memoryEnabled` |
| `POST /api/companion/brain` | **WP4.** `{action: "connect" \| "birth"}`. Records consent; `birth` runs `ensure_brain` first, so consent is never stamped over a brain that does not exist. Per-IP 20/10min, after the 400 so a malformed call never starts a process. There is no "decline" |
| `POST /api/companion/proposals/[id]/resolve` | **WP3.** `{decision: "accept" \| "decline"}`. The one door that executes anything — see "The proposal lifecycle". Per-IP 60/10min, pinned in `app/api/rate-limit-contract.test.ts`, after the 404/400/409 refusals so a rejected call never consumes budget |

`app/_lib/companion-run.ts` spawns `companion_cli` with the whole turn in
`turn.json` (nothing about the studio travels on argv, where it would land in a
process listing) and wraps the spawn in `withLlmRequestId(threadId)`, so companion
spend is attributable to the conversation that caused it instead of landing as an
anonymous ledger row.

**Grounding is assembled in exactly one function** — `companionGrounding()` —
which is the whole blast radius of "what Candi may see": the sidebar's own
attention counts plus a compact board summary (active entries, a stage histogram,
the five busiest roles with their top candidates, the mean match score). On the
digest leg it additionally carries the OPEN PROPOSALS, because "what is still
waiting on your answer" is half of what a digest is for. The pure half lives in
`app/_lib/companion-turn.ts` (clamp, derived title, transcript window, summary)
and is unit-tested without a database or `next/server`.

The assistant turn's `meta_json` carries its provenance AND its blocks: one
answer has two halves now, and a transcript reload has to repaint the same thing
it painted live. It does — `GET /api/companion/threads` and the message route
both return `listTurns(...)`, the same rows through the same mapper, so a
hydrated turn renders exactly like a live one (verified end to end in round 5,
including `meta.blocks` and the `meta.proposalIds` join).

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
(icon-only because the toolbar competes with a conversation for a 30rem column —
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

Under one assistant turn, in reading order: **what she drew** (the blocks, at the
transcript's FULL width — they escape the bubble's 85 % cap because a drawing
needs the column a paragraph can give away), then **what she offered** (the
proposal cards), then **what she stood on** — at most two quiet marginalia chips,
each one short sentence of insight and never a raw excerpt, the way a colleague
says "you told me last week…" rather than citing a source id. When nothing she
recalled carried an insight the strip is empty, which is the honest rendering.
A degraded turn says so in the same quiet voice, and a dropped block or proposal
is admitted rather than hidden.

The proposals sit between the drawing and the marginalia deliberately: they are
the only part of a turn the operator has to answer, so they belong where the eye
lands after the content and before the provenance. A card under the recall chips
would read as a footnote to a citation. The card itself is quiet — a hairline
panel, an eyebrow, one line of what would happen, and the two answers. No icon, no
severity color, no urgency: a proposal is a question, and dressing a question as
an alert would make declining feel like a failure. Its copy is a catalog reference
resolved at render time (`companion.action.*` / `companion.outcome.*`), and its
`status` comes from the live proposal row rather than from the turn, which is what
makes a re-opened conversation paint an outcome chip instead of a second Accept.

The card imports `app/_lib/companion-proposal-view.ts`, never
`companion-actions.ts` — the catalog's executors reach better-sqlite3, and a lazy
`import()` is still a bundled chunk, not an escape hatch. The split is by
AUDIENCE, not a second list: the view module names no action and decides nothing.

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

- **Blocks and proposals HAVE now been drawn by a real model** (round 5's
  operator click-through: two turns in `companion_turns` carry a `kp:chart` plus
  a `kp:table`, and one carries a `generate_digest` proposal that was accepted
  and executed). What is still unmeasured is the RATE — how often the prompt
  makes a model reach for `kp:table` instead of a numbered list, or for
  `kp:action` instead of describing the action in prose.
- **A long-running `next dev` server can serve a STALE message catalog.** Round
  5's "I can only see labels, not the rendered components" traced to exactly
  this: the dev server on :3000 had been up since 2026-08-22, WP3 added
  `companion.action` / `.proposal` / `.outcome` to `messages/en.json` on
  2026-08-24, and Next hot-reloaded the TSX but kept the JSON that
  `i18n/request.ts` imports in its module cache. `CompanionProposalCard` then
  painted next-intl's MISSING_MESSAGE fallback — the literal key paths
  `companion.proposal.eyebrow`, `companion.action.unknown` — as its copy. The
  catalog on disk was complete and all four locales were in parity the whole
  time. **Restart the dev server after any `messages/*.json` change**; nothing
  detects this, and it looks exactly like a broken component.
- **`draft_outreach` inherits the deploy's relay setting.** It reuses the board's
  own drafter, so on a deploy with `COMMS_WEBHOOK_URL` configured an accepted
  proposal relays exactly as pressing "Draft outreach" on the board does. See the
  Outbox note under "The action catalog" for why that was chosen over a second,
  stricter rule for the same action.
- **A proposal's outcome is stamped, not watched.** `outcome` records what was
  DISPATCHED (a task id, a JD slug), not whether that task later succeeded — the
  Background-tasks view is where a dispatched run's fate lives, and nothing links
  a proposal row back to it beyond `outcome.ref`.
- **No approval kind.** `companion_proposal` was considered for `APPROVAL_KINDS`
  and deliberately not added: `approvalKind` marks a PIPELINE ENTRY as waiting on
  a human, feeds the `decisions` count and the Decisions tab, and is cleared by a
  branch in `actOnPipelineEntry`. A companion proposal lives in its own table with
  its own status lifecycle and its own resolution route, so adding the kind would
  have created a gate with no branch that can clear it — exactly what the registry
  in `app/_lib/approval-kinds.ts` warns against.
- **The companion attention count reaches no badge.** `attentionCounts().companion`
  is the sixth key and the only one no tab declares, because Candi lives in a dock.
  It is read by the dock's own state line. It is deliberately kept out of
  `decisions`, whose count beacons the ControlDock orb and whose one click routes
  to the Decisions tab — a tab with no affordance that can resolve a proposal.
- No thread switcher. The toolbar can START a conversation, but the dock always
  opens the most recent one and there is no way back to an older thread — the
  ledger keeps them, nothing lists them.
- Not verified in a running app. The dock, the proposal card and the resolve
  route have been type-checked, linted and unit-tested, but no browser has painted
  a proposal card and no accept has dispatched a real task.
- The kp thread id does not reach the brain. Episodes carry the workspace
  session tag (`kp-<workspace>`) only, matching the shared format; linking a
  turn back to its episode is done through `episodePaths` on the CLI's output.
- No reindex command. If `companion_brain_index` is truncated, nothing rebuilds
  it from the tree yet. **This now has a second consequence**: the implicit
  consent arm reads that table, so a truncated mirror on a workspace that never
  answered the wizard step reads as "no consent" and the dock goes memoryless.
  The fix is to answer the step, which the operator can currently only reach by
  re-running onboarding.
- **Consent has no Settings control yet.** `POST /api/companion/brain` is a
  general operator route, not an onboarding-only one, so turning memory on later
  is one button away — but the button does not exist. Today the only door is the
  first-run wizard (`KP_FORCE_ONBOARDING=1` re-offers it; Settings →
  "Preview onboarding" deliberately does NOT, because preview persists nothing).
  The dock's memory-off line therefore names a switch that is currently hard to
  reach. A Settings → Organization toggle is the owed follow-up.
- **The consent step has not been painted by a browser.** It type-checks, lints,
  and its rule is unit-tested on both arms, but no run of the wizard has drawn
  it. Same standing caveat WP3 carries for the proposal card.
- Nothing prunes or consolidates episodes on the kp side. With Personas
  installed, its sleep cycle does that for the shared tree.
