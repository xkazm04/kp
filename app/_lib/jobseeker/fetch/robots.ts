// robots.txt — the part of politeness the HOST writes down.
//
// A deliberately small reader of the original REP (Google's RFC 9309 semantics for
// the two things that matter here): user-agent GROUPS, longest-match Allow/Disallow
// with `*` and `$`, and Crawl-delay. Anything else in the file (Sitemap:, Host:,
// comments, unknown directives) is ignored. No dependency — the format is twelve
// lines of grammar and a library would be a second parser to keep honest.

/** The token this crawler announces in its user-agent and looks for in robots.txt. */
export const CRAWLER_TOKEN = "kp-jobseeker";

export type RobotsRule = { allow: boolean; pattern: string };

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
        if (key === "disallow") current.rules.push({ allow: true, pattern: "/" });
        continue;
      }
      current.rules.push({ allow: key === "allow", pattern: value });
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

function patternToRegex(pattern: string): RegExp {
  // `*` matches any run; a trailing `$` anchors the end; everything else is literal.
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Longest-match evaluation over the binding group. Ties go to Allow. A path that
 *  no rule mentions is allowed. */
export function isPathAllowed(rules: RobotsRules, pathWithQuery: string, token: string = CRAWLER_TOKEN): boolean {
  const group = groupFor(rules, token);
  if (!group) return true;
  let best: RobotsRule | null = null;
  let bestLen = -1;
  for (const rule of group.rules) {
    if (!patternToRegex(rule.pattern).test(pathWithQuery)) continue;
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
