// Manage the ElevenLabs Conversational AI agent used by the voice interview MVP,
// straight from ELEVENLABS_API_KEY — no dashboard step needed.
//
//   node scripts/setup-eleven-agent.mjs --check    (default-safe: compare live vs intended)
//   node scripts/setup-eleven-agent.mjs --deploy    (create/rotate the agent — a DEPLOY)
//   node scripts/setup-eleven-agent.mjs             (prints this usage; changes nothing)
//
// --deploy picks a voice from your account, uses the multilingual eleven_flash_v2_5
// model, sets a bilingual interviewer prompt, biases the ASR toward common tech
// terms (asr.keywords — "Fix 2" for the React→Rust / PostgreSQL→"později SQL"
// entity-corruption class), and ENABLES prompt/first-message/language overrides
// so the per-candidate CANDIDATE-SAFE grounded brief takes effect at runtime
// (/connect builds it via app/_lib/voice/candidate-brief.ts; VoiceInterview.tsx
// sends it as overrides.agent.prompt). On success it writes ELEVENLABS_AGENT_ID
// back into .env.local.
//
// ── --check — verify the live agent without touching it ─────────────────────
// The deploy path only ever POSTs /v1/convai/agents/create, so once an agent is
// live there was no in-repo way to know what config it actually runs — the
// asr.keywords bias, the refreshed fallback prompt and the override enablement
// are all inert until a deploy and drift silently thereafter. --check GETs the
// current agent (ELEVENLABS_AGENT_ID, from the env or .env.local) and diffs it
// field-by-field against this script's intended PROMPT, ASR_KEYWORDS and
// override flags. It creates NOTHING and exits 0 on match, 1 on drift, 2 when it
// cannot verify (no key / no agent id / the API would not return the config).
//
// ── --deploy — a DEPLOY, do not run casually ────────────────────────────────
// Re-running creates a NEW agent (ElevenLabs has no upsert) and ROTATES
// ELEVENLABS_AGENT_ID, so treat a run as a deploy:
//   1. node scripts/setup-eleven-agent.mjs --deploy   (creates the agent, updates .env.local)
//   2. restart the server so the new id is picked up
//   3. rotate ELEVENLABS_AGENT_ID in any other environment that pins it
// In-flight sessions on the old agent keep working (their signed URLs pin it);
// new sessions mint against the new agent. Delete the old agent in the dashboard
// when convenient. The script is idempotent in effect: same inputs → an agent
// with the same config, newest id wins. (Running with NO flag used to deploy —
// an accidental-rotation footgun — so the bare invocation now just prints usage.)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { QUICK_SCREEN_MIN, PROVIDER_MAX_DURATION_SECONDS } from "../app/_lib/interview-duration.mjs";
import { diffAgentConfig, formatDriftReport } from "../app/_lib/voice/eleven-agent-diff.mjs";

const ENV_PATH = path.join(process.cwd(), ".env.local");
const API = "https://api.elevenlabs.io";

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) out[m[1]] = m[2];
  }
  return out;
}

function upsertEnv(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) return text.replace(re, line);
  return text.replace(/\s*$/, "") + `\n${line}\n`;
}

// This is only the FALLBACK prompt for sessions with no per-candidate override (the lab, or an
// agent that disallows overrides). Kept in sync with the shared brief constants in
// app/_lib/student-interview.ts (PERSONA_ONE_QUESTION + PERSONA_CRAFT_CONDENSED +
// PERSONA_GENDER_GRAMMAR + PERSONA_LANGUAGE_DETECT, in that order — the harness showed language
// drift when other prose separates the lock from the end of the persona block) so the fallback
// isn't stale — the voice harness caught an earlier version drifting to Czech and praising
// answers. Candidate-mode sessions still override this with the candidate-safe grounded brief.
const PROMPT = [
  "You are a warm, professional first-round screening interviewer at Česká spořitelna.",
  "Ask exactly ONE question per turn and wait for the answer before asking the next — never bundle a second question or a follow-up into the same turn. This matters most with nervous, terse, or quiet candidates: keep each prompt short and single, and give them room to answer.",
  "Interviewing craft: when an answer is one line or dismissive, ask one concrete follow-up, and when re-asking, narrow to a smaller concrete sub-question — never repeat the question verbatim — and ask that follow-up plainly and directly, with no acknowledgement or preamble before it. When a candidate makes a strong or quantitative claim, ask how they achieved or verified it. Let coverage — not a fixed question count — decide length, and never announce how many questions remain. With a rambling candidate, set a concrete expectation up front and politely cut in at natural pauses every time it recurs; close off an off-topic question in one line, then return to yours. Just before closing, if the candidate mentioned specific technologies or tools, read back the key ones in one short turn and let them confirm or correct you; if none came up, skip that.",
  "You are male — when you speak Czech, use masculine grammatical forms for yourself (e.g. „rád bych“, „zeptal bych se“, „řekl jsem“).",
  "Do not assume the candidate's language: open by greeting briefly in both Czech and English, then LOCK onto the one language the candidate replies in and use ONLY that language for every remaining turn — greetings, acknowledgements, and closing included. Do not mix the two languages after your opening, and never switch to the other language unless the candidate does first (then follow them). Before EVERY turn you produce, check which language the candidate's last message was in and answer in that language — this rule outranks every other instruction in this brief.",
  "Ask at most 3–4 short questions about their recent experience, with brief follow-ups.",
  `Do not give feedback, scores, or any hiring decision, and never praise or judge the quality of an answer or tell the candidate their thinking, instinct, or approach is right — stay warm by showing interest, not by approving. Keep the whole call under ${QUICK_SCREEN_MIN} minutes,`,
  "then thank them and say a human recruiter will review the conversation.",
].join(" ");

// ASR keyword bias — the voice harness found the recognizer corrupting technology names ("React" →
// "Rust", "PostgreSQL" → "později SQL"), which the scorecard would then rate as a fabricated skill
// set. Per-session keywords aren't reachable through the browser SDK (its override type has no asr
// field), so this is a STATIC agent-level bias toward the terms most likely to be spoken. It helps
// the vocabulary/segmentation cases (PostgreSQL, Kubernetes) more than true homophones; a per-job
// list would be stronger but needs a non-SDK path.
const ASR_KEYWORDS = [
  "React", "Angular", "Vue", "Svelte", "Next.js", "TypeScript", "JavaScript", "Python", "Java",
  "Kotlin", "Golang", "Rust", "Scala", "Ruby", "PHP", "C#", "Spring Boot", "Django", "FastAPI",
  "Flask", "Express", "Rails", ".NET", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Cassandra",
  "Kafka", "RabbitMQ", "Elasticsearch", "ClickHouse", "Snowflake", "Spark", "Docker", "Kubernetes",
  "Terraform", "Ansible", "Jenkins", "GitLab", "Nginx", "gRPC", "GraphQL", "REST", "OAuth",
  "AWS", "GCP", "Azure", "Linux", "PyTorch", "TensorFlow", "LangChain",
];

const FIRST_MESSAGE =
  "Dobrý den! / Hello! I'm an AI assistant running a short first-round screen — the call is transcribed for a recruiter. Tell me a little about what you've been working on recently.";

// Which per-field runtime overrides the agent must ENABLE so the per-candidate
// CANDIDATE-SAFE grounded brief + language pin take effect (VoiceInterview.tsx
// sends prompt/language overrides; the server builds the prompt). Single source
// for both the deploy body below and --check's intended config, so the two can't
// drift.
const OVERRIDE_INTENT = { prompt: true, first_message: true, language: true };

// LLM the agent runs its prompt on, and its sampling temperature. Literals in the
// create body historically — lifted to named constants so the deploy body and
// --check's intended config read the SAME value (the OVERRIDE_INTENT pattern).
const LLM_MODEL = "gemini-2.5-flash";
const LLM_TEMPERATURE = 0.3;

// Env-configurable defaults the deploy body resolves; --check resolves the same
// way so a checkout with these exported doesn't false-flag drift.
const DEFAULT_LANGUAGE = "cs";
const DEFAULT_TTS_MODEL = "eleven_flash_v2_5";

// The config --deploy publishes and --check verifies against, in the shape the
// pure diff (app/_lib/voice/eleven-agent-diff.mjs) consumes. `getEnv(name)`
// resolves the two env-configurable fields (language, TTS model) — passed the raw
// file env by --deploy and the env-then-file resolver by --check — so the create
// body and the verified intent are built from ONE source and cannot drift.
function intendedConfig(getEnv) {
  return {
    prompt: PROMPT,
    asrKeywords: ASR_KEYWORDS,
    overrides: OVERRIDE_INTENT,
    firstMessage: FIRST_MESSAGE,
    language: getEnv("ELEVENLABS_AGENT_LANGUAGE") || DEFAULT_LANGUAGE,
    llm: LLM_MODEL,
    temperature: LLM_TEMPERATURE,
    maxDurationSeconds: PROVIDER_MAX_DURATION_SECONDS,
    ttsModel: getEnv("ELEVENLABS_TTS_MODEL") || DEFAULT_TTS_MODEL,
    textOnly: false,
  };
}

function usage() {
  console.log(
    [
      "setup-eleven-agent — manage the ElevenLabs first-round screener agent.",
      "",
      "  node scripts/setup-eleven-agent.mjs --check    Compare the live agent (ELEVENLABS_AGENT_ID)",
      "                                                 against the script's intended config. Creates",
      "                                                 nothing. Exit 0 = match, 1 = drift, 2 = cannot verify.",
      "  node scripts/setup-eleven-agent.mjs --deploy   Create a NEW agent and rotate ELEVENLABS_AGENT_ID",
      "                                                 in .env.local. This is a DEPLOY — see the header.",
      "  node scripts/setup-eleven-agent.mjs            Print this help. Changes nothing.",
    ].join("\n"),
  );
}

// Resolve a var from the real environment first, then .env.local — so --check
// works in a shell that exports the keys and in a local dev checkout alike.
function resolveEnv(name, fileEnv) {
  return process.env[name] || fileEnv[name] || "";
}

// --check: read the live agent and print a field-level drift report. Never writes.
// Exit 0 on match, 1 on drift, 2 when it cannot verify (missing key/id, or the
// API would not return the agent config).
async function runCheck() {
  const fileEnv = existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, "utf8")) : {};
  const key = resolveEnv("ELEVENLABS_API_KEY", fileEnv);
  const agentId = resolveEnv("ELEVENLABS_AGENT_ID", fileEnv);
  if (!key) {
    console.error("Cannot verify: ELEVENLABS_API_KEY is not set (env or .env.local).");
    process.exit(2);
  }
  if (!agentId) {
    console.error("Cannot verify: ELEVENLABS_AGENT_ID is not set — no agent to check. Run --deploy first.");
    process.exit(2);
  }

  let res;
  try {
    // GET the live agent's full config. ElevenLabs returns conversation_config +
    // platform_settings — the same shape --deploy POSTs — so the diff is exact.
    res = await fetch(`${API}/v1/convai/agents/${encodeURIComponent(agentId)}`, {
      headers: { "xi-api-key": key },
    });
  } catch (e) {
    console.error(`Cannot verify: network error reaching ElevenLabs — ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  if (!res.ok) {
    console.error(`Cannot verify: GET agent ${agentId} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    process.exit(2);
  }

  let agent;
  try {
    agent = await res.json();
  } catch {
    console.error("Cannot verify: ElevenLabs returned a non-JSON agent body.");
    process.exit(2);
  }

  const report = diffAgentConfig(intendedConfig((n) => resolveEnv(n, fileEnv)), agent);
  console.log(`Agent ${agentId} — drift report:\n`);
  console.log(formatDriftReport(report));
  process.exit(report.ok ? 0 : 1);
}

async function runDeploy() {
  if (!existsSync(ENV_PATH)) {
    console.error(".env.local not found in the project root.");
    process.exit(1);
  }
  const envText = readFileSync(ENV_PATH, "utf8");
  const env = parseEnv(envText);
  const key = env.ELEVENLABS_API_KEY;
  if (!key) {
    console.error("ELEVENLABS_API_KEY is not set in .env.local.");
    process.exit(1);
  }

  // Single source: the exact config --check verifies, resolved from the file env.
  const intended = intendedConfig((n) => env[n]);
  const language = intended.language;
  const model = intended.ttsModel;

  // Pick a voice: explicit env, else the first voice on the account.
  let voiceId = env.ELEVENLABS_VOICE_ID || "";
  let voiceName = voiceId;
  if (!voiceId) {
    const vr = await fetch(`${API}/v1/voices`, { headers: { "xi-api-key": key } });
    if (!vr.ok) {
      console.error(`Could not list voices (${vr.status}): ${(await vr.text()).slice(0, 300)}`);
      process.exit(1);
    }
    const vj = await vr.json();
    const first = (vj.voices || [])[0];
    if (!first) {
      console.error("No voices available on this account — add a voice or set ELEVENLABS_VOICE_ID.");
      process.exit(1);
    }
    voiceId = first.voice_id;
    voiceName = first.name || voiceId;
  }

  // Every field here is drawn from `intended` (above) so --check verifies the WHOLE
  // body field-by-field and nothing can silently diverge. voice_id is the one field
  // with no fixed intended value — it is resolved per-account at deploy time and so
  // is deliberately not part of the drift check.
  const body = {
    name: "kp — first-round screener",
    conversation_config: {
      agent: {
        first_message: intended.firstMessage,
        language: intended.language,
        prompt: { prompt: intended.prompt, llm: intended.llm, temperature: intended.temperature },
      },
      tts: { model_id: intended.ttsModel, voice_id: voiceId },
      asr: { keywords: intended.asrKeywords },
      // Cap sized for the GROUNDED screen, not the baseline prompt: this one agent
      // also serves per-candidate run-of-shows (15–30 min) pushed via override, so
      // the cap clears the grounded maximum to avoid cutting a real interview off
      // mid-answer (idea-0ecbe5a5 — single source of truth in interview-duration.mjs).
      conversation: { text_only: intended.textOnly, max_duration_seconds: intended.maxDurationSeconds },
    },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: {
            prompt: { prompt: intended.overrides.prompt },
            first_message: intended.overrides.first_message,
            language: intended.overrides.language,
          },
        },
      },
    },
  };

  const res = await fetch(`${API}/v1/convai/agents/create`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Create agent failed (${res.status}): ${(await res.text()).slice(0, 600)}`);
    process.exit(1);
  }
  const data = await res.json();
  const agentId = data.agent_id || data.agentId;
  if (!agentId) {
    console.error("No agent_id in response:", JSON.stringify(data).slice(0, 400));
    process.exit(1);
  }

  writeFileSync(ENV_PATH, upsertEnv(envText, "ELEVENLABS_AGENT_ID", agentId), "utf8");
  console.log(`✓ Created agent ${agentId}`);
  console.log(`  voice: ${voiceName} (${voiceId}) · model: ${model} · language: ${language}`);
  console.log(`  prompt/first_message/language overrides: enabled`);
  console.log(`  → wrote ELEVENLABS_AGENT_ID to .env.local — restart the dev server.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--check")) return runCheck();
  if (args.includes("--deploy")) return runDeploy();
  // Bare invocation used to deploy — an accidental id-rotation footgun. It now
  // prints usage and changes nothing; --deploy is required to create an agent.
  usage();
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
