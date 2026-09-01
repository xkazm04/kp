# Driving the Claude Code CLI over stream-json — observed protocol

Durable output of the 2026-08-31 protocol spike for `scripts/onboard-ui/`.
Everything below was **observed live** against `C:\users\kazda\.local\bin\claude.exe`
**2.1.251** on a subscription login (no `ANTHROPIC_API_KEY` in the child env), not
read off a doc. The SDK (`@anthropic-ai/claude-agent-sdk`, installed in a
throwaway scratch dir and never in this repo) was read only to learn the argv and
the frame shapes; **the shipped host depends on nothing but `node:` builtins.**

## Why this exists

`scripts/onboard-ui/server.mjs` spawns the CLI as its engine so the wizard runs
on the operator's own subscription. It must intercept permission prompts and
`AskUserQuestion` and answer them from a browser form. That is only possible if
the CLI routes those over stdio — it does, via the same control protocol the SDK
uses.

## argv

```
claude --output-format stream-json --verbose --input-format stream-json \
       --permission-prompt-tool stdio
```

Quirks, all verified:

- **No `-p` / `--print`.** `--help` says `--input-format` is "only with --print",
  but the SDK never passes `--print` and the session starts fine without it.
  `--output-format stream-json` is what puts the CLI in headless mode.
- **`--verbose` is mandatory** in this shape — the SDK hardcodes it into the base
  argv (`["--output-format","stream-json","--verbose","--input-format","stream-json"]`).
- **`--permission-prompt-tool stdio`** is the flag that makes the CLI send
  `can_use_tool` control requests to the host instead of resolving them itself.
  It is **absent from `--help` in 2.1.251** but present in the binary and is
  exactly what the SDK emits whenever a `canUseTool` callback is supplied.
  Without it, no permission request ever reaches the wire.
- Child env: `CLAUDE_CODE_ENTRYPOINT=sdk-ts`, `NODE_OPTIONS` deleted, and every
  `ANTHROPIC_*_KEY` / `ANTHROPIC_AUTH_TOKEN` stripped so the subscription login is
  used (mirrors kp's own LLM spawn hygiene).
- stdin stays **open** for the life of the session; closing it ends it.

## Frames

All framing is NDJSON, one JSON object per line, both directions.

### 1. `initialize` handshake (host → CLI, first line)

The host **must** send this before anything else; the CLI answers with the
session's command list. `request_id` is host-minted (the SDK uses
`Math.random().toString(36).slice(2,15)`).

```json
{"request_id":"9xyou0taw8m","type":"control_request","request":{"subtype":"initialize"}}
```

Response:

```json
{"type":"control_response","response":{"subtype":"success","request_id":"9xyou0taw8m",
 "response":{"commands":[{"name":"research","description":"…","argumentHint":""}, …]}}}
```

Whether the handshake is strictly *required* for `can_use_tool` routing was
**not** isolated — every run sent it, so `--permission-prompt-tool stdio` alone
is untested. Send it: it is the SDK's contract and it is where hooks, MCP
servers and system-prompt overrides would be registered.

### 2. User message (host → CLI)

```json
{"type":"user","session_id":"",
 "message":{"role":"user","content":[{"type":"text","text":"…"}]},
 "parent_tool_use_id":null}
```

`session_id:""` is what the SDK sends; the CLI fills it in. Writing one of these
while no turn is running **starts a new turn** — this is how mid-session
follow-ups are injected (verified: four sequential turns on one child).

### 3. `can_use_tool` (CLI → host)

`request_id` here is a **CLI-minted UUID** — correlate on it verbatim.

```json
{"type":"control_request","request_id":"491e7c54-7fb1-49d4-8025-dab372009605",
 "request":{"subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash",
  "input":{"command":"mkdir spike-made-dir && echo spike-ok","description":"…"},
  "description":"…",
  "permission_suggestions":[
    {"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"mkdir spike-made-dir *"}],
     "behavior":"allow","destination":"localSettings"},
    {"type":"addDirectories","directories":["C:\\…\\spike-qwP13Q"],"destination":"session"},
    {"type":"setMode","mode":"acceptEdits","destination":"session"}],
  "blocked_path":"C:\\…\\spike-made-dir",
  "tool_use_id":"toolu_01GTskDa433PcVF6FFgnvn7x"}}
```

Host answers — allow:

```json
{"type":"control_response","response":{"subtype":"success",
 "request_id":"491e7c54-…","response":{
   "behavior":"allow","updatedInput":{…the same input, or an edited copy…},
   "toolUseID":"toolu_01GTskDa433PcVF6FFgnvn7x"}}}
```

…or deny (the message is what the model sees as the tool result):

```json
{"type":"control_response","response":{"subtype":"success","request_id":"491e7c54-…",
 "response":{"behavior":"deny","message":"Denied by the installer host.",
 "toolUseID":"toolu_01GTskDa433PcVF6FFgnvn7x"}}}
```

An unsupported subtype is answered with
`{"type":"control_response","response":{"subtype":"error","request_id":…,"error":"…"}}`.

On Windows the shell tool is named **`PowerShell`**, not `Bash` — same `command`
field, different `tool_name`. A host that only special-cases `Bash` renders a raw
JSON blob on this platform; `server.mjs` handles both names everywhere
(`describeAsk`, `shapeKey`, `summarizeTool`). A live `/onboarding check` run
raised six `PowerShell` permission requests and zero `Bash` ones.

**Not every tool call produces one.** The CLI's own classifier auto-approves
plainly-safe commands: `echo spike-ok` executed with **no** `can_use_tool` at
all, while `mkdir …` and `pip install …` both raised one. So the host's
auto-allow list is a second filter, not the only one — the wizard cannot promise
it will see every Bash command, only every one the CLI considers worth asking
about.

### 4. `AskUserQuestion` — the wizard's question channel

It arrives as an ordinary `can_use_tool` whose `tool_name` is `AskUserQuestion`,
with the extra marker `"requires_user_interaction":true`:

```json
{"type":"control_request","request_id":"4252d691-…",
 "request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion",
  "input":{"questions":[{"question":"What should I do with …?","header":"Cleanup",
    "options":[{"label":"Leave it in place","description":"…"},
               {"label":"Delete it","description":"…"}],
    "multiSelect":false}]},
  "tool_use_id":"toolu_01Dc…","requires_user_interaction":true}}
```

The answer rides in `updatedInput.answers`, **keyed by the exact question text**,
value = the chosen option's `label` (multi-select: labels joined by `", "`; free
text: just send the text as the value):

```json
{"type":"control_response","response":{"subtype":"success","request_id":"4252d691-…",
 "response":{"behavior":"allow",
  "updatedInput":{"questions":[…unchanged…],
                  "answers":{"What should I do with …?":"Delete it"}},
  "toolUseID":"toolu_01Dc…"}}}
```

The CLI then synthesizes the tool result itself:

> `Your questions have been answered: "What should I do with …?"="Delete it". You can now continue with these answers in mind.`

and the model continued correctly ("You picked **Delete it**"). Denying an
`AskUserQuestion` is never right — the host always allows it with an answer.

### 5. Messages the host renders

- `{"type":"system","subtype":"init", tools, model, session_id, permissionMode}` —
  emitted **once per turn**, not once per session. Treat repeats as idempotent.
- `{"type":"assistant","message":{"content":[{"type":"text"…},{"type":"tool_use",name,input}]}}`
- `{"type":"user","message":{"content":[{"type":"tool_result",content}]}}`
- `{"type":"result","subtype":"success","is_error":false,"result":"…","num_turns":n}`
  — end of turn. Also `system/hook_started`, `system/hook_response`,
  `system/thinking_tokens`, `rate_limit_event`, `keep_alive`; all ignorable.

## Stopping a run on Windows — `taskkill`, not `kill()`

`child.kill()` does **not** stop a session on win32, and the Stop button was
broken for exactly that reason. `claude.exe` is spawned through `cmd.exe` (the
`shell: true` branch, taken whenever `KP_CLAUDE_CLI` is not an absolute path), so
`child.pid` is the shell's; and even killing the CLI itself leaves the
PowerShell / node / npm / git grandchildren it spawned running, which keeps the
work going after the page says it stopped. Observed live: one `check` run had
`cmd.exe`, two `claude.exe`, `git.exe`, `where.exe` and three `conhost.exe`
hanging off the host.

`Session.stop()` therefore:

1. bumps `runId` **synchronously**, so every buffered stdout chunk, stderr line
   and `exit` event from that child is a no-op from then on — no event can be
   emitted after `stopped`;
2. clears the pending cards, denying every open permission so nothing is left
   half-asked (`failPending`);
3. `spawnSync("taskkill", ["/pid", pid, "/T", "/F"])` on win32 — `/T` is the tree,
   `/F` is force; failures are ignored because losing a race with a self-exit is
   a success. Elsewhere `SIGTERM`, then `SIGKILL` after 1.5 s;
4. emits `{"type":"stopped"}` and resets phase/buffer/allow-list, so the next
   `/start` is a clean session rather than a continuation.

## SSE event contract

One JSON object per `data:` frame. Every event also carries `seq` (monotonic)
and `at` (epoch ms); the UI may ignore both.

| Event | Shape |
| --- | --- |
| `hello` | `{type, repo, envFileExists, running, phase, appPort}` — sent once on connect, so a reloaded page knows where it is |
| `phase` | `{type:"phase", id}`, id ∈ `welcome` `mode` `checks` `capabilities` `boot` `voice` `done` |
| `status` | `{type:"status", text}` — one line of "what is happening now"; deduped against the previous one |
| `probe` | `{type:"probe", name, status, detail}`, status ∈ `ok` `fail` `warn` `running` |
| `narration` | `{type:"narration", md}` — the agent's prose, markdown, markers already stripped |
| `question` | `{type:"question", id, header, question, options:[{label, description?}], multiSelect}` |
| `secret` | `{type:"secret", id, name, note, alreadySet}` |
| `permission` | `{type:"permission", id, tool, command, description, shape}` |
| `app` | `{type:"app", port}` |
| `matrix` | `{type:"matrix", md}` |
| `done` | `{type:"done", exitCode}` — `exitCode` is `null` when the CLI never started |
| `stopped` | `{type:"stopped"}` |
| `error` | `{type:"error", message}` |

Deliberately **not** on the wire: raw `tool_result` payloads, `stderr` lines and
the `result` frame. stderr is kept in a capped in-memory tail and surfaced only
as the `error` message of a non-zero exit — a stray line could carry anything,
and the rule is that secrets never reach the SSE stream or a log.

One `AskUserQuestion` fans out into **one card per question**: ids are
`<request_id>#<index>`. The host answers the CLI only once every card of that
request is in, so a multi-question ask cannot be half-answered.

## Host markers — the agent's structured-event channel

The wizard-mode preamble (`preamble()` in `server.mjs`) instructs the agent to
emit marker lines inside its narration. The host matches them **line-anchored**,
strips the line before the prose is emitted, and re-emits it as a typed event.

```
[[wizard:phase id=checks]]
[[wizard:status text="Probing the runtime"]]
[[wizard:probe name="node" status=ok detail="v24.14"]]
[[wizard:app port=3000]]
[[wizard:matrix]]
```

- Attribute values are `"quoted"` or bare. An unknown `probe` status degrades to
  `warn`; an unknown phase id is ignored.
- `[[wizard:matrix]]` switches the rest of **that assistant message** into matrix
  capture — everything after it, across the remaining content blocks, is emitted
  as one `{type:"matrix", md}` and never narrated. It also implies
  `{type:"phase", id:"done"}`.
- Verified live (2026-09-01, `/onboarding check` against claude 2.1.252): the
  agent emitted `phase`, `status` and seven `probe` markers unprompted beyond
  the preamble, and no marker leaked into a `narration` payload.

Markers are a best effort, so **tool activity is a second, cheaper source**: a
`can_use_tool` (or `tool_use`) for `Bash`/`PowerShell` emits
`Running: <first 60 chars>…`, and `Read`/`Glob`/`Grep`/`NotebookRead` emit
`Inspecting the project…`. That path needs nothing from the model.

## HTTP surface

`GET /` and any `.html` / `.js` / `.css` / `.svg` under `scripts/onboard-ui/` are
served **token-free** (extension allow-list plus a containment check, so nothing
outside that directory is readable) — they are the door, not the keys.
Everything else needs `?t=<token>` or an `x-onboard-token` header.

| Route | Body / result |
| --- | --- |
| `GET /events` | the SSE stream above |
| `POST /start` | `{run}` — `"full"`, `"check"` or a group name |
| `POST /stop` | `{}` → `{ok, wasRunning}`; kills the tree (above) |
| `POST /answer` | `{id, answer}` — `answer` is a label, a joined multi-select array, or free text |
| `POST /decision` | `{id, allow, always?, reason?}` |
| `POST /secret` | `{id, action:"save"\|"keep"\|"skip", value?}` |
| `POST /message` | `{text}` — inject a user turn (409 when nothing is running) |
| `GET /app/health` | `{ok, port, status?, reason?}` — always 200, poll-friendly |
| `GET /app/tts` | passthrough of the app's `GET /api/tts` JSON, upstream status kept |
| `POST /app/tts/sample` | `{provider, voiceId?, language?}` → audio bytes |
| `POST /choice/tts` | `{provider}` or `{skipped:true}` |

### The secret three-way

The card carries `alreadySet`, so the page can offer replace / keep / skip
instead of only paste / skip:

- `save` writes the value into `.env.local` and answers the agent
  `"<NAME> is set (written by the installer host — do not read or echo its value)"`.
  Overwrite is permitted **only when the card that was shown said
  `alreadySet:true`** — keying off the file's state at save time would clobber a
  value that appeared after the card was drawn. When the value is unsurfaced and
  present, the merge returns `{state:"exists"}`, the card is re-emitted with
  `alreadySet:true`, and the item stays open; saving again then replaces.
- `keep` touches nothing and answers `"<NAME> kept — an existing value … was left untouched"`.
- `skip` answers `"<NAME> skipped"`.

The value never appears in an event, a log, or the agent transcript (asserted in
the driver by scanning the whole event and stdin streams for the literal).

### App + voice proxy

The page cannot reach the booted app cross-origin, so the host relays. It learns
the port from `[[wizard:app port=N]]`; `KP_ONBOARD_APP_PORT` presets it for tests.
Before a port is known, `/app/health` answers `{ok:false, port:null, reason}` and
the other two answer `409`.

`POST /app/tts/sample` never accepts text from the page — cost control. The host
picks a capped (~120 char) sentence, Czech when `language` starts with `cs`,
English otherwise, and streams the audio back with the upstream `content-type`
and the `x-tts-voice` / `x-tts-provider` / `x-tts-elapsed-ms` /
`x-tts-fallback-from` headers intact. `provider` must match
`/^[a-z0-9][a-z0-9_-]{0,31}$/`.

`/api/tts` is behind `requireOperator`, so in team mode these proxies can answer
**401** — that status is passed through as-is rather than smoothed over; the page
copy handles it. A non-JSON answer (an HTML error page) comes back as
`{error, status, contentType}` with the upstream status.

`POST /choice/tts {provider}` merges `KP_TTS_PROVIDER=<provider>` into the env
file (a preference, not a secret, so overwrite is the point) and injects a user
turn telling the agent the host wrote it, so the final matrix reflects the
choice. `{skipped:true}` injects the skip note instead. The preamble tells the
agent to emit `[[wizard:app]]` + `[[wizard:phase id=voice]]` after a successful
boot verify and then **wait** for that message before printing the matrix.

## Spike record

`spike.mjs` / `spike2.mjs` (scratchpad, not committed) ran against a throwaway
temp cwd so no project hooks loaded. Final assertion set, all `true`:

```
init: true          — system/init received after the initialize handshake
bashDenied: true    — deny on `pip install --dry-run …`; model reported
                      "denied by the permission system … Nothing ran"
bashAllowed: true   — allow on `mkdir spike-made-dir && echo spike-ok`;
                      tool_result "spike-ok", directory created
askIntercepted: true— AskUserQuestion answered programmatically, model echoed
                      the chosen option back
followUp: true      — four sequential user messages on one child process
```
