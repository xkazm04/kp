---
kind: task
status: done
opened: 2026-10-07
charter: codebase-security-scan
branch: autopilot/codebase-security-scan-ae9f0318
gate: npm run test:unit
measurable: fixes 5, 6 and 7 of the agent-entry scan (2026-10-07-agent-entry-machine-actors-scan.md), one commit and one red-first test each.
---

# Agent-entry scan, fixes 5-7

Reconciled first: fixes 1-4 are 9eeba1f70; none of 5-7 was on main.

| fix | commit | change | red-first test |
| --- | --- | --- | --- |
| 5 | 849eb78ea | both arrival hooks branch on `contactVerdict`'s `agent_population` and answer `skipped`/`agent_population`, parking nothing. The homework hook skips at its first gate, before a case is designed. No new localized string. | `stage-hooks.test.ts`, `stage-hooks-homework.test.ts` |
| 6 | ed3ff3ea9 | `dispatchInterviewInvite` and `dispatchCaseInvite` take `CandidateCommTarget & { locale }`; `resendNextAction` passes the whole entry. | `comms-dispatch-population.test.ts` (resend door, agent with a contact) |
| 7 | b9f45b1aa | `buildAtsRecord` refuses `isAgentPopulation` entries with `AtsRecordRefusedError("agent_population")`; `AtsRefusalReason` widens the egress refusal type, whose handling is unchanged (terminal dead-letter). No schema bump. | `ats-record.test.ts` |

Each test was run red against the unchanged source before the fix.

Notes: `ats-record.ts` described itself as dependency-free; it now imports `isAgentPopulation` from `db/core.ts` as the brief directed. The `listJobPipelineStats` status filter was left out (another run holds `db/pipeline.ts`). `docs/features/integrations/README.md` still names only the anonymized refusal; outside the declared paths.
