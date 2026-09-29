import type { Gig, GigBrief } from "./types";

// Withdraw reasons: a gig the operator took off the line FOR one of its brief's expected
// challenges remembers which one (Gig.withdrawReason, written by PATCH /api/gigs/[id]
// `withdraw` with `challenge: <index>`), and the next scans read those reasons back
// (research.ts hands them to the brief model, which writes a repeated obstacle in the
// operator's own words, so a repeat is countable by text). docs/features/gigs/README.md
// "Withdraw reasons" is the operator-facing account.
//
// PURE and client-safe: the desk counts reasons over the gigs it already holds, the
// scan over the rows the store reads. No db, no clock.

/** The heading of the brief's challenge section. The brief writes it (research.ts
 *  assembleGigBriefMarkdown) and this module reads it: one string, two readers. */
export const GIG_BRIEF_CHALLENGES_HEADING = "Expected challenges";

/** How many past reasons one brief call is shown (the most frequent, then the newest). */
export const GIG_WITHDRAW_REASONS_TO_MODEL = 12;

/** A challenge as a comparable key: case, width, quotes, whitespace and closing
 *  punctuation folded, so "Budget is fixed." and "budget is fixed" are one reason. */
export function challengeKey(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”"'‘’`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s.!?;:,]+$/, "")
    .trim();
}

/** Undo research.ts escapeBriefText: a backslash before the characters it escapes. */
function unescapeBriefText(s: string): string {
  return s.replace(/\\([\\*`<#[\]\-.])/g, "$1");
}

/** A brief's expected challenges, one per bullet. The stored list is the source (the
 *  brief's section is written from it); a brief whose list is empty is read from its
 *  "Expected challenges" section, so an older or hand-edited brief still offers its
 *  bullets. "None named." and prose lines are not challenges. */
export function briefChallenges(brief: Pick<GigBrief, "challenges" | "markdown"> | null | undefined): string[] {
  if (!brief) return [];
  const stored = (brief.challenges ?? []).map((c) => String(c ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (stored.length > 0) return stored;
  const out: string[] = [];
  let inside = false;
  for (const raw of String(brief.markdown ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      if (inside) break;
      inside = heading[1].trim() === GIG_BRIEF_CHALLENGES_HEADING;
      continue;
    }
    if (!inside) continue;
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      const text = unescapeBriefText(bullet[1]).trim();
      if (text && !out.some((o) => challengeKey(o) === challengeKey(text))) out.push(text);
    }
  }
  return out;
}

export type WithdrawReasonTally = { challenge: string; count: number; lastAt: string };

/** Past withdraw reasons, one row per reason (by challengeKey): the most frequent first,
 *  then the most recent. The newest wording of a reason is the one kept. */
export function tallyWithdrawReasons(gigs: readonly Pick<Gig, "withdrawReason">[]): WithdrawReasonTally[] {
  const byKey = new Map<string, WithdrawReasonTally>();
  for (const g of gigs) {
    const r = g.withdrawReason;
    if (!r || !r.challenge.trim()) continue;
    const key = challengeKey(r.challenge);
    const seen = byKey.get(key);
    if (!seen) byKey.set(key, { challenge: r.challenge, count: 1, lastAt: r.at });
    else {
      seen.count += 1;
      if (r.at > seen.lastAt) {
        seen.lastAt = r.at;
        seen.challenge = r.challenge;
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

/** How many gigs were withdrawn for each reason, keyed by challengeKey. */
export function withdrawCountsByKey(tallies: readonly WithdrawReasonTally[]): Map<string, number> {
  return new Map(tallies.map((t) => [challengeKey(t.challenge), t.count]));
}
