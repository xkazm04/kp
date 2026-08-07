# Dev Submissions & Live Work Surface — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (1 critical, 2 high, 2 medium, 0 low)

## 1. Live-session write route is gated only by a guessable `randomId` — anyone can overwrite a candidate's work or forge authenticity-tanking events
- **Severity**: Critical
- **Lens**: ambiguity
- **Category**: guessable-id-write-surface
- **File**: `app/api/devcase/session/[id]/route.ts:18`
- **Scenario**: A candidate works in the Live Work Surface. An attacker (or a rival applicant who saw the shared apply link) POSTs to `/api/devcase/session/<id>` with a guessed session id: `saveDevSessionFiles` wholesale-replaces the candidate's `files_json` (their entire graded work), or the attacker injects a single `{"kind":"paste","size":99999}` event that flips `observedBulkPaste`, docking −65 authenticity and branding the candidate "suspect".
- **Root cause**: `startDevSession` mints ids with `randomId("dsess")` (`app/_lib/db/devcase.ts:630`) — the `Date.now().toString(36)` + 6-char `Math.random()` scheme whose own doc says "Never a security boundary" (`app/_lib/random-id.ts:10`). Yet the session route is a public, unauthenticated, side-effecting endpoint where the id is the *only* credential. The repo's own doctrine elsewhere (`channels.ts:78`, `pipeline.ts:1013`) mandates `randomToken` for exactly this shape. The time prefix makes enumeration near-trivial once the approximate start minute is known.
- **Impact**: Silent destruction of a candidate's in-progress work (data loss the candidate can't detect — flushes 200 OK), or forged process events that swing the authenticity score and therefore the hiring decision. Both the write route and `session/[id]/submit` are affected.
- **Fix sketch**: Mint session ids with `randomToken("dsess")` (matching the skill-profile precedent in `db/core.ts:969`), or keep the internal id and add a per-session CSPRNG secret returned at session start that every flush/submit must present. Also require the posting's apply `token` in the flush body and check it against `session.token` as a cheap second factor.

## 2. Final flush failure is swallowed — the submission finalizes and shows "submitted" while grading stale or pristine-seed files
- **Severity**: High
- **Lens**: ambiguity
- **Category**: silent-partial-write-on-submit
- **File**: `app/devcase/apply/[token]/LiveWorkSurface.tsx:130`
- **Scenario**: A candidate finishes their last edits and clicks Submit on flaky Wi-Fi. The final `flush({submit:true})` POST fails; `flush` catches the error, re-buffers, and returns normally (`:91-93`). `submit()` then proceeds to `/session/[id]/submit`, which succeeds — the candidate sees the green "submitted" panel, but the engine grades the `files_json` from the last successful periodic flush (up to 8s stale, or the untouched seed if no flush ever landed). The re-buffered events are then permanently unsendable: the session is `submitted` and further flushes 409 (`session/[id]/route.ts:23`).
- **Root cause**: `flush` is fire-and-forget by design (fine for the 8s interval) but `submit()` reuses it without distinguishing "final state persisted" from "buffered for later" — there is no later.
- **Impact**: The candidate's actual final work is silently dropped from evaluation; scores and the seed-engagement diff are computed on the wrong file tree, i.e. wrong hiring signal with a false success confirmation.
- **Fix sketch**: Make `flush` return a boolean (or throw on `submit: true`). In `submit()`, retry the final flush once and abort to `status: "error"` if the file tree wasn't persisted — never call the finalize endpoint while `pendingRef` holds unflushed events/files. Alternatively, have the submit endpoint accept `{files, events}` inline so finalize-and-persist is one atomic request.

## 3. Session-start failures (429 throttle, closed posting, network) are invisible — the candidate works unrecorded and the server's honest error messages are discarded
- **Severity**: High
- **Lens**: ui
- **Category**: missing-error-state
- **File**: `app/devcase/apply/[token]/LiveWorkSurface.tsx:47`
- **Scenario**: The token has hit the 50-sessions/day throttle (`session/route.ts:28`) or the posting closed mid-visit. `ensureSession` returns `null` on every non-OK response and every `record`/`flush` becomes a silent no-op — the editor stays fully interactive, so the candidate works for hours with nothing observed or saved. On Submit, `sid` is null and they get only the generic `t("error")` string (`:223`); likewise a 410/429 on the submit endpoint is mapped to the same generic text (`:141`) even though the server sends a specific, honest message ("intake has closed…", "Too many sessions…").
- **Root cause**: `ensureSession` collapses all failure modes to `null` with no state surfaced to the UI, and `submit()` never reads the response body — the error taxonomy the API deliberately built (W5-3 "honest closure", the throttle copy) dies at the client boundary.
- **Impact**: Worst case a candidate loses a whole working session with no warning; best case they retry blindly against a permanent condition. Directly contradicts the product's "never ghosts" stance on its own candidate surface.
- **Fix sketch**: Track a `sessionState: "ok" | "unavailable"` — on a failed session start, show a persistent banner over the editor ("work isn't being recorded — reload / try later") and disable Submit. In `submit()`, parse `payload.error` like `DevApplyForm.tsx:49-50` does and render it, keeping the 410-closed case as a distinct terminal state.

## 4. Recruiter "Record" form can't capture contact, but SubmissionRow's warning claims only the webhook produces contactless rows
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: stale-invariant-comment
- **File**: `app/features/sub_dev/SubmissionForm.tsx:20`
- **Scenario**: A recruiter hand-records a submission that arrived by email using the drawer form (candidate + repo URL only). The row then permanently shows the amber "No contact — unreachable if promoted" alert, whose code comment asserts "Only the lenient webhook path can produce this now (the public form requires contact)" (`SubmissionRow.tsx:324-327`) — false: `/api/devcase/submit` accepts `contact` (`submit/route.ts:16,29`) but the form never collects or sends it, and offers no way to fix the row afterwards.
- **Root cause**: When contact became required on the public form, the internal recruiter path was never updated; the invariant comment documents a rule the code doesn't enforce.
- **Impact**: Every manually-recorded submission is born "unreachable"; the amber warning cries wolf on the exact rows the recruiter knows most about, training reviewers to ignore it — eroding its value on the genuinely contactless webhook rows.
- **Fix sketch**: Add an optional contact input to `SubmissionForm` and pass it through to the intake (the API already accepts it). Correct the SubmissionRow comment to name both lenient paths, or better, let the amber pill open a one-field inline "add contact" editor so any contactless row is fixable in place.

## 5. Compare table's count chip reports the capped column count as the total, and truncated candidate refs can collide into identical headers
- **Severity**: Medium
- **Lens**: ui
- **Category**: misleading-truncation
- **File**: `app/features/sub_dev/CompareSubmissions.tsx:29`
- **Scenario**: A case has 8 evaluated submissions. `rubricCompare` silently keeps the top 5 by transfer score (`devcase-compare.ts:55`, `maxColumns = 5`) — its contract even says "the caller reports the true count" — but the header renders `· {columns.length}`, i.e. "· 5", so a reviewer believes they're comparing everyone while 3 candidates are invisibly excluded. Separately, `shortRef` (`:23`) keys columns on the pre-`@` local part clipped to 14 chars: `jan.novak@a.com` and `jan.novak@b.dev` render as two identical "jan.novak" headers with no way to tell which column is whom.
- **Root cause**: The component ignores the documented cap contract (it never receives the pre-cap total), and the disambiguating part of an email is exactly what the truncation discards.
- **Impact**: Wrong-decision risk in the one surface built for side-by-side judgment: excluded candidates are unknowable, and colliding headers can attribute one candidate's axis leadership to another.
- **Fix sketch**: Pass `submissions.filter(hasEval).length` (or return `totalEvaluated` from `rubricCompare`) and render "top 5 of 8" when capped. For headers, add a `title={col.candidateRef}` tooltip and disambiguate collisions (e.g. append the domain initial or the fit score is already there — include a 2-char suffix of the id) before slicing.
