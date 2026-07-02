// Natural-language pipeline command bar (#7) — the PURE, tested parse layer (the
// only genuinely new capability; the actions it maps to already exist, with
// fairness backstops + supervised mode). A deterministic intent matcher over a
// small, safe command set; every MUTATING intent is preview-then-confirm at the
// route, so nothing executes without the recruiter seeing the affected set first.
// An LLM fallback for free-form phrasing can wrap this (parse here first, defer to
// a model only on `unknown`) — kept out of the core so it stays import-free/tested.

export type ParsedCommand =
  | { kind: "reject_below"; threshold: number; jobQuery: string | null }
  | { kind: "advance_top"; count: number }
  | { kind: "run_policy" }
  | { kind: "help" }
  | { kind: "unknown"; text: string };

// Bounds so a parsed command can never request something absurd (a 0% reject that
// matches everyone, or "advance top 9999"). The route re-clamps defensively too.
const MAX_ADVANCE = 50;

function clampThreshold(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(1, Math.round(n)));
}

function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_ADVANCE, Math.max(1, Math.round(n)));
}

/** Parse a recruiter's typed command into one of the known intents, or `unknown`
 *  (which the UI shows as "didn't catch that" + examples). Deterministic and
 *  order-sensitive: the most specific patterns are tried first. Never throws. */
export function parseCommand(input: string): ParsedCommand {
  const text = (input ?? "").trim();
  if (!text) return { kind: "unknown", text: "" };
  const lower = text.toLowerCase();

  if (lower === "help" || lower === "?" || lower === "commands") return { kind: "help" };

  // "reject everyone/all/candidates below 60%[ on backend]" — the % is optional.
  const reject = lower.match(/reject\b.*?\bbelow\s+(\d{1,3})\s*%?/);
  if (reject) {
    const threshold = clampThreshold(Number(reject[1]));
    // Optional "on <role/job query>" tail scopes it to a matching job title.
    const onMatch = text.match(/\bon\s+(.{1,60})$/i);
    const jobQuery = onMatch ? onMatch[1].trim() : null;
    return { kind: "reject_below", threshold, jobQuery };
  }

  // "advance the top 3" / "advance top 5 candidates"
  const advance = lower.match(/advance\b.*?\btop\s+(\d{1,3})/);
  if (advance) return { kind: "advance_top", count: clampCount(Number(advance[1])) };

  // "run the policy pass" / "run automation"
  if (/\brun\b.*\b(policy|automation)\b/.test(lower)) return { kind: "run_policy" };

  return { kind: "unknown", text };
}

/** A short, human-readable echo of what a parsed command will do — shown above the
 *  preview so the recruiter confirms intent, not just a candidate count. */
export function describeCommand(cmd: ParsedCommand): string {
  switch (cmd.kind) {
    case "reject_below":
      // "and notify" is load-bearing copy, not flourish: the execute path now
      // queues a rejection comm per candidate (UAT M3), so the preview must tell
      // the operator these candidates will be contacted, not silently dropped.
      return cmd.jobQuery
        ? `Reject and notify active candidates scoring below ${cmd.threshold}% on roles matching "${cmd.jobQuery}".`
        : `Reject and notify active candidates scoring below ${cmd.threshold}%.`;
    case "advance_top":
      // "up to Offer" is load-bearing copy: the execute path holds Offer-stage
      // targets instead of bare-advancing them to Hired (a hire happens only when
      // the candidate accepts an extended offer), so the preview must say so.
      return `Advance the top ${cmd.count} active candidate${cmd.count === 1 ? "" : "s"} by match score (up to Offer — candidates at Offer await the offer flow).`;
    case "run_policy":
      return "Run the deterministic automation policy pass now.";
    case "help":
      return "Commands you can type.";
    case "unknown":
      return "Didn't catch that.";
  }
}

/** Whether an intent mutates state (so the route requires an explicit confirm). */
export function isMutating(cmd: ParsedCommand): boolean {
  return cmd.kind === "reject_below" || cmd.kind === "advance_top" || cmd.kind === "run_policy";
}
