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
contract**, the **voice contract** and — when the caller shipped an action
catalog — the **action contract** (the system prompt) → recall of the six
best-matching episodes + the grounding blob + the last 12 turns (the user
prompt) → one completion under the **`assistant`** use case, answered in the
operator's UI locale.

Output is one JSON line: `{reply, voiceReply, blocks, blockErrors, actions, actionErrors,
recallUsed, episodePaths, memoryEnabled, source, indexSkipped[, fallbackReason]}`, where each
`recallUsed` entry is `{path, excerpt, insight}` (see **What she is allowed to
remember at you** below). Both halves of
the exchange are appended as episodes — the operator's message *before* the model is called, so a provider
timeout can never cost them their own words. Keyless or unreachable, the reply
says so in the operator's language rather than inventing an answer.

- **A deterministic reply is answered, not remembered.** When `source` is
  `deterministic` (`_worth_remembering` in `companion_cli.py`), `run_turn`
  writes the operator's episode and **no assistant episode** — the person said
  their half, but `UNREACHABLE_REPLY` is not something Candi knows, and appending
  it made outage prose a permanently recallable memory that competes with the
  real thing (`surface_recall` drops echoes and same-day commands, not this). A
  keyless install would otherwise fill its own brain with apologies. `memoryEnabled`,
  `indexSkipped` and the memory-off path are unchanged. `run_digest` applies the
  same rule with only one half to apply it to: a degraded digest has no operator
  message either, so it writes no episode at all and `episodePaths` is empty.

- **…and it is not replayed either.** The episode rule covers the brain; the
  TRANSCRIPT is the other half of her memory, and until this round the route fed
  every stored turn back into the next prompt. So the first answer after a key
  was finally configured had her own apology as the last thing in her context and
  read as if she were still broken. `promptEligibleTurns` in
  `app/_lib/companion-turn.ts` is the one predicate that decides it: an assistant
  turn whose `meta.source` is `deterministic` is dropped from the window,
  everything else stays. The drop runs BEFORE the 12-turn slice, so a stretch of
  outage replies does not eat the window. Only the turn's own `source` decides,
  so a reply stored before the field existed is kept. It stays on SCREEN either
  way: the dock renders the whole page, degraded exchanges included.

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
**Both halves of that discard are counted.** `blockErrors` is produced in Python,
where the raw fences were still visible; a block that satisfied
`companion_blocks.py` and then failed the TS coercion — the stale stored turn
this second gate exists for — used to be dropped in silence. `renderableBlocks()`
now re-coerces at the point of drawing and adds what died there to the server's
count, so the one chip both the dock and the voice strip render
(`t("blocks.dropped")`) tells the truth about both.
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

## The spoken channel (V1)

**Every reply is dual-channel.** `reply` is written for a 30rem column and may
hand the comparable part to a table; `voiceReply` is *the same answer composed
for the ear*. It is a different composition, not a shorter one — the failure this
exists to prevent is a voice that reads the report aloud, enumerates six
candidates nobody can hold in their head, and finishes with "as the table above
shows" at a listener who is not looking at a table.

The model is asked for it in a **sentinel section**, emitted after the prose and
after any fence:

```
<<<VOICE>>>
29 decisions are waiting - twelve more than yesterday. Clear the offer-stage two first.
<<<END_VOICE>>>
```

**Why sentinels and not a ```` ```kp:voice ```` fence**, when everything else in
this reply is a fence. Two reasons, and both are specific to this component. Its
payload is a plain sentence, not JSON, so a fence buys none of the parsing it
exists for. And it is emitted **last**, which is exactly where a completion cut at
its token ceiling loses its terminator: a dangling fence is *dropped* by the block
rules above (correct for a half-written table, which cannot be half-rendered),
while a dangling `<<<VOICE>>>` is *recovered* by reading to the end of the text —
precisely right for a trailing section. Sentinels also cannot collide with a code
fence the model emits for its own reasons, and this prompt already speaks that
dialect (`<<<OPERATOR_MESSAGE>>>`).

`split_reply_voice` runs **before** both fence passes, so neither parser can eat
the other's delimiter, and it strips every marker — including an orphan
`<<<END_VOICE>>>` — because a raw sentinel in the dock is the same class of defect
as a raw JSON block. The operator is never shown the section: they are shown the
prose, and offered the button that speaks it.

| | |
| --- | --- |
| Cap | **280 characters** (`MAX_VOICE_CHARS`), which is also the TTS chunker's default clip size — a voice reply is therefore ONE synthesis request, so no chunk boundary, no prosody reset, no lookahead, and the fastest time-to-first-audio available |
| Register | first sentence IS the answer; at most one supporting fact after it; no list, no second topic; never points at the screen; plain ASCII, present tense, every number keeps its noun; same language as the reply |
| `source: "model"` | the completion carried a section |
| `source: "derived"` | it did not, so the spoken form is cut **mechanically** from the reply's own first two sentences (`derive_voice`). Never a second model call: a paraphrase of what was just said is not worth doubling the cost of every turn |
| Degraded leg | the keyless/unreachable reply carries a **hand-written** spoken line per locale (`UNREACHABLE_VOICE`), because the one reply that is about the product failing should not be read aloud through a derivation |

So `voiceReply` is **always present** from a current CLI, and the dock never has
to decide whether a turn is speakable before offering to speak it.

**This is not a second speech normalizer.** The one door before any engine stays
`speechReady` in `packages/voice-tts/src/text/normalize.ts` — one pure isomorphic
function, per the AI registry's *speech-ready-text* technique, whose named defect
is a divergent second copy. `companion_blocks.py`'s flatten chooses the **words**
and bounds the **length**; anything it leaves behind is caught downstream, which
is why it is deliberately shallow.

It crosses the boundary in `meta.voiceReply` (`{text, source}`), coerced by
`coerceVoiceReply` in `app/_lib/companion-turn.ts` for the same reason blocks are:
a `meta_json` row written by an older build is untrusted input, and a turn stored
before V1 carries none at all — which reads as `null`, and the dock then speaks
the prose.

**Three files hold the 280.** `companion_blocks.py` (`MAX_VOICE_CHARS`),
`app/_lib/companion-turn.ts` (`MAX_COMPANION_VOICE_CHARS`) and the chunker's own
default in `packages/voice-tts/src/text/segment.ts`. They must move together: a
voice reply that outgrew the chunk size would silently become two synthesis
requests and lose the property the bound was chosen for.

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
| `GET /api/companion/brain` | **WP4.** The probe (`companion_cli --probe`, which CREATES NOTHING) plus this workspace's `consent` and `memoryEnabled`. Per-IP 60/10min — it creates nothing and calls no model, but it is still a Python child per request, and in open mode the operator gate above it is a no-op for the whole API |
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

The assistant turn's `meta_json` carries its provenance, its blocks AND its
spoken form: one answer has several halves now, and a transcript reload has to
repaint — and be able to re-speak — the same thing it painted live, without
paying for a model call to re-say it. It does — `GET /api/companion/threads` and the message route
both return `listTurns(...)`, the same rows through the same mapper, so a
hydrated turn renders exactly like a live one (verified end to end in round 5,
including `meta.blocks` and the `meta.proposalIds` join).

**Write order: the operator's words land first**, before the model is called —
the same contract `companion_cli.py` keeps for episodes, and the reason a provider
timeout costs a reply but never the question. A spawn failure therefore leaves a
user turn with no answer; that is the honest record, not a bug. The message
response carries the thread's turn list so the client replaces optimistic
bubbles with server truth on every exchange.

**Which turns, exactly: the newest ones.** `listTurns` pages from the NEWEST end
(`ORDER BY created_at DESC, rowid DESC`, reversed so callers still read
oldest-first; the rowid tie-break matters because turns written inside one
millisecond share a timestamp), and every caller states the bound it means rather
than inheriting a default. There are two, both in `app/_lib/companion-turn.ts`:
`COMPANION_THREAD_TURNS` (200) is what the dock renders, and
`COMPANION_PROMPT_SCAN_TURNS` (40) is the page the model's 12-turn window is
taken from. Before this, the read paged from the oldest end and every caller took
its default: past turn 200 the dock, the POST response and the window all kept
showing the FIRST 200 turns while the writes carried on landing. The conversation
froze on screen with nothing erroring. `app/_lib/db/companion-turns.test.ts`
walks a 250-turn thread through all three.

Throttle: per-IP 30/10min on the message route, pinned in
`app/api/rate-limit-contract.test.ts`. It runs after the cheap refusals (404 for
an unknown or other-tenant thread, 400 for an empty message) so a rejected call
never consumes budget.

### Refusals carry a code, and a vanished thread is one

Every companion 4xx goes through the refusal chokepoint
(`jsonRefusal` / `REFUSAL_ERRORS`, `docs/architecture/api-contracts.md` §1.1), so
the dock resolves `errors.<CODE>` in the reader's language instead of printing
the server's English. Two codes are the companion's own:

- **`COMPANION_THREAD_NOT_FOUND` (404)** — an unknown or other-tenant thread, and
  also a thread **deleted mid-request**. Both store writers re-check the thread
  inside their own transaction and answer `null`; the route used to discard that
  answer and reply `200` with a turn list missing the exchange it was reporting —
  the one failure shape a dock cannot detect. The check on the operator's own turn
  sits before the spawn, so a vanished thread never buys a model call.
- **`TOO_MANY_REQUESTS` (429)** — the shared throttle, on all four routes. The
  message is `RATE_LIMITED_ERROR` itself (the registry entry *is* the constant,
  pinned by `rate-limit-contract.test.ts`); it is deliberately NOT the existing
  `errors.RATE_LIMITED`, which is GitHub's upstream policy refusal and would
  answer a throttled companion turn with advice about `GITHUB_TOKEN`.

**Abort travels with the request.** `runCompanionTurn` takes the handler's
`request.signal` and `spawnCompanion` hands it to `spawnPython`, so a closed tab
or a dock unmounted mid-turn kills the child instead of leaving a 120-second
spawn and a paid model call running to nobody.

**The derived title is written under a precondition.** Both callers decide
`!thread.title.trim()` from a read that predates the write — by a whole model call
on the digest leg — so `renameThread`'s UPDATE re-asserts `title = ''` and reports
`changes === 0` rather than overwriting the title the other leg just derived.

Source guard for all of the above: `app/api/companion/companion-route-hygiene.test.ts`.

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

#### The states the engine already reported, now shown

Four facts were being stored on every turn and rendered by nothing. The dock now
reads what it is handed:

| Fact | Where it comes from | What the dock says |
| --- | --- | --- |
| `meta.fallbackReason` | `companion_cli.py::_complete` — either the literal `"no provider available"` or `"<ExceptionType>: <message>"` | The degraded chip names the CLASS: *no model configured* (a settings trip) vs *the model did not answer* (an incident worth one retry). An unrecognised reason keeps the old generic chip rather than being guessed at. `companionFallbackClass` in `app/_lib/companion-turn.ts`, unit-tested. |
| `meta.indexSkipped` | the message route and the digest run both store it | One quiet line under the state line: *this answer was not written to memory*. The NEWEST assistant turn's fact only — one blocked write does not make a conversation memoryless. Distinct from `state.memoryOff`, which is consent and IS fixable in setup. |
| `meta.digest` | `companion-digest-run.ts` | A chip labelling the turn as the daily digest. An unannounced paragraph that appears above your own last message otherwise reads as a reply to it. |
| the route's error `code` | `jsonRefusal` (see Transport) | The error line is a `role="alert"` region — outside the transcript's `aria-live="polite"`, because a failure must be heard now — resolving `TOO_MANY_REQUESTS` / `COMPANION_THREAD_NOT_FOUND` through `useErrorMessage()`, with a **Send it again** button beside it. |

**Retry, and the duplicate it fixed.** A refused message is no longer put back
into the shared orchestration machine's queue. That requeue is right for the voice
caller the machine was written for (a dropped utterance exists nowhere), and wrong
here: `ChatComposer` already RESTORES the draft on a false resolve, so the queued
copy made the operator's next send coalesce their restored draft WITH it and ask
Candi the same question twice, in one message. It also stranded anything typed
while the failed turn was in flight, because `completeTurn` dispatches nothing on
the tick that carries a `failed`. The refused message is held in `lastFailed`
instead, and Retry re-sends it through the ordinary `send` path — so it still
queues behind an in-flight turn and is still never re-dispatched on its own.

**Late arm, no new poller.** `useAttention` already polls `/api/attention` every
60 s for the sidebar badges, and `attention.companion` is the open-proposal count
— which is exactly what a landed digest, or a proposal a sibling tab answered,
moves. `CompanionDock` watches that number and calls `thread.refresh()` when it
changes while the dock is open (`shouldRefetchCompanionThread`: open only, on a
change only, never on the first observation, since the boot fetch just read the
same thread). `refresh()` re-reads `GET /api/companion/threads` — the boot route,
which already returns the newest thread's turns and proposals — so an accepted
digest appears in place instead of waiting for a remount. Its one stated limit:
it can only refresh the thread that is still the NEWEST one, and it never switches
threads. Since `runCompanionDigestTask` writes into `listThreads()[0]` — the same
thread the dock opens on — the digest case is the one it covers.

**Keyboard.** Escape closes the window when the settings popover is not open, and
closing returns focus to the rest pill. Still deliberately not a dialog: no focus
trap, no `inert` page (see the geometry note above). The Escape gate is on
`settingsOpen` rather than on propagation — the popover's own handler calls
`stopPropagation`, but two listeners on `document` never see each other's
propagation, so the gate is what actually stops one keypress dismissing both.

**The speak control lives in that marginalia strip** (`CompanionSpeakButton`),
first in the chip row. It acts on THIS answer, which is why it is not in the
header: a global "read the last reply" control cannot say which reply it means
once the operator has scrolled. One button, three meanings and never a fourth —
start this reply, stop the one that is playing, or unblock a playback the browser
refused (rare from a click, since a user gesture is exactly what browsers want,
and expected from V2's auto-speak). It is drawn only when the turn has something
speakable: `voiceTextForTurn` has already run the one normalizer over it, so an
empty answer means an empty utterance and no control at all.

`useCompanionSpeech` is the single seam between a turn and the portable TTS
package. It owns three decisions that would otherwise be made inconsistently per
button: **what** gets spoken (`meta.voiceReply.text`, falling back to the prose
for turns stored before V1), **which** turn owns the current utterance
(`speakingId`, derived from playback rather than stored, so a finished utterance
leaves no control lit), and **stop means now** — including on unmount, which is a
live risk here because the dock unmounts its body when collapsed. That last one
is not re-implemented: `useTts` registers its own teardown, and the hook never
hands a caller the raw playback resource.

**No availability probe on mount.** `GET /api/tts` probes every configured
provider and for a cloud engine that is a network round trip; the dock is mounted
whenever it is open and most sessions never press play. So availability is learned
by ATTEMPTING — the route answers 503 with a typed reason when nothing can speak,
and that reason is surfaced on the control. Never a silent no-op, and never a
probe nobody asked for. The button is not latched off afterwards either: an
operator who just pasted an API key is one click from it working.

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

## Voice mode (settled in round V3)

Candi wears two shapes. The **window** is the left dock described above. **Voice
mode** is a centred strip near the top of the screen carrying her last answer,
with typing to her living in the footer control dock as a layer-2 panel - and the
whole middle of the display left alone.

It exists because a spoken companion and a conversation column want opposite
things. A column is the right shape for reading a transcript; it is the wrong
shape for *listening* while working, where the operator wants the page visible
and one answer at a time. Voice mode also replaces scrolling with **stepping**:
two arrows and a `3 of 17` counter walk her answers, so "what did she say three
answers ago" is a countable act rather than a search through a column that is no
longer on screen.

**PRESENTATION ONLY.** Same `CompanionDockProvider`, same open/close, same
`useCompanionThread`, same routes, same proposals, same speech seam. The mode
branch is the LAST decision `CompanionDock` makes — everything above it is
resolved first and handed to whichever shape is on. A flip mid-conversation
therefore drops nothing: not a turn in flight, not an utterance, not the
operator's place.

**Round V3 moved that "everything above it" one level UP**, into
`useCompanionRuntime` (called by `CompanionDockProvider`). The one thread, the
one utterance, the one preference set, the auto-speak and the palette's seed
handoff are assembled there now. The reason is that voice mode splits her across
two React trees: the strip is `CompanionDock`'s, and the INPUT is a panel of the
footer control dock in `shell/simulation`. Two surfaces that send into the same
conversation cannot each own a thread, and both alternatives were worse — a
portal from the dock into the footer's panel slot makes the input's existence
depend on the render order of two independent trees, and a "register your
composer upward" callback is the same hoist with an effect in the middle of it.

What that costs, stated rather than discovered: those four hooks now load with
the shell rather than with the deferred `CompanionDock` chunk. They are hooks -
`fetch`, a state machine, a localStorage read, the TTS package's headless half -
and every heavy piece of her (the transcript, chat blocks, charts, the strip) is
still behind the same `dynamic()` boundary it always was. `active` still gates
the thread's boot request, so a workspace where nobody opens her makes no
companion call at all.

### Switching, and where the preference lives

A gear in Candi's chrome — in **both** shapes — opens `CompanionSettingsMenu`.
Two controls today:

| Control | Does |
| --- | --- |
| Interface (`Window` / `Voice`) | Picks the shape. |
| Read new replies aloud | Speaks a reply as it lands. Default **off**. |

The preferences are per-BROWSER, one localStorage key (`kp-companion-prefs`,
`companionPrefs.ts` + `useCompanionPrefs`), the same call the pipeline's saved
views and the intake layout already made. They describe how *this screen* is
being used; they carry nothing a teammate needs to see, and putting them on the
server would mean a schema, a route and a round trip to answer "which window am
I in". The panel says so in its intro rather than leaving it to be assumed.

The hook seeds the defaults and corrects itself in a mount effect (SSR parity),
and the write-back effect is gated on `hydrated` so the first render can never
persist the defaults over a real stored choice. `coerceCompanionPrefs` is total
and works **field by field**: a store with one good field and one garbage field
keeps the good one, because dropping the object would silently move an operator
back to the window they had left.

The panel is deliberately built as the *seed of the owed policy surface* — a
titled dialog of `SettingsGroup` sections, not two toggles in a popup — so a
third group (model routing, memory scope, whether a proposal may execute without
a second confirmation) is an insertion. The moment a group's effect is NOT
visible from where the panel opens, that group belongs in Setup and this panel
should link to it instead of growing it.

**Auto-speak is primed, not fired, on arrival.** `useCompanionAutoSpeak` records
the newest reply id on its first pass and says nothing — opening the dock
hydrates a stored thread whose last answer may be a week old, and speaking it
would be the app talking at someone who just arrived. Only a *change* after that
is an arrival. The same rule makes turning the setting on silent. A new
conversation is deliberately not re-primed: the list empties, the newest id
becomes null, and the next real answer is a genuine change from null.

**Expect `blocked`.** Browsers refuse audio no gesture asked for, and an
auto-speak is by construction the case with no gesture behind it. That is not
handled in the hook, because it cannot be — unblocking must run *from* a
gesture. It is handled where the gesture is: the playback control renders
`blocked` as a resume affordance, V1's contract.

### The reading model

`voiceHistory.ts` (pure, unit-tested) projects the transcript into the thing the
header paginates: her ANSWERS, oldest first, each carrying the question it
answered — the nearest user turn *before* it, which is the only join available
(turns carry no reply-to id, and pairing by position breaks on a greeting or on
two consecutive assistant turns).

`useVoiceHistory` derives the position every render and runs **no effect**. What
is state is the *intent* — which answer the operator asked for, and whether they
are still at the end. `pinned` is not `index === last`: the two agree until a
reply lands, and the whole point is that a pinned reader moves with it while a
reader who has arrowed back does not. An unpinned reader keeps their place **by
id**, because a server reconcile renumbers optimistic rows underneath them.
Every earlier shape of this hook set the index in an effect, and every one
flashed the old answer's text under the new answer's counter for one frame.

Arrow keys are bound to the header REGION (`tabIndex=0`, labelled), never the
document — a global arrow handler would steal the keys from the page this mode
exists to leave usable — and the handler ignores events from inside an input,
select or radiogroup, because the direction switcher owns those keys itself.

### The presentation, and what the prototype round settled

Round V2 shipped three directions behind a `SegmentedControl` — **Ticker** (a
newsroom crawl frozen on its last item), **Stage** (a lit stage carrying the
SPOKEN answer as the headline) and **HUD** (a head-up display with a jump
timeline and a studio-state band). Round V3 picked **Ticker**. The other two, the
rail, the `variant` preference field and the `voiceTypes.ts` contract that let
all three render interchangeably are deleted; `CompanionVoiceTicker` is now the
only voice presentation, hosted by `CompanionVoiceMode`.

**One thing came across from a rejected direction: Stage's WIDTH.** Full-bleed,
the strip read as a system banner — something the app had put at the top of the
screen, not something the operator had opened. Capped at Stage's reading measure
(`max-w-[40rem]`) and centred, the identical content reads as a window. The
register is otherwise unchanged: one to two lines of prose, everything with
height behind "show details", arrows and a `3 of 17` counter, one play control,
proposals resolvable in place, and no motion at all.

**The strip never truncates.** It shows her full prose — `line-clamp-2` hides
overflow, it does not cut text — and the expander is offered whenever there is
more than the clamp can show. That threshold (`CLAMP_SAFE_CHARS = 100`) sits
deliberately BELOW the two-line measure it protects: at 40rem two lines is
roughly 160 characters, and V2's 140 sat close enough underneath to be a coin
toss on font, locale and zoom. A reply that lost its tail with no expander beside
it would be content the operator cannot know is missing. Erring low costs an
expander over a reply that did fit; erring high costs a sentence nobody can
reach.

Note that the strip carries the WRITTEN reply, never `meta.voiceReply` — the
composed-for-the-ear form is what the play button speaks. So a turn with no voice
composition has nothing to fall back *from*: the strip was already showing every
character she wrote.

The shared bones are `VoiceNav`, `VoicePlaybackButton` and `VoiceParts` (prose,
blocks, proposals, meta chips, empty and busy notes). `VoiceDots`,
`VoicePlaybackRow` and `VoicePromptEcho` served only the deleted directions and
went with them, along with their message keys.

Two rules the strip keeps:

- **Proposals are never behind a disclosure.** A proposal is the only part of an
  answer the operator has to answer; a minimal strip that hid the one actionable
  thing would be minimal about the wrong half.
- **Blocks scroll inside the window, never the page.** The strip is a fixed pane;
  a table that pushed the page down would defeat the mode.

### Typing to her: the `candi` panel

V2 hung a free-floating input pill above the control bar. That was two floating
chromes stacked at the same edge, one of which was the app's actual footer, and
it left "Ask Candi" as the one control in the console that opened something the
console did not own. **V3 puts the input in the control dock's single layer-2
slot** as panel id `candi` (`CompanionInputPanel`), which buys three things at
once: the dock's exclusivity rule covers her (opening Automations closes Candi
and the reverse), the roving toolbar reaches her the way it reaches every other
panel, and the input sits at the width the footer already establishes.

The row's Candi control is therefore whichever of two things the interface mode
makes it — `candiControl()` in `shell/simulation/simControlDockLayers.ts`:

| Interface mode | The control is | Announced as |
| --- | --- | --- |
| **Voice** | a PANEL toggle for `candi`; opening it raises the strip, closing it lowers her | `aria-expanded` + `aria-controls` |
| **Window** | the round-3 ACTION: it empties the slot and raises the left dock, the competing surface | `aria-pressed` |
| no companion (deep-link pages) | not rendered at all | — |

**Her panel's openness is `companion.open` itself**, never a second copy in the
dock's `panel` state — joined during render by `effectiveDockPanel()`. That is
what keeps the command palette's "Ask Candi" (which knows nothing about the
footer) consistent with the row, with no effect keeping two states in step.
Sending from the panel keeps it open: her answer lands in the strip and the next
question is typed in the same place, so a panel that closed itself on send would
make every second message a two-click act.

**Closing her never cuts audio.** `CompanionDock` keeps the strip mounted while
`speech.speakingId` is set even after `open` goes false, because the strip
carries the only stop control there is. In WINDOW mode that courtesy is
impossible — the rest pill has no transport — so closing the window stops the
utterance, which is V1's contract unchanged.

### Geometry

The strip is fixed on `--z-sim-drawer`, the dock's own layer: above the sidebar,
below the Modal, because a dialog the operator opened is the more recent intent.
Nothing traps focus and nothing is inert — the page behind is the entire reason
this mode exists. The rest pill is unchanged and shared: the mode changes the
OPEN state only, so a voice-mode operator whose deck is collapsed still has the
pill as a door.

**Parity with the window, three ways.** *Escape* closes the strip when the
settings popover is not open, through the SAME close path the X uses — so focus
lands back on the rest pill however it was dismissed. Bound to the document, not
to the region: the strip is one focus stop that an operator working the page
behind it does not have focus in. *Below `sm` the row wraps*: the prose takes the
full first row and the controls sit beneath it, because at 360px the controls
alone want ~332px of the ~312px available and a nowrap row squeezes her answer to
nothing. Hiding the counter would have been cheaper and would have deleted the
one affordance the mode exists for. *One live region for the answer* (the prose)
and *one status region for busy* — the counter is no longer live and the ticker
reuses `VoiceBusyNote` instead of duplicating it, so a single arrow press no
longer fires three announcements at once.

The input is one line (`<input>`, not a textarea): the operator gave up the
column to keep the page visible, so the composer cannot claim it back, Enter has
exactly one meaning and there is no Shift+Enter to explain. It reproduces
`ChatComposer`'s draft contract (cleared optimistically, restored when the
exchange resolves false) rather than sharing it — about eight lines, against
adding a `compact` prop to a primitive another workstream owns. It is disabled
until the thread is `ready`, because a message sent into no thread resolves false
and silently restores itself, which reads as the app ignoring you. It takes focus
on open: the operator pressed a control that makes a place to type. The mic is
drawn disabled with a title naming what it waits for: a voice mode with no
microphone reads as an oversight, one with a live-looking icon that does nothing
is worse, and a control that is visibly not ready yet is the honest third option.

> **Found by painting it, not by a gate.** The dock header's `backdrop-blur`
> gives it its own stacking context, which confined the settings panel's `z-50`
> to the header's level while the body — a later sibling — swallowed every click
> on it. The popover rendered perfectly and could not be pressed. The header now
> carries `relative z-10`; anything anchored in the toolbar's `extra` slot that
> opens over the body depends on it.


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
