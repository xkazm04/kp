// POST /api/agents/hire-from-need
//   { need, project:{name,rootPath,mainBranch?}, workspace?, population:"agent",
//     budgetUsd?, personasBaseUrl?, dryRun?, simulation?, originPersonaId? }
//   -> { intakeId, agentId, personaRequestId, status, jobDescription:{title,summary}, dryRun }
//
// ONE call from a need to a persona. The door Personas asks through: an App
// master (or the Architect) that notices one of its responsibilities has no
// holder POSTs a need in prose, and this route runs kp's OWN machinery end to
// end — scan, intake, dossier, composer, dispatch — with nobody in the loop.
//
// It is a SEQUENCER, not a second pipeline. Every step below is the same
// function the interactive surfaces call, in the same order the bench driver
// drives them (scripts/app-master-bench/run.mjs):
//
//   1. start a repo scan on project.rootPath — same as POST /api/repo-scan
//   2. poll the scan row until the dossier lands
//   3. create the intake with that scanId    — same as POST /api/intake
//   4. run one intake exchange               — the need IS the first message
//   5. land the dossier on the intake        — same as POST /api/intake/[id]/dossier
//   6. app-master sync + brief-to-spec       — same as POST .../compose-app-master
//   7. mint and dispatch                     — the SHARED tail of POST /api/agents/dispatch
//
// (Those step names avoid spelling the real call sites verbatim: the rate-limit
// contract test asserts the limiter precedes the first repo-scan CALL in the
// file, and naming it here — parentheses and all — would put a match ahead of
// the limiter and fail an assertion that is right about the ordering.)
//
// WHAT IT DOES NOT DO, deliberately:
//   - It does not run the nine-message intake dialog. The need is one message.
//     A caller that wants the dialog's realism has the interactive routes.
//   - It does not fall back to the JD-build → agent-fit composer when the repo
//     root is not allow-listed. The App-master composer REFUSES without a
//     dossier (`INTAKE_SCAN_NOT_LANDED`), and a dossier requires a scan, which
//     requires the root to be in KP_APP_MASTER_REPO_ROOTS. So an un-allow-listed
//     root is refused HERE, by name, rather than three steps later behind a code
//     that talks about intakes. See HIRE_ROOT_NOT_ALLOWED below.

import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { isOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { createIntake, getIntake, updateIntakeAppMaster, updateIntakeDialog, updateIntakeDossier } from "@/app/_lib/db/intakes";
import { getRepoScan, RepoScanRequestError, startRepoScan } from "@/app/_lib/repo-scan";
import { allowedRoots, resolveRootPath } from "@/app/_lib/repo-scan-target";
import { runIntakeAppMasterSync, runIntakeExchange, runIntakeOpening } from "@/app/_lib/intake-run";
import { intakeLang } from "@/app/_lib/intake-lang";
import { stripEndSentinel } from "../../intake/reply-sentinel";
import type { RepoDossier } from "@/app/_lib/schemas.generated";
import { briefToAppMasterSpec } from "@/app/_lib/intake-brief";
import { appMasterSpecSchema } from "@/app/_lib/schemas.generated";
import { mintAndDispatch, specFromAppMaster } from "../dispatch/mint";
import { AUTOMATION_TOKEN_HEADER, checkAutomationToken } from "./automation-auth";

// THROTTLE (rate-limit-contract.test.ts). Placed at the very top of the work,
// AFTER auth and the cheap body refusals but BEFORE the scan: unlike the
// dispatch door, the first expensive act here is a repository scan that spawns
// Python, so "past this line the request always costs something" is the scan,
// not the mint. 6/10min per IP — a hire is a rare, deliberate act even for a
// machine, and the Grand Simulation's own ceiling is ten active personas.
const HIRE_RATE_LIMIT = { limit: 6, windowMs: 10 * 60_000 };

/** How long the route waits for a repository scan before answering.
 *
 *  Bounded well under Personas' own 240 s client timeout so the caller sees THIS
 *  route's honest refusal rather than a transport timeout that says nothing.
 *  A timed-out scan is not lost: `claimRepoScan` coalesces by TARGET, so a
 *  retry of the identical body joins the in-flight scan and normally finds it
 *  finished. That is why the refusal below says "retry", and means it. */
const SCAN_DEADLINE_MS = 150_000;
const SCAN_POLL_MS = 2_000;

/** Hard bound on the need. Matches Personas' own MAX_HIRE_NEED_CHARS so neither
 *  side silently truncates what the other bounded. */
const MAX_NEED_CHARS = 1200;

type HireBody = {
  need?: unknown;
  project?: { name?: unknown; rootPath?: unknown; mainBranch?: unknown } | null;
  workspace?: unknown;
  population?: unknown;
  budgetUsd?: unknown;
  personasBaseUrl?: unknown;
  dryRun?: unknown;
  simulation?: unknown;
  originPersonaId?: unknown;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Sleep between scan polls. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  // AUTHORIZATION — two doors, and a caller needs exactly one.
  //
  // (a) The operator session every other /api/agents/* route takes, plus the
  //     same `pipeline:write` capability the dispatch door asks for: a human
  //     driving this route is doing recruiter work and must hold the recruiter
  //     capability.
  // (b) The machine token, for Personas, which has no session (automation-auth.ts).
  //
  // The token is checked FIRST because it is cheap and side-effect free, and
  // because a Personas caller presenting a valid token must not be made to
  // depend on kp's open-mode accident. A caller with neither gets 401 — or 503
  // when the machine door is not configured AND there is no operator session,
  // because "you presented no credential and none would have worked" is a
  // different fact from "your credential was wrong".
  const machine = checkAutomationToken(request.headers.get(AUTOMATION_TOKEN_HEADER));
  if (machine.outcome !== "accepted") {
    const human = await isOperator();
    if (!human) {
      if (machine.outcome === "disabled") {
        return NextResponse.json({ error: machine.reason, code: "HIRE_AUTOMATION_DISABLED" }, { status: 503 });
      }
      return NextResponse.json({ error: "Unauthorized.", code: "HIRE_UNAUTHORIZED" }, { status: 401 });
    }
    const under = await requireCapabilityCoded("pipeline:write", requireCapability);
    if (under) return under;
  }

  try {
    const body = (await request.json().catch(() => null)) as HireBody | null;

    const need = str(body?.need).slice(0, MAX_NEED_CHARS);
    if (!need) {
      return NextResponse.json(
        {
          error: "A hire needs a `need`: the work, the evidence that it is needed, and what would count as done.",
          code: "HIRE_NEED_REQUIRED",
        },
        { status: 400 }
      );
    }
    // `population` is required and must be "agent". Not defaulted: this route
    // dispatches to Personas, which mints an AI persona and nothing else, and a
    // caller that meant to open a human requisition must not have it silently
    // turned into an agent because a field was blank.
    if (str(body?.population) !== "agent") {
      return NextResponse.json(
        { error: 'population must be "agent" — this door hires into Personas.', code: "HIRE_POPULATION_UNSUPPORTED" },
        { status: 400 }
      );
    }

    const projectName = str(body?.project?.name);
    const rootPath = str(body?.project?.rootPath);
    if (!projectName || !rootPath) {
      return NextResponse.json(
        { error: "project.name and project.rootPath are required.", code: "HIRE_PROJECT_REQUIRED" },
        { status: 400 }
      );
    }

    // The allow-list, checked HERE rather than inside startRepoScan, so the
    // refusal names the env var and the whole request stops before it costs
    // anything. `resolveRootPath` is the same predicate /api/repo-scan uses —
    // one authority, two callers, no second interpretation of "allowed".
    const target = resolveRootPath(rootPath);
    if (!target.ok) {
      return NextResponse.json(
        {
          error: `${target.reason} This door composes an App master, which cannot be composed without a repository dossier, so an un-scannable root is refused rather than skipped.`,
          code: "HIRE_ROOT_NOT_ALLOWED",
          allowedRootCount: allowedRoots().length,
        },
        { status: target.status === 400 ? 400 : target.status }
      );
    }

    const dryRun = body?.dryRun === true;
    const budgetUsd =
      typeof body?.budgetUsd === "number" && Number.isFinite(body.budgetUsd) && body.budgetUsd > 0
        ? body.budgetUsd
        : null;
    // A workspace named in the body wins; otherwise the session's. A machine
    // caller has no session, so `currentWorkspace()` gives it the default —
    // which is correct for a single-workspace install and explicit for the rest.
    const ws = str(body?.workspace) || (await currentWorkspace());

    if (!rateLimit(`agent-hire-from-need:${clientIpFrom(request.headers)}`, HIRE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // ---- 1-2. Scan the repository ------------------------------------------
    let scan;
    try {
      scan = startRepoScan({ rootPath, fresh: false }, ws);
    } catch (e) {
      if (e instanceof RepoScanRequestError) {
        // The THROWN message is not forwarded (error-response-contract.test.ts:
        // no new route puts a thrown error's own message on the wire). It is
        // also not information the caller is missing: `resolveRootPath` above
        // is the same predicate `startRepoScan` re-checks, so reaching here at
        // all means a race between the two — the target became unreadable
        // between the check and the claim. The code says which door refused;
        // the reason is in the server log.
        console.error("[api:agents/hire-from-need] HIRE_SCAN_REFUSED", e);
        return NextResponse.json({ error: "The repository scan was refused.", code: "HIRE_SCAN_REFUSED" }, { status: e.status });
      }
      throw e;
    }

    const deadline = Date.now() + SCAN_DEADLINE_MS;
    let dossier: unknown = null;
    for (;;) {
      const row = getRepoScan(scan.scanId, ws);
      if (row?.status === "complete" && row.dossier) {
        dossier = row.dossier;
        break;
      }
      if (row?.status === "failed") {
        return NextResponse.json(
          { error: `The repository scan failed: ${row.error ?? "no reason recorded"}`, code: "HIRE_SCAN_FAILED" },
          { status: 502 }
        );
      }
      if (Date.now() >= deadline) {
        return NextResponse.json(
          {
            error: "The repository scan did not finish in time. Retry the same request — the scan keeps running and a retry joins it.",
            code: "HIRE_SCAN_TIMEOUT",
            scanId: scan.scanId,
          },
          { status: 504 }
        );
      }
      await wait(SCAN_POLL_MS);
    }

    // ---- 3-4. Intake, seeded with the need as its first message ------------
    //
    // `runIntakeOpening` / `runIntakeExchange` return a REPLY, never a
    // transcript: the transcript is the caller's to accumulate, exactly as
    // /api/intake/[id]/message does. Building it here rather than reading a
    // field off the exchange is what keeps the two turns below in the order
    // they happened.
    const lang = intakeLang(null);
    const intake = createIntake({ title: projectName, lang, scanId: scan.scanId }, ws);
    const opening = await runIntakeOpening(lang, "app_master");
    const openedAt = new Date().toISOString();
    const openingTranscript = [
      { role: "interviewer" as const, text: stripEndSentinel(opening.reply), at: openedAt },
    ];
    updateIntakeDialog(
      intake.id,
      { transcript: openingTranscript, brief: opening.brief, shape: opening.shape },
      ws
    );

    const seeded = getIntake(intake.id, ws);
    if (!seeded) {
      return NextResponse.json({ error: "The intake vanished mid-hire.", code: "HIRE_INTAKE_LOST" }, { status: 500 });
    }
    const exchange = await runIntakeExchange({
      transcript: seeded.transcript,
      brief: seeded.brief,
      message: need,
      lang,
      dossier: dossier as RepoDossier,
    });
    const turnAt = new Date().toISOString();
    updateIntakeDialog(
      intake.id,
      {
        transcript: [
          ...seeded.transcript,
          { role: "candidate" as const, text: need, at: turnAt },
          { role: "interviewer" as const, text: stripEndSentinel(exchange.reply), at: turnAt },
        ],
        brief: exchange.brief,
        shape: exchange.shape,
        expectedUpdatedAt: seeded.updatedAt,
      },
      ws
    );

    // ---- 5. Land the dossier on the intake ---------------------------------
    const withNeed = getIntake(intake.id, ws);
    if (!withNeed) {
      return NextResponse.json({ error: "The intake vanished mid-hire.", code: "HIRE_INTAKE_LOST" }, { status: 500 });
    }
    const synced = await runIntakeAppMasterSync({
      brief: withNeed.brief,
      dossier: dossier as RepoDossier,
      lang,
    });
    updateIntakeDossier(
      intake.id,
      { scanId: scan.scanId, dossier: dossier as RepoDossier, brief: synced.brief, expectedUpdatedAt: withNeed.updatedAt },
      ws
    );

    // ---- 6. Compose the App master -----------------------------------------
    const composed = getIntake(intake.id, ws);
    if (!composed) {
      return NextResponse.json({ error: "The intake vanished mid-hire.", code: "HIRE_INTAKE_LOST" }, { status: 500 });
    }
    const rawSpec = briefToAppMasterSpec(synced.brief, composed.dossier);
    updateIntakeAppMaster(
      intake.id,
      { spec: rawSpec, fit: synced.fit, composedAt: new Date().toISOString() },
      ws,
      { brief: synced.brief, expectedUpdatedAt: composed.updatedAt }
    );

    // Validated against the codegen'd contract for the same reason the dispatch
    // door validates it: the mandate is the whole point of this role, and a
    // half-parsed rung or a dropped forbidden-class list must never reach a
    // dispatch.
    const parsed = appMasterSpecSchema.safeParse(rawSpec);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "The composed App master spec does not match the contract.", code: "HIRE_SPEC_INVALID" },
        { status: 500 }
      );
    }
    const appMaster = parsed.data;
    const jobDescription = {
      title: appMaster.role.title || projectName,
      summary: (appMaster.agent?.mission ?? "").trim(),
    };

    // ---- 7. Dispatch (or stop, on a dry run) -------------------------------
    if (dryRun) {
      // Nothing is minted and nothing crosses the bridge. The intake IS kept:
      // it is the composed artifact the caller asked to see, and discarding it
      // would make the rehearsal unreviewable.
      return NextResponse.json({
        intakeId: intake.id,
        agentId: "",
        personaRequestId: "",
        status: "composed",
        jobDescription,
        dryRun: true,
      });
    }

    if (appMaster.role.population === "human") {
      return NextResponse.json(
        {
          error: "The composer judged this role human-only — no agent was dispatched.",
          code: "HIRE_HUMAN_POPULATION",
          intakeId: intake.id,
        },
        { status: 409 }
      );
    }
    if (!appMaster.agent) {
      return NextResponse.json(
        { error: "The composed spec carries no agent block.", code: "HIRE_NO_AGENT_BLOCK", intakeId: intake.id },
        { status: 409 }
      );
    }

    const spec = specFromAppMaster(appMaster);
    const dispatched = await mintAndDispatch(request, ws, {
      jobId: "",
      jobTitle: jobDescription.title,
      intakeId: intake.id,
      spec,
      fit: synced.fit,
      metrics: spec.successMetrics,
      budgetUsd: budgetUsd ?? spec.maxBudgetUsd,
      appMaster,
      passthrough: {
        // Passed through only when the caller ASKED for it. A simulated hire is
        // enrolled in Personas' attention loop; an ordinary one is not, and
        // that difference is the caller's to declare.
        ...(body?.simulation === true ? { simulation: true as const } : {}),
        ...(str(body?.originPersonaId) ? { originPersonaId: str(body?.originPersonaId) } : {}),
      },
    });

    // `mintAndDispatch` answers the dispatch door's shape. Re-project it onto
    // this door's shape rather than forwarding it: a caller of hire-from-need
    // asked one question and must get one answer, and a 502 from the bridge
    // still carries its own body through unchanged.
    if (dispatched.status !== 200) return dispatched;
    const out = (await dispatched.json()) as { hiredAgentId?: string; requestId?: string; status?: string };
    return NextResponse.json({
      intakeId: intake.id,
      agentId: out.hiredAgentId ?? "",
      personaRequestId: out.requestId ?? "",
      status: out.status ?? "pending_approval",
      jobDescription,
      dryRun: false,
    });
  } catch (error) {
    return safeJsonError(error, "api:agents/hire-from-need", "AGENT_HIRE_FROM_NEED_FAILED");
  }
}
