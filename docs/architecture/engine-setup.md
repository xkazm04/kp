# Engine setup — Claude subscription, ElevenLabs agent, env notes

The quickest route is to let the agent do it: run `claude` in the checkout and type
`/onboarding` (overlay: `.claude/onboarding/config.md`). This page is the manual
version for the pieces that surprise people. The full provider layer is in
[llm-provider-layer.md](llm-provider-layer.md); the container/production side in
[self-hosting.md](self-hosting.md).

## Claude subscription (via the Claude Code CLI)

`pipeline/jobfit/claude_cli.py` spawns the headless CLI as a subprocess
(`claude -p --output-format json`). It deliberately strips `ANTHROPIC_API_KEY` /
`ANTHROPIC_AUTH_TOKEN` from the child environment so calls run on your interactive
subscription login instead of metered API billing — that's what makes hundreds of
automation/eval calls affordable. Setup:

1. Install Claude Code (`npm install -g @anthropic-ai/claude-code` or the desktop
   app) so `claude` resolves on `PATH`.
2. Log in once interactively (`claude` → `/login`) with a Pro/Max account.

If the CLI is missing or not logged in, every consumer (automation tasks, devcase
design/evaluate, match reasoning) falls back to its deterministic implementation —
the app still runs, just with rule-based output instead of LLM judgment.

## ElevenLabs voice agent

```bash
# Put ELEVENLABS_API_KEY in .env.local first, then:
node scripts/setup-eleven-agent.mjs
```

The script creates the Conversational AI agent straight from the API (multilingual
`eleven_flash_v2_5` model, Czech-capable voice, Czech-first interviewer prompt,
runtime overrides enabled) and writes `ELEVENLABS_AGENT_ID` back into `.env.local` —
no dashboard step needed. Re-running creates a new agent; the newest id wins. The
OpenAI Realtime alternative and the self-hosted option are covered in
[voice-conversation-plane.md](voice-conversation-plane.md).

## Environment reference

Every variable, grouped and commented, lives in [`.env.example`](../../.env.example) —
copy it to `.env.local` and fill in only what you use. Two notes worth repeating here
because they surprise people:

- `ANTHROPIC_API_KEY` is deliberately **not** part of the setup. The Claude CLI
  engine authenticates through your interactive subscription login, and the spawner
  strips API-key vars from the child environment to keep it that way.
- `KP_LOG_PROMPTS=1` captures prompts and responses to disk. Those contain
  **candidate PII**. It is a debugging switch, not a production setting
  ([../development/logging.md](../development/logging.md)).
