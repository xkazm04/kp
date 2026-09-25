// robots.txt — the part of politeness the HOST writes down.
//
// A deliberately small reader of the original REP (Google's RFC 9309 semantics for
// the two things that matter here): user-agent GROUPS, longest-match Allow/Disallow
// with `*` and `$`, and Crawl-delay. Anything else in the file (Sitemap:, Host:,
// comments, unknown directives) is ignored. No dependency — the format is twelve
// lines of grammar and a library would be a second parser to keep honest.

/** The token this crawler announces in its user-agent and looks for in robots.txt. */
export const CRAWLER_TOKEN = "kp-jobseeker";

export type RobotsRule = {
  allow: boolean;
  pattern: string;
  /** The pattern split on `*` (a trailing `$` removed), compiled once at parse time. */
  segments: string[];
  anchored: boolean;
};

export type RobotsGroup = {
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
};

export type RobotsRules = {
  groups: RobotsGroup[];
};

export function parseRobots(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  // A group is one or more consecutive User-agent lines followed by their rules; a
  // User-agent line AFTER a rule line starts a new group (RFC 9309 §2.1).
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySeconds: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    if (!current) continue; // a rule before any User-agent line belongs to nobody
    lastWasAgent = false;
    if (key === "allow" || key === "disallow") {
      // An empty Disallow means "nothing is disallowed"; an empty Allow says nothing.
      if (value === "") {
        if (key === "disallow") current.rules.push(compileRule(true, "/"));
        continue;
      }
      current.rules.push(compileRule(key === "allow", value));
    } else if (key === "crawl-delay") {
      const n = Number(value.replace(",", "."));
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySeconds = n;
    }
  }
  return { groups };
}

/** The group that binds `token`: the most specific user-agent match wins (a group
 *  naming our token beats `*`); no group at all = everything allowed. */
export function groupFor(rules: RobotsRules, token: string = CRAWLER_TOKEN): RobotsGroup | null {
  const lower = token.toLowerCase();
  let star: RobotsGroup | null = null;
  for (const group of rules.groups) {
    if (group.agents.some((a) => a !== "*" && (lower.includes(a) || a.includes(lower)))) return group;
    if (!star && group.agents.includes("*")) star = group;
  }
  return star;
}

/** Does `path` match a robots pattern? `*` is any run (including an empty one), a
 *  trailing `$` anchors the end, everything else is literal (RFC 9309 §2.2.3).
 *
 *  Deliberately NOT a regex: `/*a*a*...*b` translated to `.*a.*a...` backtracks
 *  exponentially (ten wildcards against forty `a`s measured 45 s), and robots.txt is
 *  text a third party writes. Leftmost-first segment search is correct for `*`-only
 *  globs and costs at most O(path x pattern). */
export function matchesRobotsPattern(rule: Pick<RobotsRule, "segments" | "anchored">, path: string): boolean {
  const { segments, anchored } = rule;
  const first = segments[0];
  if (segments.length === 1) return anchored ? path === first : path.startsWith(first);
  if (!path.startsWith(first)) return false;
  let pos = first.length;
  const lastIndex = segments.length - 1;
  for (let i = 1; i < lastIndex; i++) {
    const seg = segments[i];
    if (!seg) continue;
    const at = path.indexOf(seg, pos);
    if (at < 0) return false;
    pos = at + seg.length;
  }
  const last = segments[lastIndex];
  if (anchored) return path.length - last.length >= pos && path.endsWith(last);
  return last === "" || path.indexOf(last, pos) >= 0;
}

/** A pattern split once, when the file is parsed — never per request. */
function compileRule(allow: boolean, pattern: string): RobotsRule {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  return { allow, pattern, segments: body.split("*"), anchored };
}

/** Longest-match evaluation over the binding group. Ties go to Allow. A path that
 *  no rule mentions is allowed. */
export function isPathAllowed(rules: RobotsRules, pathWithQuery: string, token: string = CRAWLER_TOKEN): boolean {
  const group = groupFor(rules, token);
  if (!group) return true;
  let best: RobotsRule | null = null;
  let bestLen = -1;
  for (const rule of group.rules) {
    if (!matchesRobotsPattern(rule, pathWithQuery)) continue;
    const len = rule.pattern.length;
    if (len > bestLen || (len === bestLen && rule.allow && best && !best.allow)) {
      best = rule;
      bestLen = len;
    }
  }
  return best ? best.allow : true;
}

export function crawlDelayFor(rules: RobotsRules, token: string = CRAWLER_TOKEN): number | null {
  return groupFor(rules, token)?.crawlDelaySeconds ?? null;
}
