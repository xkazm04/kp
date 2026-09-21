// Analytics → Quality & audit: the two lists that used to be unbounded are now
// tables with sorting, header-cell filters and a pager.
//
// The decision log is SERVER-sorted and server-paged (the audit trail must stay
// reachable in full, so it cannot be held in memory); the sealed records are
// client-side (the endpoint returns the whole chain to verify it). Both are
// checked here because the two halves of the table kit have to behave the same
// from the reader's side regardless of where the work happens.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
});

// THE TWO TABLES, BY NAME. Both carry aria-label={t("title")}
// (DecisionRecordsTable.tsx:161, DecisionLogTable.tsx:316), so each test can say
// which one it means. It used to say `page.locator("table").first()` / `.last()`,
// and on a database with no sealed records — which is every fresh one, and so
// every CI run — the records panel renders its `empty` paragraph and NO table at
// all. `.first()` then resolved to the DECISION LOG, and "Sealed records default
// to newest link first" passed by reading the log's own descending `when` header:
// a green assertion about a table it was not looking at.
const recordsTable = (page: Page) => page.getByRole("table", { name: "Decision records (sealed)" });
const logTable = (page: Page) => page.getByRole("table", { name: "Decision log" });

/** Both panels sit in <Defer strategy="visible"> (QualityInstrument.tsx:257/:260):
 *  an IntersectionObserver commits them the first time their sentinel enters the
 *  viewport, so a spec that only navigates is asserting on a subtree that will
 *  never be built. Re-scroll on every attempt — each panel that mounts pushes the
 *  next sentinel past the bottom. */
async function revealBelowTheFold(page: Page, target: Locator): Promise<void> {
  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(target).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** Quality is the third section; the decision log sits at its foot. */
async function openQuality(page: Page) {
  await page.goto("/?tab=analytics&sec=quality");
  await revealBelowTheFold(page, logTable(page));
}

/** Open Quality and make sure the SEALED-RECORDS half is really on screen.
 *
 *  Separate from openQuality because it needs one more thing to be true: the
 *  records table only exists when the chain has links, and a fresh database has
 *  none. The fixture below supplies one. */
async function openRecords(page: Page) {
  await page.goto("/?tab=analytics&sec=quality");
  await revealBelowTheFold(page, recordsTable(page));
}

// A sealed record of our own, through the product's own door.
//
// A record is sealed as a side effect of a human decision (runPipelineEntryAction
// → sealDecisionSafe), and nothing seeds the chain — so on CI's fresh database the
// two tests below had nothing to look at. The alternative was to let them skip,
// which would leave the release gate certifying an empty panel; the alternative
// after that was to depend on journey-one-thread having already sealed one, which
// is an ordering this suite does not control. So this file makes its own, on a
// RUN-SCOPED candidate id that collides with neither the seeded corpus nor a
// sibling spec (the entry id is derived as m-<candidateId>-<jobId>).
const runId = Date.now().toString(36);

test.beforeAll(async ({ request }) => {
  const board = await request.get("/api/pipeline");
  expect(board.ok(), `GET /api/pipeline responded ${board.status()}`).toBe(true);
  const { entries } = (await board.json()) as { entries: Array<{ jobId: string }> };
  const jobId = entries[0]?.jobId;
  expect(jobId, "the seeded board must carry at least one job to file a decision against").toBeTruthy();

  const created = await request.post("/api/pipeline", {
    data: {
      candidateId: `e2e-quality-${runId}`,
      candidateLabel: `E2E Quality Fixture ${runId}`,
      jobId,
      stage: "Screened",
    },
  });
  expect(created.ok(), `POST /api/pipeline responded ${created.status()}`).toBe(true);
  const entryId = ((await created.json()) as { entry: { id: string } }).entry.id;

  // Rejecting is what seals: the decision, its rationale and the policy version go
  // into the tamper-evident chain the panel renders.
  const sealed = await request.post(`/api/pipeline/${entryId}`, {
    data: { action: "reject", detail: `e2e quality-tables ${runId}: a sealed record to render` },
  });
  expect(sealed.ok(), `POST /api/pipeline/[id] responded ${sealed.status()}`).toBe(true);

  const records = await request.get("/api/decisions/records");
  expect(records.ok(), `GET /api/decisions/records responded ${records.status()}`).toBe(true);
  const { chain } = (await records.json()) as { chain: { count: number } };
  expect(chain.count, "the fixture must leave at least one link in the chain").toBeGreaterThan(0);
});

test.describe("Decision log — table, not infinite scroll", () => {
  test("renders a paged table with sortable headers", async ({ page }) => {
    await openQuality(page);
    const when = logTable(page).getByRole("columnheader", { name: /when/i }).first();
    // Opens newest-first and SAYS so — the state the infinite scroll could not
    // express at all.
    await expect(when).toHaveAttribute("aria-sort", "descending");
    await expect(logTable(page).getByRole("columnheader", { name: /candidate/i }).first()).toBeVisible();
  });

  test("sorting a column re-queries the server and moves aria-sort", async ({ page }) => {
    await openQuality(page);
    const when = logTable(page).getByRole("columnheader", { name: /when/i }).first();
    const candidate = logTable(page).getByRole("columnheader", { name: /candidate/i }).first();

    // BY NAME. The candidate header now carries TWO controls — "Sort by
    // Candidate" and "Search Candidate…" — so a bare getByRole("button") is a
    // strict-mode violation. The table gained a header-cell filter; the
    // selector had not noticed.
    await candidate.getByRole("button", { name: /^sort by/i }).click();
    await expect(candidate).toHaveAttribute("aria-sort", /ascending|descending/);
    await expect(when).toHaveAttribute("aria-sort", "none");
  });

  test("the pager reports position in the WHOLE trail, and turning a page changes the rows", async ({ page }) => {
    await openQuality(page);
    const pager = page.getByRole("navigation", { name: /table pages/i }).last();
    // A server-paged table knows its true total, so the pager is real: the old
    // "load more" could only ever say how far you had scrolled.
    await expect(pager).toBeVisible();

    const firstRowBefore = await logTable(page).locator("tbody tr").first().innerText();
    await pager.getByRole("button", { name: /next/i }).click();
    await expect(async () => {
      const after = await logTable(page).locator("tbody tr").first().innerText();
      expect(after).not.toBe(firstRowBefore);
    }).toPass({ timeout: 15_000 });
  });
});

test.describe("Sealed decision records — table", () => {
  test("renders a table with the chain position always visible", async ({ page }) => {
    await openRecords(page);

    // Seq FIRST, and the table did not collapse. Targeted structurally rather
    // than by label: the chain-position column is titled "#", and a ColumnHead's
    // accessible name is its title plus its buttons', so a text matcher on a
    // single glyph is both brittle and ambiguous against the sibling log table.
    //
    // The exact column count used to be pinned at six. It is eight today (the
    // records table gained kind/actor filters and a key column) and the pin
    // failed on a table that got BETTER — a magic number that can only ever be
    // wrong twice. What actually matters is asserted instead: the chain position
    // leads, it is sortable, and the table still carries the substance columns
    // rather than having degraded to a stub.
    const records = recordsTable(page);
    const heads = records.locator("thead th");
    await expect(heads.first()).toHaveAttribute("aria-sort", /ascending|descending/);
    expect(await heads.count()).toBeGreaterThanOrEqual(6);
    for (const label of [/kind/i, /subject/i, /sealed/i]) {
      await expect(records.getByRole("columnheader", { name: label }).first()).toBeVisible();
    }
  });

  test("defaults to newest link first and re-sorts on click", async ({ page }) => {
    await openRecords(page);
    const seq = recordsTable(page).locator("thead th").first();
    await expect(seq).toBeVisible();
    // Opens on the chain's own order, newest link first.
    await expect(seq).toHaveAttribute("aria-sort", "descending");

    await seq.getByRole("button", { name: /^sort by/i }).click();
    await expect(seq).toHaveAttribute("aria-sort", "ascending");
  });
});
