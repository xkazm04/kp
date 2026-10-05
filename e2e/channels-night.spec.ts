// Hiring > Channels ("The Night Post", app/features/hiring/channels/night/README.md) and the
// Hiring > Overview it sits beside ("The Orbit, Lit", orbit/overview/): the two surfaces the
// 2026-09-30 contest port replaced. Everything their pure models decide is unit-tested beside them;
// what only a browser can show is pinned here:
//
//   · the plumbing's headline is TRUTHFUL about the relay: with no relay configured it never says
//     "Everything is wired and flowing", and with queued mail it says those messages are NOT being
//     sent (the page's one alert, product law: never a green lie);
//   · the post book opens the ledger (level 2), and Esc walks back to the plumbing with focus on the
//     building that opened it;
//   · `?sec=` is the tab's one inbox: `comms` lands on the ledger, `relay` on the relay's setup level,
//     the param is consumed on arrival, and Esc walks back through the stack the arrival built;
//   · the Overview's queues light their people on the folded orbit while pointed at, and the trail
//     names where you are.
//
// READ-ONLY. Every non-GET request is aborted in the browser, so this spec can run against an
// already-running server (KP_E2E_BASE_URL) without touching its data. For the same reason it does not
// call seedDevAuth (which stamps the onboarding state with a POST) when pointed at such a server; the
// managed webServer's throwaway database gets the stamp, so the first-run wizard cannot cover the page.
//
// Not in KEYLESS_SPECS (yet): it is keyless by construction, but it has only been run against a
// developer's server, not against the release job's fresh production build.
import { expect, test, type Page } from "@playwright/test";
import { E2E_BASE_URL, seedDevAuth } from "./dev-auth";

const EXTERNAL_SERVER = !!process.env.KP_E2E_BASE_URL;

test.beforeEach(async ({ page }) => {
  if (EXTERNAL_SERVER) {
    await page.context().addCookies([{ name: "kp_entered", value: "1", url: E2E_BASE_URL }]);
  } else {
    await seedDevAuth(page);
  }
  await page.route("**/*", (route) => (["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort()));
});

/** The Channels surface root; `data-level` is the top of its level stack (0 plumbing … 3 message). */
const night = (page: Page) => page.locator('[data-sim="channels"]');
/** The level in the page flow (covered levels stay mounted, hidden). */
const topLayer = (page: Page) => page.locator('.k-layer[data-mode="flow"]');

/**
 * Put focus inside the surface, as a reader's first click does. The level keys answer only key
 * presses from inside the surface (they yield to everything outside it), and an arrival never
 * takes focus by itself (night/README.md "Focus and announcement"), so a deep link lands with
 * focus on the document.
 */
async function focusLevel(page: Page) {
  // Settled: every layer is either the one in the flow or a covered (hidden) one, so no wipe is
  // still running (a key press mid-transition belongs to the level that is leaving).
  await expect(page.locator('.k-layer:not([data-mode="flow"]):not([data-mode="hidden"])')).toHaveCount(0);
  const heading = topLayer(page).locator("[data-level-heading]");
  await heading.focus();
  await expect(heading).toBeFocused();
}

async function openChannels(page: Page, sec?: string) {
  await page.goto(sec ? `/?tab=channels&sec=${sec}` : "/?tab=channels");
  await expect(night(page)).toBeVisible();
  // aria-busy holds until every source has settled once.
  await expect(night(page)).not.toHaveAttribute("aria-busy", /.*/);
}

test.describe("Channels — the Night Post", () => {
  test("the plumbing's headline is truthful about the relay", async ({ page }) => {
    await openChannels(page);
    await expect(night(page)).toHaveAttribute("data-level", "0");
    const headline = page.locator("h2.cn-headline");
    await expect(headline).not.toHaveAttribute("data-tone", "reading");

    const relay = await (await page.request.get(`${E2E_BASE_URL}/api/comms/relay`)).json().catch(() => null);
    const comms = await (await page.request.get(`${E2E_BASE_URL}/api/comms`)).json().catch(() => null);
    const queued = Array.isArray(comms?.messages) ? comms.messages.filter((m: { status?: string }) => m.status === "queued").length : 0;
    if (relay?.relay === "unconfigured") {
      // No relay: nothing is sent, so the page may never read as an all-clear.
      await expect(headline).not.toHaveAttribute("data-tone", /^ok/);
      await expect(headline).not.toHaveText(/everything is wired and flowing/i);
      if (queued > 0) await expect(headline).toHaveText(/NOT being sent/);
    } else {
      // A readable answer either way: an all-clear, or the worst need first.
      await expect(headline).toHaveAttribute("data-tone", /.+/);
    }
    // The guided walk's spotlight hook survives the redesign.
    await expect(page.locator('[data-sim="channel-inbound"]')).toBeVisible();
  });

  test("the post book opens the ledger, and Esc walks back onto it", async ({ page }) => {
    await openChannels(page);
    const book = page.locator('button[data-night-node="book"]:visible');
    await book.click();
    await expect(night(page)).toHaveAttribute("data-level", "2");
    await expect(topLayer(page).locator("[data-level-heading]")).toBeFocused();
    // The trail is announced politely on every move.
    await expect(page.getByRole("status").filter({ hasText: "›" }).first()).toBeAttached();

    await page.keyboard.press("Escape");
    await expect(night(page)).toHaveAttribute("data-level", "0");
    await expect(book).toBeFocused();
  });

  test("?sec=comms lands on the ledger, is consumed, and Esc returns to the plumbing", async ({ page }) => {
    await openChannels(page, "comms");
    await expect(night(page)).toHaveAttribute("data-level", "2");
    await expect(page).not.toHaveURL(/[?&]sec=/);
    // The arrival built the stack 0 -> 2, so one Esc is back on the plumbing.
    await focusLevel(page);
    await page.keyboard.press("Escape");
    await expect(night(page)).toHaveAttribute("data-level", "0");
  });

  test("?sec=relay lands on the relay's setup level", async ({ page }) => {
    await openChannels(page, "relay");
    await expect(night(page)).toHaveAttribute("data-level", "1");
    await expect(topLayer(page).locator("[data-level-heading]")).toHaveText(/delivery relay/i);
    await expect(page).not.toHaveURL(/[?&]sec=/);
    await focusLevel(page);
    await page.keyboard.press("Escape");
    await expect(night(page)).toHaveAttribute("data-level", "0");
  });
});

test.describe("Hiring Overview — the Orbit, Lit", () => {
  test("pointing at a queue lights its people on the orbit; the trail says Overview", async ({ page }) => {
    await page.goto("/?tab=pipeline");
    const overview = page.locator('[data-role="orbit-overview"]');
    const board = page.locator('[data-sim="pipeline-board"]');
    await expect(board).toBeVisible();
    // An empty board shows the empty state instead of the Overview: nothing to light.
    const hasOverview = await overview.waitFor({ timeout: 30_000 }).then(() => true, () => false);
    test.skip(!hasOverview, "the board is empty: the Overview is replaced by the empty state");

    await expect(page.locator(".ob-trail .ob-trail__here")).toHaveText(/overview/i);
    const queue = overview.locator('[data-role="overview-today"]').first();
    const hasQueue = (await queue.count()) > 0;
    test.skip(!hasQueue, "nobody is queued today: no queue to point at");

    const halos = overview.locator(".k-halos circle");
    await expect(halos).toHaveCount(0);
    await queue.hover();
    await expect(halos.first()).toBeAttached();
    // Moving away puts them out again (a state, never ambient).
    await page.mouse.move(0, 0);
    await expect(halos).toHaveCount(0);
  });
});
