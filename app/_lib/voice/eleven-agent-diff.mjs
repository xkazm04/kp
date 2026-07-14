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
// carries { prompt: { prompt }, first_message, language }, conversation_config.asr
// carries { keywords }, and platform_settings.overrides.conversation_config_override
// .agent carries the per-field override enablement flags. We read every field
// defensively (optional chaining + type guards) so a shape change upstream degrades
// to "drift"/"cannot read", never a crash.

/**
 * @typedef {Object} IntendedAgentConfig
 * @property {string} prompt            The fallback interviewer prompt the agent should run.
 * @property {string[]} asrKeywords     The ASR keyword-bias list the agent should carry.
 * @property {{ prompt: boolean, first_message: boolean, language: boolean }} overrides
 *           Which per-field runtime overrides should be ENABLED.
 */

const PROMPT_CONTEXT = 48;

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
  const o = agent?.platform_settings?.overrides?.conversation_config_override?.agent ?? {};
  return {
    prompt: o?.prompt?.prompt === true,
    first_message: o?.first_message === true,
    language: o?.language === true,
  };
}

/**
 * Compare the intended config against a live agent JSON, field by field.
 * Pure — no I/O. Returns a structured report the caller formats and turns into an
 * exit code (ok → 0, drift → 1).
 * @param {IntendedAgentConfig} intended
 * @param {any} agent  Parsed body of GET /v1/convai/agents/{agent_id}.
 */
export function diffAgentConfig(intended, agent) {
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
  const flags = ["prompt", "first_message", "language"].map((flag) => ({
    flag,
    intended: intended.overrides[flag] === true,
    live: liveOverrides[flag] === true,
    match: (intended.overrides[flag] === true) === (liveOverrides[flag] === true),
  }));
  const overrides = { match: flags.every((f) => f.match), flags };

  return { ok: prompt.match && asrKeywords.match && overrides.match, prompt, asrKeywords, overrides };
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

/** Render a diff report as an operator-facing multi-line string. Pure. */
export function formatDriftReport(report) {
  const lines = [];
  if (report.prompt.match) {
    lines.push("  prompt            ✓ match");
  } else {
    lines.push("  prompt            ✗ DRIFT");
    lines.push(promptDiffSnippet(report.prompt));
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
