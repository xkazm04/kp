import { NextResponse, type NextRequest } from "next/server";
import { renameWorkspace, setWorkspaceReviewContact } from "@/app/_lib/db/workspaces";
import { requireWorkspaceCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { withSession } from "@/app/_lib/auth/workspace-context";

// Rename a team (P2). `team:manage` ON THE TARGET workspace — which an org-wide
// admin holds over every team in their org, and nobody holds over another org's
// (requireWorkspaceCapability answers 404 there, so a cross-org probe learns
// nothing). Renaming is the only workspace field the console edits; deletion is
// deliberately absent (a team's data outlives the label).
export const PATCH = withSession(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await context.params;
    const denied = await requireWorkspaceCapability(id, "team:manage");
    if (denied) return denied;
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; reviewContactEmail?: unknown };
    // The review-contact address (owner ruling Q7) rides the same door and the same
    // team:manage gate. A string sets it, an empty string clears it; validated in the store.
    const hasContact = typeof body.reviewContactEmail === "string";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name && !hasContact) return NextResponse.json({ error: "A workspace name is required." }, { status: 400 });
    let workspace = null;
    // Contact first: it is the only write that can be refused for its content, and a
    // refusal must not leave a half-applied rename behind.
    if (hasContact) {
      const result = setWorkspaceReviewContact(id, body.reviewContactEmail as string);
      if (!result.ok) {
        return result.reason === "invalid"
          ? jsonRefusal("REVIEW_CONTACT_EMAIL_INVALID", 400)
          : NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      workspace = result.workspace;
    }
    if (name) {
      workspace = renameWorkspace(id, name);
      if (!workspace) return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ workspace });
  } catch (error) {
    return safeJsonError(error, "api:workspaces/[id]", "WORKSPACE_RENAME_FAILED");
  }
});
