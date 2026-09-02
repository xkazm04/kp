import { NextRequest, NextResponse } from "next/server";
import { jobPostGate, recordMeterUsage } from "@/app/_lib/billing";
import { ensureDb } from "@/app/_lib/db/core";
import { canWriteJobLifecycle, getJob } from "@/app/_lib/db/jobs";
import { createPipelineEntry, reopenEntriesByJobId } from "@/app/_lib/db/pipeline";
import { classifyPublish, setJobStatus } from "@/app/_lib/job-ingest";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { runSourceForRole } from "@/app/_lib/devcase-run";
import { raiseRediscoveryAlertsForJob } from "@/app/_lib/rediscover";
import { splitRequirements } from "@/app/features/library/jobs/JobsTypes";

export const maxDuration = 60;

// Take a draft job live: flip its status to 'published' and source candidates
// into the pipeline (the step that used to happen implicitly on save). Idempotent
// — re-running doesn't re-source.
//
// User-facing this is "Source into Pipeline" (internal go-live), NOT external
// "Publish to job boards". The route name and the 'published' DB status are kept
// as a stable contract. See docs/features/jobs/README.md.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ws = await currentWorkspace();
  try {
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    // Ownership gate (mirrors /close): setJobStatus is a bare by-id UPDATE, so without
    // this workspace B could force workspace A's draft live — on B's quota — and the
    // reopen below would restore A's withdrawn entries into B's scope. Seeded corpus
    // rows (workspace_id NULL) stay publishable by every tenant: that is how a tenant
    // adopts a shared corpus role. See canWriteJobLifecycle. 404 (not 403) so the
    // endpoint doesn't confirm another tenant's job id exists.
    if (!canWriteJobLifecycle(id, ws)) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    // Billing hard gate: one of the two units the customer actually pays for — a role
    // taken to market. Re-publishing an already-live job is always allowed and never
    // charges (idempotent). The gate, the status flip and the debit run in ONE
    // db.transaction so two concurrent publishes can't both pass on the last included
    // unit, and so a refused publish can never leave a debit behind. (No await sits
    // between them and better-sqlite3 is synchronous, so this is atomic today too;
    // the transaction enforces the invariant if an await is ever introduced here.)
    //
    // "ONE transaction" is only true because all three statements run on THIS
    // handle. setJobStatus used to write through job-ingest.ts's own connection,
    // which made this block fail on every genuine go-live: the gate's billing read
    // opened this handle's WAL snapshot, the flip committed on the other connection,
    // and the debit then hit SQLITE_BUSY_SNAPSHOT — rolled back here, 500 to the
    // caller, and the role already live and unmetered. Pinned by
    // publish-atomicity.test.ts, which drives exactly this sequence.
    const gate = ensureDb().transaction((): { already: boolean; wasClosed: boolean; quota: ReturnType<typeof jobPostGate> } => {
      // ONE read of the row's lifecycle: is it already live, was it closed (a
      // reopen), and has it EVER been to market (`published_at`)?
      const transition = classifyPublish(id);
      if (transition.already) return { already: true, wasClosed: false, quota: null };
      // Taking a role to market is one of the two things the customer actually pays
      // for, so the gate and the debit are the same transaction as the status flip:
      // a publish that is refused must not charge, and one that succeeds must not
      // escape the meter.
      //
      // The debit fires once per job EVER — closing and REOPENING a role does not
      // re-charge. That is what this comment claimed before the rule was actually
      // implemented: it pointed at the `published_at = COALESCE(...)` stamp inside
      // setJobStatus, which guards the timestamp and nothing else, while the skip
      // above tested only `prevStatus === "published"`. A closed→published reopen
      // therefore took the gate AND the debit on every reopen. `published_at` is the
      // record of "this role has been live before", so it is what the once-per-job
      // rule reads (`classifyPublish().billable`). A never-stamped row — a draft, a
      // seeded corpus role — is a first go-live and still bills.
      const quota = transition.billable ? jobPostGate(new Date(), ws) : null;
      if (!quota) {
        setJobStatus(id, "published");
        if (transition.billable) recordMeterUsage("job_posts", 1, new Date(), ws);
      }
      // A reopen is a closed→published transition; remember it so the entries this
      // role's close withdrew are restored explicitly below (not left to sourcing).
      return { already: false, wasClosed: transition.wasClosed, quota };
    })();
    if (gate.quota) return NextResponse.json(gate.quota, { status: 402 });
    const already = gate.already;

    // REOPEN (job-postings-lifecycle #1): reopening a CLOSED role is an explicit,
    // complete inverse of the close — NOT a side effect of re-sourcing. Restore
    // every entry the close withdrew (role_closed → active, at its preserved
    // pre-close stage) and stamp a role_reopened audit event, in one transaction,
    // BEFORE sourcing runs — so the pipeline is made whole even if re-sourcing is a
    // no-op, errors, or the matcher no longer returns a previously-withdrawn
    // candidate. (Was: reopen leaned on sourcing to incidentally un-terminal
    // whatever it re-selected, stranding the rest in role_closed with a lying
    // timeline and no audit.) `ws` here equals the default workspace the close
    // scoped to under the single-tenant lock, so it restores exactly what was closed.
    let reopened = 0;
    if (!already && gate.wasClosed) {
      reopened = reopenEntriesByJobId(id, ws);
    }

    let sourced = 0;
    let skipped = 0;
    // Soft-warning: set when the sourcing step itself errors (Python/CLI failure),
    // so callers can tell "sourced 0 because nobody matched" apart from "sourced 0
    // because sourcing broke". null = sourcing ran cleanly (even if it found nobody).
    let sourcingWarning: string | null = null;
    if (!already) {
      try {
        const reqs = ((job as { requirements?: { skill: string; kind?: string }[] }).requirements ?? []);
        // Single-sourced split (JobsTypes.splitRequirements) so the sourcing
        // must-haves can't diverge from the published posting's must/nice buckets.
        const { mustHaves, niceToHaves } = splitRequirements(reqs);
        const role = {
          title: job.title,
          seniority: job.seniority,
          roleFamily: job.roleFamily,
          languages: job.languages ?? [],
          mustHaves,
          niceToHaves,
          responsibilities: job.description ? [job.description] : [],
        };
        // Thread the request's AbortSignal so abandoning the publish (closing the
        // modal mid-source) SIGKILLs the sourcing child instead of leaving it to
        // run — and keep spending — to the backstop.
        // Same team the entries below are stamped with. This read was unscoped
        // while that write was already correct — the dangerous half: the board
        // filled with rows that looked native but held the DEFAULT team's real
        // candidates (name, id, archetype, score).
        const outcome = await runSourceForRole(role, { signal: request.signal, workspaceId: ws });
        skipped = outcome.skipped;
        for (const m of outcome.candidates) {
          if (!m.candidateId) continue;
          createPipelineEntry({
            candidateId: m.candidateId,
            candidateLabel: m.label,
            archetype: m.archetype,
            roleFamily: job.roleFamily ?? null,
            jobId: id,
            jobTitle: job.title,
            matchScore: m.score,
            stage: "Accepted",
            // The publishing recruiter's team owns the sourced candidates.
            workspaceId: ws,
          });
          sourced += 1;
        }
      } catch (sourcingError) {
        // Sourcing is best-effort — the role still goes live — but DON'T swallow the
        // reason. A broken pipeline that emits 0 candidates looks identical to an
        // empty pool unless we surface why. The warning flows to the draft note.
        sourcingWarning =
          sourcingError instanceof Error ? sourcingError.message : "Sourcing failed for an unknown reason.";
      }
    }

    // fdb45cd0 — the moment a role goes live, raise standing rediscovery alerts:
    // rank the pool against it and persist "a candidate you rejected from Role X
    // clears the bar for this new role" hits to the dismissable feed. Best-effort
    // (raiseRediscoveryAlertsForJob swallows its own failures) and only on the
    // genuine go-live, not idempotent re-publishes. The just-sourced candidates
    // are excluded by rediscoverForJob (they're now active in this role).
    let silverMedalists = 0;
    if (!already) {
      silverMedalists = await raiseRediscoveryAlertsForJob(id, { signal: request.signal, workspaceId: ws });
    }

    // `skipped` = candidates whose payload failed to parse (not low matches), so an empty
    // pipeline after publish can be told apart from a pool that failed to load.
    // `sourcingWarning` (non-null) = the sourcing step errored; the UI shows it instead of
    // a misleading "sourced 0" success.
    return NextResponse.json({ ok: true, status: "published", sourced, skipped, sourcingWarning, silverMedalists, alreadyPublished: already, reopened });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing failed." }, { status: 500 });
  }
}
