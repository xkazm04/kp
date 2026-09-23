import { NextResponse } from "next/server";
import { jsonOk, jsonRefusal } from "@/app/_lib/api-response";
import { currentSession } from "@/app/_lib/auth/current-user";
import { glyphArt } from "@/app/_components/glyph/glyphCatalog";

// GET /api/glyphs/[id] — the traced /motionize art for one empty-state glyph.
//
// Why a route: the art is ~274 KB of emitted path data across 13 generated modules
// (app/_components/glyph/glyphs/), and importing it from the empty states put all of
// it on the workspace page's import graph. It is served from here by id instead and
// fetched by app/_components/glyph/glyphLoader.ts only when an empty state renders.
//
// Auth posture: GATED, deliberately not on the public allow-list. Every surface that
// renders a glyph — the ?tab= workspace and /me — is behind a session, so the art
// never 401s for a page that shows it. The handler re-checks the same thing the
// proxy gate checks (open mode, or ANY verified session) rather than
// requireOperator(): a demo-workspace session is not an operator but IS shown the
// workspace and its empty states, and a decorative drawing is not a reason to split
// the demo from what it demonstrates. The body is static art — no tenant data, no
// store read, nothing spent — so there is nothing to scope or rate-limit.
//
// Cache: private (it sits behind a session) and long-lived; the art only changes
// when /motionize regenerates a module, which ships with a new deploy.
const CACHE_CONTROL = "private, max-age=86400";

async function hasSession(): Promise<boolean> {
  if (!process.env.KP_OPERATOR_PASSWORD) return true; // open mode, as proxy.ts
  return (await currentSession()) !== null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const art = glyphArt(id);
  if (!art) return jsonRefusal("GLYPH_UNKNOWN", 404);
  const res = jsonOk(art);
  res.headers.set("Cache-Control", CACHE_CONTROL);
  return res;
}
