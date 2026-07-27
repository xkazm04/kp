import type { Page } from "@playwright/test";

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
 */
export async function seedDevAuth(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "kp_entered",
      value: "1",
      url: "http://localhost:3101"
    }
  ]);
}
