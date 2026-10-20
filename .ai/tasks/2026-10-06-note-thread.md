# Per-entry note thread (idea a94f3c09)

Reconciled first: no authored-note table or note-append action existed on main
(no `author_user_id` anywhere under `app/`; no `pipeline_entry_notes`). Built.

## What changed
- **Schema** — `pipeline_entry_notes` (id, entry_id, workspace_id NOT NULL, author_user_id NULL,
  body, created_at) + index, in `app/_lib/db/core.ts` (the initializer, like its siblings).
  Slice: `app/_lib/db/entry-notes.ts` (imported directly, not through the barrel).
- **Tenancy** — scoped in `app/_lib/tenancy.ts`; the insert derives `workspace_id` from the entry
  in the caller's workspace (`INSERT … SELECT … FROM pipeline_entries`), every read binds it;
  id named a minted identity key in `tenant-keys.test.ts`.
- **Authorship** — `POST /api/pipeline/[id]` action `add_note` stamps `currentUser().userId`;
  the body carries `note` only. Null user -> NULL, shown "Local user". Name resolved at read
  (LEFT JOIN users), nothing copied into the row.
- **Doors** — `add_note` (pipeline:write, `entry-actions.ts`), `GET /api/pipeline/[id]/notes`
  (new route, row in `api-reference.md`). Append-only. Empty -> 400 `PIPELINE_NOTE_EMPTY` (new,
  4 catalogs), non-text -> `PIPELINE_NOTES_INVALID`, over cap -> `PIPELINE_NOTES_TOO_LONG` with
  `{max,length}`. `MAX_NOTES_LENGTH` now lives in `entry-notes.ts`, one number for set_notes too.
  `set_notes` behaviour untouched.
- **GDPR** — `scrubEntryLinkedPii` deletes the thread inside `anonymizeEntry`'s transaction.
  `erasure-full-scrub.test.ts` extended (name/email/phone note body gone). No candidate
  data-export path enumerates entry-linked tables, so there was nothing to extend.
- **UI** — `PipelineEntryNoteThread.tsx` (~125 lines) under the scratchpad on the Record tab;
  9 strings x 4 locales.
- **Docs** — `docs/features/pipeline/README.md` ("The note thread").

## Proofs
- `app/_lib/db/entry-notes.test.ts`: append+list order, null author, session author (and the
  route branch reads no author from the body), read-time rename, empty/non-string/too-long 400
  (cap as data), cross-workspace list+append refused, unknown entry 404.
- `app/_lib/db/entry-notes-tenancy.test.ts`: manifest class, SQL scoping, insert derivation,
  append-only, the single erasure DELETE.
- `app/_lib/erasure-full-scrub.test.ts`: thread deleted by `anonymizeEntry`; the manifest/erasure
  pin passes because the DELETE is in the erasure region.

## Gates
| Gate | Result |
| --- | --- |
| typecheck | pass |
| lint | 0 errors, 49 warnings (all pre-existing; none in touched files) |
| test:unit (full) | green after naming the note id in `tenant-keys.test.ts` (the one failure it found) |
| i18n:check | pass |
| design:check | pass |
| docs:check | pass |
| api:check | pass |
| lint:ts-ratchet, guidance:check | pass |
| test:perf | red before and after; the over-budget set is IDENTICAL (32 distinct files by my parse); no route touched here gained an entry |
| test:docs | red before and after, same cause: missing `docs/design/app-contest-kit.md` |

Restored `*.generated.ts` after schemas:gen (CRLF-only churn). No CHANGELOG entry (told not to).
Open: the thread is not editable/deletable by design this run.
