// Accessibility gate for the PUBLIC TOKEN DOORS other than /schedule/[token].
//
// The schedule door has had an axe sweep in the keyless subset since
// journey-role-to-schedule.spec.ts landed (its two states, picker and booked).
// Its three siblings — the offer card a candidate accepts a job on, the GDPR
// erasure page they reach from an email footer, and the invite form a colleague
// sets their password in — had none, although each is reached WITHOUT a session,
// usually from a link in an email, usually on a phone, and each is the most
// consequential page in its flow.
//
// FULLY DETERMINISTIC — no GEMINI/Claude/ElevenLabs key is needed. Every token is
// minted through the app's OWN seams, and the only LLM-shaped step on the offer
// path is deliberately routed around: /api/sim/offer-draft is the simulation's
// keyless offer draft (salary from the job-band midpoint, no model call), which
// is exactly why it exists. Nothing here reads a fixture or seeds the database
// directly; a fresh DB self-seeds pipeline entries from data/seed_pipeline and
// seedDevAuth stamps the first-run gate, as in the sibling journeys.
//
// CI invocation (for the keyless job — no .env.local, no API keys):
//   npm ci && npx playwright install --with-deps chromium
//   npm run build                        # runs schemas:gen (needs Python deps)
//   npm run start -- --port 3101 &      # prod server against data/kp.sqlite
//   KP_E2E_BASE_URL=http://localhost:3101 npx playwright test \
//     e2e/token-doors-axe.spec.ts
//
// LOCALLY, run this against a PRODUCTION build, not `next dev`, for the same
// reason journey-role-to-schedule.spec.ts states: a dev server rebuilds on any
// file write and a rebuild mid-request leaves a candidate page's client fetch
// hanging on "Loading…" past the expect timeout.
//
// HOW EACH TOKEN IS MINTED (all four doors are mintable keyless — none had to be
// skipped):
//   offer   POST /api/sim/offer-draft → POST /api/pipeline/[id] {action:"accept"}
//           (extendDraftedOffer) → GET /api/sim/offer-link?entryId= , the same
//           three calls the in-product simulation walks.
//   data    the erasure token is minted by ensureErasureToken INSIDE a candidate
//           comm's "manage your data" footer (comms-dispatch.ts dataFooter) — it
//           has no mint endpoint of its own by design. So we send a real candidate
//           comm (POST /api/schedule/invite, the journey's own seam) and read the
//           link back out of the outbox through GET /api/comms?entry=.
//   invite  POST /api/org/invites, which returns the tokenized accept link.
//
// The theme is the DEFAULT (Studio Light) on every sweep: which theme a public
// page should honour — the device's, or a pinned light — is an open product
// question, so this file asserts nothing about it.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { E2E_BASE_URL, seedDevAuth } from "./dev-auth";

// The minting step feeds the three sweeps, so they run serially in one worker;
// a failed mint skips the dependent remainder rather than failing three times.
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

// Unique per run so a repeated run cannot collide with an invite it already made.
const runId = Date.now().toString(36);

// Filled by the minting step below.
let offerPath = "";
let dataPath = "";
let invitePath = "";

// Same pragmatic axe gate as journey-role-to-schedule.spec.ts and
// analyze-smoke.spec.ts: fail on serious/critical WCAG A/AA violations only.
//
// KNOWN EXCLUSION — `.text-coral`: the app-wide EYEBROW recipe
// (app/_components/ui/recipes.ts: "text-meta uppercase text-coral") puts coral on
// paper at 3.65:1, under the 4.5:1 AA bar for 14px text. That is a design-token
// brand decision (coral is also the focus ring and score-weak color), not
// something this suite can restyle, so the decorative kicker is excluded rather
// than the color-contrast rule disabled. Everything else stays contrast-checked.
// If the design system ever darkens light-theme coral, delete this exclusion.
async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude(".text-coral").analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);
}

/** Open one public door in a context that holds NO cookie at all — the candidate
 *  or colleague has the link and nothing else, which is the whole premise of a
 *  capability URL. Closing the context is the caller's `finally`. */
async function openAsStranger(browser: import("@playwright/test").Browser, path: string): Promise<[Page, () => Promise<void>]> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  await page.goto(path);
  return [page, () => context.close()];
}

test("recruiter mints an offer, an erasure and an invite token through the app's own seams", async ({ page }) => {
  // 1 — an ACTIVE pipeline entry to hang the candidate-facing tokens on.
  const board = await page.request.get("/api/pipeline");
  expect(board.ok(), `GET /api/pipeline responded ${board.status()}`).toBe(true);
  const entries = ((await board.json()) as { entries: { id: string; status: string }[] }).entries;
  const entry = entries.find((e) => e.status === "active");
  expect(entry, "the seeded board must carry at least one active entry").toBeTruthy();
  const entryId = entry!.id;

  // 2 — a real candidate comm, purely so its "manage your data" footer mints the
  // erasure token. There is deliberately no endpoint that mints one directly: the
  // token exists because a letter went out carrying it.
  const invited = await page.request.post("/api/schedule/invite", { data: { entryId } });
  expect(invited.ok(), `POST /api/schedule/invite responded ${invited.status()}`).toBe(true);

  const outbox = await page.request.get(`/api/comms?entry=${encodeURIComponent(entryId)}`);
  expect(outbox.ok(), `GET /api/comms responded ${outbox.status()}`).toBe(true);
  const messages = ((await outbox.json()) as { messages: { body: string | null }[] }).messages;
  const dataLink = messages.map((m) => /\/data\/([A-Za-z0-9_%-]+)/.exec(m.body ?? "")).find((m) => m !== null);
  expect(dataLink, "a candidate comm must carry the GDPR footer's /data/<token> link").toBeTruthy();
  dataPath = `/data/${dataLink![1]}`;

  // 3 — the offer. offer-draft sets the offer_review approval WITHOUT a model
  // call; approving it is what extends a real offer link to the candidate.
  const drafted = await page.request.post("/api/sim/offer-draft", { data: { entryId } });
  expect(drafted.ok(), `POST /api/sim/offer-draft responded ${drafted.status()}`).toBe(true);
  // The accept may answer 502 OFFER_NOT_DISPATCHED with no comms relay wired —
  // the offer row and its token are still minted (the route's stated compensation),
  // and the token is what this spec needs, so the status is not asserted.
  await page.request.post(`/api/pipeline/${entryId}`, { data: { action: "accept", actor: "sim" } });
  const link = await page.request.get(`/api/sim/offer-link?entryId=${encodeURIComponent(entryId)}`);
  expect(link.ok(), `GET /api/sim/offer-link responded ${link.status()}`).toBe(true);
  const offerToken = ((await link.json()) as { token: string | null }).token;
  expect(offerToken, "approving the offer_review approval must mint an offer token").toBeTruthy();
  offerPath = `/offer/${offerToken}`;

  // 4 — the colleague's invite. Returns the tokenized accept link.
  const invite = await page.request.post("/api/org/invites", {
    data: { email: `e2e-doors-${runId}@example.test`, role: "recruiter" },
  });
  expect(invite.ok(), `POST /api/org/invites responded ${invite.status()}`).toBe(true);
  const inviteToken = ((await invite.json()) as { invite: { token: string } }).invite.token;
  expect(inviteToken).toBeTruthy();
  invitePath = `/invite/${inviteToken}`;
});

test("/offer/[token] passes axe in its undecided state", async ({ browser }) => {
  const [candidate, close] = await openAsStranger(browser, offerPath);
  try {
    // The card is client-fetched; wait for the decision itself, not the shell.
    await expect(candidate.locator('[data-sim-click="offer-accept"]')).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousA11yViolations(candidate);
  } finally {
    await close();
  }
});

test("/offer/[token] passes axe with the decline alertdialog open", async ({ browser }) => {
  const [candidate, close] = await openAsStranger(browser, offerPath);
  try {
    await expect(candidate.locator('[data-sim-click="offer-accept"]')).toBeVisible({ timeout: 30_000 });
    // The decline confirm is the door's only dialog, and a dialog is where the
    // a11y failures live: it is swept as its own state rather than assumed.
    await candidate.getByRole("button", { name: /decline/i }).click();
    await expect(candidate.locator('[role="alertdialog"]')).toBeVisible();
    await expectNoSeriousA11yViolations(candidate);
    // Leave the offer UNDECIDED: a decline is terminal and irreversible, and a
    // spec that closes the seeded entry poisons every later run.
  } finally {
    await close();
  }
});

test("/data/[token] passes axe, loaded and with the erase confirm open", async ({ browser }) => {
  const [candidate, close] = await openAsStranger(browser, dataPath);
  try {
    await expect(candidate.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    // The held-data list only renders once the client fetch lands; sweeping the
    // skeleton instead would test the wrong page.
    await expect(candidate.getByRole("list")).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousA11yViolations(candidate);

    // The erase confirm — an alertdialog over an IRREVERSIBLE action, the state
    // this door most needs to be accessible in. Opened, swept, then cancelled:
    // the erasure itself would scrub a seeded candidate for every later run.
    await candidate.getByRole("button").filter({ hasText: /erase/i }).first().click();
    const dialog = candidate.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible();
    await expectNoSeriousA11yViolations(candidate);
    await candidate.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  } finally {
    await close();
  }
});

test("/invite/[token] passes axe on the set-your-password form", async ({ browser }) => {
  const [colleague, close] = await openAsStranger(browser, invitePath);
  try {
    // The form appears only after the preview GET resolves; before that the page
    // is one line of loading copy, which is not the state worth gating.
    await expect(colleague.locator('input[type="password"]')).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousA11yViolations(colleague);
  } finally {
    await close();
  }
});
