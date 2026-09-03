# Recruiter feedback door

An in-product "Send feedback" channel for signed-in recruiters: a rail
affordance in the workspace shell opens a small dialog, the submission lands in
the local SQLite store, and operators read it (read-only) on `/control`.

## Entry points

- **Rail button** — `app/features/shell/nav/NavFeedbackButton.tsx`, mounted in
  both sidebars' rail footer (interactive shell:
  `app/features/shell/WorkspaceNavDrawer.tsx`; deep-link/link-mode:
  `app/features/shell/WorkspaceNav.tsx`), beside the preferences and sign-out
  controls. Icon over a visible label, the same shape as the rail's Search
  trigger and the section buttons above it: the short `feedback.railLabel`
  ("Feedback") is visible, the full `feedback.open` ("Send feedback") rides in
  the tooltip. (`railIconBtn` remains the recipe for the preference popups and
  sign-out, which are chrome rather than destinations.)
- **Dialog** — `app/features/shell/nav/FeedbackDialog.tsx` on the shared
  `Modal` primitive at `size="lg"`: one message (required, ≤ 2000 chars) and
  the current route captured automatically. It asks for nothing else — the
  reply address is resolved from the signed-in user by the route, so there is
  no email field to fill in or to spoof.
- **Operator view** — `app/control/FeedbackSection.tsx`, composed from
  `app/control/page.tsx` beside `ControlRoom` (deliberately NOT inside
  `ControlRoom.tsx`, which is oversized and mid-decomposition). Read-only,
  newest first, bounded at 50 rows. **Gated on `members:manage`**: the page
  resolves `can("members:manage")` server-side and renders the section only for a
  caller who holds it, so a recruiter is not shown a panel that could only 403 at
  them. The route below is the actual wall — this is the UI half of the same rule,
  and the two use the same capability so they cannot disagree.

## API surface

| Route | Method | Auth | Behavior |
| --- | --- | --- | --- |
| `/api/feedback` | POST | workspace-gated (not in `public-routes.ts` — the fail-closed proxy enforces a session in password mode) | Validates via `parseFeedbackSubmission` (refuses, never coerces) and answers a refusal as `jsonRefusal(code, 400)`, then rate-limits per IP (`feedback:<ip>`, 10/10min, pinned in `app/api/rate-limit-contract.test.ts`) and answers `jsonRefusal("TOO_MANY_REQUESTS", 429)`, then records with the session workspace, the reply address read from the session user (`currentSession` → `getUserById` → `replyEmailFrom`), and the server's own `npm_package_version`. |
| `/api/feedback` | GET | workspace-gated **+ `members:manage`** (`requireCapability`) | Newest-first list for the current workspace, for `/control`. Each row carries the author's reply address, so this is a read of colleagues' words *and* their contact details — `members:manage` is the bar because it is the same capability that already gates the member and invite lists, and it is one an admin holds (`org:manage` is owner-only). A caller without it gets `FEEDBACK_READ_FORBIDDEN` at 403, or 401 with no session. Pinned by `app/api/feedback/feedback-read-gate.test.ts`, which also re-asserts that the POST half stays open to any signed-in member. |

## Lib surface

- `app/_lib/feedback.ts` — pure validation. `parseFeedbackSubmission` covers
  what the CLIENT may say (message + route bounds; a non-path `route` drops to
  null rather than rejecting the submission) and returns `ParsedFeedback`, which
  has no `email` field at all. `replyEmailFrom` normalises the SERVER-derived
  address separately: an unreadable identity becomes null rather than blocking
  the report.
  A refusal carries a CODE and nothing else — `FEEDBACK_REFUSALS`
  (`FEEDBACK_MESSAGE_REQUIRED`, `FEEDBACK_MESSAGE_TOO_LONG`), each registered in
  `REFUSAL_ERRORS` with an `errors.<CODE>` entry in all four catalogs. The
  validator used to put its own English sentence in the 400 body, and the 429
  carried no code at all, so `FeedbackDialog` (which resolves `code` through
  `useErrorMessage`) painted its generic "could not send" at a throttled sender
  and sent them straight back into the same wall. Pinned by
  `app/_lib/feedback.test.ts`.
- `app/_lib/feedback-store.ts` — SQL only: `recordFeedback`, `listFeedback`,
  both workspace-scoped.

## Data model

`feedback` (created idempotently in `app/_lib/db/core.ts`, no ALTER migration —
the table is new-in-full): `id`, `message`, `email` (nullable), `route`
(nullable), `app_version` (nullable, server-stamped), `workspace_id`
(default `'workspace'`), `created_at`; index `idx_feedback_ws`
`(workspace_id, created_at DESC)`. Classified **scoped** in the tenancy
manifest (`app/_lib/tenancy.ts`); pins live in
`app/_lib/feedback-tenancy.test.ts` (migration columns, round-trip, tenant
isolation, validation refusals).

## Keyless behavior

Fully keyless — no LLM, no external provider. Works identically on open-mode
dev deploys (where the per-IP limiter is the only brake) and gated deploys.

## Known gaps

- No operator triage state (read/unread, resolved) — the list is append-only.
- No notification on new feedback; operators discover it by visiting `/control`.
- Demo sessions share the proxy gate's rules; a demo-workspace session that
  reaches the shell can submit (rows land in the isolated `demo` workspace).
- In open dev mode (no `KP_OPERATOR_PASSWORD`) there is no session identity, so
  `email` stores as null and the row is unattributed. The operator view shows it
  as such rather than guessing.
