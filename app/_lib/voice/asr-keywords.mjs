// The ASR keyword bias for the voice interview — ONE list-building rule shared
// by the agent deploy script (the account-wide floor) and the per-session
// override the browser sends (the per-JOB list).
//
// WHY: the voice harness caught the recognizer corrupting technology names
// ("React" → "Rust", "PostgreSQL" → "později SQL"), which the scorecard then
// scored as a fabricated skill set. The account-wide bias in
// scripts/setup-eleven-agent.mjs was the only fix reachable at the time — the
// browser SDK's override type had no `asr` field. As of @elevenlabs/client
// 1.21.0 it does (`overrides.asr.keywords`, max 50 per conversation), so the
// list can finally be built from the JOB the candidate is actually interviewing
// for, with the static list as the tail filler.
//
// Plain .mjs (not .ts) on purpose — same reasoning as interview-duration.mjs and
// eleven-agent-diff.mjs: the setup script runs under bare `node` with no build
// step, so anything it imports must be plain JS. The sibling .d.mts types it for
// the app and its tests. Pure: no DB, no env, no I/O — the caller resolves the
// job terms and passes them in.

/** ElevenLabs caps a conversation's keyword override. Exceeding it is not an
 *  error we would see: the platform truncates or rejects silently, so we cap. */
export const ASR_KEYWORD_LIMIT = 50;

/** The account-wide floor deployed onto the agent: the terms most likely to be
 *  spoken in ANY screen, biasing the vocabulary/segmentation cases (PostgreSQL,
 *  Kubernetes) more than true homophones. A session with a job attached puts
 *  that job's own stack in front of this (buildAsrKeywords), so this list is
 *  what a lab session — or a session for a job with no detected skills — runs
 *  on. Deliberately longer than ASR_KEYWORD_LIMIT: as a tail filler it is meant
 *  to be displaced by job terms, not to fit alongside them. */
export const BASE_ASR_KEYWORDS = [
  "React", "Angular", "Vue", "Svelte", "Next.js", "TypeScript", "JavaScript", "Python", "Java",
  "Kotlin", "Golang", "Rust", "Scala", "Ruby", "PHP", "C#", "Spring Boot", "Django", "FastAPI",
  "Flask", "Express", "Rails", ".NET", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Cassandra",
  "Kafka", "RabbitMQ", "Elasticsearch", "ClickHouse", "Snowflake", "Spark", "Docker", "Kubernetes",
  "Terraform", "Ansible", "Jenkins", "GitLab", "Nginx", "gRPC", "GraphQL", "REST", "OAuth",
  "AWS", "GCP", "Azure", "Linux", "PyTorch", "TensorFlow", "LangChain",
];

// A keyword biases the recognizer toward a TERM. Requirement rows and detected
// skills are free text written by a recruiter or an extraction model, so they
// also carry things that are not terms — "5+ years of experience with
// distributed systems", "communication skills", an empty string. Feeding those
// in wastes slots against the 50-cap and biases the recognizer toward ordinary
// words, which is worse than not biasing it at all.
const MAX_KEYWORD_CHARS = 40;
const MAX_KEYWORD_WORDS = 3;
// Letters (incl. accented), digits, and the punctuation real tech names carry:
// Next.js, C#, C++, CI/CD, Node.js, Objective-C — and a LEADING dot, because
// ".NET" is a term and not a typo. Trailing sentence punctuation (a "!" or a
// closing "." on prose) still fails the shape, which is the point.
const KEYWORD_SHAPE = /^[\p{L}\p{N}.][\p{L}\p{N} .+#/&_-]*$/u;

/** Normalize one candidate term, or null when it is not term-shaped. Exported
 *  for the unit test — the rejection rules are the interesting part. */
export function normalizeKeyword(value) {
  if (typeof value !== "string") return null;
  const term = value.trim().replace(/\s+/g, " ");
  if (!term || term.length > MAX_KEYWORD_CHARS) return null;
  if (term.split(" ").length > MAX_KEYWORD_WORDS) return null;
  if (!KEYWORD_SHAPE.test(term)) return null;
  return term;
}

/**
 * Build the keyword list for ONE conversation: the job's own terms first, the
 * account-wide floor filling whatever slots remain, deduped case-insensitively
 * (first spelling wins — "PostgreSQL" from the job beats "postgresql" from the
 * floor) and capped at ASR_KEYWORD_LIMIT.
 *
 * Order matters beyond the cap: it is what the job's stack displaces when the
 * two lists together exceed 50.
 *
 * @param {Iterable<unknown>} [jobTerms]  Skills/requirements from the job, in priority order.
 * @param {Iterable<unknown>} [base]      The floor list; defaults to BASE_ASR_KEYWORDS.
 * @param {number} [limit]                Defaults to ASR_KEYWORD_LIMIT.
 * @returns {string[]}
 */
export function buildAsrKeywords(jobTerms = [], base = BASE_ASR_KEYWORDS, limit = ASR_KEYWORD_LIMIT) {
  const out = [];
  const seen = new Set();
  for (const source of [jobTerms, base]) {
    for (const raw of source ?? []) {
      if (out.length >= limit) return out;
      const term = normalizeKeyword(raw);
      if (!term) continue;
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(term);
    }
  }
  return out;
}
