# Recruiter feedback door

An in-product "Send feedback" channel for signed-in recruiters: a rail
affordance in the workspace shell opens a small dialog, the submission lands in
the local SQLite store, and operators read it (read-only) on `/control`.

## Entry points

- **Rail button** — `app/features/shell/nav/NavFeedbackButton.tsx`, mounted in
  both sidebars' rail footer (interactive shell:
  `app/features/shell/WorkspaceNavDrawer.tsx`; deep-link/link-mode:
  `app/features/shell/WorkspaceNav.tsx`), beside the preferences and sign-out
  controls. Icon-only on the shared `railIconBtn` recipe; name lives in
  `aria-label` + tooltip (the SignOutButton pattern).
- **Dialog** — `app/features/shell/nav/FeedbackDialog.tsx` on the shared
  `Modal` primitive: one message (required, ≤ 2000 chars), an optional reply
  email, and the current route captured automatically.
- **Operator view** — `app/control/FeedbackSection.tsx`, composed from
  `app/control/page.tsx` beside `ControlRoom` (deliberately NOT inside
  `ControlRoom.tsx`, which is oversized and mid-decomposition). Read-only,
  newest first, bounded at 50 rows.

## API surface

| Route | Method | Auth | Behavior |
| --- | --- | --- | --- |
| `/api/feedback` | POST | workspace-gated (not in `public-routes.ts` — the fail-closed proxy enforces a session in password mode) | Validates via `parseFeedbackSubmission` (refuses, never coerces), then rate-limits per IP (`feedback:<ip>`, 10/10min, pinned in `app/api/rate-limit-contract.test.ts`), then records with the session workspace + the server's own `npm_package_version`. |
| `/api/feedback` | GET | workspace-gated | Newest-first list for the current workspace, for `/control`. |

## Lib surface

- `app/_lib/feedback.ts` — pure validation (message/email/route bounds; a
  non-path `route` drops to null rather than rejecting the submission).
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
