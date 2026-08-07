import type { Page } from "@playwright/test";

/** The origin the suite runs against. Mirrors playwright.config.ts: the
 *  KP_E2E_BASE_URL override (prod build / remote target, no managed webServer)
 *  or the default dev server on :3101. Exported so specs that open extra
 *  browser contexts (e.g. an unauthenticated candidate context) resolve links
 *  against the same origin the recruiter context used. */
export const E2E_BASE_URL = process.env.KP_E2E_BASE_URL ?? "http://localhost:3101";

/*
 * '/' is server-gated (M8, app/page.tsx): a visitor who has not "entered the
 * workspace" gets the public landing instead of the dashboard, so every journey
 * that starts at '/?tab=…' must open the gate BEFORE the first document loads.
 * In OPEN mode (no KP_OPERATOR_PASSWORD — the e2e default) the gate reads the
 * plain `kp_entered` marker cookie (ENTERED_COOKIE in app/_lib/auth/session.ts;
 * not a security token — the signed session is). The name/value are deliberately
 * duplicated here — same lockstep rule as the pre-paint theme bootstrap regex in
 * app/layout.tsx, which tests `kp_entered=1` literally.
 *
 * (Until M8 this seeded the old HomeGate localStorage flag `kp_dev_authed`; that
 * gate was deleted with devAuth.ts, which is why the suite rotted unnoticed —
 * the landing swallowed every workspace locator.)
 *
 * SECOND gate (first-run onboarding, app/_lib/auth/onboarding-gate.ts): on a
 * FRESH database the '/' route overlays the setup wizard (needsOnboarding()
 * reads workspaces.onboarding_state, which starts NULL), and its fixed
 * full-screen backdrop swallows every click the deterministic specs make. Stamp
 * the workspace "skipped" once per test — idempotent ("completed" always wins
 * server-side, so a developer DB is never downgraded), a no-op after the first
 * call, and it keeps the whole keyless subset green against an empty seed DB.
 * Specs that WANT the wizard use the `/?onboarding=1` single-load escape hatch,
 * which fires regardless of the stamp (see journey-role-to-schedule.spec.ts).
 */
export async function seedDevAuth(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "kp_entered",
      value: "1",
      url: E2E_BASE_URL
    }
  ]);
  // Best-effort: open mode stamps the default workspace; password-mode deploys
  // would 401 here, and any failure just means the wizard may appear as it
  // would for a real first run.
  await page.request
    .post(`${E2E_BASE_URL}/api/me/onboarding`, { data: { status: "skipped" } })
    .catch(() => undefined);
}
