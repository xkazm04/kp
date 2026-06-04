// Create the ElevenLabs Conversational AI agent used by the voice interview MVP,
// straight from ELEVENLABS_API_KEY — no dashboard step needed.
//
//   node scripts/setup-eleven-agent.mjs
//
// It picks a voice from your account, uses the multilingual eleven_flash_v2_5
// model, sets a Czech-first interviewer prompt, and ENABLES prompt/first-message/
// language overrides so our per-candidate grounded questions take effect at
// runtime. On success it writes ELEVENLABS_AGENT_ID back into .env.local.
//
// Re-running creates a NEW agent (ElevenLabs has no upsert); the newest id wins.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { QUICK_SCREEN_MIN, PROVIDER_MAX_DURATION_SECONDS } from "../app/_lib/interview-duration.mjs";

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

const PROMPT = [
  "You are a warm, professional first-round screening interviewer at Česká spořitelna.",
  "You are male — when you speak Czech, use masculine grammatical forms for yourself (e.g. „rád bych“, „zeptal bych se“, „řekl jsem“).",
  "Detect whether the candidate speaks Czech or English and respond in that language; follow them if they switch.",
  "Open by stating in one sentence that you are an AI assistant running a short first-round screen and that the call is transcribed.",
  "Ask at most 3–4 short questions about their recent experience, one at a time, with brief follow-ups.",
  `Do not give feedback, scores, or any hiring decision. Keep the whole call under ${QUICK_SCREEN_MIN} minutes,`,
  "then thank them and say a human recruiter will review the conversation.",
].join(" ");

const FIRST_MESSAGE =
  "Dobrý den! / Hello! I'm an AI assistant running a short first-round screen — the call is transcribed for a recruiter. Tell me a little about what you've been working on recently.";

async function main() {
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

  const language = env.ELEVENLABS_AGENT_LANGUAGE || "cs";
  const model = env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5";

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

  const body = {
    name: "kp — first-round screener",
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGE,
        language,
        prompt: { prompt: PROMPT, llm: "gemini-2.5-flash", temperature: 0.3 },
      },
      tts: { model_id: model, voice_id: voiceId },
      // Cap sized for the GROUNDED screen, not the baseline prompt: this one agent
      // also serves per-candidate run-of-shows (15–30 min) pushed via override, so
      // the cap clears the grounded maximum to avoid cutting a real interview off
      // mid-answer (idea-0ecbe5a5 — single source of truth in interview-duration.mjs).
      conversation: { text_only: false, max_duration_seconds: PROVIDER_MAX_DURATION_SECONDS },
    },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: { prompt: { prompt: true }, first_message: true, language: true },
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

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
