# Interview rounds: AI-first / Human / Hybrid (concept)

Status: **concept** — brainstormed 2026-08-10 alongside the Schedule-tab
/prototype round (AI-round ledger/docket subtab). Nothing below is committed;
the prototype ships only the AI subtab surface over existing infrastructure.

## The three modes

| Mode | First round | Follow-up | What Schedule shows |
| --- | --- | --- | --- |
| **AI-first** | AI voice interview via tokenized link (`/interview/[token]`) — no calendar at all | none (verdict → Decisions) | AI subtab: link generation + past-interview ledger + evaluation |
| **Human** | Recruiter/hiring-manager interview booked via the self-scheduling link + calendar sync | — | Today's calendar surface (invite lifecycle + week grid) |
| **Hybrid** | AI round for the WHOLE cohort | Human round for the REDUCED cohort (AI verdict `advance`, optionally top-N by scorecard) | Both subtabs, with a visible handoff between them |

Everything needed already exists as parts: the voice engine + session store
(`interview_sessions`), the scheduling engine (`schedule_invites` + Google
Calendar sync), and the Decisions gates (`scorecard_review`). The mechanism to
build is the **round policy** that strings them together per job.

## Mechanism: a per-job `interviewPlan`

One new config object, stored per job (with a workspace default), owned by a
new **Hiring pipeline** settings tab:

```ts
type InterviewPlan = {
  mode: "ai_first" | "human" | "hybrid";
  ai?: {
    autoInvite: boolean;        // mint + send the link on reaching Interview stage
    linkTtlDays: number;        // existing INTERVIEW_LINK_TTL_DAYS, surfaced
    durationMin: number;
  };
  hybrid?: {
    // The cohort reducer between rounds — the "reduced scope of candidates":
    advanceOn: "ai_advance" | "ai_advance_or_hold";
    topN?: number | null;       // optional cap after the verdict filter
    autoInviteHuman: boolean;   // auto-mint the self-scheduling link for survivors
  };
  human?: { defaultDurationMin: number; interviewerUserId?: string | null };
};
```

Flow (hybrid): entry reaches Interview stage → AI link auto-minted/sent →
interview completes → `scorecard_review` in Decisions (human ratifies, as
today) → **on accept, instead of terminal advance, the plan routes the
candidate to the human round** (`approvalKind: "calendar"` + self-scheduling
invite) when they clear the reducer; otherwise the accept behaves as today.
This reuses the existing accept path in `pipeline-entry-action.ts` — the plan
only decides which gate comes next. Every hop stays auditable via the existing
sealed-decision events.

## Impacted surfaces

- **Settings → new "Hiring pipeline" tab** (`app/features/settings/pipeline/`):
  workspace-default plan + per-job overrides; follows the 6-step add-a-tab
  recipe in tabs.ts (append to Settings group, chunk registry, i18n key,
  tabs.test). Existing automation/decision-config (`decision-config-store.ts`)
  is the natural storage neighbour — the plan could ride the same store.
- **Onboarding**: the first-run wizard (`setupSteps.ts`) gains a step (or a
  field on `firstRole`) choosing the interview mode for the first role —
  default "hybrid" tells the product story best; "human" is the conservative
  default for corporate. The Getting-started checklist gains "connect Google
  Calendar" when a human round is chosen (deep link to `?tab=integrations`).
- **Schedule tab**: the prototyped round switcher becomes plan-aware — an
  AI-first job never shows the calendar; a hybrid job shows the handoff count
  ("3 cleared the AI round, awaiting human slot").
- **Integrations**: human/hybrid rounds lean on the existing Google Calendar
  connection (free/busy + event write). Gap: `calendar_connections` is one
  grant **per workspace** — a hybrid rollout across multiple interviewers
  needs per-USER connections (below).

## Organizations / multi-user impact (the load-bearing part)

Current model: Organization → Team (= `workspace_id`, the isolation boundary)
→ User (role per membership). Everything schedule/interview-related is
**team-scoped and person-blind**:

1. **No interviewer identity.** `schedule_invites` and `interview_sessions`
   carry no `user_id`; the only attribution is a free-text `interviewer`
   string on the prep artifact. The human round needs
   `interviewer_user_id` on invites (nullable, additive) so that:
   free/busy checks the RIGHT person's calendar, "my interviews" filters
   exist, and hiring-manager members only see their own agenda.
2. **Calendar connections are per workspace, not per user.** One Google grant
   serves the whole team — wrong the moment two interviewers exist. Additive
   fix: `calendar_connections.user_id` column + resolution order (interviewer's
   connection → workspace default). OAuth flow already lands on
   `?tab=integrations`; it becomes "connect *your* calendar".
3. **Attention badges are workspace-blind** (documented gap): `attentionCounts()`
   computes for the default workspace only. The new future-events badge
   inherits this; fixing it means threading `currentWorkspace()` through
   `/api/attention` and `WorkspaceNav` (the store helper already takes a
   workspace parameter).
4. **RBAC**: the plan is config → editing it should require `team:manage`
   (owner/admin), while running interviews needs only `pipeline:write`. A
   `hiring_manager` role member is the natural owner of human-round scorecards;
   the existing capability set covers this without new capabilities.
5. **Tenancy manifest**: any new table (e.g. `interview_plans` if not riding
   `decision_config`) must land in `TENANCY_SCOPED_TABLES` with a colocated
   `*-tenancy.test.ts`, per the fail-closed manifest rule.
6. **Billing**: AI rounds spend `interview_minutes` (already metered via
   `meterGate`). A hybrid plan multiplies usage per candidate — the plan
   editor should surface the projected minute cost next to the mode choice.

## Known risks / open questions

- Auto-inviting the AI round on stage entry is a *sending* action — it must
  respect the comms relay's truthful sent/queued semantics and probably a
  per-wave cap (same grammar as the screening wave).
- The hybrid reducer is a selection decision → it belongs in the sealed
  decision-record chain (adverse-impact monitoring already watches rejects;
  "not advanced to human round" is a new adverse-ish event worth recording).
- Candidate experience: hybrid means two invitations — the status page
  (`/status/[token]`) should narrate the two-round journey so the second
  email doesn't read as a mistake.
