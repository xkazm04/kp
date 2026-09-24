// The deterministic honeypot scan. Gig text is UNTRUSTED - written by strangers, and a
// real share of public bounty and freelance listings carry text aimed at the agents that
// read them: a hidden "ignore previous instructions", a request for the reader's API key,
// a "contact me on Telegram, paid in USDT". A listing that trips any rule is stored as
// `suspect` (upsertGigFromRaw) and is never dispatched until the operator clears it.
//
// PURE: string in, reasons out. No model, no network, no clock - the same listing always
// yields the same reasons, so the verdict is reproducible and testable (suspect.test.ts
// holds real-looking positives AND the negatives each rule must leave alone).
//
// The rules and what they are careful NOT to catch:
//   hidden_instructions   text the operator would not see - an HTML comment, a
//                         display:none / zero-size / white-on-white element, a `hidden`
//                         element, Unicode tag characters, a zero-width run - that carries
//                         an instruction; or a phrase another rule catches only once
//                         zero-width characters inside its words are removed. A plain
//                         issue-template comment ("<!-- Describe the bug -->") is NOT one.
//   prompt_exfiltration   "ignore previous instructions", "your system prompt", "paste your
//                         prompt". A brief about WRITING system prompts is not.
//   credential_request    a request verb aimed at the reader's key/token/password/seed
//                         phrase/SSH key. "Implement password reset", "rotate API keys" are not.
//   off_platform_payment  contact on Telegram/WhatsApp (or Discord "for payment"), payment
//                         in crypto/PayPal/gift cards, "email me directly", a wallet address.
//                         "Build a Discord bot", "a crypto wallet app" are not.
//   agent_addressed       text addressed TO an AI reader: "If you are an AI...", "Dear
//                         ChatGPT,", "any LLM reading this". A brief about building an AI
//                         product, or "You are an AI engineer", is not.

import { GIG_SUSPECT_REASONS, type GigSuspectReason } from "./types";

export type HoneypotScanInput = { bodyText: string; bodyHtml: string | null; title: string };

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const ZERO_WIDTH = /[​‌‍⁠﻿᠎]/g;
const ZERO_WIDTH_RUN = /[​‌‍⁠﻿᠎]{8,}/;
/** A zero-width character wedged between two letters - how a phrase dodges a filter. */
const ZERO_WIDTH_IN_WORD = /\p{L}[​‌‍⁠﻿᠎]+\p{L}/u;
const TAG_RUN = /[\u{E0000}-\u{E007F}]+/gu;

/** NFKC folds full-width and styled letters to plain ones; curly quotes become straight. */
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\S\n]+/g, " ");
}

function stripTags(html: string): string {
  return html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ");
}

// ---------------------------------------------------------------------------
// Hidden segments
// ---------------------------------------------------------------------------

const HTML_COMMENT = /<!--([\s\S]*?)(?:-->|$)/g;
const MD_COMMENT = /^[ \t]*\[(?:\/\/|comment|_)\]:\s*#\s*[("'](.*)[)"'][ \t]*$/gim;
const HIDDEN_STYLE =
  /<(\w+)\b[^>]*\bstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:\.0+)?(?:px|em|rem|pt|%)?(?=\s*(?:;|!|["']))|opacity\s*:\s*0(?:\.0+)?(?=\s*(?:;|!|["']))|(?<![\w-])color\s*:\s*(?:#fff(?:fff)?\b|white\b|transparent\b))[^"']*["'][^>]*>([\s\S]*?)<\/\1\s*>/gi;
const HIDDEN_ATTR = /<(\w+)\b[^>]*\shidden(?:\s*=\s*["'][^"']*["'])?(?=[\s>/])[^>]*>([\s\S]*?)<\/\1\s*>/gi;

/** Decoded Unicode tag-character runs that are NOT an emoji subdivision flag
 *  (🏴 + "gbeng" + cancel is the one legitimate use). */
function tagSmuggled(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TAG_RUN)) {
    const decoded = [...m[0]].map((ch) => String.fromCharCode((ch.codePointAt(0) ?? 0xe0000) - 0xe0000)).join("");
    const payload = decoded.replace(/\x7f$/, "");
    if (/^[a-z]{2}[a-z0-9]{1,4}$/.test(payload)) continue; // a subdivision flag tag sequence
    out.push(payload);
  }
  return out;
}

function hiddenSegments(sources: string[]): string[] {
  const out: string[] = [];
  for (const src of sources) {
    for (const m of src.matchAll(HTML_COMMENT)) out.push(m[1]);
    for (const m of src.matchAll(MD_COMMENT)) out.push(m[1]);
    for (const m of src.matchAll(HIDDEN_STYLE)) out.push(stripTags(m[2]));
    for (const m of src.matchAll(HIDDEN_ATTR)) out.push(stripTags(m[2]));
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const SENT = String.raw`[^.!?\n]`;

const PROMPT_EXFILTRATION: RegExp[] = [
  /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+|every\s+)?(?:of\s+)?(?:the\s+|your\s+|my\s+|these\s+|those\s+)?(?:previous|prior|above|earlier|preceding|original|initial|system|existing)\s+(?:instructions?|prompts?|directions?|rules|guidelines|directives|messages?|context)\b/i,
  /\byour\s+(?:own\s+)?(?:system\s+prompt|system\s+message|initial\s+prompt|hidden\s+prompt|original\s+prompt|original\s+instructions|initial\s+instructions|hidden\s+instructions|pre-?prompt|custom\s+instructions)\b/i,
  new RegExp(
    String.raw`\b(?:reveal|print|show|output|repeat|paste|share|send|copy|display|dump|leak|disclose|include|post|give\s+me|tell\s+me)\b${SENT}{0,30}\b(?:your|the)\s+(?:full\s+|entire\s+|complete\s+|exact\s+|verbatim\s+)?(?:system\s+prompt|system\s+message|pre-?prompt|initial\s+prompt|hidden\s+prompt)\b`,
    "i"
  ),
  /\b(?:paste|share|send|post|reveal|repeat)\s+(?:us\s+|me\s+)?your\s+(?:full\s+|exact\s+)?(?:prompts?|instructions)\b/i,
  /\b(?:jailbreak(?:ed)?|developer\s+mode\s+enabled|you\s+are\s+now\s+(?:dan|in\s+developer\s+mode))\b/i,
];

const CREDENTIAL_NOUN = String.raw`(?:api[\s_-]?keys?|access[\s_-]?tokens?|auth(?:entication)?[\s_-]?tokens?|bearer[\s_-]?tokens?|personal[\s_-]?access[\s_-]?tokens?|tokens?|passwords?|passphrases?|passcodes?|seed[\s_-]?phrases?|recovery[\s_-]?phrases?|mnemonic(?:\s+phrase)?|private[\s_-]?keys?|ssh[\s_-]?keys?|id_rsa|secret[\s_-]?keys?|secrets|credentials?|login\s+(?:details|info|credentials)|2fa\s+codes?|otp|one[\s-]time\s+(?:codes?|passwords?)|\.env(?:\s+file)?)`;
const NOT_A_FEATURE = String.raw`(?![\s-]?(?:reset|hash|hashing|rotation|refresh|validation|policy|policies|strength|field|manager|flow|input|form|storage|encryption|generation|handling|management|scanner|scanning|leak|leaks))`;

const CREDENTIAL_REQUEST: RegExp[] = [
  new RegExp(
    String.raw`\b(?:send|share|provide|give|paste|dm|email|e-mail|submit|enter|post|upload|forward|include|attach|tell|message|type|drop)\b${SENT}{0,30}?\b(?:your|ur)\s+(?:[\w-]+\s+){0,2}?${CREDENTIAL_NOUN}\b${NOT_A_FEATURE}`,
    "i"
  ),
  new RegExp(String.raw`\b(?:your|ur)\s+(?:[\w-]+\s+){0,2}?${CREDENTIAL_NOUN}\b${NOT_A_FEATURE}${SENT}{0,30}\b(?:to|with)\s+(?:me|us)\b`, "i"),
  /\b(?:seed|recovery|mnemonic)\s+(?:phrase|words)\b[^.!?\n]{0,40}\b(?:send|share|provide|dm|paste|enter|verify|submit)\b/i,
];

const MESSENGER = String.raw`(?:telegram|whatsapp|whats\s+app|signal\s+app|wechat|skype|viber|line\s+app)`;
const PAY_WORDS = String.raw`(?:crypto(?:currenc(?:y|ies))?|bitcoin|btc|usdt|usdc|ethereum|eth|tron|trc-?20|erc-?20|paypal|western\s+union|moneygram|gift\s*cards?|zelle|cash\s*app|venmo|wire\s+transfer|payoneer)`;

const OFF_PLATFORM_PAYMENT: RegExp[] = [
  // "contact me on Telegram", "message us via WhatsApp"
  new RegExp(
    String.raw`\b(?:contact|reach|message|msg|dm|text|add|ping|talk\s+to|write\s+to|chat\s+with|hit\s+me\s+up|find\s+me|connect\s+with)\b${SENT}{0,50}\b(?:on|via|in|at|through|over|using)\s+${MESSENGER}\b`,
    "i"
  ),
  /\b(?:t\.me|telegram\.me|wa\.me|chat\.whatsapp\.com)\/\S+/i,
  // "contact X in discord for payment information"
  new RegExp(
    String.raw`\b(?:contact|reach|message|dm|ping|talk\s+to|write\s+to|chat\s+with|join|find|add)\b${SENT}{0,50}\b(?:${MESSENGER}|discord)\b${SENT}{0,60}\b(?:payment|payments|pay|paid|payout|invoice|compensation)\b`,
    "i"
  ),
  // "Payment methods: PayPal / Cryptocurrency"
  new RegExp(String.raw`\bpayment\s+(?:methods?|options?)\s*[:\-]${SENT}{0,40}\b${PAY_WORDS}\b`, "i"),
  // "I will pay you in USDT", "you'll be paid via PayPal"
  new RegExp(String.raw`\b(?:i|we)\s*(?:will|'ll|can)?\s+pay\s+(?:you\s+)?(?:via|by|in|with|through|using)\s+${SENT}{0,20}?\b${PAY_WORDS}\b`, "i"),
  new RegExp(String.raw`\b(?:be|get|gets|are|is)\s+paid\s+(?:out\s+)?(?:via|by|in|with|through|using)\s+${SENT}{0,20}?\b${PAY_WORDS}\b`, "i"),
  new RegExp(
    String.raw`\b(?:payment|payout|reward|bounty)\s+(?:(?:is|will\s+be)\s+)?(?:made|sent|paid|done|issued)\s+(?:via|by|in|with|through|using)\s+${SENT}{0,20}?\b${PAY_WORDS}\b`,
    "i"
  ),
  new RegExp(String.raw`\b(?:payout|reward|bounty)\s+(?:via|by|in|with|through)\s+${SENT}{0,20}?\b${PAY_WORDS}\b`, "i"),
  // wallet addresses asked for
  /\b(?:send|share|provide|give|dm|post|drop)\b[^.!?\n]{0,30}\b(?:(?:crypto|btc|bitcoin|eth|usdt|usdc|trc-?20|erc-?20)\s+)?wallet\s+address\b/i,
  /\b(?:your|ur)\s+(?:(?:crypto|btc|bitcoin|eth|usdt|usdc|trc-?20|erc-?20)\s+)?wallet\s+address\b/i,
  // "email me directly", "email me at x@y", "pay outside the platform"
  /\b(?:email|e-mail|contact|message|reach|call|text)\s+me\s+directly\b/i,
  /\bemail\s+me\s+at\s+\S+@\S+/i,
  /\boff[\s-]platform\b/i,
  /\b(?:pay|paid|payment|contact|communicat\w*|talk|deal|continue|work)\b[^.!?\n]{0,30}\b(?:outside|off)\s+(?:of\s+)?(?:the\s+)?(?:platform|site|upwork|freelancer(?:\.com)?)\b/i,
];

const AI_NOUN = String.raw`(?:ai|a\.i\.|llms?|large\s+language\s+models?|language\s+models?|chat\s?bots?|ai\s+assistants?|ai\s+models?|ai\s+agents?|autonomous\s+agents?|gpt(?:-?\d[\w.]*)?|chatgpt|claude|gemini|copilot|bots?)`;
/** "You are an AI engineer" / "a Claude-savvy dev" describe a HUMAN - not an address to a model. */
const NOT_A_PROFESSION = String.raw`(?![\s/&-]*(?:and\s+\w+\s+)?(?:ml\b|engineers?|developers?|devs?\b|researchers?|specialists?|experts?|enthusiasts?|consultants?|scientists?|architects?|practitioners?|trainers?|products?|startups?|company|companies|firms?|teams?|tools?\b|power\s+users?|users?|savvy|native|first|driven|powered|builders?|freelancers?|professionals?|writers?|artists?|integrations?|platforms?|solutions?|projects?|apps?|features?))`;

const AGENT_ADDRESSED: RegExp[] = [
  new RegExp(String.raw`\bif\s+you\s*(?:are|'re)\s+(?:an?\s+|the\s+)?(?:${AI_NOUN}|automated\s+\w+|(?:ai\s+)?agents?|robots?)\b${NOT_A_PROFESSION}`, "i"),
  new RegExp(String.raw`\byou\s*(?:are|'re)\s+(?:an?\s+|the\s+)?${AI_NOUN}\b${NOT_A_PROFESSION}`, "i"),
  new RegExp(
    String.raw`\b(?:dear|hey|hi|hello|attention|note\s+to|message\s+to|instructions?\s+for|psst)\s+(?:the\s+|all\s+|any\s+)?(?:${AI_NOUN}|(?:ai\s+)?agents?|automated\s+(?:agents?|systems?|tools?|readers?))\s*[,:!]`,
    "i"
  ),
  new RegExp(
    String.raw`(?:^|[.!?\n]\s*|<!--\s*|[(\[]\s*)(?:${AI_NOUN}|agents?)\s*[,:]\s*(?:please|ignore|you|do|don't|include|respond|reply|write|start|begin|add|mention|use|make\s+sure|must|disregard|remember)\b`,
    "i"
  ),
  new RegExp(
    String.raw`\b(?:any|all|every)?\s*(?:${AI_NOUN}|agents?|automated\s+(?:agents?|systems?|tools?))\s+(?:that\s+(?:is|are)\s+)?(?:reading|processing|parsing|reviewing|summari[sz]ing|analy[sz]ing|scanning)\s+this(?:\s+(?:listing|post|posting|job|issue|brief|message|text|page|description|task|bounty|project|ticket|gig)\b|\s*[,.:;!]|$)`,
    "i"
  ),
];

/** Words that make a HIDDEN segment an instruction rather than a template note. */
const HIDDEN_DIRECTIVE =
  /\b(?:ignore|disregard|forget|override)\b|\b(?:do\s+not|don't|never)\s+(?:mention|tell|reveal|disclose|say)\b|\byou\s+(?:must|should|will)\s+(?:always|now|instead|also|include|mention|start|write)\b|\binstead,?\s+(?:you|write|respond|reply|include)\b|\b(?:respond|reply|answer)\s+(?:only\s+)?with\b|\binclude\s+(?:the|this)\s+(?:word|phrase|string|code|token)\b/i;

type Rule = { reason: Exclude<GigSuspectReason, "hidden_instructions">; patterns: RegExp[] };

const RULES: Rule[] = [
  { reason: "prompt_exfiltration", patterns: PROMPT_EXFILTRATION },
  { reason: "credential_request", patterns: CREDENTIAL_REQUEST },
  { reason: "off_platform_payment", patterns: OFF_PLATFORM_PAYMENT },
  { reason: "agent_addressed", patterns: AGENT_ADDRESSED },
];

function ruleHits(text: string): Set<GigSuspectReason> {
  const out = new Set<GigSuspectReason>();
  if (!text) return out;
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(text))) out.add(rule.reason);
  }
  return out;
}

/** Which honeypot rules this listing trips, in GIG_SUSPECT_REASONS order ([] = clean). */
export function scanGigForHoneypots(input: HoneypotScanInput): GigSuspectReason[] {
  const title = input.title ?? "";
  const body = input.bodyText ?? "";
  const html = input.bodyHtml ?? "";
  const reasons = new Set<GigSuspectReason>();

  const rawAll = [title, body, html].join("\n");
  const smuggled = tagSmuggled(rawAll);
  const hidden = [...hiddenSegments([body, html]), ...smuggled];

  // Everything the listing carries - visible text, hidden text, decoded tag characters -
  // is read by the category rules, zero-width characters removed.
  const everything = normalize([title, body, stripTags(html), ...smuggled].join("\n").replace(ZERO_WIDTH, ""));
  for (const r of ruleHits(everything)) reasons.add(r);

  // hidden_instructions: a hidden segment that instructs, tag smuggling, a zero-width
  // payload, or a rule that only matches once zero-width characters are removed.
  let hiddenHit = smuggled.length > 0 || ZERO_WIDTH_RUN.test(rawAll);
  for (const seg of hidden) {
    // A hidden segment is read on its own too: its start is a sentence start.
    const n = normalize(seg.replace(ZERO_WIDTH, ""));
    const hits = ruleHits(n);
    for (const r of hits) reasons.add(r);
    if (hits.size > 0 || HIDDEN_DIRECTIVE.test(n)) hiddenHit = true;
  }
  if (!hiddenHit && ZERO_WIDTH_IN_WORD.test(rawAll)) {
    // Zero-width chars as word breaks: does a rule match ONLY when they vanish?
    const asBreaks = normalize([title, body, stripTags(html)].join("\n").replace(ZERO_WIDTH, "¦"));
    const before = ruleHits(asBreaks);
    for (const r of ruleHits(everything)) {
      if (!before.has(r)) hiddenHit = true;
    }
  }
  if (hiddenHit) reasons.add("hidden_instructions");

  return GIG_SUSPECT_REASONS.filter((r) => reasons.has(r));
}
