// One (`/?tab=one`, docs/design/one-interface.md) — the AI-conducted home, end to end.
//
// What no unit test reaches: the tab opens against the real corpus with no page error, the
// header's counts render, a candidate's profile sheet opens, and a held outreach letter goes
// through the SAME two doors the rest of the app uses — approve (a named person, one
// revision) then release — from One's consent cards, with the truthful delivery claim shown.
// A booking from the calendar sheet names, before the press, where the candidate's
// confirmation goes, and its result states what the confirmation did (on the demo corpus,
// whose people carry no address, that is "not sent: no address"; the queued and suppressed
// paths are unit-tested in app/api/schedule/schedule-book-confirmation.test.ts).
// The refusal path is pinned too: a request that names no approver, and a letter that changed
// after approval, each answer with their own sentence (useErrorMessage), never "failed".
//
// Keyless and deterministic, on the throwaway e2e DB. The fixture letter is drafted through
// the app's own sourcing door (POST /api/jobs/[id]/candidates/outreach), whose outreach task
// falls back to its deterministic draft with no provider (run the server with KP_OFFLINE=1
// so a configured key does not take the slow real-engine path). Nothing leaves the box: with
// no relay configured a release lands in the local outbox and answers `queued`.
//
// THE SERVER MUST NAME AN APPROVER: KP_OPERATOR_NAME=<a name> in the server's env. An open
// single-operator install with no name is refused by the approve door, by design; the third
// test pins that refusal's sentence by answering the request the way such a server does.
//
// Run: export KP_OPERATOR_NAME (and KP_OFFLINE=1) for the managed webServer, or point
// KP_E2E_BASE_URL=http://localhost:<port> at an isolated server started with them. An
// isolated KP_EMPTY=1 server boots blank (KP_EMPTY wins over KP_SEED_DEMO); seed it first
// with POST /api/setup/first-run {"choice":"demo"}.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_BASE_URL, seedDevAuth } from "./dev-auth";

test.use({ viewport: { width: 1600, height: 1000 } });

function collectFailures(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") seen.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => seen.push(`pageerror: ${err.message}`));
  return seen;
}

type Fixture = { entryId: string; letterId: string; label: string };

/** Draft a held outreach letter through the sourcing door, on a candidate who has none sent. */
async function draftLetter(request: APIRequestContext, skip: ReadonlySet<string> = new Set()): Promise<Fixture> {
  const jobs = (await (await request.get(`${E2E_BASE_URL}/api/jobs?limit=8`)).json()) as { jobs: { id: string }[] };
  for (const job of jobs.jobs) {
    const res = await request.get(`${E2E_BASE_URL}/api/jobs/${job.id}/candidates`);
    if (!res.ok()) continue;
    const body = (await res.json()) as { candidates?: { candidateId: string; label: string }[] };
    for (const c of body.candidates ?? []) {
      if (skip.has(c.candidateId)) continue;
      const out = await request.post(`${E2E_BASE_URL}/api/jobs/${job.id}/candidates/outreach`, {
        data: { candidateId: c.candidateId, candidateLabel: c.label, source: "sourcing" },
        timeout: 60_000,
      });
      if (!out.ok()) continue;
      const r = (await out.json()) as { entryId?: string; applied?: string; outreachLetterId?: string | null };
      if (r.applied !== "drafted" || !r.entryId || !r.outreachLetterId) continue;
      // "drafted" is also the answer when an already-APPROVED letter keeps its approval (the
      // store drops a late redraft): only a letter that is a draft now is a fixture.
      if ((await heldLetter(request, r.entryId))?.state === "drafted") return { entryId: r.entryId, letterId: r.outreachLetterId, label: c.label };
    }
  }
  throw new Error("no candidate in the first jobs could be drafted a first-contact letter");
}

async function heldLetter(request: APIRequestContext, entryId: string): Promise<{ state: string; revision: number } | null> {
  const r = (await (await request.get(`${E2E_BASE_URL}/api/outreach-letters/by-entry/${encodeURIComponent(entryId)}`)).json()) as {
    letter: { state: string; revision: number } | null;
  };
  return r.letter;
}

/** Open One, then the letters sheet, then this candidate's letter; arm its Approve card. */
async function armApprove(page: Page, fx: Fixture) {
  await page.goto("/?tab=one");
  await expect(page.locator("[data-one-root]")).toBeVisible();
  // The count is a client read: once it is a numeral the tab has hydrated and a press asks.
  const stat = page.locator("[data-stat=letters]");
  await expect.poll(async () => (await stat.innerText()).trim(), { timeout: 15_000 }).toMatch(/^[1-9]/);
  await stat.click();
  const letters = page.locator("[data-sheet=letters]");
  await expect(letters).toBeVisible();
  // A letters row is keyed by the letter id (the label is what the person reads).
  await letters.locator(`[data-row-key="${fx.letterId}"]`).click();
  const sheet = page.locator("[data-sheet=letter]");
  await expect(sheet).toBeVisible();
  await sheet.locator("[data-act=letter-approve]").click();
  const card = page.locator("[data-one-consent=letterApprove]");
  await expect(card).toBeVisible();
  return card;
}

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

test.describe("One — the tab, its counts, a profile, and a letter through its doors", () => {
  // The fixtures share the corpus' candidates: one test at a time, in order.
  test.describe.configure({ mode: "serial" });

  test("the tab opens with its counts and a profile sheet, with no page error", async ({ page }) => {
    const failures = collectFailures(page);
    await page.goto("/?tab=one");
    await expect(page.locator("[data-one-root]")).toBeVisible();

    // The counts: each stat is a numeral once /api/attention has answered (a dash only while
    // it has not — never a 0 standing in for "not read").
    const decisions = page.locator("[data-stat=decisions]");
    await expect(decisions).toBeVisible();
    await expect.poll(async () => (await decisions.innerText()).trim(), { timeout: 15_000 }).toMatch(/^\d+/);

    // A candidate's profile: the Decisions count asks for the queue, and a candidate row of the
    // side's list (a selectable row carries aria-selected) opens the profile sheet.
    await decisions.click();
    const row = page.locator("[data-role=split-side] [data-row][aria-selected]").first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.locator("[data-sheet=profile]")).toBeVisible();

    expect(failures.filter((f) => /FORMATTING_ERROR|MISSING_MESSAGE/i.test(f))).toEqual([]);
    expect(failures.filter((f) => f.startsWith("pageerror"))).toEqual([]);
  });

  test("a drafted letter is previewed, approved by a named person, then released", async ({ page, request }) => {
    const failures = collectFailures(page);
    const fx = await draftLetter(request);
    const card = await armApprove(page, fx);

    // The card shows what the approval covers: recipient, subject, language, the body.
    const facts = card.locator("[data-role=one-consent-letter]");
    await expect(facts).toBeVisible();
    await expect(card.locator("[data-role=one-consent-body]")).not.toBeEmpty();
    const confirm = card.locator("[data-role=one-consent-confirm]");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // Approved — or, on a server with no named approver, its own sentence (fail loudly).
    const result = card.locator("[data-role=one-consent-result]");
    await expect(result.or(card.getByText(/needs a named person/i))).toBeVisible();
    await expect(result, "the server needs KP_OPERATOR_NAME (see the header)").toBeVisible();
    await expect.poll(async () => (await heldLetter(request, fx.entryId))?.state).toBe("approved");

    // Approving sends nothing: the send is its own card, armed from the approve card.
    await card.locator("[data-act=letter-send-next]").click();
    const send = page.locator("[data-one-consent=letterSend]");
    await expect(send).toBeVisible();
    const sendConfirm = send.locator("[data-role=one-consent-confirm]");
    await expect(sendConfirm).toBeEnabled({ timeout: 15_000 });
    await sendConfirm.click();

    // The truthful claim: no relay is configured on the e2e server, so it is QUEUED locally.
    await expect(send.locator("[data-role=one-consent-result]")).toHaveText(/queued|sent|not delivered/i);
    await expect.poll(async () => (await heldLetter(request, fx.entryId))?.state).toMatch(/released|delivery_failed/);

    expect(failures.filter((f) => f.startsWith("pageerror"))).toEqual([]);
  });

  test("a booking from the calendar names who is mailed, then states what the confirmation did", async ({ page }) => {
    const failures = collectFailures(page);
    await page.goto("/?tab=one");
    await expect(page.locator("[data-one-root]")).toBeVisible();
    // Hydrated once a count is a numeral (Interviews may be 0 on the corpus: it counts the
    // confirmed interviews AHEAD, not who waits), then Interviews opens the calendar.
    const decisions = page.locator("[data-stat=decisions]");
    await expect.poll(async () => (await decisions.innerText()).trim(), { timeout: 15_000 }).toMatch(/^\d+/);
    await page.locator("[data-stat=schedule]").click();
    const sheet = page.locator("[data-sheet=calendar]");
    await expect(sheet).toBeVisible();

    // One title on screen: the sheet's bar names the view; the panel's own title is kept for
    // assistive tech only, never painted a second time.
    await expect(sheet.locator("[data-role=sheets-crumbs]")).toContainText(/interview calendar/i);
    expect(await sheet.locator("[data-role=one-panel-title]").evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);

    // Pick a waiting candidate; the free times become Book buttons.
    const waiting = sheet.locator("[data-role=one-waiting] [role=button]").first();
    await expect(waiting, "the demo corpus holds a candidate waiting for a slot").toBeVisible({ timeout: 15_000 });
    await waiting.click();
    await sheet.locator("[data-act=interview-book]").first().click();

    // The card says, before the press, where the confirmation goes (or why it does not).
    const card = page.locator("[data-one-consent=interviewBook]");
    const forecast = card.locator("[data-role=one-consent-confirmation]");
    await expect(forecast).toBeVisible({ timeout: 15_000 });
    await expect(forecast).toHaveAttribute("data-forecast", /^(relay|local|withheld)$/);

    const booked = page.waitForResponse((r) => r.url().endsWith("/api/schedule") && r.request().method() === "POST");
    await card.locator("[data-role=one-consent-confirm]").click();
    const res = await booked;
    expect(res.ok(), "the booking door accepted the pick").toBe(true);
    const confirmation = ((await res.json()) as { confirmation?: { delivery: string } }).confirmation;
    expect(confirmation?.delivery, "the door answers the confirmation's claim").toMatch(/^(sent|queued|failed|withheld)$/);

    // The result line names that same state: the truthful claim, never a bare "booked".
    const SAYS: Record<string, RegExp> = {
      sent: /confirmation was emailed/i,
      queued: /confirmation .* waits in the local outbox/i,
      failed: /confirmation email did not go out/i,
      withheld: /no confirmation was sent/i,
    };
    const result = card.locator("[data-role=one-consent-result]");
    await expect(result).toContainText(/is booked for/i);
    await expect(result).toContainText(SAYS[confirmation!.delivery]);

    expect(failures.filter((f) => /FORMATTING_ERROR|MISSING_MESSAGE/i.test(f))).toEqual([]);
    expect(failures.filter((f) => f.startsWith("pageerror"))).toEqual([]);
  });

  test("a refused approval and a stale release each say why, in their own sentence", async ({ page, request }) => {
    const fx = await draftLetter(request);

    // 1) No named approver: answered the way an unnamed open install answers (403 + code).
    await page.route("**/api/outreach-letters/*/approve", (route) =>
      route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "x", code: "OUTREACH_APPROVER_UNNAMED" }) })
    );
    let card = await armApprove(page, fx);
    await card.locator("[data-role=one-consent-confirm]").click();
    await expect(card.getByText(/needs a named person/i)).toBeVisible();
    await expect(card.locator("[data-role=one-consent-result]")).toHaveCount(0);
    expect((await heldLetter(request, fx.entryId))?.state, "a refused approval writes nothing").toBe("drafted");

    // 2) Changed after approval: approve for real, then the release door answers 409 STALE.
    await page.unroute("**/api/outreach-letters/*/approve");
    await page.route("**/api/outreach-letters/*/release", (route) =>
      route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "x", code: "OUTREACH_APPROVAL_STALE", state: "drafted" }) })
    );
    card = await armApprove(page, fx);
    await card.locator("[data-role=one-consent-confirm]").click();
    await expect(card.locator("[data-role=one-consent-result]")).toBeVisible();
    await card.locator("[data-act=letter-send-next]").click();
    const send = page.locator("[data-one-consent=letterSend]");
    const sendConfirm = send.locator("[data-role=one-consent-confirm]");
    await expect(sendConfirm).toBeEnabled({ timeout: 15_000 });
    await sendConfirm.click();
    await expect(send.getByText(/changed after it was approved/i)).toBeVisible();
    expect((await heldLetter(request, fx.entryId))?.state, "nothing was released").toBe("approved");
  });
});
