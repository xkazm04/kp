import { NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { isOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { isEntityKind, isPreviewableTab, resolveEntityPreview, resolveTabPreview } from "@/app/_lib/palette-preview";

// SHELL1 — the command palette's preview pane: the few live facts about the
// highlighted destination (a workspace tab: ?tab=billing) or entity (a search
// hit: ?type=profile&id=…), computed by app/_lib/palette-preview from cheap
// tenant-scoped reads. Read-only. Unknown targets answer { view: "missing" } —
// a 200, because the pane simply has nothing to say, not an error to surface.
// Operator-only tabs (billing, models, integrations, organization, workspaces)
// resolve to { view: "restricted" } for a demo session — same carve-out
// requireOperator applies to the pages themselves.
const MAX_ID_LENGTH = 128;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get("tab");
    const type = searchParams.get("type");
    const id = (searchParams.get("id") ?? "").slice(0, MAX_ID_LENGTH);
    const ws = await currentWorkspace();
    if (tab) {
      if (!isPreviewableTab(tab)) return NextResponse.json({ preview: { view: "missing" } });
      return NextResponse.json({ preview: await resolveTabPreview(tab, ws, await isOperator()) });
    }
    if (type && id && isEntityKind(type)) {
      return NextResponse.json({ preview: resolveEntityPreview(type, id, ws) });
    }
    return NextResponse.json({ preview: { view: "missing" } });
  } catch (error) {
    return safeJsonError(error, "api:palette/preview", "SEARCH_FAILED");
  }
}
