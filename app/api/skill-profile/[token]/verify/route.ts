import { NextResponse } from "next/server";
import { verifySkillProfileToken } from "@/app/_lib/db";
import { jsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Durable Skill Profile (moonshot A) — the public verification lookup. A third
// party (or a candidate's embedded badge) confirms a presented token is a genuine,
// non-revoked, untampered kp-issued credential and reads its headline summary.
// This is the "FICO lookup" trust model: kp vouches via this endpoint.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const v = verifySkillProfileToken(token);
    if (!v.found || !v.profile) {
      return NextResponse.json({ found: false, valid: false }, { status: 404 });
    }
    return NextResponse.json({
      found: true,
      valid: v.valid,
      revoked: v.revoked,
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
