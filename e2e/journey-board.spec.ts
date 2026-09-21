// The Journeys board — the surface this spec exists for is the one thing no unit
// test reaches: whether the thing actually RENDERS against the real corpus.
//
// It was written because the board shipped typecheck-green, lint-green and
// unit-green, and then threw on first open:
//
//   FORMATTING_ERROR: The intl string context variable "kind" was not provided
//   to the string "An event of kind {kind} was recorded"
//
// Every row whose kind render-keys.ts has no word for failed to format, and kp
// writes at least 11 such kinds (interview_scorecard, intake_degraded, rematched,
// outreach_sent, group_eval, …). A unit test now pins the key/argument pairing
// (useJourneySentence.test.ts); this pins the property that failure violated —
// the board renders the REAL ledger with no page error at all. A formatting
// error surfaces as a console error and an error boundary, neither of which a
// 200 from the server would have shown.
//
// Deterministic and keyless: /api/journeys reads the SQLite tables and never
// spawns an LLM or an HTTP call, exactly like /api/analytics.
import { expect, test, type Page } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";

/** Every console error and every uncaught page error, collected for the whole test. */
function collectFailures(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") seen.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => seen.push(`pageerror: ${err.message}`));
  return seen;
}

const board = (page: Page) => page.getByRole("dialog", { name: /journeys/i });

// The board is a desktop surface: dozens of columns beside a rail. The default
// Desktop Chrome viewport (1280x720) is narrow enough that the shell renders both
// the rail and the mobile drawer, so a bare name match can land on the drawer's
// hidden twin. Pin a real desk width and scope clicks to what is actually on screen.
test.use({ viewport: { width: 1600, height: 1000 } });

/** The VISIBLE nav item with this name — never the mobile drawer's hidden copy. */
const navItem = (page: Page, name: RegExp) =>
  page.getByRole("button", { name }).filter({ visible: true }).first();

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

test.describe("Journeys — the board opens over the workspace and renders the ledger", () => {
  test("?tab=journeys opens the overlay, and the URL is an inbox", async ({ page }) => {
    await page.goto("/?tab=journeys");

    // A dialog, not a panel: the board is a full-viewport overlay ABOVE the
    // workspace, so the surface must announce itself as one or a screen reader
    // gets the page behind it as well.
    await expect(board(page)).toBeVisible();
    await expect(board(page)).toHaveAttribute("aria-modal", "true");

    // The same ?tab= contract every other tab keeps: consumed on arrival and
    // cleared, so a second link to the same tab still does something.
    await expect(page).toHaveURL(/^[^?]*\/?$/);
  });

  test("the board renders the real corpus with NO page error", async ({ page }) => {
    const failures = collectFailures(page);
    await page.goto("/?tab=journeys");
    await expect(board(page)).toBeVisible();

    // Wait for real rows rather than a fixed timeout: the board fetches
    // /api/journeys client-side, so "visible" precedes "populated".
    const rows = board(page).getByRole("button").filter({ hasText: /\S/ });
    await expect.poll(async () => await rows.count(), { timeout: 15_000 }).toBeGreaterThan(0);

    // THE REGRESSION. A missing ICU argument throws at format time, which React
    // surfaces as a page error; it does not merely render an ugly string.
    expect(failures.filter((f) => /FORMATTING_ERROR|intl string context/i.test(f))).toEqual([]);
    expect(failures).toEqual([]);
  });

  test("a row's sentence is prose, never a raw key path or a naked kind", async ({ page }) => {
    await page.goto("/?tab=journeys");
    await expect(board(page)).toBeVisible();
    const rows = board(page).getByRole("button").filter({ hasText: /\S/ });
    await expect.poll(async () => await rows.count(), { timeout: 15_000 }).toBeGreaterThan(0);

    const texts = await rows.allInnerTexts();
    const joined = texts.join("\n");
    // next-intl renders the KEY PATH when a message is missing — the failure mode
    // that looks like content and is not.
    expect(joined).not.toMatch(/journey\.(events|topics|absence)\./);
    // An unmapped kind is legitimate and renders through events.unknown, which
    // NAMES the kind in a sentence. What must never appear is the bare snake_case
    // token standing alone as if it were a label.
    expect(joined).not.toMatch(/^\s*[a-z]+_[a-z_]+\s*$/m);
  });

  test("Escape closes the board and returns to the tab behind it", async ({ page }) => {
    // The board is the only overlay-surfaced tab, so closing it must restore the
    // tab the reader came FROM rather than leave them on an empty content frame.
    //
    // Driven through the rail, not through a second page.goto: a fresh navigation
    // is a fresh page, and "the tab behind it" is in-memory state that a reload
    // legitimately does not have. Deep-linking straight to the board and closing
    // it lands on the default tab, which is correct and is the case below.
    await page.goto("/?tab=analytics");
    const sections = page.getByRole("radiogroup", { name: /analytics section/i });
    await expect(sections).toBeVisible();

    // Analytics already sits in the Insights section, so its sibling items are on
    // screen: click Journeys directly rather than re-opening the section first.
    await navItem(page, /^journeys$/i).click();
    await expect(board(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(board(page)).toBeHidden();
    // Back on the tab that was behind it, with its content — not a blank frame.
    await expect(sections).toBeVisible();
  });

  test("closing a DEEP-LINKED board lands on a real tab, not an empty frame", async ({ page }) => {
    // Arriving by link, there is no previous tab to return to. The reader must
    // still land somewhere real; an empty content frame is the failure this
    // guards, because the overlay is the whole surface and closing it would
    // otherwise reveal nothing at all.
    await page.goto("/?tab=journeys");
    await expect(board(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(board(page)).toBeHidden();
    await expect(page.locator("main")).not.toBeEmpty();
  });

  test("an absent phase states its reason without needing a hover", async ({ page }) => {
    // The distinction the owner imported from the contest's runner-up: an absence
    // carries a REASON, and that reason is reachable without a pointer. Hover-only
    // content does not exist on a touch screen or to a screen reader.
    await page.goto("/?tab=journeys");
    await expect(board(page)).toBeVisible();
    await expect
      .poll(async () => await board(page).getByRole("button").filter({ hasText: /\S/ }).count(), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // The seeded corpus runs no work-sample case, so every role's case band is
    // absent WITH a reason — the one absence guaranteed to be on screen.
    const absence = board(page).getByText(/nothing happened here|never recorded|no work-sample case/i);
    expect(await absence.count()).toBeGreaterThan(0);
    await expect(absence.first()).toBeVisible();
  });
});
