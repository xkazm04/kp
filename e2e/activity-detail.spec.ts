// Insights → Activity, row-click detail. Deterministic and keyless.
//
// The ledger (llm_usage) records AI actions that actually happened, and a fresh
// database — which is what the suite runs against (playwright.config.ts's
// throwaway KP_DB_PATH) and what CI's keyless job always had — has made none.
// This file used to SKIP on an empty ledger, which on every CI run meant it
// asserted nothing at all. So it now makes the action itself, through doors the
// other specs already use and no production seam of its own:
//
//   • POST /api/jds/save — a matchable job with NO LLM (journey-one-thread's step 1);
//   • POST /api/tasks {kind:"campaign"} — the background run the Campaign tab
//     starts. Keyless (or under KP_OFFLINE) campaign_cli serves its deterministic
//     template and emits ONE ledger line for it (monitor.emit_deterministic), and
//     because it runs inside a task the line carries that task's id as
//     `request_id` (tasks.ts → llm-request-context → KP_LLM_REQUEST_ID). With a
//     provider configured the same run is an LLM call and emits the same line
//     with source "llm" — either way there is exactly one row, linked to the run.
//
// That link is what the detail exists for: a row with a request id opens the
// owning run's output from GET /api/tasks/[id]; a row without one says plainly
// there is no stored output (activity.runUnlinked) — never an empty panel, a
// spinner that never resolves, or a fetch to /api/tasks/null.
//
// LOCAL: a keyed .env.local takes the run off the deterministic path, so run it
// the way CI does — `KP_OFFLINE=1 npx playwright test e2e/activity-detail.spec.ts`.
import { expect, test, type Page } from "@playwright/test";
import { E2E_BASE_URL, seedDevAuth } from "./dev-auth";

// The tests share the one metered action below, so they run in one worker.
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

type ActivityRow = { useCase: string; requestId: string | null };

// Unique per run: the spec writes a real job into the e2e database.
const runId = Date.now().toString(36);
const ROLE_TITLE = `E2E Activity Ledger Analyst ${runId}`;

let meteredTaskId: string | null = null;

/** Drive ONE metered action and wait until its ledger row exists. Memoised so the
 *  serial tests below read the same row rather than spending a second run. */
async function ensureMeteredAction(page: Page): Promise<string> {
  if (meteredTaskId) return meteredTaskId;

  const saved = await page.request.post("/api/jds/save", {
    data: {
      title: ROLE_TITLE,
      body: `# ${ROLE_TITLE}\n\nReads the AI activity ledger.\n\n## Responsibilities\n- Audit AI spend\n`,
      company: "KandiDate e2e",
      role: {
        title: ROLE_TITLE,
        seniority: "medior",
        roleFamily: "software_engineering",
        languages: ["en"],
        responsibilities: ["Audit AI spend"],
        mustHaves: ["SQL"],
        niceToHaves: [],
      },
    },
  });
  expect(saved.ok(), `POST /api/jds/save responded ${saved.status()}`).toBe(true);
  const { jobId, jobIngested } = (await saved.json()) as { jobId: string; jobIngested: boolean };
  expect(jobIngested, "the campaign needs a matchable job to run against").toBe(true);

  const started = await page.request.post("/api/tasks", {
    data: { kind: "campaign", params: { jobId, lang: "en", origin: E2E_BASE_URL } },
  });
  expect(started.ok(), `POST /api/tasks responded ${started.status()}`).toBe(true);
  const taskId = ((await started.json()) as { task: { id: string } }).task.id;
  expect(taskId).toBeTruthy();

  let lastTask: unknown = null;
  await expect(async () => {
    const res = await page.request.get(`/api/tasks/${taskId}`);
    expect(res.ok(), `GET /api/tasks/[id] responded ${res.status()}`).toBe(true);
    lastTask = await res.json();
    const status = (lastTask as { task: { status: string } }).task.status;
    expect(["succeeded", "failed", "canceled", "interrupted"], `campaign run still ${status}`).toContain(status);
  }).toPass({ timeout: 90_000, intervals: [500, 1000, 2000] });
  expect(
    (lastTask as { task: { status: string } }).task.status,
    `the campaign run must succeed — last body: ${JSON.stringify(lastTask).slice(0, 400)}`
  ).toBe("succeeded");

  // The ledger is folded in when the child exits, before the task settles; assert
  // the row landed AND is linked to this run, so the UI half below reads a fact.
  const activity = await page.request.get("/api/llm/activity");
  expect(activity.ok(), `GET /api/llm/activity responded ${activity.status()}`).toBe(true);
  const rows = ((await activity.json()) as { rows: ActivityRow[] }).rows;
  const newestCampaign = rows.find((r) => r.useCase === "campaign_pack");
  expect(newestCampaign, "the campaign run must write one llm_usage row").toBeTruthy();
  expect(newestCampaign!.requestId, "a row written inside a background run carries that run's id").toBe(taskId);

  meteredTaskId = taskId;
  return taskId;
}

/** The detail for the newest Campaign-pack row — the one ensureMeteredAction wrote.
 *  The table and /api/llm/activity read the same newest-first window. */
async function openCampaignRow(page: Page) {
  await page.goto("/?tab=activity");
  await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });
  const row = page.locator("tbody tr").filter({ hasText: "Campaign pack" }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Activity — row detail", () => {
  test("clicking a row opens the detail with the ledger facts and the run's output", async ({ page }) => {
    test.setTimeout(180_000);
    await ensureMeteredAction(page);
    const dialog = await openCampaignRow(page);

    // The ledger half is painted from data the table already had — it must be
    // there on the first frame, with no fetch involved.
    await expect(dialog.getByText(/provider/i).first()).toBeVisible();
    await expect(dialog.getByText(/tokens in\/out/i).first()).toBeVisible();
    await expect(dialog.getByText(/answered by/i).first()).toBeVisible();

    // The output half resolves the LINKED run — not the unlinked degradation, not
    // "aged out", and not a heading over nothing. The section's own <h3> is always
    // rendered, so the body is asserted with the heading stripped: matching the
    // heading alone once made this assertion unfailable.
    const outputSection = dialog.locator("section").filter({ hasText: /what it produced/i }).first();
    await expect(outputSection).toBeVisible();
    await expect(outputSection.getByText("Done", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(outputSection).not.toContainText(/outside a tracked background run|aged out of the task history/);
    const body = (await outputSection.innerText()).replace(/what it produced/i, "").replace(/\bdone\b/i, "").trim();
    expect(body, "the linked run's output rendered nothing under its status").not.toBe("");
  });

  test("Escape closes the detail", async ({ page }) => {
    test.setTimeout(180_000);
    await ensureMeteredAction(page);
    await openCampaignRow(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
