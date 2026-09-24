// Helpers every gig adapter reaches for: the detail-fetch rule, the key door, the
// money reader, and text clipping. JSON/ISO/string coercion is the job-seeker side's
// (jobseeker/adapters/shared.ts) and is re-used from there, never forked.

import type { FetchOk, FetchOutcome } from "../../jobseeker/fetch/politeFetch";
import type { GigReward } from "../types";
import { FetchHalt, type GigAdapterContext } from "./types";

export { isoOrNull, mustOk, num, parseJsonBody, str } from "../../jobseeker/adapters/shared";

/** A brief is a page, not a book: what the desk and the honeypot scan read is bounded. */
export const MAX_GIG_BODY_CHARS = 60_000;

export function clipBody(text: string | null | undefined): string {
  return typeof text === "string" ? text.slice(0, MAX_GIG_BODY_CHARS) : "";
}

/** A per-item read (a bot comment, a program policy): `blocked`/`offline` halt the
 *  source - a denial anywhere is a denial - while gone/outage/robots skip just this
 *  item and the listing is kept without the extra detail. */
export function detailOk(outcome: FetchOutcome, ctx: GigAdapterContext, url: string): FetchOk | null {
  if (outcome.kind === "ok") return outcome;
  if (outcome.kind === "blocked" || outcome.kind === "offline") throw new FetchHalt(outcome);
  ctx.log({ level: "warn", code: `detail_${outcome.kind}`, detail: `${url}: ${outcome.detail}` });
  return null;
}

/** The first non-empty value among the named keys, read through the context's env door. */
export function envKey(ctx: GigAdapterContext, ...names: string[]): string | null {
  for (const name of names) {
    const v = ctx.env(name);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function basicAuth(user: string, secret: string): string {
  return `Basic ${Buffer.from(`${user}:${secret}`, "utf8").toString("base64")}`;
}

/** Config string list: an array of non-empty strings, or a single comma-separated string. */
export function cfgList(config: Record<string, unknown>, key: string): string[] {
  const v = config[key];
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?`;
const K_SUFFIX = String.raw`(\s?[kK](?![a-zA-Z]))?`;
const CODES = "USD|EUR|GBP|CAD|AUD|CHF|CZK|INR|USDC|USDT|ETH|BTC|SOL";

const SYMBOL_CURRENCY: Record<string, string> = {
  "US$": "USD",
  $: "USD",
  "CA$": "CAD",
  C$: "CAD",
  "AU$": "AUD",
  A$: "AUD",
  "€": "EUR",
  "£": "GBP",
};

const SYMBOL_RE = new RegExp(String.raw`(US\$|CA\$|C\$|AU\$|A\$|\$|€|£)\s?${AMOUNT}${K_SUFFIX}`, "g");
const AMOUNT_CODE_RE = new RegExp(String.raw`(?<![\w.])${AMOUNT}${K_SUFFIX}\s?(${CODES})(?![a-zA-Z])`, "gi");
const CODE_AMOUNT_RE = new RegExp(String.raw`(?<![a-zA-Z])(${CODES})\s?${AMOUNT}${K_SUFFIX}`, "gi");
const KEYWORD_RE = new RegExp(String.raw`\b(?:bounty|reward|prize)\s*[:=]\s*${AMOUNT}${K_SUFFIX}(?![\d%])`, "gi");
/** Words that make an amount in free prose a reward rather than a hosting bill. */
const REWARD_WORD_RE = /\b(bount(?:y|ies)|reward|prize|payout|paying|pays|paid|budget|compensation)\b/i;

type MoneyHit = { index: number; amount: number; currency: string | null; text: string };

function toAmount(whole: string, frac: string | undefined, k: string | undefined): number | null {
  const n = Number(whole.replace(/,/g, "")) + (frac ? Number(`0.${frac}`) : 0);
  const v = k ? n * 1000 : n;
  // Zero is not a reward, and eight figures in a bounty label is a typo or an issue number.
  return Number.isFinite(v) && v > 0 && v < 10_000_000 ? v : null;
}

function hits(text: string): MoneyHit[] {
  const out: MoneyHit[] = [];
  for (const m of text.matchAll(SYMBOL_RE)) {
    const amount = toAmount(m[2], m[3], m[4]);
    if (amount !== null) out.push({ index: m.index ?? 0, amount, currency: SYMBOL_CURRENCY[m[1]] ?? null, text: m[0].trim() });
  }
  for (const m of text.matchAll(AMOUNT_CODE_RE)) {
    const amount = toAmount(m[1], m[2], m[3]);
    if (amount !== null) out.push({ index: m.index ?? 0, amount, currency: m[4].toUpperCase(), text: m[0].trim() });
  }
  for (const m of text.matchAll(CODE_AMOUNT_RE)) {
    const amount = toAmount(m[2], m[3], m[4]);
    if (amount !== null) out.push({ index: m.index ?? 0, amount, currency: m[1].toUpperCase(), text: m[0].trim() });
  }
  for (const m of text.matchAll(KEYWORD_RE)) {
    const amount = toAmount(m[1], m[2], m[3]);
    if (amount !== null) out.push({ index: m.index ?? 0, amount, currency: null, text: m[0].trim() });
  }
  // Leftmost wins; on a tie the currency-bearing reading beats the bare keyword one.
  return out.sort((a, b) => a.index - b.index || (a.currency === null ? 1 : 0) - (b.currency === null ? 1 : 0));
}

/** The first money amount a short text states ("$500", "500 USD", "bounty: 1,000",
 *  "€2k"). With `requireRewardWord`, an amount counts only when a reward word
 *  (bounty, reward, prize, budget...) sits within 60 characters of it - a brief that
 *  mentions a "$20/month server" is not offering $20. Null when nothing parses. */
export function parseMoney(text: string | null | undefined, opts: { requireRewardWord?: boolean } = {}): GigReward | null {
  if (!text) return null;
  for (const h of hits(text)) {
    if (opts.requireRewardWord) {
      const window = text.slice(Math.max(0, h.index - 60), h.index + h.text.length + 60);
      if (!REWARD_WORD_RE.test(window)) continue;
    }
    return { amount: h.amount, currency: h.currency, text: h.text };
  }
  return null;
}
