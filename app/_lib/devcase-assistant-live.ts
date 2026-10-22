// Is there a real AI behind the candidate door's chat tabs? (CX S43)
//
// The live work surface told every candidate "good prompts count in your favor" — and on
// a keyless install both tabs answer from the Python fallback (devcase/chat.py
// `deterministic()`, "the assistant is unavailable right now"). This is the page's
// FORECAST, read once per render so the first paint says the right thing:
//
//   KP_OFFLINE           → no (the seal refuses every hosted call)
//   any LLM routing/key  → yes (the operator configured one; Settings → AI)
//   else                 → the Python default chain: the Claude CLI on PATH, or a Gemini key
//
// A forecast can be wrong (a configured key that is dead); the surface corrects itself
// the moment a reply comes back as `source: "deterministic"` (chatIntroKey), so the
// promise never outlives the evidence against it.

import { listLlmConfig, listProviderKeys } from "./db/llm";
import { engineAvailability } from "./engine-preflight";
import { isOffline } from "./offline";

export type AssistantLiveDeps = {
  offline: () => boolean;
  configured: () => boolean;
  engine: () => { claudeCli: boolean; gemini: boolean };
};

const defaults: AssistantLiveDeps = {
  offline: () => isOffline(),
  configured: () => listLlmConfig().length > 0 || listProviderKeys().length > 0,
  engine: () => engineAvailability(),
};

export function devcaseAssistantLive(deps: Partial<AssistantLiveDeps> = {}): boolean {
  const d = { ...defaults, ...deps };
  if (d.offline()) return false;
  try {
    if (d.configured()) return true;
  } catch {
    // best-effort: an unreadable config store falls through to the engine probe
  }
  const e = d.engine();
  return e.claudeCli || e.gemini;
}
