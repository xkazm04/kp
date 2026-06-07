// Deterministic coverage for the shared Modal's keyboard-dismiss contract
// (app/_components/Modal.tsx). The dialog's key handler lives on `document`, not
// the dialog node, so Escape must close the modal regardless of where focus
// sits — including the failure mode this guards against: focus resting on
// <body> after a render with no focusable child to receive it. A node-bound
// listener never fired in that state, silently trapping keyboard-only users.
//
// We drive the Decision-rules modal: it opens from a button that's always in the
// Decisions header (no LLM key, no seeded data needed), so the whole file is
// deterministic and runs without GEMINI_API_KEY — unlike analyze-smoke.spec.ts.
import { expect, test, type Page } from "@playwright/test";

// Open the Decision-rules modal. The Decisions tab is a client component, so the
// "Rules" button can paint a tick before React wires its onClick (the same
// dev-hydration gap profile-builder.spec.ts works around). Retry the open until
// the dialog appears, then return it.
async function openRulesModal(page: Page) {
  await page.goto("/?tab=decisions");
  const openBtn = page.getByRole("button", { name: "Rules" });
  const dialog = page.getByRole("dialog");
  await expect(openBtn).toBeVisible();
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await openBtn.click().catch(() => undefined);
    }
    await expect(dialog).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  return dialog;
}

test.describe("Modal — Escape closes regardless of focus", () => {
  test("Escape closes the modal when focus has left the dialog (focus on <body>)", async ({ page }) => {
    const dialog = await openRulesModal(page);

    // Reproduce the trap: drop focus out of the dialog onto <body>, exactly the
    // state a no-focusable-child render would leave behind.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

    // With the old node-bound listener this keypress reached nothing and the
    // dialog stayed open. The document-level handler must still close it.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("Escape closes the modal from its initial auto-focused control", async ({ page }) => {
    const dialog = await openRulesModal(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("backdrop click still closes the modal (existing dismissal preserved)", async ({ page }) => {
    const dialog = await openRulesModal(page);
    // The full-bleed backdrop is the first "Close"-labelled control behind the
    // dialog; click its top-left corner, clear of the centered panel.
    await page.getByRole("button", { name: "Close" }).first().click({ position: { x: 5, y: 5 } });
    await expect(dialog).toBeHidden();
  });
});
