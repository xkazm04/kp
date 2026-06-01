export type NeedAnalysis = {
  realStack?: string[];
  coreResponsibilities?: string[];
  statedVsRealGaps?: string[];
  trueComplexity?: string;
  riskAreas?: string[];
  reflection?: string;
  confidence?: number;
};
export type RepoSnapshot = {
  ref?: string;
  languages?: Record<string, number>;
  inferredStack?: string[];
  topDirs?: string[];
  recentCommitSummaries?: string[];
  loc?: number;
  readmeExcerpt?: string;
};
export type Result = { analysis?: NeedAnalysis; snapshot?: RepoSnapshot | null; source?: string };

export type CoverProbe = { id?: string; kind?: string; where?: string; reveals?: string };
export type RubricDim = { name?: string; weight?: number; description?: string };
export type RoleSpec = { title?: string; seniority?: string; mustHaves?: string[]; niceToHaves?: string[]; responsibilities?: string[] };
export type CaseScenario = { title?: string; brief?: string; repoSeed?: string; tasks?: string[]; coverProbes?: CoverProbe[]; rubricDimensions?: RubricDim[]; timeboxHours?: number };
export type Design = { role?: RoleSpec; case?: CaseScenario; source?: string };
export type ApprovedCase = { id: string; title: string | null; roleTitle: string | null; seniority: string | null; createdAt: string };
export type Submission = {
  id: string;
  candidateRef: string | null;
  repoRef: string | null;
  notes: string | null;
  receivedAt: string;
  status?: string;
  evaluation?: EvalBundle | null;
  transferScore?: number | null;
};
export type Posting = {
  id: string;
  caseId: string | null;
  channel: string;
  token: string | null;
  roleTitle: string | null;
  caseTitle: string | null;
  submissionCount?: number;
  submissions?: Submission[];
};
export type Lifecycle = {
  id: string;
  title: string | null;
  stage: string;
  auto: boolean;
  detail: string | null;
  caseId: string | null;
  postingId: string | null;
  createdAt: string;
};

export type OutboxItem = { id: string; recipient: string | null; subject: string | null; kind: string | null; channel: string | null; status: string; createdAt: string };

export type Reflection = {
  narrative?: string;
  iterationPattern?: string;
  deadEnds?: string[];
  readBeforeWrite?: number;
  verificationHabits?: string[];
  confidence?: number;
};
export type ProbeOutcome = { probeId?: string; kind?: string; where?: string; detected?: boolean; handledWell?: boolean; note?: string };
export type Tooling = { fluency?: number; probeOutcomes?: ProbeOutcome[]; overRelianceFlags?: string[]; evidence?: string[]; confidence?: number };
export type CaseEval = { dimensionScores?: Record<string, number>; strengths?: string[]; concerns?: string[]; summary?: string };
export type Transfer = { transferScore?: number; transfers?: string[]; gaps?: string[]; roleFitRationale?: string };
export type EvalBundle = { reflection?: Reflection; tooling?: Tooling; evaluation?: CaseEval; transfer?: Transfer; source?: string; commitCount?: number };

export const LIFECYCLE_STEPS = ["intake", "analyzed", "designed", "approved", "collecting", "ranked", "promoted"];
export const STAGE_LABEL: Record<string, string> = {
  intake: "intake",
  analyzed: "analyzed",
  designed: "designed",
  awaiting_approval: "needs approval",
  approved: "approved",
  published: "published",
  collecting: "collecting",
  ranked: "ranked",
  promoted: "promoted",
};

export const COMPLEXITY: Record<string, string> = {
  low: "bg-moss/15 text-moss",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-coral/15 text-coral",
};
