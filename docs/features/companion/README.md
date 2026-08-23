# Operator companion (Candi)

The companion is the studio-side chat the operator talks to about their own
workspace. It has continuity across sessions, it is grounded in what the studio
actually holds, and it **never acts** — it proposes, and the operator accepts.

> **Status: WP1 only.** The brain, the turn CLI, the model use case and the
> persistence layer are in. There is no route and no UI yet — nothing in the app
> reads these tables today. WP2 (route) and WP3 (panel) land on top of this.

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

## Known gaps

- No route and no UI (WP2/WP3). Nothing writes `companion_threads`,
  `companion_turns` or `companion_proposals` yet — the store and the schema are
  ahead of their callers on purpose.
- The kp thread id does not reach the brain. Episodes carry the workspace
  session tag (`kp-<workspace>`) only, matching the shared format; linking a
  turn back to its episode is done through `episodePaths` on the CLI's output.
- No reindex command. If `companion_brain_index` is truncated, nothing rebuilds
  it from the tree yet.
- Nothing prunes or consolidates episodes on the kp side. With Personas
  installed, its sleep cycle does that for the shared tree.
