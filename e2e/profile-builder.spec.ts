// Deterministic end-to-end coverage for the candidate **profile builder** — the
// guided intake that routes a candidate to an archetype and scores completeness.
//
// Unlike analyze-smoke.spec.ts, this path is PURE LOGIC: /api/profile shells out
// to pipeline.jobfit.profile_cli (the archetype router + completeness model), no
// LLM — which is exactly why it was untested. The file once named
// profile-smoke.spec.ts actually drove the Analyze flow and never touched
// ProfileTab, the router, or the scoring, so routing/scoring regressions could
// ship while the suite stayed green. No API key is needed to run this file.
//
// Because routing + weights live in a shared registry (pipeline/jobfit/
// archetypes.json), the expected archetype and completeness for a given intake are
// fully determined. We self-declare the archetype (signals.selfDeclared) so routing
// never depends on heuristics, and fill exactly the fields each checklist scores.
//
// Note: the form starts HONEST — it no longer auto-seeds education / languages /
// seniority (idea-fa7d5360), so these tests fill them explicitly. Their completeness
// now reflects real recruiter input rather than unchosen create-mode defaults.
//
// Completeness = weighted ratio of satisfied checks (archetypes.json):
//   Experienced (bau): education 1 + languages 1 + 3 skills 1.5 + seniority 1.5
//                      + years 1 + work-experience entry 1.5  (total 7.5)
//                      → every check satisfied = 7.5/7.5 = 100%.
//   Student:           education 1 + languages 1 + 3 skills 1.5 + aspirations 1.5
//                      + study detail 1 + project/thesis 2 + activity 1 (total 9)
//                      → all but the activity = 8/9 = round(0.888…) = 0.89 = 89%.
import { expect, test, type Page } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";

// The workspace only renders at '/' for a dev-signed-in visitor (HomeGate);
// seed the flag before each test or the landing swallows every locator.
test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

type BuildResponse = {
  archetype: string;
  completeness: number;
  saved: { id: string } | null;
};

type ProfileGet = { profile: { archetype: string | null; completeness: number | null } };

async function openBuilder(page: Page): Promise<void> {
  await page.goto("/?tab=profile");
  const openBtn = page.getByRole("button", { name: "Build candidate profile" });
  const heading = page.getByRole("heading", { name: "Build a candidate profile" });
  await expect(openBtn).toBeVisible();
  // The Profile tab is server-rendered, so the button paints before React wires
  // its onClick (a Next.js dev hydration gap). Retry the open until the editor
  // heading appears; once it does we stop clicking the (now-detached) button.
  await expect(async () => {
    if (!(await heading.isVisible())) {
      await openBtn.click().catch(() => undefined);
    }
    await expect(heading).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
}

async function fillSkills(page: Page, skills: string[]): Promise<void> {
  // The intake opens with one (empty) skill row; add the rest, then fill each.
  // exact:true matches only the skill inputs (placeholder "React"), never the
  // evidence "skills: …" input.
  for (let i = 1; i < skills.length; i += 1) {
    await page.getByRole("button", { name: "+ skill" }).click();
  }
  const inputs = page.getByPlaceholder("React", { exact: true });
  for (let i = 0; i < skills.length; i += 1) {
    await inputs.nth(i).fill(skills[i]);
  }
}

async function fillEvidence(page: Page, kind: string, title: string): Promise<void> {
  // Target the evidence "kind" <select> by an option only it carries ("job"):
  // skill-level / provenance / seniority / education selects never do, so this
  // is position-independent. ("internship"/"thesis" also live in provenance, so
  // they would not disambiguate.)
  await page.locator("select").filter({ hasText: "job" }).first().selectOption(kind);
  await page.getByPlaceholder("Title").fill(title);
}

// Click Save and return the /api/profile POST body. The editor closes itself on a
// successful save (ProfileTab clears it), so the saved-state result panel never
// settles in the DOM — instead we read the persisted id/archetype/completeness off
// the save response and re-confirm them via GET below.
async function saveAndCapture(page: Page): Promise<BuildResponse> {
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/profile") &&
      r.request().method() === "POST" &&
      (r.request().postData() ?? "").includes('"persist":true')
  );
  await page.getByRole("button", { name: "Save profile" }).click();
  return (await (await responsePromise).json()) as BuildResponse;
}

test.describe("Profile builder — archetype routing + completeness", () => {
  test("Experienced intake routes to bau, scores 100% complete, and saves", async ({ page }) => {
    await openBuilder(page);
    await page.getByRole("radio", { name: "Experienced" }).click();
    await page.getByLabel("Name", { exact: true }).fill("E2E Experienced Candidate");
    // education / languages / seniority are no longer auto-seeded (idea-fa7d5360),
    // so fill them explicitly — they are the education_known / has_languages /
    // has_seniority checks that take this intake to 100%.
    // Selects (Pick) sit inside a wrapping <label> whose text includes every
    // <option>, which defeats getByLabel's label-text match — target them by
    // accessible name instead (the accname algorithm skips the embedded widget).
    await page.getByRole("combobox", { name: "Education level", exact: true }).selectOption("master");
    await page.getByLabel("Languages", { exact: true }).fill("Czech, English");
    await page.getByRole("combobox", { name: "Seniority", exact: true }).selectOption("senior");
    await page.getByLabel("Years of experience", { exact: true }).fill("6");
    await fillSkills(page, ["TypeScript", "React", "SQL"]);
    await fillEvidence(page, "job", "Senior Engineer at Acme (2019–2024)");

    // Check (preview): the in-DOM result panel renders the routed archetype + score
    // and is explicitly flagged not-saved.
    await page.getByRole("button", { name: "Check (preview)" }).click();
    await expect(page.locator("span.rounded-full.bg-ink", { hasText: "Experienced" })).toBeVisible();
    await expect(page.getByText("self-declared: Experienced (BAU)")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Profile completeness 100%" })).toBeVisible();
    await expect(page.getByText("Profile looks complete for its archetype.")).toBeVisible();
    await expect(page.getByText("preview (not saved)")).toBeVisible();

    // Save: the round-trip persists with the same routing + score and returns an id.
    const saved = await saveAndCapture(page);
    expect(saved.archetype).toBe("bau");
    expect(saved.completeness).toBe(1);
    const savedId = saved.saved?.id;
    expect(savedId, "save should persist and return an id").toBeTruthy();

    // Editor closed → back at the candidates view.
    await expect(page.getByRole("button", { name: "Build candidate profile" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Build a candidate profile" })).toHaveCount(0);

    // Persisted record reflects the routed archetype + score.
    const record = await page.request.get(`/api/profile?id=${savedId}`);
    const { profile } = (await record.json()) as ProfileGet;
    expect(profile.archetype).toBe("bau");
    expect(profile.completeness).toBe(1);
  });

  test("Student intake routes to student, scores 89% with the missing-activity nudge, and saves", async ({ page }) => {
    await openBuilder(page);
    await page.getByRole("radio", { name: "Student / early-career" }).click();
    await page.getByLabel("Name", { exact: true }).fill("E2E Student Candidate");
    // education + languages are no longer auto-seeded (idea-fa7d5360); fill them so
    // the only remaining gap is the missing activity (→ 8/9 = 89%).
    // Role-based for the same wrapping-<label> reason as the experienced intake.
    await page.getByRole("combobox", { name: "Education level", exact: true }).selectOption("bachelor");
    await page.getByLabel("Languages", { exact: true }).fill("Czech, English");
    await page.getByLabel("Aspirations / target roles", { exact: true }).fill("Junior frontend developer");
    await page.getByLabel("Study programme & specialisation", { exact: true }).fill("CS, ČVUT FEL — focus on ML");
    await fillSkills(page, ["JavaScript", "React", "Git"]);
    // A project is the student's strongest evidence; omitting an internship /
    // activity is the single remaining gap, landing the score at 8/9 = 89%.
    await fillEvidence(page, "project", "Bachelor thesis: a React recommender app");

    await page.getByRole("button", { name: "Check (preview)" }).click();
    // The pill shows the short archetype label ("Student"); the full
    // "Student / early-career" phrasing is asserted on the routing line below.
    await expect(page.locator("span.rounded-full.bg-ink", { hasText: "Student" })).toBeVisible();
    await expect(page.getByText("self-declared: Student / early-career")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Profile completeness 89%" })).toBeVisible();
    await expect(page.getByText("an internship, activity, or certification")).toBeVisible();
    await expect(page.getByText("preview (not saved)")).toBeVisible();

    const saved = await saveAndCapture(page);
    expect(saved.archetype).toBe("student");
    expect(saved.completeness).toBe(0.89);
    const savedId = saved.saved?.id;
    expect(savedId, "save should persist and return an id").toBeTruthy();

    await expect(page.getByRole("button", { name: "Build candidate profile" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Build a candidate profile" })).toHaveCount(0);

    const record = await page.request.get(`/api/profile?id=${savedId}`);
    const { profile } = (await record.json()) as ProfileGet;
    expect(profile.archetype).toBe("student");
    expect(profile.completeness).toBe(0.89);
  });
});
