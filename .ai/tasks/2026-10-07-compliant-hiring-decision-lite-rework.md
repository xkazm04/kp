---
kind: task
status: done
opened: 2026-10-07
charter: accepted-idea-delivery
branch: autopilot/accepted-idea-delivery-3fae30c9
gate: npm run typecheck && npm run lint && npm run test:unit
measurable: the three council must_address lines for compliant-hiring-decision (lite r1, overall 0.6375) are answered by a commit and a test each.
---

# compliant-hiring-decision: lite round 1 rework

Source: run `2026-10-07-compliant-hiring-decision-lite-r1` (outcome incomplete).

## must_address 1: "value is unmeasured: no declared characters; value cannot be judged against an invented user."

`.claude/council/config.md` (tracked) now carries `## Characters`: `uat/characters/` in the
checkout under review, else `C:/Users/kazda/kiro/kp/uat/characters/`, first existing wins.
It names the four characters this feature serves (petra-recruiter, lucie-dpo-compliance,
eng-lead-hiring-app-master, tereza-candidate). No character content is copied; `.gitignore`
and `uat/` are untouched. This is a config file, so the proof is the file itself.

## must_address 2: "value: Nothing in the tree links to /control, the page that holds the Art. 22 gates"

`app/features/shell/nav/controlDoor.ts` decides, `NavControlLink.tsx` draws, beside the
feedback tile in `WorkspaceNav` (server) and `WorkspaceNavDrawer` (SPA). Label in
`nav.controlRoom` / `nav.controlRoomRail`, 4 catalogs. `app/control/page.tsx`'s
`notFound()` gate is unchanged; its comment and the drawer's "lands on /control" comment
(which described the feedback dialog wrongly) now describe the code.
Test: `app/features/shell/nav/controlDoor.test.ts`.

**Open (outside the declared paths, so not made):** `app/page.tsx` renders `<Workspace>`
and must pass `operator={await isOperator()}`. Until it does the SPA rail shows no door
(the default is `false`, fail closed) and only the link-mode rail (`/jds/[slug]`,
`/history/[slug]`, `/diagrams`) links to `/control`. The `DevLifecycleRow` link was left
out for the same reason: that row has no operator flag and a link to a 404 is worse.

## must_address 3: "robustness: A candidate-name label enters dev_audit, and no erasure path reaches that table"

The three writers (outcomes route, `actOnPipelineEntry` reject, `offer-finalize` accept)
record the outcome in `reason` and the `dev_outcomes` key in `ref`. `anonymizeEntry`
(`scrubEntryLinkedPii`) masks `reason` for rows keyed by the erased refs and for legacy
rows led by the label; the legacy match is deliberately not workspace-scoped (the
unattributed writers stamp the default workspace). robustness-2: the catch in
`recordAudit` now logs one line. Tests: `erasure-full-scrub.test.ts` (red first: failed
with the name in dev_audit against the unchanged source), `dev-audit-no-candidate-label.test.ts`.

## Not done, by instruction

craft-1/2/3 (hash link, second connection, Approve confirm) are not this round.
