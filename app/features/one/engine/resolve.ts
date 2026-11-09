// /one's conductor for round 1 — PURE and DETERMINISTIC: no I/O, no clock, no model.
//
// It maps a chip or the user's typed words onto ONE of a small set of intents and
// answers with a Reply in the closed vocabulary (../types.ts). Keyword matching, not a
// guess: words it does not recognise get the honest "not in this prototype yet" reply
// and three chips, never the nearest-looking intent. A model can replace this function
// later behind the same signature; the validation door (validate.ts) is already the
// thing that stands between whatever composes and the screen.
//
// Three rules from the governing standard (model-composed-workspace) are enforced here
// by construction and pinned by resolve.test.ts:
//   - `say` is a catalog key, never English, and carries NO figure — a count the user
//     needs is on a panel that fetched it, so a reply cannot assert a stale number;
//   - ≤ 4 ops, each a closed verb; data changes are `propose`, never applied;
//   - the user's own words (a role name, a threshold they typed) travel as op PARAMS,
//     where the panel or the consent card reads them back as the user's words.
import type { AttentionCounts } from "@/app/_lib/attention";
import type { ChipId, OneInput, Op, Reply, SayKey } from "../types";

export type ResolveContext = {
  /** The latest /api/attention read, or null when it has not landed or failed. Used
   *  only to ORDER follow-up chips (what needs the user first) — never quoted. */
  attention: AttentionCounts | null;
  /** The active entries from the shared pipeline read (null until it lands). Used only to
   *  bind "open <name>" to ONE candidate; an ambiguous or unread name shows the matching
   *  slice instead, never a guess. */
  entries?: readonly { id: string; label: string }[] | null;
};

/** The intents round 1 answers. Exported for the tests and the doc table. */
export const INTENTS = [
  "needs",
  "decisions",
  "pipeline",
  "stalled",
  "interviews",
  "funnel",
  "arrivals",
  "drafts",
  "outbox",
  "letters",
  "calendar",
  "openProfile",
  "role",
  "rejectBelow",
  "advanceTop",
  "companionAnalyse",
  "companionJd",
  "companionOutreach",
  "companionDigest",
  "console",
] as const;
export type Intent = (typeof INTENTS)[number];

const CHIP_INTENT: Record<ChipId, Intent> = {
  needs: "needs",
  decisions: "decisions",
  pipeline: "pipeline",
  stalled: "stalled",
  interviews: "interviews",
  funnel: "funnel",
  arrivals: "arrivals",
  drafts: "drafts",
  outbox: "outbox",
  digest: "companionDigest",
  letters: "letters",
  calendar: "calendar",
};

/** The chips offered after an unknown request: the three most useful questions. */
export const FALLBACK_CHIPS: readonly ChipId[] = ["needs", "pipeline", "funnel"];

/** Clamp a typed number into [lo, hi]; a non-number is null (the intent then refuses). */
function clampInt(raw: string | undefined, lo: number, hi: number): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

/** The role the user named with "for …" / "on …" at the end of the sentence, in their
 *  own words (trimmed of a trailing "role" and punctuation), or null. */
export function roleOf(text: string): string | null {
  const m = text.match(/\b(?:for|on)\s+(?:the\s+)?(.{2,60}?)(?:\s+(?:role|position|job))?[\s.?!]*$/i);
  if (!m) return null;
  const role = m[1].trim();
  // "for today", "on the board" are not roles.
  if (/^(today|now|me|us|the board|board|pipeline|this week|the week)$/i.test(role)) return null;
  return role.length >= 2 ? role : null;
}

type Match = { intent: Intent; text: string };

/** Words after "open" that name a VIEW, not a candidate ("open the pipeline"). */
const VIEW_WORDS = /\b(pipeline|board|calendar|schedule|decisions?|letters?|outbox|console|workspace|funnel|drafts?|interviews?|needs)\b/i;

/** Typed words → intent, or null. Order matters and is the whole design: the specific
 *  (a wave, a companion act) is tested before the general it contains ("draft a JD"
 *  before "drafts", "reject below" before "pipeline"). */
export function matchIntent(raw: string): Match | null {
  const text = raw.trim();
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\breject\b.*\bbelow\s+\d{1,3}\s*%?/.test(t)) return { intent: "rejectBelow", text };
  if (/\badvance\b.*\btop\s+\d{1,3}\b/.test(t)) return { intent: "advanceTop", text };
  if (/\b(analy[sz]e|screen|re-?run)\b.*\b(cv|resume|candidate|analysis)\b/.test(t)) return { intent: "companionAnalyse", text };
  if (/\b(draft|write|build)\b.*\b(jd|job description|job ad)\b/.test(t)) return { intent: "companionJd", text };
  // A companion draft needs the verb: bare "outreach" is the held letters' view (below).
  if (/\b(draft|write|compose)\b.*\boutreach\b|\b(draft|write)\b.*\b(message|email|letter)\s+to\b/.test(t)) return { intent: "companionOutreach", text };
  if (/\bdigest\b|\bsummar(y|ise|ize)\b.*\b(day|today)\b/.test(t)) return { intent: "companionDigest", text };
  if (/\b(console|workspace|full board|old view)\b/.test(t)) return { intent: "console", text };
  // "open Jana Nováková" / "profile of Jana" — a candidate by name, unless the rest names a view.
  const named = text.match(/^\s*(?:open|profile\s+(?:of|for))\s+(?:the\s+)?(.{2,60}?)[\s.?!]*$/i);
  if (named && !VIEW_WORDS.test(named[1])) return { intent: "openProfile", text: named[1].trim() };
  // Held outreach letters: "emails to approve", "drafts waiting", "letters", "outreach" — but
  // "draft / write outreach to …" is the companion's act (tested above, so it never lands here).
  if (/\b(emails? to approve|drafts? waiting|letters?|outreach)\b/.test(t) && !/\b(draft|write|compose)\b/.test(t)) return { intent: "letters", text };
  if (/\b(decision|decisions|approve|approval|waiting on me|sign[- ]off)\b/.test(t)) return { intent: "decisions", text };
  if (/\b(stalled|stuck|aging|ageing|overdue|slow|past (the|their) limit)\b/.test(t)) return { intent: "stalled", text };
  if (/\b(calendar|schedule|this week|waiting for an? interviews?|book|slots?)\b/.test(t)) return { intent: "calendar", text };
  if (/\b(interview|interviews|scheduled|booked)\b/.test(t)) return { intent: "interviews", text };
  if (/\b(how are we doing|funnel|conversion|analytics|metrics|how is it going)\b/.test(t)) return { intent: "funnel", text };
  if (/\b(new arrivals?|arrived|new applications?|applied|inbound|newcomers?)\b/.test(t)) return { intent: "arrivals", text };
  if (/\b(drafts?|unpublished|to publish|publish)\b/.test(t)) return { intent: "drafts", text };
  if (/\b(sent|outbox|emails?|messages?|comms|mail)\b/.test(t)) return { intent: "outbox", text };
  if (/\b(what needs me|needs me|needs my|attention|what'?s up|today|to do|todo)\b/.test(t)) return { intent: "needs", text };
  if (/\b(pipeline|board|candidates)\b/.test(t)) return { intent: "pipeline", text };
  if (/\b(role|job|position|requisition)\b/.test(t)) return { intent: "role", text };
  return null;
}

/** The follow-ups after an answer: the buckets that need the user first (ordered by the
 *  attention read when there is one), never the chip the user just pressed. */
function followUps(exclude: readonly ChipId[], ctx: ResolveContext): ChipId[] {
  const a = ctx.attention;
  const ranked: ChipId[] = [];
  if (a) {
    if (a.decisions > 0) ranked.push("decisions");
    if (a.pipeline > 0) ranked.push("stalled");
    if (a.channels > 0) ranked.push("arrivals");
    if (a.schedule > 0) ranked.push("interviews");
    if (a.jobs > 0) ranked.push("drafts");
  }
  for (const c of ["needs", "pipeline", "funnel", "outbox"] as const) ranked.push(c);
  const out: ChipId[] = [];
  for (const c of ranked) {
    if (!exclude.includes(c) && !out.includes(c)) out.push(c);
    if (out.length === 3) break;
  }
  return out;
}

const reply = (key: SayKey, ops: Op[], chips: ChipId[], fallback = false): Reply => ({
  say: { key },
  ops,
  chips,
  ...(fallback ? { fallback: true } : {}),
});

/** One intent → one reply. */
function answer(m: Match, ctx: ResolveContext, chip: ChipId | null): Reply {
  const own = chip ? [chip] : [];
  const role = roleOf(m.text);
  switch (m.intent) {
    case "needs":
      return reply("needsShown", [{ op: "show", panel: "needs" }], followUps(["needs", ...own], ctx));
    case "decisions":
      return reply("decisionsShown", [{ op: "show", panel: "decisionsQueue" }], followUps(["decisions", ...own], ctx));
    case "pipeline":
      return role
        ? reply("pipelineRoleShown", [{ op: "show", panel: "pipelineSlice", params: { role } }, { op: "show", panel: "roleCard", params: { role } }], followUps(["pipeline", ...own], ctx))
        : reply("pipelineShown", [{ op: "show", panel: "pipelineSlice" }], followUps(["pipeline", ...own], ctx));
    case "stalled":
      return reply("stalledShown", [{ op: "show", panel: "pipelineSlice", params: { filter: "aging", ...(role ? { role } : {}) } }], followUps(["stalled", ...own], ctx));
    case "interviews":
      return reply("interviewsShown", [{ op: "show", panel: "scheduleAhead" }], followUps(["interviews", ...own], ctx));
    case "funnel":
      return reply("funnelShown", [{ op: "show", panel: "funnel" }], followUps(["funnel", ...own], ctx));
    case "arrivals":
      return reply("arrivalsShown", [{ op: "show", panel: "pipelineSlice", params: { filter: "new", ...(role ? { role } : {}) } }], followUps(["arrivals", ...own], ctx));
    case "drafts":
      return reply("draftsShown", [{ op: "show", panel: "jobDrafts" }], followUps(["drafts", ...own], ctx));
    case "outbox":
      return reply("outboxShown", [{ op: "show", panel: "outbox" }], followUps(["outbox", ...own], ctx));
    case "letters":
      return reply("lettersShown", [{ op: "show", panel: "letters" }], followUps(["letters", "outbox", ...own], ctx));
    case "calendar":
      return reply("calendarShown", [{ op: "show", panel: "calendar" }], followUps(["calendar", "interviews", ...own], ctx));
    case "openProfile": {
      // m.text is the NAME (matchIntent cut it out). One active candidate answers to it →
      // their profile; several, none, or the pipeline not read yet → the slice filtered by
      // that name, where the user picks (or reads that nobody matches).
      const name = m.text;
      const hits = ctx.entries ? ctx.entries.filter((e) => nameMatches(e.label, name)) : null;
      if (hits && hits.length === 1) {
        return reply("profileShown", [{ op: "show", panel: "profile", params: { entryId: hits[0].id, label: hits[0].label } }], followUps([], ctx));
      }
      return reply(hits && hits.length === 0 ? "profileNone" : "profileMany", [{ op: "show", panel: "pipelineSlice", params: { name } }], followUps(["pipeline"], ctx));
    }
    case "role":
      return role
        ? reply("roleShown", [{ op: "show", panel: "roleCard", params: { role } }, { op: "show", panel: "pipelineSlice", params: { role } }], followUps(["pipeline"], ctx))
        : reply("roleAsk", [], followUps([], ctx));
    case "rejectBelow": {
      const threshold = clampInt(m.text.toLowerCase().match(/\bbelow\s+(\d{1,3})/)?.[1], 1, 100);
      if (threshold === null) return unknown();
      const params: Record<string, string> = { mode: "reject", threshold: String(threshold), ...(role ? { role } : {}) };
      return reply(
        "waveRejectProposed",
        [{ op: "show", panel: "pipelineSlice", params: role ? { role } : {} }, { op: "propose", act: "wave", params }],
        followUps(["pipeline"], ctx)
      );
    }
    case "advanceTop": {
      const count = clampInt(m.text.toLowerCase().match(/\btop\s+(\d{1,3})/)?.[1], 1, 50);
      if (count === null) return unknown();
      return reply(
        "waveAdvanceProposed",
        [{ op: "show", panel: "pipelineSlice" }, { op: "propose", act: "wave", params: { mode: "advance", count: String(count) } }],
        followUps(["pipeline"], ctx)
      );
    }
    case "companionAnalyse":
      return reply("companionProposed", [{ op: "propose", act: "companion", params: { action: "run_analysis" } }], followUps([], ctx));
    case "companionJd":
      return reply("companionProposed", [{ op: "propose", act: "companion", params: { action: "draft_jd" } }, { op: "show", panel: "jobDrafts" }], followUps(["drafts"], ctx));
    case "companionOutreach":
      return reply("companionProposed", [{ op: "propose", act: "companion", params: { action: "draft_outreach" } }], followUps([], ctx));
    case "companionDigest":
      return reply("companionProposed", [{ op: "propose", act: "companion", params: { action: "generate_digest" } }, { op: "show", panel: "needs" }], followUps(["digest", "needs"], ctx));
    case "console":
      return reply("consoleOffered", [{ op: "navigate", tab: "pipeline" }], followUps([], ctx));
  }
}

/** Every word of the typed name appears in the label (case- and accent-insensitive) — the
 *  same rule the slice filters by (panels/pipelineRead.ts matchesName). */
function nameMatches(label: string, name: string): boolean {
  const fold = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const l = fold(label);
  return fold(name).split(/\s+/).filter(Boolean).every((w) => l.includes(w));
}

function unknown(): Reply {
  return reply("notYet", [], [...FALLBACK_CHIPS], true);
}

/** The conductor. A chip is its intent; typed words go through the matcher; nothing
 *  matched is the honest fallback, never a guess. */
export function resolve(input: OneInput, ctx: ResolveContext): Reply {
  if (input.chip) {
    const intent = CHIP_INTENT[input.chip];
    if (intent) return answer({ intent, text: "" }, ctx, input.chip);
  }
  const m = matchIntent(input.text ?? "");
  return m ? answer(m, ctx, null) : unknown();
}
