// Deterministic end-to-end coverage for the saved-profile ROSTER — the ledger the
// Archetypes tab opens on (ProfileRoster.tsx / ProfileRosterTable.tsx /
// ProfileRosterRow.tsx over the pure profileRosterView.ts).
//
// profile-builder.spec.ts drives the BUILDER (intake → routing → completeness) and
// never touches the roster: the table, its in-header column filters, the 20-row
// pager, the confirm-guarded delete and the rebuild-warning dialog had no end-to-end
// coverage at all, so a regression in any of them shipped green.
//
// Keyless by construction, like profile-builder: every endpoint this file touches is
// pure logic. POST/PUT /api/profile shell out to pipeline.jobfit.profile_cli (the
// archetype router + completeness model, no LLM); GET /api/profile and /api/analyses
// are plain SQLite reads. Fixtures are created THROUGH the API rather than by
// clicking the builder, so the spec pins the roster and nothing else.
//
// Every fixture name carries a per-test unique tag, and every assertion is made
// under the name filter, so this file is independent of whatever the seed corpus
// (or a sibling spec) left in the roster.
// NOT covered here, deliberately: the rebuild-warning dialog. It opens only for a
// profile that DIVERGED from its source analysis, which needs lineage
// (profiles.lineage_stamped_at), which analysisLineageSource stamps only from an
// analysis carrying a cv_hash — and NO analysis in the seeded corpus has one
// (data/seed_analyses/analyses.json). So the state cannot be reached keylessly
// through the API, and a spec that pretended to reach it would be asserting on the
// non-diverged branch. The dialog itself is the shared Modal, whose focus/Escape
// contract modal-escape.spec.ts already pins.
import { expect, test, type Page } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

// Every fixture this file saves is deleted again, so a repeated run cannot inflate
// the roster it measures (the pager test reads the real total).
test.afterEach(async ({ page }) => {
  const res = await page.request.get("/api/profile");
  if (!res.ok()) return;
  const { profiles = [] } = (await res.json()) as { profiles?: { id: string; label: string }[] };
  for (const p of profiles.filter((p) => p.label.startsWith("ZZ"))) {
    await page.request.delete(`/api/profile?id=${encodeURIComponent(p.id)}`);
  }
});

const tag = (what: string) => `ZZ${what}${Date.now().toString(36)}`;

/** Create a saved profile through the real build endpoint. Returns its id. */
async function createProfile(page: Page, displayName: string, sourceAnalysisSlug?: string): Promise<string> {
  const res = await page.request.post("/api/profile", {
    data: {
      profile: { displayName, roleFamily: "engineering", yearsExperience: 5, seniority: "senior" },
      signals: {},
      ...(sourceAnalysisSlug ? { sourceAnalysisSlug } : {}),
    },
  });
  expect(res.ok(), `POST /api/profile for ${displayName}`).toBeTruthy();
  const body = (await res.json()) as { saved: { id: string } | null };
  expect(body.saved?.id, "the build persisted").toBeTruthy();
  return body.saved!.id;
}

async function profileCount(page: Page): Promise<number> {
  const res = await page.request.get("/api/profile");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { profiles?: unknown[] };
  return (body.profiles ?? []).length;
}

/** Open the Archetypes tab's List projection and wait for the roster to paint. */
async function openRoster(page: Page, url = "/?tab=archetypes"): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Candidate profiles" })).toBeVisible();
}

/** Type into the Candidate column's search box (the magnifier in the header). */
async function nameFilterBox(page: Page) {
  const box = page.getByRole("textbox", { name: "Search Candidate…" });
  const trigger = page.getByRole("button", { name: "Search Candidate…" });
  await expect(trigger).toBeVisible();
  // The table is server-rendered, so the header glyph paints before React wires its
  // onClick (the same dev-hydration gap profile-builder.spec.ts works around).
  await expect(async () => {
    if (!(await box.isVisible())) await trigger.click().catch(() => undefined);
    await expect(box).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  return box;
}

async function filterByName(page: Page, needle: string): Promise<void> {
  await (await nameFilterBox(page)).fill(needle);
  await expect(page.getByRole("cell", { name: needle })).toBeVisible();
}

test.describe("Profile roster — the saved-profile ledger", () => {
  test("lists saved profiles, and a column filter narrows the list AND the count", async ({ page }) => {
    const keep = tag("Keep");
    const other = tag("Other");
    await createProfile(page, keep);
    await createProfile(page, other);
    const total = await profileCount(page);

    await openRoster(page);
    // Filter first: the roster windows at 20 rows, so on a populated workspace a
    // just-saved profile is not necessarily on page one — which is the whole reason
    // the column filter exists.
    await filterByName(page, keep);
    // The unfiltered count is "N saved profiles"; a narrowed one says so explicitly,
    // so a filtered list can never read as a roster that lost rows.
    await expect(page.getByText(`1 of ${total} profiles`)).toBeVisible();
    await expect(page.getByRole("cell", { name: other })).toHaveCount(0);
  });

  test("a filter that matches nothing offers a way back, not the first-run brief", async ({ page }) => {
    await createProfile(page, tag("Present"));
    await openRoster(page);
    await (await nameFilterBox(page)).fill("no-such-candidate-anywhere");

    await expect(page.getByText("No profile matches these filters.")).toBeVisible();
    // NOT the illustrated empty state — that would lie about the roster being empty.
    await expect(page.getByText("No saved profiles yet")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByText("No profile matches these filters.")).toHaveCount(0);
  });

  test("the pager windows the roster at 20 rows a page", async ({ page }) => {
    // The pager renders only when the list outgrows one page, so top the roster up
    // to 21 profiles first. Cheap and idempotent: already-full rosters create none.
    const have = await profileCount(page);
    const label = tag("Page");
    for (let i = have; i < 21; i += 1) await createProfile(page, `${label}${i}`);
    const total = await profileCount(page);
    expect(total).toBeGreaterThan(20);

    await openRoster(page);
    const pager = page.getByRole("navigation", { name: "Table pages" });
    await expect(pager).toBeVisible();
    await expect(pager.getByText(`1–20 of ${total}`)).toBeVisible();
    // 20 rows on page one, whatever the roster holds.
    await expect(page.locator("tbody tr")).toHaveCount(20);

    await expect(pager.getByRole("button", { name: "Previous page" })).toBeDisabled();

    await pager.getByRole("button", { name: "Next page" }).click();
    await expect(pager.getByText(`21–${Math.min(total, 40)} of ${total}`)).toBeVisible();
    await expect(pager.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });

  test("delete asks first: cancel keeps the row, confirm removes it", async ({ page }) => {
    const name = tag("Doomed");
    await createProfile(page, name);
    await openRoster(page);
    await filterByName(page, name);

    // Cancel leaves the profile exactly where it was.
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    const confirm = page.getByRole("group", { name: `Confirm deleting ${name}` });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByRole("cell", { name })).toBeVisible();

    // Confirm removes the row optimistically, and the delete is real: a reload
    // (a fresh GET /api/profile) must not bring it back.
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await page.getByRole("group", { name: `Confirm deleting ${name}` }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("cell", { name })).toHaveCount(0);

    await openRoster(page);
    await expect(page.getByRole("cell", { name })).toHaveCount(0);
  });
});
