import { NextRequest, NextResponse } from "next/server";
import { getBrand, saveBrand } from "@/app/_lib/brand-store";
import { requireOperator } from "@/app/_lib/auth/require-operator";

// White-label brand config (E3, docs/ENTERPRISE_READINESS.md §4).
//   GET  — the effective brand (name/accent/logo). Public-readable: the nav and the
//          candidate-facing surfaces render it and it carries no secrets.
//   PUT  — operator-only; validates (app/_lib/brand-config.ts) then persists.

export async function GET() {
  try {
    return NextResponse.json(getBrand());
  } catch (error) {
    console.error("[api/brand] read failed", error);
    return NextResponse.json({ error: "Failed to load branding." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as unknown;
  try {
    // saveBrand sanitizes every field, so a bad color/URL is dropped (stored null)
    // rather than rejected — the editor shows the effective result and can't wedge
    // a broken value into the injected <style>.
    return NextResponse.json(saveBrand(body));
  } catch (error) {
    console.error("[api/brand] save failed", error);
    return NextResponse.json({ error: "Failed to save branding." }, { status: 500 });
  }
}
