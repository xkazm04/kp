// The worked scoring example's synthetic candidate data for the early-career
// About tab. Split out of StudentsAbout.tsx (now AboutStudents.tsx) so that
// file stays under the 200-line cap — no JSX here, so it's a plain .ts file.

export type AxisKey = "skills" | "potential" | "motivation";
export const AXES: { key: AxisKey; label: string; sub: string }[] = [
  { key: "skills", label: "Demonstrated skill", sub: "provenance-weighted match" },
  { key: "potential", label: "Potential", sub: "depth · velocity · foundation · initiative" },
  { key: "motivation", label: "Motivation & fit", sub: "direction · domain fit" },
];

export type ExampleStudent = {
  name: string;
  tagline: string;
  weights: Record<AxisKey, number>; // % — bounded dynamic weights
  scores: Record<AxisKey, number>; // 0-100 per axis
  total: number;
  band: [number, number];
  bandLevel: "tight" | "moderate" | "wide";
  bandWhy: string;
  weightWhy: string;
  // Interview grid, keyed by the EXACT rubric competency names (1-5 + quote).
  ratings: Record<string, { score: number; evidence: string }>;
};

export const STUDENTS: ExampleStudent[] = [
  {
    name: "Adéla",
    tagline: "Part-time job + strong case-grounded interview → observed skills minted",
    weights: { skills: 48, potential: 34, motivation: 18 },
    scores: { skills: 82, potential: 68, motivation: 71 },
    total: 75,
    band: [69, 81],
    bandLevel: "moderate",
    bandWhy: "Early-career, but skills were directly observed (case-grounded interview) — band stays tighter.",
    weightWhy: "Must-haves backed by observed + professional evidence → demonstrated skill weighted up (bounded).",
    ratings: {
      "Problem decomposition": { score: 4, evidence: "Split the task into ingestion, validation and API before touching code." },
      "Learning agility": { score: 4, evidence: "\"I benchmarked both, saw the N+1, and rewrote the loader.\"" },
      Coachability: { score: 5, evidence: "Took the indexing hint and generalised it to the cache layer unprompted." },
      "Conceptual depth": { score: 4, evidence: "Explained WHY the queue decouples the spike, not just that it does." },
      "Motivation & direction": { score: 3, evidence: "Backend interest is real but the long-term goal is still fuzzy." },
      "Communication & collaboration": { score: 4, evidence: "Checked understanding before answering the counterfactual." },
    },
  },
  {
    name: "Bára",
    tagline: "Thesis + projects, no work yet → strong potential, thin proof",
    weights: { skills: 32, potential: 50, motivation: 18 },
    scores: { skills: 58, potential: 81, motivation: 74 },
    total: 72,
    band: [62, 82],
    bandLevel: "wide",
    bandWhy: "Early-career with no observed evidence yet — thinner, less-verifiable track record.",
    weightWhy: "No high-trust skill evidence yet — the case rests on trajectory, so potential carries the weight.",
    ratings: {
      "Problem decomposition": { score: 4, evidence: "Named the constraints first, then ordered sub-problems by risk." },
      "Learning agility": { score: 5, evidence: "Described a diagnose–experiment–adjust loop from the thesis dead-end." },
      Coachability: { score: 3, evidence: "Adjusted after the hint, but needed a second prompt to act on it." },
      "Conceptual depth": { score: 4, evidence: "Handled the 100× counterfactual; flagged where the design breaks." },
      "Motivation & direction": { score: 4, evidence: "Coherent throughline from coursework choices to this role." },
      "Communication & collaboration": { score: 3, evidence: "Clear but long-winded; structure appeared only when asked." },
    },
  },
  {
    name: "Cyril",
    tagline: "Long self-declared skill list, weak interview verification",
    weights: { skills: 40, potential: 40, motivation: 20 },
    scores: { skills: 49, potential: 52, motivation: 60 },
    total: 52,
    band: [42, 62],
    bandLevel: "wide",
    bandWhy: "Thin verification + overclaim risk — treat the score as provisional.",
    weightWhy: "Baseline weights — nothing verified enough to justify a shift; overclaim risk routed to interview.",
    ratings: {
      "Problem decomposition": { score: 2, evidence: "Jumped to a memorised pattern; missed the stated constraint." },
      "Learning agility": { score: 2, evidence: "\"It just worked after a while\" — no repeatable loop described." },
      Coachability: { score: 2, evidence: "Acknowledged the hint, then repeated the original approach." },
      "Conceptual depth": { score: 3, evidence: "Happy path explained; tradeoffs broke down on the first what-if." },
      "Motivation & direction": { score: 3, evidence: "Interest stated, but not tied to anything he has built." },
      "Communication & collaboration": { score: 3, evidence: "Pleasant and fluent — fluency scored separately from content." },
    },
  },
];

export const BAND_STYLE: Record<ExampleStudent["bandLevel"], string> = {
  tight: "text-moss",
  moderate: "text-steel",
  wide: "text-dial-amber",
};

export const ratingColor = (r: number) =>
  r >= 4 ? "bg-moss/15 text-moss" : r <= 2 ? "bg-coral/10 text-coral" : "bg-stone-100 text-ink";
