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
import { seedDevAuth } from "./dev-auth";

// The workspace only renders at '/' for a dev-signed-in visitor (HomeGate);
// seed the flag before each test or the landing swallows every locator.
test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

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

  test("Escape closes from the auto-focused control, and focus returns to the trigger", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "Rules", exact: true });
    const dialog = await openRulesModal(page);

    // Opening must move focus INTO the dialog (useDialogA11y focuses the first
    // focusable, else the container). Without this the "from its auto-focused
    // control" half of the name is unproven — the document-level key handler
    // would answer the keypress from anywhere.
    await expect
      .poll(() => page.evaluate(() => !!document.querySelector('[role="dialog"]')?.contains(document.activeElement)))
      .toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // …and closing RESTORES focus to the control that opened it (the unmount
    // cleanup in useDialogA11y). Asserting only that the dialog went away lets a
    // dropped restore ship green: the keyboard user is silently returned to
    // <body> and their next Tab starts over at the top of the page.
    await expect(trigger).toBeFocused();
  });

  test("backdrop click still closes the modal (existing dismissal preserved)", async ({ page }) => {
    const dialog = await openRulesModal(page);
    // The scrim is the dialog's immediately preceding sibling: a full-bleed
    // aria-hidden <div> carrying onClick={onClose} (Modal.tsx). It USED to be a
    // <button aria-label="Close">, and this test still looked it up that way —
    // which now resolves to the header X instead, so backdrop dismissal could be
    // deleted outright and this test would keep passing by clicking the X.
    const scrim = dialog.locator("xpath=preceding-sibling::div[1]");
    await expect(scrim).toHaveAttribute("aria-hidden", "true");
    // Top-left corner: full-bleed, so clear of the centered panel.
    await scrim.click({ position: { x: 5, y: 5 } });
    await expect(dialog).toBeHidden();
  });
});
