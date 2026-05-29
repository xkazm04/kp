import path from "path";
import { expect, test, type Page } from "@playwright/test";

const sampleCv = path.join(process.cwd(), "samples", "sample-cv.txt");
const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

test.skip(!hasGeminiKey, "Gemini API key is required for the consolidated Analyze flow.");

const SCORE_TIMEOUT = 120_000;
const GITHUB_PROFILE = "xkazm04";

const JOB_DESCRIPTION = [
  "Senior AI Automation Engineer",
  "Required: Python, TypeScript, React, FastAPI, SQL, Docker, Azure, OpenAI API, LLM, RAG, CI/CD, testing.",
  "Responsibilities: build LLM automations, RAG pipelines, MCP tooling, technical analysis, and production delivery.",
  "Seniority: senior or lead. Salary range 150 000 - 220 000 CZK monthly."
].join("\n");

const COMPANY_OVERVIEW =
  "Large international corporate bank in Prague with enterprise engineering, regulated delivery, and strong benefits.";

async function attachCv(page: Page, fixture: string): Promise<void> {
  await page.locator("#profile-file-0").setInputFiles(fixture);
}

async function fillJobDescription(page: Page): Promise<void> {
  await page.getByLabel("Job description text").fill(JOB_DESCRIPTION);
}

async function fillCompany(page: Page): Promise<void> {
  await page.getByLabel("Company overview text").fill(COMPANY_OVERVIEW);
}

async function setGithub(page: Page, handle: string): Promise<void> {
  await page.getByLabel("GitHub profile").fill(handle);
}

async function runAnalysis(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Score Breakdown" })).toBeVisible({ timeout: SCORE_TIMEOUT });
}

test("CV only — overall profile assessment with no job context", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "LinkedIn", exact: true })).toHaveCount(0);
  await attachCv(page, sampleCv);
  await runAnalysis(page);

  // Default Extraction tab populated.
  await expect(page.getByRole("heading", { name: "Strengths" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Score Breakdown" })).toBeVisible();

  // Salary tab shows market estimate but no company-context block.
  await page.getByRole("button", { name: "Salary", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Salary Estimate" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Company Compensation Context" })).toHaveCount(0);

  // No JD → no Job-fit block populated, no Keyword Coverage; no GitHub panel.
  await page.getByRole("button", { name: "Job fit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Job Fit" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Keyword Coverage" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "GitHub Analysis" })).toHaveCount(0);
});

test("CV + job description — adds role-fit, missing-skills, and keyword coverage", async ({ page }) => {
  await page.goto("/");
  await attachCv(page, sampleCv);
  await fillJobDescription(page);
  await runAnalysis(page);

  // Job fit tab populated against the JD; keyword coverage now lives here.
  await page.getByRole("button", { name: "Job fit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Job Fit", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Matching Skills" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Keyword Coverage" })).toBeVisible();

  // Salary still rendered, still no company-context block.
  await page.getByRole("button", { name: "Salary", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Salary Estimate" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Company Compensation Context" })).toHaveCount(0);

  // No GitHub panel.
  await expect(page.getByRole("heading", { name: "GitHub Analysis" })).toHaveCount(0);
});

test("CV + JD + company overview — applies enterprise context and salary multiplier", async ({ page }) => {
  await page.goto("/");
  await attachCv(page, sampleCv);
  await fillJobDescription(page);
  await fillCompany(page);
  await runAnalysis(page);

  // Company classification is applied to the salary tab.
  await page.getByRole("button", { name: "Salary", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Salary Estimate" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Company Compensation Context" })).toBeVisible();
  // The wording "international corporate bank" maps to enterprise/corporate via the taxonomy.
  await expect(page.getByText(/Enterprise/i).first()).toBeVisible();

  // Job fit tab combines role-fit and keyword coverage in one place.
  await page.getByRole("button", { name: "Job fit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Matching Skills" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Keyword Coverage" })).toBeVisible();

  // No GitHub panel.
  await expect(page.getByRole("heading", { name: "GitHub Analysis" })).toHaveCount(0);
});

test("CV + JD + company + GitHub profile — full pipeline renders all panels", async ({ page }) => {
  await page.goto("/");
  await attachCv(page, sampleCv);
  await fillJobDescription(page);
  await fillCompany(page);
  await setGithub(page, GITHUB_PROFILE);
  await runAnalysis(page);

  // Main analysis renders.
  await expect(page.getByRole("heading", { name: "Score Breakdown" })).toBeVisible();

  // Company context is applied.
  await page.getByRole("button", { name: "Salary", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Company Compensation Context" })).toBeVisible();

  // GitHub analysis is now a tab inside the result panel — click it.
  // The anonymous GitHub API rate-limit (60/hr) can drop the request during
  // back-to-back e2e runs, so accept either the loaded "@<username>" header
  // or the rate-limit error message as proof the panel mounted.
  await page.getByRole("button", { name: "GitHub", exact: true }).click();
  await expect(page.getByRole("heading", { name: "GitHub Analysis" })).toBeVisible({ timeout: 30_000 });
  await expect(
    page
      .getByText(`@${GITHUB_PROFILE}`)
      .or(page.getByText(/rate limit|access policy/i))
      .first()
  ).toBeVisible({ timeout: 30_000 });
});

// Both `xkazm04` and `https://github.com/xkazm04` should resolve to the same
// public profile and render the GitHub panel in the result tabs. These two
// tests share a smaller LinkedIn fixture (~17 s) and skip the JD/company
// columns to keep the per-test wall time low.
const GITHUB_INPUT_VARIANTS: Array<{ label: string; value: string }> = [
  { label: "bare username", value: "xkazm04" },
  { label: "full https URL", value: "https://github.com/xkazm04" },
];

for (const variant of GITHUB_INPUT_VARIANTS) {
  test(`GitHub input — ${variant.label} (${variant.value})`, async ({ page }) => {
    await page.goto("/");
    await attachCv(page, sampleCv);
    await setGithub(page, variant.value);
    await runAnalysis(page);

    await page.getByRole("button", { name: "GitHub", exact: true }).click();
    await expect(page.getByRole("heading", { name: "GitHub Analysis" })).toBeVisible({ timeout: 30_000 });

    // Either the loaded panel content (`@xkazm04`) or the rate-limit error;
    // both prove the username was parsed and dispatched correctly.
    await expect(
      page
        .getByText(`@${GITHUB_PROFILE}`)
        .or(page.getByText(/rate limit|access policy/i))
        .first()
    ).toBeVisible({ timeout: 30_000 });
  });
}
