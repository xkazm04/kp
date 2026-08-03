# Features

These documents describe the **implemented** product surface — what the app does today,
with the files that do it. They are written for developers and for agents that need a
stable reference before touching code.

Not-yet-built work lives in [../concepts/](../concepts/); market and roadmap framing lives
in [../product/](../product/); superseded material lives in [../_archive/](../_archive/).

## The hiring loop

| Area | Doc | Implementation roots |
| --- | --- | --- |
| Jobs & JD lifecycle | [jobs/README.md](jobs/README.md) | `app/_lib/job-ingest.ts`, `app/_lib/jd-lint.ts`, `app/api/jobs`, `app/api/jds`, `app/features/library/jobs`, `pipeline/jobfit/campaign.py` |
| Candidate intake & CV analysis | [candidates/README.md](candidates/README.md) | `app/_lib/apply*.ts`, `app/_lib/analyze-run.ts`, `app/api/apply`, `app/features/tools/{analyze,profile}`, `pipeline/jobfit/profile.py` |
| Matching & scoring | [matching/README.md](matching/README.md) | `pipeline/jobfit/{matching,taxonomy,transform,transferable,weight_proposal}.py`, `app/features/tools/match`, `app/features/insights/matrix` |
| Pipeline & automation | [pipeline/README.md](pipeline/README.md) | `app/_lib/{pipeline-stages,automation-run,screen-wave,decision-config-store}.ts`, `app/api/automation`, `app/features/hiring/{pipeline,decisions}`, `pipeline/jobfit/automation.py` |
| Dev cases | [dev-case/README.md](dev-case/README.md) | `app/_lib/devcase-*.ts`, `app/api/devcase`, `app/features/tools/devcases`, `app/devcase/apply`, `pipeline/jobfit/devcase/**` |
| Interview scheduling | [scheduling/README.md](scheduling/README.md) | `app/_lib/schedule-{slots,store}.ts`, `app/_lib/calendar/**`, `app/api/schedule`, `app/api/calendar`, `app/schedule`, `app/features/hiring/schedule` |
| Interviews (voice) | [interviews/README.md](interviews/README.md) | `app/_lib/voice/**`, `app/api/interview`, `app/interview`, `app/interview-lab`, `app/_components/voice` |
| Candidate comms | [comms/README.md](comms/README.md), [comms/outbound-export.md](comms/outbound-export.md) | `app/_lib/comms*.ts`, `app/api/comms`, `app/api/channels`, `app/features/hiring/channels` |

## Platform

| Area | Doc | Implementation roots |
| --- | --- | --- |
| Compliance & trust | [compliance/README.md](compliance/README.md), [compliance/ai-act-conformity.md](compliance/ai-act-conformity.md) | `app/_lib/{consent,decision-record-store,trust-posture,status-decisions}.ts`, `app/trust`, `app/data/[token]`, `app/status/[token]` |
| Organization, identity & tenancy | [organization/README.md](organization/README.md) | `app/_lib/db/{organizations,users,memberships,invites}.ts`, `app/_lib/auth/**`, `app/_lib/tenancy.ts`, `app/features/settings/organization` |
| Integrations (calendar, inbound ATS) | [integrations/README.md](integrations/README.md) | `app/_lib/calendar/**`, `app/_lib/ats/connections-store.ts`, `app/api/calendar`, `app/api/ats/connections`, `app/features/settings/integrations` |
| Billing | [billing/README.md](billing/README.md) | `app/_lib/billing/**`, `app/api/billing`, `app/features/settings/billing`, `scripts/polar-setup.mjs` |

Cross-cutting contracts (LLM provider layer, persistence backend, self-hosting, app
structure) are in [../architecture/](../architecture/). The design system is in
[../design/](../design/).

## Writing rules

- Name the **UI entry point**, the primary **user flows**, the **API/lib surface**, the
  **data model**, and a short **Known gaps** section. Nothing else.
- Cite real file paths and verify they exist. A doc that names a moved file is worse than
  no doc — that is the failure mode this tree was reorganized to fix.
- Long future-looking sections belong in `../concepts/`, not here.
- State it explicitly when a feature is gated behind a tier, an env key, or a dev flag,
  and describe what happens **without** API keys — keyless degradation is a product
  property of this app, not an edge case.
- Adding a feature area? Add its entry to
  [`scripts/docs/feature-doc-map.json`](../../scripts/docs/feature-doc-map.json) in the
  same change, or the drift detector will not watch it.
