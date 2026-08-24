import { NextResponse } from "next/server";
import {
  birthCompanionBrain,
  companionBrainStatus,
  probeCompanionBrain,
  recordCompanionBrainConsent,
} from "@/app/_lib/companion-brain";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// The companion's MEMORY CONSENT door (docs/features/companion/README.md, WP4).
//
// Candi's memory is a tree of markdown files in the operator's own home
// directory, shared with Personas' Athena. kp is not entitled to create it,
// adopt it, or write to it until the operator has said yes — so first-run
// onboarding asks, and this is the route it asks through.
//
// GET  — what is on disk (`companion_cli --probe`, which CREATES NOTHING) plus
//        the two workspace facts the wizard branches on: whether consent was
//        recorded, and whether memory is on for this tenant at all. A GET that
//        birthed the tree would have answered the question it was sent to ask.
// POST — {action: "connect" | "birth"}. `connect` adopts a brain that already
//        exists and MODIFIES NOTHING about it; `birth` runs `ensure_brain`,
//        which is idempotent and never overwrites a constitution or an identity
//        the operator (or Athena) already wrote.
//
// There is deliberately NO "decline" action. Skipping stamps nothing: a null
// column and an explicit refusal behave identically (the dock runs memoryless),
// so inventing the distinction would only mean claiming to know which one a
// pre-existing row was.
//
// Operator-gated like the rest of /api/companion, and workspace-scoped: consent
// is a tenant fact even though the tree it consents to is machine-wide.

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    return NextResponse.json(companionBrainStatus(await probeCompanionBrain(), ws));
  } catch (error) {
    return safeJsonError(error, "api:companion/brain", "COMPANION_BRAIN_FAILED");
  }
}

export async function POST(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    const action = body.action;
    if (action !== "connect" && action !== "birth") {
      return NextResponse.json({ error: "action must be 'connect' or 'birth'" }, { status: 400 });
    }
    // Spawn protection, not spend protection — no model is called here. Runs
    // AFTER the cheap 400 so a malformed call never starts a process, and before
    // the spawn itself. Far above human pace: this is answered once at first run.
    if (!rateLimit(`companion-brain:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const ws = await currentWorkspace();
    // The disk is re-read HERE rather than trusted from the GET the wizard made
    // minutes ago: a proposal-time check is a claim and an execution-time check
    // is the guarantee (the same reasoning the resolve route documents). Birth
    // runs first so consent is only ever stamped over a brain that exists.
    const probe = action === "birth" ? await birthCompanionBrain() : await probeCompanionBrain();
    if (!probe.present) return jsonRefusal("COMPANION_BRAIN_ABSENT", 409);
    recordCompanionBrainConsent(action, ws);
    return NextResponse.json(companionBrainStatus(probe, ws));
  } catch (error) {
    return safeJsonError(error, "api:companion/brain", "COMPANION_BRAIN_FAILED");
  }
}
