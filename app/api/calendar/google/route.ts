import { NextResponse } from "next/server";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { googleOAuthConfig, revokeToken } from "@/app/_lib/calendar/google-oauth";
import { deleteCalendarConnection, getCalendarConnection, getRefreshToken } from "@/app/_lib/calendar/token-store";
import { requireOperator } from "@/app/_lib/auth/require-operator";

// W1.4 — connection status and disconnect. The token never crosses this boundary; the
// status payload carries only whether a connection exists, which calendar, and whether
// the grant was partial.

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  const base = publicBaseUrl(null);
  const configured = googleOAuthConfig(base) !== null;
  return NextResponse.json({
    configured,
    connection: getCalendarConnection(await currentWorkspace()),
    // Surfaced so the operator can copy it straight into the Google Cloud console instead
    // of guessing the exact string Google will demand an exact match on.
    redirectUriToRegister: `${base.replace(/\/+$/, "")}/api/calendar/google/callback`,
  });
}

export async function DELETE() {
  const denied = await requireOperator();
  if (denied) return denied;
  const workspaceId = await currentWorkspace();
  // Revoke at Google FIRST. Deleting our row without revoking leaves a live grant that
  // nobody can see in kp and nobody can withdraw from kp — the user would have to hunt it
  // down in their Google account security settings.
  // The token is ciphertext at rest, and decryption THROWS when the at-rest key changed
  // under it (a KP_SECRET rotation, or KP_ATS_SECRET_KEY set later to decouple the two).
  // That must not 500 the disconnect: this is the button that CLEARS a connection kp can
  // no longer use, so failing it would trap the operator with a row they cannot delete
  // and a grant they were never told to withdraw. Unreadable ⇒ no revoke, said out loud
  // (`revokedAtGoogle: false` renders as "disconnected, but go withdraw it at Google").
  let refresh: string | null = null;
  try {
    refresh = getRefreshToken(workspaceId);
  } catch (err) {
    console.error("[api/calendar/google] the stored refresh token could not be read; disconnecting locally only", err);
  }
  const revoked = refresh ? await revokeToken(refresh) : false;
  const removed = deleteCalendarConnection(workspaceId);
  // Report both outcomes separately: a failed revoke with a successful delete is exactly
  // the case where the operator needs to know to go revoke it at Google themselves.
  return NextResponse.json({ ok: removed, revokedAtGoogle: revoked });
}
