import type { Page } from "@playwright/test";

/*
 * '/' is gated by HomeGate on the dev-only localStorage sign-in flag
 * (app/_lib/auth/devAuth.ts): a fresh browser context is "signed out" and gets
 * the public landing instead of the workspace, so every journey that starts at
 * '/?tab=…' must seed the flag BEFORE the first document loads. The key string
 * is deliberately duplicated here — same lockstep rule as the pre-paint theme
 * bootstrap in app/layout.tsx (see the DEV_AUTH_KEY comment in devAuth.ts).
 */
export async function seedDevAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("kp_dev_authed", "1");
    } catch {
      /* disabled storage — the gate will just show the landing */
    }
  });
}
