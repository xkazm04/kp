---
kind: task
status: done
opened: 2026-10-07
charter: accepted-idea-delivery
branch: autopilot/accepted-idea-delivery-2967d471
gate: npm run typecheck && npm run lint && npm run test:unit
measurable: the one open must_address of lite round 2 (afed4dd6, overall 0.6414) is answered by a commit and a test.
---

# compliant-hiring-decision: the /control door at '/'

Source: council lite round 2, run `afed4dd6`, head `cf595ece5` (lite-ready).

## must_address: "value: The /control door is drawn on server-rendered pages only; the interactive workspace at '/' never receives the operator flag (app/page.tsx:79, app/features/shell/Workspace.tsx:40)."

Reconciled first: no commit after `cdc10819d` on main passed `operator` to `<Workspace>`.

`app/page.tsx` now resolves `isOperator()` inside the existing `Promise.all` with
`currentSession()` and `resolveShellPrincipal()` (after the `!entered` return, so the
anonymous landing stays DB-free) and passes `operator={operator}` to the single
`<Workspace>` mount. `Workspace.tsx` and `WorkspaceNavDrawer.tsx` are unchanged. The door
appears for exactly the callers `app/control/page.tsx` admits.

Test: `app/features/shell/nav/controlDoor.test.ts` reads `app/page.tsx` and asserts the
mount passes `operator=` and that the value comes from `isOperator()`; removing
`operator=` from the mount fails it.

Commit: see `git log` for `fix(shell): hand the operator flag to the workspace at '/'`.
