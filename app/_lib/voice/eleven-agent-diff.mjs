// Pure, network-free field-level diff between the config the ElevenLabs setup
// script INTENDS to deploy and the config a live agent actually runs (fetched via
// GET /v1/convai/agents/{agent_id}). Extracted from scripts/setup-eleven-agent.mjs
// so `--check` can report drift without a dashboard round-trip, and so the diff
// logic is unit-testable with no network (eleven-agent-diff.test.ts).
//
// Plain .mjs (not .ts) on purpose — same reasoning as interview-duration.mjs: the
// setup script runs under bare `node` with no build step, so anything it imports
// must be plain JS. The sibling .d.mts gives the TS app/test full types.
//
// The GET agent response mirrors the create body: its conversation_config.agent
// carries { prompt: { prompt, llm, temperature }, first_message, language },
// conversation_config.tts carries { model_id }, conversation_config.conversation
// carries { text_only, max_duration_seconds }, conversation_config.asr carries
// { keywords }, and platform_settings.overrides.conversation_config_override.agent
// carries the per-field override enablement flags. We read every field defensively
// (optional chaining + type guards) so a shape change upstream degrades to
// "drift"/"cannot read", never a crash.

// ── The interview director's CLIENT tools (spark ai-interview-parity) ─────────────
// ElevenLabs no longer accepts tools inline on the agent: `conversation_config.agent
// .prompt.tools` was deprecated in July 2025 and requests carrying it are rejected.
// A tool is now a WORKSPACE resource — POST /v1/convai/tools with a `tool_config` —
// and the agent references it by id in `conversation_config.agent.prompt.tool_ids`.
// So the deploy creates (or reuses) five client tools and lists their ids, and
// --check follows those ids back to each tool's config and diffs it here.
//
// A client tool's parameter properties must each carry exactly one of description /
// dynamic_variable / constant_value / is_system_provided, and the schema knows no
// `additionalProperties` — so the shared JSON-schema definitions
// (director-tools.mjs) are REBUILT into that shape rather than passed through.

/** How long the agent waits for the browser to answer a director tool call. The
 *  browser answers by POSTing /api/interview/director, a local SQLite round trip —
 *  10s is generous; the platform default (20s) would hold a stalled turn for longer
 *  than a candidate should sit in silence. Must be 1..120 (API constraint). */
export const DIRECTOR_TOOL_RESPONSE_TIMEOUT_SECS = 10;

/** One provider-neutral tool definition ({ name, description, parameters }) as an
 *  ElevenLabs client `tool_config`. `expects_response: true` — the model waits for
 *  the director's answer (a rejected evidence quote tells it to ask again). Pure. */
export function toElevenClientTool(def) {
  const properties = {};
  for (const [key, prop] of Object.entries(def?.parameters?.properties ?? {})) {
    const enumValues = Array.isArray(prop?.enum) ? [...prop.enum] : null;
    properties[key] = {
      type: prop?.type ?? "string",
      description:
        typeof prop?.description === "string" && prop.description.trim()
          ? prop.description
          : enumValues
            ? `One of: ${enumValues.join(", ")}.`
            : key,
      ...(enumValues ? { enum: enumValues } : {}),
    };
  }
  return {
    type: "client",
    name: def.name,
    description: def.description,
    expects_response: true,
    response_timeout_secs: DIRECTOR_TOOL_RESPONSE_TIMEOUT_SECS,
    parameters: { type: "object", required: [...(def?.parameters?.required ?? [])], properties },
  };
}

/** The comparable projection of a client tool_config: only the fields the deploy
 *  sets, with order-insensitive `required`. A live config carries defaulted extras
 *  (execution_mode, pre_tool_speech, …) that are not drift. Null for anything that
 *  is not a client tool. Pure. */
export function normalizeClientTool(cfg) {
  if (!cfg || typeof cfg !== "object" || cfg.type !== "client" || typeof cfg.name !== "string") return null;
  const props = cfg?.parameters?.properties && typeof cfg.parameters.properties === "object" ? cfg.parameters.properties : {};
  const properties = {};
  for (const key of Object.keys(props).sort()) {
    const p = props[key] ?? {};
    properties[key] = {
      type: p.type ?? null,
      description: typeof p.description === "string" ? p.description : null,
      enum: Array.isArray(p.enum) ? [...p.enum] : null,
    };
  }
  return {
    name: cfg.name,
    description: typeof cfg.description === "string" ? cfg.description : null,
    expects_response: cfg.expects_response === true,
    response_timeout_secs: typeof cfg.response_timeout_secs === "number" ? cfg.response_timeout_secs : null,
    parameters: {
      required: Array.isArray(cfg?.parameters?.required) ? [...cfg.parameters.required].sort() : [],
      properties,
    },
  };
}

const CLIENT_TOOL_FIELDS = ["description", "expects_response", "response_timeout_secs", "parameters"];

/** Which comparable fields of two client tool configs differ ([] = same tool). Pure. */
export function clientToolDrift(intended, live) {
  const a = normalizeClientTool(intended);
  const b = normalizeClientTool(live);
  if (!a || !b) return [...CLIENT_TOOL_FIELDS];
  return CLIENT_TOOL_FIELDS.filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
}

/** The tool ids the live agent references (conversation_config.agent.prompt.tool_ids). */
export function extractLiveToolIds(agent) {
  const ids = agent?.conversation_config?.agent?.prompt?.tool_ids;
  return Array.isArray(ids) ? ids.filter((x) => typeof x === "string" && x) : [];
}

/**
 * Compare the intended client tools against the tool configs the agent's tool_ids
 * resolve to, by name. Pure.
 * @param {any[]} intended  tool_config objects (toElevenClientTool output)
 * @param {any[]} live      tool_config objects fetched for the agent's tool_ids
 */
export function diffClientTools(intended, live) {
  const liveByName = new Map();
  for (const cfg of live ?? []) {
    if (cfg && typeof cfg.name === "string") liveByName.set(cfg.name, cfg);
  }
  const intendedNames = new Set(intended.map((t) => t.name));
  const missing = intended.filter((t) => !liveByName.has(t.name)).map((t) => t.name);
  const extra = [...liveByName.keys()].filter((n) => !intendedNames.has(n));
  const drifted = intended
    .filter((t) => liveByName.has(t.name))
    .map((t) => ({ name: t.name, fields: clientToolDrift(t, liveByName.get(t.name)) }))
    .filter((d) => d.fields.length > 0);
  return { match: missing.length === 0 && extra.length === 0 && drifted.length === 0, missing, extra, drifted };
}

/**
 * @typedef {Object} IntendedAgentConfig
 * @property {string} prompt            The fallback interviewer prompt the agent should run.
 * @property {string[]} asrKeywords     The ASR keyword-bias list the agent should carry.
 * @property {{ prompt: boolean, first_message: boolean, language: boolean, asr_keywords: boolean }} overrides
 *           Which per-field runtime overrides should be ENABLED.
 * @property {string} firstMessage       The opening line the agent should greet with.
 * @property {string} language           The agent's configured default language code.
 * @property {string} llm                The LLM the agent should run its prompt on.
 * @property {number} temperature        The LLM sampling temperature.
 * @property {number} maxDurationSeconds The provider hard cap on call length.
 * @property {string} ttsModel           The TTS model_id the agent should speak with.
 * @property {boolean} textOnly          Whether the agent runs text-only (voice → false).
 * @property {any[]} [clientTools]       The client tool_configs the agent must reference
 *           (toElevenClientTool output). Absent → tools are not checked.
 */

const PROMPT_CONTEXT = 48;

// The override-enablement flags checked, in report order. ONE list drives the
// live read, the comparison loop and the report, so unlocking a new override is
// a single edit here plus its OVERRIDE_INTENT entry in the setup script — not
// three places that can disagree about which flags exist. `asr_keywords` sits
// on a different branch of the override object (conversation_config_override.asr
// rather than .agent), which is exactly why the read is per-flag.
const OVERRIDE_FLAGS = [
  { flag: "prompt",        read: (o) => o?.agent?.prompt?.prompt === true },
  { flag: "first_message", read: (o) => o?.agent?.first_message === true },
  { flag: "language",      read: (o) => o?.agent?.language === true },
  { flag: "asr_keywords",  read: (o) => o?.asr?.keywords === true },
];

// Every remaining SCALAR field the deploy body sends beyond the prompt / ASR
// keywords / override flags handled specially above — so `--check` verifies the
// WHOLE create body, not just three of its fields. Each entry knows how to pull
// its live value out of the GET-agent body defensively (a missing branch or a
// wrong shape yields `undefined`, which compares unequal → reported as drift,
// never a throw). `key` matches the IntendedAgentConfig field it is checked
// against; `label` is the operator-facing path in the report.
//
// NOT here: tts.voice_id and the agent `name`. voice_id is resolved at deploy
// time from whatever voice the account exposes (no fixed intended value to
// single-source), and the name is cosmetic; neither changes interview behavior.
const SCALAR_FIELDS = [
  { key: "firstMessage",       label: "first_message",           read: (a) => a?.conversation_config?.agent?.first_message },
  { key: "language",           label: "language",                read: (a) => a?.conversation_config?.agent?.language },
  { key: "llm",                label: "llm",                     read: (a) => a?.conversation_config?.agent?.prompt?.llm },
  { key: "temperature",        label: "temperature",             read: (a) => a?.conversation_config?.agent?.prompt?.temperature },
  { key: "maxDurationSeconds", label: "conversation.max_duration_seconds", read: (a) => a?.conversation_config?.conversation?.max_duration_seconds },
  { key: "ttsModel",           label: "tts.model_id",            read: (a) => a?.conversation_config?.tts?.model_id },
  { key: "textOnly",           label: "conversation.text_only",  read: (a) => a?.conversation_config?.conversation?.text_only },
];

/** First index at which two strings differ, or -1 if identical. */
export function firstDifferenceIndex(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

export function extractLivePrompt(agent) {
  const p = agent?.conversation_config?.agent?.prompt?.prompt;
  return typeof p === "string" ? p : "";
}

export function extractLiveKeywords(agent) {
  const k = agent?.conversation_config?.asr?.keywords;
  return Array.isArray(k) ? k.filter((x) => typeof x === "string") : [];
}

export function extractLiveOverrides(agent) {
  const o = agent?.platform_settings?.overrides?.conversation_config_override ?? {};
  const out = {};
  for (const f of OVERRIDE_FLAGS) out[f.flag] = f.read(o);
  return out;
}

/** Pull every scalar field's live value out of the GET-agent body, keyed by the
 *  IntendedAgentConfig field it is compared against. Missing/wrong-shape branches
 *  yield `undefined` (→ drift on compare), never a throw. Pure. */
export function extractLiveScalars(agent) {
  const out = {};
  for (const f of SCALAR_FIELDS) out[f.key] = f.read(agent);
  return out;
}

/**
 * Compare the intended config against a live agent JSON, field by field.
 * Pure — no I/O. Returns a structured report the caller formats and turns into an
 * exit code (ok → 0, drift → 1).
 * @param {IntendedAgentConfig} intended
 * @param {any} agent  Parsed body of GET /v1/convai/agents/{agent_id}.
 * @param {any[]} [liveTools]  The tool_configs the agent's tool_ids resolve to
 *           (GET /v1/convai/tools/{id} each) — read only when intended.clientTools is set.
 */
export function diffAgentConfig(intended, agent, liveTools) {
  const livePrompt = extractLivePrompt(agent);
  const promptMatch = livePrompt === intended.prompt;
  const prompt = {
    match: promptMatch,
    intended: intended.prompt,
    live: livePrompt,
    firstDiffAt: promptMatch ? -1 : firstDifferenceIndex(intended.prompt, livePrompt),
  };

  const liveKeywords = extractLiveKeywords(agent);
  const intendedSet = new Set(intended.asrKeywords);
  const liveSet = new Set(liveKeywords);
  const missing = intended.asrKeywords.filter((k) => !liveSet.has(k));
  const extra = liveKeywords.filter((k) => !intendedSet.has(k));
  const asrKeywords = { match: missing.length === 0 && extra.length === 0, missing, extra };

  const liveOverrides = extractLiveOverrides(agent);
  const flags = OVERRIDE_FLAGS.map(({ flag }) => ({
    flag,
    intended: intended.overrides[flag] === true,
    live: liveOverrides[flag] === true,
    match: (intended.overrides[flag] === true) === (liveOverrides[flag] === true),
  }));
  const overrides = { match: flags.every((f) => f.match), flags };

  const liveScalars = extractLiveScalars(agent);
  const scalarFlags = SCALAR_FIELDS.map(({ key, label }) => {
    const intendedVal = intended[key];
    const liveVal = liveScalars[key];
    return { key, label, intended: intendedVal, live: liveVal, match: Object.is(intendedVal, liveVal) };
  });
  const scalars = { match: scalarFlags.every((s) => s.match), flags: scalarFlags };

  // Director client tools: checked only when the caller states an intent, so a
  // config without tools is not suddenly "drift" for every older caller.
  const tools = Array.isArray(intended.clientTools)
    ? { checked: true, ...diffClientTools(intended.clientTools, liveTools ?? []) }
    : { checked: false, match: true, missing: [], extra: [], drifted: [] };

  return {
    ok: prompt.match && asrKeywords.match && overrides.match && scalars.match && tools.match,
    prompt,
    asrKeywords,
    overrides,
    scalars,
    tools,
  };
}

function promptDiffSnippet(prompt) {
  const at = prompt.firstDiffAt;
  const start = Math.max(0, at - PROMPT_CONTEXT);
  const window = (s) => {
    const slice = s.slice(start, at + PROMPT_CONTEXT);
    return (start > 0 ? "…" : "") + JSON.stringify(slice) + (s.length > at + PROMPT_CONTEXT ? "…" : "");
  };
  return [
    `      first differs at char ${at} (intended ${prompt.intended.length} chars, live ${prompt.live.length}):`,
    `        intended: ${window(prompt.intended)}`,
    `        live:     ${window(prompt.live)}`,
  ].join("\n");
}

// Render a scalar value compactly for the drift line — strings quoted (and
// truncated so a ~180-char first_message doesn't flood the report), everything
// else stringified as-is. `undefined` (field absent live) shows as "(absent)".
function fmtScalar(v) {
  if (v === undefined) return "(absent)";
  if (typeof v === "string") {
    const max = 80;
    const shown = v.length > max ? v.slice(0, max) + "…" : v;
    return JSON.stringify(shown);
  }
  return String(v);
}

/** Render a diff report as an operator-facing multi-line string. Pure. */
export function formatDriftReport(report) {
  const lines = [];
  if (report.prompt.match) {
    lines.push("  prompt            ✓ match");
  } else {
    lines.push("  prompt            ✗ DRIFT");
    lines.push(promptDiffSnippet(report.prompt));
  }

  if (report.scalars.match) {
    lines.push("  fields            ✓ match");
  } else {
    lines.push("  fields            ✗ DRIFT");
    for (const s of report.scalars.flags) {
      if (s.match) continue;
      lines.push(`      ✗ ${s.label}: intended ${fmtScalar(s.intended)}, live ${fmtScalar(s.live)}`);
    }
  }

  if (report.asrKeywords.match) {
    lines.push("  asr.keywords      ✓ match");
  } else {
    lines.push("  asr.keywords      ✗ DRIFT");
    if (report.asrKeywords.missing.length) {
      lines.push(`      missing (intended, not live): ${report.asrKeywords.missing.join(", ")}`);
    }
    if (report.asrKeywords.extra.length) {
      lines.push(`      extra (live, not intended):   ${report.asrKeywords.extra.join(", ")}`);
    }
  }

  if (report.tools?.checked) {
    if (report.tools.match) {
      lines.push("  client tools      ✓ match");
    } else {
      lines.push("  client tools      ✗ DRIFT");
      if (report.tools.missing.length) lines.push(`      missing (intended, not on the agent): ${report.tools.missing.join(", ")}`);
      if (report.tools.extra.length) lines.push(`      extra (on the agent, not intended):   ${report.tools.extra.join(", ")}`);
      for (const d of report.tools.drifted) lines.push(`      ✗ ${d.name}: ${d.fields.join(", ")} differ`);
    }
  }

  if (report.overrides.match) {
    lines.push("  overrides         ✓ match (all enabled)");
  } else {
    lines.push("  overrides         ✗ DRIFT");
    for (const f of report.overrides.flags) {
      const mark = f.match ? "✓" : "✗";
      lines.push(
        `      ${mark} ${f.flag}: intended ${f.intended ? "enabled" : "disabled"}, live ${f.live ? "enabled" : "disabled"}`,
      );
    }
  }

  lines.push("");
  lines.push(report.ok ? "✓ live agent matches the script's intended config." : "✗ drift detected — re-run with --deploy to publish the intended config.");
  return lines.join("\n");
}
