export type CoverageItem = {
  slug: string;
  title: string;
  summary: string;
  details: string[];
};

const coverageItems: CoverageItem[] = [
  {
    slug: "company-salary-context",
    title: "Company salary context",
    summary: "Company notes adjust compensation assumptions and the application strategy.",
    details: [
      "The pipeline detects enterprise, startup, scaleup, consultancy, and public-sector signals.",
      "Salary ranges and negotiation guidance are adjusted using the detected context (capped at 1.20×).",
    ],
  },
  {
    slug: "cv-text-extraction",
    title: "CV text extraction",
    summary: "Profile uploads are converted into normalized text before scoring.",
    details: [
      "PDF, DOCX, TXT, and MD files are supported.",
      "The local extractor uses pypdf parsing and cleanup helpers for spacing and encoding issues.",
    ],
  },
  {
    slug: "czech-diacritics",
    title: "Czech diacritics",
    summary: "The extraction path preserves and repairs Czech text where possible.",
    details: [
      "The local parser includes cleanup for common mojibake and PDF spacing artifacts.",
      "Gemini extraction is prompted to preserve Czech diacritics and reconstruct letter-spaced words.",
    ],
  },
  {
    slug: "end-to-end-api",
    title: "End-to-end API",
    summary: "The Next API route bridges browser uploads to the Python analysis CLI.",
    details: [
      "app/api/analyze/route.ts spawns the Python CLI as a subprocess, validates JSON with Zod, and returns the parsed result.",
      "Keeping analysis logic in Python while running it under the Next.js process avoids a second long-lived server.",
    ],
  },
  {
    slug: "github-evidence",
    title: "GitHub evidence",
    summary: "An optional GitHub profile can be analyzed separately from the CV run.",
    details: [
      "The web app triggers a separate non-blocking API request for public GitHub metadata.",
      "Gemini deep-dive verifies CV claims against READMEs, recent commits, and the repo file tree.",
    ],
  },
  {
    slug: "job-description-input",
    title: "Job description input",
    summary: "A role file or pasted role text can be attached to make the result role-specific.",
    details: [
      "The result adds fit score, matching skills, missing skills, seniority alignment, and salary positioning.",
      "Role-specific talking points and proof gaps are surfaced in the Job-fit tab.",
    ],
  },
  {
    slug: "linkedin-pdf-export",
    title: "LinkedIn PDF export",
    summary: "LinkedIn profile exports are handled as regular profile PDFs.",
    details: [
      "The app does not need a separate LinkedIn input mode.",
      "Profile extraction uses the same pipeline as uploaded CVs.",
    ],
  },
  {
    slug: "python-solution",
    title: "Python solution",
    summary: "The analysis engine is implemented as a Python package and runs independently from the web app.",
    details: [
      "The CLI lives at pipeline/jobfit/cli.py and returns the same JSON shape consumed by the UI.",
      "This keeps parsing, scoring, salary logic, and Gemini calls testable outside Next.js.",
    ],
  },
  {
    slug: "role-fit-scoring",
    title: "Role-fit scoring",
    summary: "When a job is supplied, the candidate is compared against the target role.",
    details: [
      "The job-fit result separates general profile strength from match quality for a specific vacancy.",
      "Missing skills and recruiter risk flags help identify what needs to be proven or improved.",
    ],
  },
  {
    slug: "salary-heuristic-data",
    title: "Salary heuristic data",
    summary: "Salary estimates start from local Czech technology benchmark data.",
    details: [
      "data/salary_benchmarks.json carries role × seniority anchor bands fed into the Gemini prompt.",
      "Gemini grounding can blend market context into the local range when enabled.",
    ],
  },
  {
    slug: "structured-scoring",
    title: "Structured scoring",
    summary: "Candidate seniority is scored from explicit profile factors.",
    details: [
      "The 0–100 score combines experience, skills, role seniority, education, and professional traits.",
      "The Extraction tab shows score breakdown and evidence trace so the score is auditable.",
    ],
  },
];

// Items live in source roughly in load order; the About tab presents them
// alphabetically by title so the left rail is browsable.
export const sortedCoverageItems = [...coverageItems].sort((a, b) =>
  a.title.localeCompare(b.title)
);
