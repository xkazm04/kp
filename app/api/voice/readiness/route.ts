import { NextResponse } from "next/server";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { can, requireCapability } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireHomeOrgReader } from "@/app/_lib/auth/require-operator";
import { countInterviewFailovers } from "@/app/_lib/db/interviews";
import { isOffline } from "@/app/_lib/offline";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { getVoiceAdapter } from "@/app/_lib/voice";
import { VOICE_PROVIDER_ORDER } from "@/app/_lib/voice/types";
import {
  buildVoiceReadiness,
  probeVoiceProviders,
  sharedProbeMemory,
  type ReadinessAdapters,
} from "@/app/_lib/voice/readiness";

// Operator readiness for the realtime voice plane (challenge-r09 voice-provider-io/B):
// the Spend strip's voice rows (SpendVoiceFacts.tsx). See app/_lib/voice/readiness.ts
// for the four states and what a probe is.
//
// AUTH: requireHomeOrgReader, like /api/ops — the verdicts describe the DEPLOYMENT's
// provider credentials, so a member of another org on a shared box has no business
// reading them (it answers 401 with no session, a coded 403 deployment:read to a
// foreign org). The probe additionally asks pipeline:write: it is the same mint a
// recruiter's interview link performs, so a read-only seat may look but not spend.
// Not on public-routes.ts.
//
// GET never mints: env, prices, preference, this workspace's failover counts, and the
// verdicts a POST remembered. POST mints one short-lived credential per configured
// provider and opens no conversation. Whether a provider meters an unused mint is not
// verifiable here, so the probe is operator-triggered only and limited per IP; it is
// refused outright under KP_OFFLINE. The response is a projection: no minted credential
// field ever reaches it (readiness.ts drops them where they are minted).

const FAILOVER_WINDOW_MS = 7 * 24 * 60 * 60_000;

function adapters(): ReadinessAdapters {
  return Object.fromEntries(VOICE_PROVIDER_ORDER.map((id) => [id, getVoiceAdapter(id)])) as ReadinessAdapters;
}

async function failovers() {
  return countInterviewFailovers(await currentWorkspace(), new Date(Date.now() - FAILOVER_WINDOW_MS).toISOString());
}

export async function GET() {
  const denied = await requireHomeOrgReader();
  if (denied) return denied;
  try {
    const report = buildVoiceReadiness({ adapters: adapters(), memory: sharedProbeMemory(), failovers: await failovers() });
    // The strip offers "Check now" only to a seat the POST below would admit, so the
    // button never leads to a 403 (and never at all while offline).
    return NextResponse.json({ ...report, canProbe: await can("pipeline:write") });
  } catch (err) {
    return safeJsonError(err, "api:voice/readiness", "VOICE_READINESS_FAILED");
  }
}

export async function POST(request: Request) {
  const denied = await requireHomeOrgReader();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  // KP_OFFLINE: a hosted provider cannot be reached, and a probe of the self-hosted one
  // alone would still read as a verdict on the whole plane. Refused before the budget.
  if (isOffline()) return jsonRefusal("VOICE_READINESS_OFFLINE", 503);
  // Per IP, 6 per 10 minutes: each probe mints up to one credential per paid provider.
  if (!rateLimit(`voice-readiness:${clientIpFrom(request.headers)}`, { limit: 6, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const report = await probeVoiceProviders({ adapters: adapters(), memory: sharedProbeMemory(), failovers: await failovers() });
    return NextResponse.json({ ...report, canProbe: true });
  } catch (err) {
    return safeJsonError(err, "api:voice/readiness", "VOICE_READINESS_FAILED");
  }
}
