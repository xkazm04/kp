import { NextResponse } from "next/server";
import { verifySkillProfileToken } from "@/app/_lib/db/skill-profiles";
import { jsonError, jsonRefusal } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";


// Durable Skill Profile (moonshot A) — the public verification lookup. A third
// party (or a candidate's embedded badge) confirms a presented token is a genuine,
// non-revoked, untampered kp-issued credential and reads its headline summary.
// This is the "FICO lookup" trust model: kp vouches via this endpoint.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    // bug-ui-scan-2026-07-09 (skill-matrix-coverage #2): this endpoint is a public,
    // unauthenticated existence-and-data oracle — a hit dumps the full summary, a miss
    // 404s. Throttle per client IP so the token space can't be walked to enumerate
    // valid credentials / harvest scores in bulk. Tokens are 192-bit CSPRNG (sibling
    // #1 fix) so brute force is already infeasible; this is the defense-in-depth cap
    // that makes guessing uneconomical regardless. Same shared limiter / 429 refusal
    // envelope as the other public token surfaces (offer, schedule, interview-connect).
    if (!rateLimit(`skill-verify:${clientIpFrom(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const { token } = await params;
    const v = verifySkillProfileToken(token);
    // Uniform response for BOTH a miss AND a found-but-invalid (tampered / revoked)
    // credential: a guessed token that exists-but-fails looks identical to one that
    // was never issued, so this public endpoint stops being an existence oracle. Only
    // a genuinely valid credential returns its summary. (This narrows the response
    // SHAPE; the missing rate-limit is a separate finding, left untouched here.)
    if (!v.found || !v.profile || !v.valid) {
      return NextResponse.json({ found: false, valid: false }, { status: 404 });
    }
    return NextResponse.json({
      found: true,
      valid: v.valid,
      revoked: v.revoked,
      // The signature attests integrity, not substance — a consumer should require
      // valid AND substantive before showing a trusted verdict (no green over a 0).
      substantive: v.substantive,
      summary: {
        version: v.profile.version,
        transferScore: Math.round(v.profile.transferScore),
        confidence: v.profile.confidence,
        issuedAt: v.profile.issuedAt,
        axes: v.profile.axes,
      },
    });
  } catch (error) {
    return jsonError(error, "Failed to verify the skill profile.");
  }
}
