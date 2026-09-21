# Driving the Claude Code CLI over stream-json — observed protocol

Durable output of the 2026-08-31 protocol spike for `scripts/onboard-ui/`,
extended 2026-09-06 by the enforcement spike (v0.4) and the same day by the
first-real-operator-run fixes ([v0.5](#v05--what-a-real-operator-run-found)).
Everything below was **observed live** against `C:\users\kazda\.local\bin\claude.exe`
— **2.1.251** for the original protocol shapes, **2.1.263** for everything in
[Closing the invisible-command hole](#closing-the-invisible-command-hole) and
[v0.5](#v05--what-a-real-operator-run-found) — on a
subscription login (no `ANTHROPIC_API_KEY` in the child env), not read off a doc. The SDK (`@anthropic-ai/claude-agent-sdk`, installed in a
throwaway scratch dir and never in this repo) was read only to learn the argv and
the frame shapes; **the shipped host depends on nothing but `node:` builtins.**

## Why this exists

`scripts/onboard-ui/` spawns the CLI as its engine so the wizard runs on the
operator's own subscription. It must intercept permission prompts and
`AskUserQuestion` and answer them from a browser form. That is only possible if
the CLI routes those over stdio — it does, via the same control protocol the SDK
uses.

## The two files (v0.6)

Since v0.6 the host is split, with **no behaviour change** at the split:

| File | Owns |
| --- | --- |
| `engine.mjs` | the CLI child and its argv self-check, the control protocol, the permission policy + the hook settings file, host markers, the host inventory, the wizard preamble, the `.env.local` merge, secrets, the app proxy, and the `Session` — including the replay buffer below |
| `server.mjs` | HTTP only: routes, the SSE fan-out, the per-run token, CORS, static files, the banner |

`Session` takes an **event sink** — `new Session(fn)`, where `fn` is handed one
event object. `server.mjs` passes its SSE broadcaster; a driver passes an array
push. The engine therefore knows nothing about connections, which is what makes
"two faces on one run" a non-question for it: the session state that decides
what a card means is single and server-side.

`server.mjs` re-exports the engine's test surface (`classifyCommand`,
`assertEnforcement`, `parseProbeTable`, …), so a driver may import either file —
the split is an implementation detail of this process, not of its contract.

**Why the engine is not a Next.js route handler**: it would couple the engine to
the process it is configuring. A repair journey where the app crashes would take
the wizard down with it; env-file writes would come from the process that needs
restarting to read them; and the CLI child would inherit the app's env instead
of the launcher's scrubbed one. See `docs/concepts/onboarding-in-app.md`.

## Two faces, one engine

The wizard has two front ends on the same session:

| Face | Served by | Covers |
| --- | --- | --- |
| the standalone page (`wizard.html` + `core.js`) | this server, token-free | the bootstrap: a machine where kp cannot boot yet has no other option |
| the studio (`<app>/setup/studio`) | the kp app itself | everything after the app answers `/api/health` — the design system, both themes, four locales |

Both open `GET /events` and POST the same routes. Both may be connected **at the
same time**; that is the normal state after a hand-off, not an edge case. What
makes it work is that nothing per-connection decides anything: see
[CORS](#cors--the-studio-origin), [the hand-off](#the-hand-off-url) and
[Rejoining a live session](#rejoining-a-live-session).

## argv

```
claude --output-format stream-json --verbose --input-format stream-json \
       --permission-prompt-tool stdio \
       --permission-prompts host \
       --permission-mode manual \
       --settings <tmpdir>/kp-onboard-enforce-<token>.json
```

…where the settings file is exactly:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node -e \"process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'ask',permissionDecisionReason:'The kp installer host reviews every tool call.'}}))\""
      }]
    }]
  }
}
```

The last four lines are new in v0.4 and are the subject of
[Closing the invisible-command hole](#closing-the-invisible-command-hole)
below — read that before changing any of them, because the obvious-looking
one (`--permission-mode manual`) is measurably **not** the one doing the work.

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
- **`--settings` must be a PATH, not an inline JSON string.** It accepts either,
  and the inline form is a trap: with `KP_CLAUDE_CLI` unset the cliPath is a bare
  `claude`, which takes the `shell: true` branch on win32, and cmd.exe re-parses
  the argv and eats every `"` in the blob. Measured — the child received
  `{hooks:{PreToolUse:[{matcher:*,…` and would have started with **no hook at
  all**, i.e. silently unenforced, with nothing on stderr. `server.mjs` writes the
  JSON to a temp file and passes the path, and also quotes any arg containing a
  space before handing it to a shell.
- Child env: see [The env strip](#the-env-strip). `CLAUDE_CODE_ENTRYPOINT=sdk-ts`
  is forced; `NODE_OPTIONS`, every `ANTHROPIC_*_KEY` / `ANTHROPIC_AUTH_TOKEN`
  (so the subscription login is used — mirrors kp's own LLM spawn hygiene) and
  every permission-relevant `CLAUDE_CODE_*` are removed.
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

**`updatedInput` really is an edit, not a formality — measured.** Spiked
directly (`spike-updatedinput.mjs`, claude 2.1.263, throwaway cwd): the model
asked to run `echo ORIGINAL-COMMAND`, the host allowed it with
`updatedInput.command = "echo REWRITTEN-BY-HOST"`, and the `tool_result` came
back `"REWRITTEN-BY-HOST"`. The original never ran. This is what licenses the
[timeout append](#4-a-probe-with-no-timeout-hangs-forever) below.

One cost, worth knowing before using it for anything else: **the model notices.**
In that spike it reported, unprompted, that "something between my tool call and
the shell — a hook or the harness — appears to have rewritten either the command
or its result", and stopped to flag it. An unannounced rewrite reads to the agent
as a fault. So the preamble now tells it in advance that the host may append a
timeout and that a non-byte-identical command is expected — a rewrite the wizard
uses is a rewrite it declares, to the operator on the ledger *and* to the agent
in its instructions.

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
(`describeAsk`, `shapeKey`, `noteToolActivity`). A live `/onboarding check` run
raised six `PowerShell` permission requests and zero `Bash` ones.

**Historically, not every tool call produced one.** With
`--permission-prompt-tool stdio` alone the CLI's own classifier auto-approved
plainly-safe commands: `echo spike-ok` executed with **no** `can_use_tool` at
all, while `mkdir …` and `pip install …` both raised one. Until v0.4 this file
said, correctly, that "the wizard cannot promise it will see every Bash command".
That is no longer true, and the next section is how — and what it cost to find
out that the flag which sounds like it fixes this does not.

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

## Closing the invisible-command hole

*New in v0.4. Everything in this section was measured against
`claude.exe` **2.1.263** from a throwaway temp cwd, in the rig style above.*

### The problem

The wizard's whole pitch is that a non-technical operator sees what is about to
run on their machine. v0.3 could not honestly make that claim: the CLI settles
"plainly safe" commands before the wire, so the host provably did not see every
command. Worse, the same classifier settles `Read` inside the cwd — which meant
the v0.3 **env-file read guard was decorative**, because a `Read .env.local`
could be approved without ever reaching the code that denies it.

### What was measured

Prompt in every case: run `echo spike-ok`, then `node --version`, nothing else.
"Invisible" = the command appeared as a `tool_use` and **executed**, with no
`can_use_tool` for it.

| Configuration | Commands run | Reached the host | Invisible |
| --- | --- | --- | --- |
| `--permission-prompt-tool stdio` (v0.3) | 2 | 0 | **2** |
| …plus `--permission-mode manual` | 2 | 0 | **2** |
| …plus a project `.claude/settings.json` with an `allow` rule | 2 | 0 | **2** |
| **…plus a `PreToolUse` ask-hook** (no mode flag) | 2 | 2 | **0** |
| **ask-hook + `--permission-mode manual`** (adopted) | 2 | 2 | **0** |
| ask-hook + an explicit `permissions.allow` for one of them | 2 | 2 | **0** |
| ask-hook, matcher `*`, a `Read` and a command | 2 | 2 | **0** |

Three findings worth stating plainly, because two of them are the opposite of
what a reasonable person would guess:

1. **`--permission-mode manual` does NOT close it.** It is listed in `--help`
   ("acceptEdits, auto, bypassPermissions, manual, dontAsk, plan"), it is the
   mode whose name means "ask me", and it changed nothing: the same two commands
   ran with no control request. It was the expected fix and it was falsified.
2. **A `PreToolUse` hook returning `permissionDecision:"ask"` does.** It runs
   ahead of the classifier, so every tool call is forced into the permission
   flow, which `--permission-prompt-tool stdio` then routes to the host. Zero
   invisible calls in every configuration that includes it.
3. **The hook also beats an explicit `allow` rule.** With the hook installed, a
   `permissions.allow` entry for `echo spike-ok` did *not* let it skip the wire.

### The project-settings trust boundary

Tested directly, because "the repo can silently pre-approve commands" would be a
real hole worth documenting. Two facts:

- Project `permissions.allow` entries are **ignored in an untrusted workspace**,
  and the CLI says so on stderr: *"Ignoring 2 permissions.allow entries from
  .claude/settings.json: this workspace has not been trusted."* kp's own checkout
  **is** trusted, so there they would apply.
- …except that the ask-hook overrides them anyway (row 6 above). So the boundary
  is closed in practice, and it is closed by the host's own hook rather than by
  hoping the repo's committed settings stay empty. kp's `.claude/settings.json`
  today has no `permissions` block at all.

Nothing about settings loading is disabled, so `CLAUDE.md`, project skills and
the `/onboarding` skill all still load — verified by the live run below, which
executed the skill end to end and printed its capability matrix.

### The adopted argv, and why `manual` is still in it

`manual` does no work here. It is kept because it costs nothing, it is the mode
whose name matches what the page tells the operator, and it is a second layer if
a future CLI drops or changes hook precedence. **The hook is what enforces.**
This file says so rather than crediting the flag, and the launch self-check
asserts both.

### Safe-command policy — the compensation

Routing everything to the host would turn a dozen version probes into a dozen
cards, so the host now does the classifying the CLI used to do — conservatively,
in writing, and with a `notice` event per decision so nothing settled without a
card is settled in silence. A command is auto-allowed only if it matches a
declared prefix **and** survives every veto.

Allowed prefixes (`SAFE_PREFIXES` in `server.mjs`) — a prefix matches the whole
command or the command up to a space, so `node --version` never admits
`nodejs --version`:

| Class | Prefixes |
| --- | --- |
| version probes | `node --version` `node -v` `npm --version` `npm -v` `npx --version` `python --version` `python -V` `python3 --version` `python3 -V` `py -3 --version` `py --version` `git --version` `claude --version` `docker --version` |
| existence probes | `where` `which` `command -v` `Get-Command` |
| inert listings | `npm ls` `ls` `dir` `Get-ChildItem` `echo` |
| loopback HTTP GET | `curl` `Invoke-WebRequest` `Invoke-RestMethod` |

Plus **the overlay's own declared probes**: `.claude/onboarding/config.md`
already names the exact command each prerequisite is checked with, in a markdown
table. The host parses that table's `probe command` column at spawn and treats
each backticked cell as an exact-prefix allow — re-deriving the list here would
only make it drift. A `<port>`-style placeholder is truncated to its head
(`curl -s localhost:<port>/api/tts` → the open prefix `curl -s localhost:`); a
cell that is a bare path rather than a command (`` `node_modules/` ``) is
rejected; and a declared probe that fails a veto is dropped at parse time. **This
is a trust boundary and it is deliberate: the wizard trusts the repo's own
committed overlay the way it trusts its own source.** It is worth knowing that
today that list includes `npm run schemas:gen` (runs the Python codegen) and
`claude -p "say ok"` (one cheap subscription call) — both are what the overlay
declares a healthy install is proven by.

Vetoes (`HARD_BLOCKS`), applied to the **raw** string before whitespace is
collapsed, so a newline cannot hide a second command. Any one of these wins over
any prefix match:

| Veto | Catches |
| --- | --- |
| `[>|;&\`]` | redirect, pipe, chaining, backtick — including a PowerShell formatting pipe |
| `$(` | command substitution |
| `\r` `\n` | more than one line |
| `.env` as a path token | anything naming the env file |
| `rm` `del` `erase` `rmdir` `Remove-Item` `Move-Item` `Copy-Item` `Set-Content` `Add-Content` `Out-File` `Clear-Content` `New-Item` `Invoke-Expression` `iex` `sudo` `runas` `taskkill` `Stop-Process` `Start-Process` `chmod` `chown` `uninstall` | destructive or state-changing verbs |
| `--force` / `-force` | forced anything |
| network verbs only: `-o` `-O` `--output` `-T` `--upload-file` `-d` `--data*` `-F` `--form` `-X` `--request` `-OutFile` `-Method` `-Body` `-InFile` | a download or a non-GET — **except** `-o`/`--output` pointed at the null device, which is a status probe (v0.5) |
| network verbs only: no loopback host, or any dotted TLD present | reaching off this machine |

Anything else simply draws a card. **`{allowed:false}` never means "refused"** —
the operator can always still say yes.

Two narrow classes sit beside this table, both added in v0.5 after a real
operator run carded them, and both described in full
[below](#v05--what-a-real-operator-run-found): the **python import probe**
(parsed, so a `;` inside a quoted `-c` payload is not read as shell chaining)
and the **network timeout append** (an allowed verdict may hand back an edited
command). Neither loosens a veto; the first parses a shape the veto could not
see into, the second adds a bound that was missing.

### Repeat fatigue, and the button that is gone

v0.3 had an "always allow for this run" button. It is **removed**: it widened a
*shape* (`Write:<path>` ignored the file's content; `Bash:<command>` was widened
on a click) and it asked the operator to opt out of their own protection to make
the asking stop. `POST /decision` still accepts `always` and **ignores it**.

What replaces it is invisible and strictly narrower: a call the operator has
explicitly allowed may be re-allowed automatically on an **exact** match for the
rest of that run — the normalized command string for a shell tool, the whole
input object for anything else. It repeats a decision the operator already made
for a byte-identical call and widens nothing, which is why it needs no button.
Every repeat still emits a `notice` (`kind:"repeat-allowed"`), because a silent
repeat is how "allow once" quietly becomes "allow forever".

### The tripwire

The ask-hook is supposed to make an unrequested shell run impossible. That claim
stays *checked* rather than asserted: every `tool_use` for `Bash`/`PowerShell`
whose `tool_use_id` no `can_use_tool` ever mentioned emits
`{type:"notice", kind:"unrequested-run", …}`. It is a tripwire, not a crash —
the run continues and the operator is told.

Ordering-safe by construction: a `can_use_tool` and its `tool_use` block can
arrive in either order, so the verdict waits for the turn's `result` frame.
Measured on the live runs below: **zero** unrequested runs.

### The launch self-check

`assertEnforcement(buildArgs())` runs before the port is bound and exits non-zero
with a plain-English stderr block if any of these is true:

- `--permission-prompt-tool stdio` is absent;
- `--permission-mode manual` is absent;
- any argv token contains `--dangerously-skip-permissions`,
  `--allow-dangerously-skip-permissions`, `bypassPermissions`, `dontAsk` or
  `acceptEdits`;
- the `--settings` target (path **or** inline blob) does not parse, or carries no
  `PreToolUse` hook that decides `ask`.

The same assertion re-runs per spawn, so a session can never start weaker than
the process promised at startup. On the shipped argv it can never trip, which is
the point: it is a standing assertion that a future edit which quietly re-opens
the hole stops the wizard at launch instead of shipping a page that claims
"every command asks first" over a session where they do not.

`KP_ONBOARD_NO_LISTEN=1` imports `server.mjs` without binding a port, so a driver
can call the exported `assertEnforcement`, `buildArgs`, `sanitizeEnv`,
`classifyCommand`, `classifyPythonImportProbe`, `parseProbeTable`,
`overlayProbeCommands` and `isProtectedEnvName` directly.

### The env strip

The `CLAUDE_CODE_*` surface is ~500 names wide (enumerated out of the binary), so
a deny-list would be stale the day it was written. The child env is therefore
built by **removing every `CLAUDE_CODE_*` except a small keep-list** — proxy and
client-certificate settings, `CLAUDE_CODE_GIT_BASH_PATH`, `CLAUDE_CODE_TMPDIR`,
and `CLAUDE_CODE_ENTRYPOINT`, which is then forced to `sdk-ts` — plus, by name:
`IS_SANDBOX`, `BASH_ENV`, `CLAUDE_BG_SESSION_PERMISSION_RULES`,
`CLAUDE_CHROME_PERMISSION_MODE`, `CLAUDE_RUNNER_SKIP_GIT_VERIFY` and
`NODE_OPTIONS`. That sweeps up the real levers a stale environment could carry —
`CLAUDE_CODE_ENABLE_AUTO_MODE`, `CLAUDE_CODE_SAFE_MODE`,
`CLAUDE_CODE_MANAGED_SETTINGS_PATH`, `CLAUDE_CODE_SHELL`, an inherited
`CLAUDE_CODE_SESSION_ID` — without needing to have predicted each one.

**Honest scope:** this does not sandbox the child. It inherits the operator's
`PATH`, so which `node` or `git` actually runs is still the machine's business.
What it removes is the class of variable that turns asking *off*.

### What this run of the wizard may honestly claim

`hello` now carries:

```json
"enforcement": {
  "mode": "manual",
  "skipFlagBlocked": true,
  "askHook": true,
  "autoAllowPolicy": "host-side read-only diagnostics plus skill/agent plumbing; every command and every plumbing call emits a notice"
}
```

The claim it licenses is precise, and it is not "nothing runs without your
click": **every command is either allowed by a written host policy — and said so
on the ledger — or shown to you.**

Two classes of tool are allowed by the host without a card. They differ in
whether they also emit a notice, and the difference is deliberate:

| Class | Tools | Notice? |
| --- | --- | --- |
| Read-only inspection (`AUTO_ALLOW_READONLY`) | `Read` `Glob` `Grep` `NotebookRead` | **no** — they are not commands, they fire dozens of times a session, and the env-file guard below is the one place a read matters |
| Skill / agent plumbing (`AUTO_ALLOW_PLUMBING`, v0.5) | `Skill` `Task` `Agent` `TodoWrite` `ToolSearch` `TaskOutput` `ListAgents` | **yes**, `kind:"auto-allowed"` — rare, and "the host started the assistant for you" is worth saying out loud |

`WebFetch` and `WebSearch` were in the first class until v0.5 and are **not any
more**: they were filed under "read-only", which is true of the local filesystem
and false of the internet. They reach off this machine — exactly what the shell
policy's loopback confinement refuses to wave through — so they card.

### Verified live (v0.4)

One real `{run:"check"}` against this configured checkout, `KP_CLAUDE_CLI`
unset so the production `shell: true` path was exercised:

```
user cards:          2   (1 shell)
notices:            11   (11 auto-allowed, 0 repeat-allowed)
unrequested-run:     0   <- nothing invisible to the host
probes: 6   phases: welcome -> assess -> verify -> voice -> done   matrix: yes
```

The eleven auto-allowed commands were `node --version`, `python --version`,
`python -c "import pipeline.jobfit.codegen"`, `git --version`,
`claude --version`, `claude -p "say ok" --output-format json` and five
`curl -s http://localhost:3002/…` probes — every one of them a command that, in
v0.3, the host would never have seen at all. The single shell card was
`curl -s -o /dev/null -w "%{http_code}" …`: a loopback GET, carded because `-o`
is a download flag. That was called "the policy being exact rather than clever"
and it was neither — see [v0.5](#v05--what-a-real-operator-run-found).

Two earlier iterations of the same run cost 7 and then 6 cards, both because the
agent batched its probes (`node --version; git --version; python --version`, and
later `Invoke-WebRequest … | Select-Object …`) into single commands that the
pipe/chain veto correctly refused to wave through. The fix was **not** to carve
into the veto: the preamble now tells the agent to run probes one at a time and
to read a local endpoint with a bare `curl -s`, which moved work from cards to
policy without loosening a single rule. 7 → 6 → 2 → (v0.5) **0**.

## v0.5 — what a real operator run found

*2026-09-06, claude 2.1.263. v0.4 was verified by its author driving it; this is
what the first run by the operator it was built for turned up. Every fix below
moved work from cards to written policy — no veto was loosened.*

### 1. Pressing Start asked permission to start

The very first thing the run did was card. The `*` ask-hook routes **every**
tool through the host, and v0.4 auto-allowed only the read-only four plus the
shell policy — so the model's reach for the `/onboarding` skill arrived as a
`can_use_tool` for `Skill` and became a confirmation card asking the operator
whether the wizard might run the thing they had just pressed Start for. Decline
it, and the run was over before it began.

Two shapes were measured, because the fix has to cover both:

- `/onboarding check` sent as a **slash command** in a bare session loads
  inline and raises **no tool call at all** (`spike-skillname.mjs`: the first
  frame on the wire was `Read .claude/onboarding/config.md`);
- under the wizard's real preamble the model instead reaches for the **`Skill`
  tool**, which does raise a `can_use_tool` (confirmed on the v0.5 live run,
  8.3 s in: `Ran automatically: Skill (onboarding)`).

So `Skill` joins the plumbing class above, and the skill invocation is never a
question again.

**`Task` and `Agent` are the same tool under two names.** The `system/init`
frame's tool list says `Task`; the identical dispatch arrives on the wire as
`tool_name:"Agent"` (`spike-subagent.mjs`). Both are listed, because the wire is
what this code sees and the init list is what a reader would have copied.

**Allowing dispatch is not a hole, and that was checked rather than assumed.** A
subagent's own tool calls reach this host as their own `can_use_tool`: in the
spike the dispatched agent's `Bash echo SUBAGENT-RAN` arrived here and was
policed like any other command. Nothing in the plumbing class writes, edits or
runs a shell itself — that is the line, and `Write`/`Edit`/`Bash`/`PowerShell`
never cross it by this route.

### 2. A declared probe carded because the agent embellished it

The overlay declares the Python health check as
`python -c "import pipeline.jobfit.codegen"`. What the agent actually ran was
`python -c "import pipeline.jobfit.codegen; print('ok')"` — and the `;` veto,
which reads the **raw** string precisely so a newline cannot hide a second
command, cannot see that this particular `;` is punctuation inside a quoted
argument. A declared probe carded.

Fixed at both layers, neither of which softens the veto:

- **Preamble:** a declared probe is run **verbatim**. No appended print, no
  second check chained on; if more output is needed, run a second probe of the
  same declared shape.
- **Policy:** `classifyPythonImportProbe()` **parses** one shape — an
  interpreter (`python` / `python3` / `py`, optional `-3`), `-c`, and a quoted
  payload that is a single `import a.b.c` optionally followed by
  `print(<literal>)`. A match returns an allow **before** the vetoes; anything
  else returns `null` and meets every veto exactly as before. So
  `python -c "import os; os.system('x')"` still cards — as do a `from … import`,
  a comma list, three statements, `print(os.environ)` (a call, not a literal),
  `__import__(…)`, and any real shell chaining around the whole thing. All
  thirteen are pinned in the driver.

Honest scope: importing a module runs that module's top-level code. This class
is a deliberate trade against carding the single most common health probe in
this project, and it is bounded by the grammar above rather than by hoping the
module is harmless.

### 3. (page-side, not this file)

### 4. A probe with no timeout hangs forever

`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/` — the
LightTrack check — was **both** carded and hung. Two independent defects:

**Carded.** v0.4 read `-o` as a download flag. It is not, when the target is the
null device: `-o /dev/null`, `-o NUL`, `--output /dev/null|NUL` is *the*
canonical status-probe shape and writes nowhere. `DISCARD_TO_NULL` strips those
occurrences before the download flags are looked for; any other `-o` target is
still a download and still cards, and curl's `-O` (write to the remote name)
keeps its veto because the short flag is matched case-sensitively.

**Hung.** The probe carried no timeout, and on this box nothing listens on 8787,
so it waited — with the page sitting on a step that would never finish. Fixed
three ways:

- **Preamble:** every network probe carries an explicit short timeout
  (`curl --max-time 4`, `Invoke-WebRequest -TimeoutSec 4`), and the examples
  show it, including the `-o /dev/null` status shape.
- **Policy:** a loopback GET with no timeout flag is **allowed with an edited
  command** — `--max-time 4` / `-TimeoutSec 4` appended — and the ledger says
  `Ran automatically (timeout added): …`. It is not a silent rewrite: the
  operator is told on the notice and the agent is warned in its instructions
  that the command which ran may not be byte-identical to the one it wrote.
  This rides on `updatedInput`, which was
  [spiked first](#3-can_use_tool-cli--host) rather than assumed. The card-with-
  a-hint fallback was not needed.
- **Preamble, generically:** a capability group's verify probe is *conditional*
  on its service running. A configured variable pointing at a local port proves
  the wiring, not that anything is listening; "nothing answered" is a finding to
  report (`status warn`, naming what would start it), never a reason to wait.
  **No service is special-cased by name in code** — the timeout rule covers
  LightTrack the same way it covers anything else.

### Verified live (v0.5)

One real `{run:"check"}` against this configured checkout, `KP_CLAUDE_CLI` unset:

```
user cards:          0   <- was 2
notices:            15   (15 auto-allowed, 0 repeat-allowed)
unrequested-run:     0
probes: 12   phases: welcome -> checks -> verify -> voice -> done   matrix: yes
```

Card count for a full doctor pass is now **zero**. Specifically:
`Skill (onboarding)` auto-allowed at 8.3 s (the v0.4 card, gone);
`python -c "import pipeline.jobfit.codegen"` run verbatim (the agent obeyed the
new rule, so the parse class was belt to the preamble's braces); and
`curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://127.0.0.1:8787/`
allowed, returning in ~1 s to
`[[wizard:probe name="LightTrack" status=warn detail="configured, but nothing
answering on :8787"]]` — the defect that hung the operator's run, now a reported
finding.

Because the agent wrote its own timeouts, the **append** path was not exercised
by that run; it is proved instead by the session driver, which asserts the CLI
*received* the edited command. Worth stating plainly rather than letting a
zeroed counter imply the code is unreachable.

One thing that looks like a hang and is not: on a `check` run the agent stops at
`[[wizard:phase id=voice]]` and waits for the host's `POST /choice/tts`. A
driver that never sends one waits forever. That is the spoken-output contract
working — the first v0.5 verification run burned its whole budget on it before
the driver was taught to answer.

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
| `hello` | sent once per connect, and the whole of [Rejoining a live session](#rejoining-a-live-session) — it is the only event with no `seq` |
| `notice` | `{type:"notice", kind, text}` — the transparency ledger: something the host settled WITHOUT a card. `kind` is `auto-allowed` (matched the safe-command policy), `repeat-allowed` (byte-identical to a call the operator already allowed this run) or `unrequested-run` (the tripwire: a shell run no `can_use_tool` mentioned). Render these in the activity drawer, not as cards — they are already done |
| `plan` | `{type:"plan", steps:[{id,label}]}` — the agent-declared step rail for this journey; re-emitted if the journey changes mid-run |
| `phase` | `{type:"phase", id}` — **free-form since v0.3**: any id matching `/^[a-z0-9][a-z0-9-]{0,31}$/`, normally one the `plan` event declared. `check` and single-group runs still emit the legacy fixed ids `welcome` `mode` `checks` `capabilities` `boot` `voice` `done`, so a page with no plan can fall back on them |
| `status` | `{type:"status", text}` — one line of "what is happening now"; deduped against the previous one |
| `probe` | `{type:"probe", name, status, detail}`, status ∈ `ok` `fail` `warn` `running` |
| `narration` | `{type:"narration", md}` — the agent's prose, markdown, markers already stripped |
| `question` | `{type:"question", id, header, question, options:[{label, description?}], multiSelect}` |
| `secret` | `{type:"secret", id, name, note, alreadySet}` |
| `permission` | `{type:"permission", id, tool, command, description, shape}` — `shape` is now only a stable identity string; there is no longer any UI that widens it (see below) |
| `resolved` | `{type:"resolved", id, kind, outcome, answer?}` — **v0.6.** A card is no longer open. `kind` is `question` \| `secret` \| `permission`; `outcome` is `answered` \| `saved` \| `kept` \| `skipped` \| `allowed` \| `declined` \| `withdrawn`; `answer` is present only for `kind:"question"` and carries the label(s) the operator picked. Settle the card with that id — it may have been answered on ANOTHER face. The face that answered it gets this event too, so settle idempotently (skip a card already settled) rather than settling twice |
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

`seq` is **strictly increasing across the whole session** (it is not reset by a
new run) and is the identity a client uses for de-duplication — see the replay
block below. Track the highest `seq` you have processed.

## Rejoining a live session

Every `/events` connection opens with one `hello` frame, written and registered
in the SAME synchronous step as the client joins the fan-out — so no event can
slip between the state a client is handed and the live stream it then joins.
Two clients connecting at different points in the same run get the **same
picture**; the only difference is how much of it arrives as replay.

```jsonc
{
  "type": "hello",
  "repo": "C:\\Users\\kazda\\kiro\\kp",
  "envFileExists": true,
  "running": true,
  "phase": "capabilities",          // current phase id, or null
  "plan": [{"id":"assess","label":"Looking around"}],  // or null
  "appPort": 3000,                  // or null before boot verify
  "self":   { "port": 4655 },       // THIS wizard server's own bound port
  "studio": true,                   // present only when the studio is on offer
  "enforcement": {
    "mode": "manual",
    "skipFlagBlocked": true,
    "askHook": true,
    "autoAllowPolicy": "host-side read-only diagnostics plus skill/agent plumbing; …"
  },
  "replay": {
    "status":    "Checking Python",             // the last status line, or ""
    "probes":    [ /* one `probe` event per name, latest wins */ ],
    "narration": [ /* the last 20 `narration` events */ ],
    "notices":   [ /* the last 20 `notice` events */ ],
    "cards":     [ /* every card still awaiting the operator */ ],
    "matrix":    null,                          // the final matrix markdown, or null
    "terminal":  null,                          // the last done/stopped/error EVENT, or null
    "seq":       41                             // the session's seq at hello time
  }
}
```

Field notes, in the order they bite:

- **`self.port`** is what this server actually bound. It retries on
  `EADDRINUSE`, so it is not necessarily `KP_ONBOARD_PORT` or 4655, and a face
  must not guess it.
- **`studio`** is present and `true` only when the studio offer is live
  (`KP_ONBOARD_STUDIO=0` omits the key entirely). Key the hand-off off this,
  never off your own environment — only the server reads that variable.
- **`enforcement`** is what a face may honestly display about permissions.
  `skipFlagBlocked` is the load-bearing half; it is asserted at launch AND
  re-asserted per spawn. If the field is absent, claim nothing.
- **Every entry in `probes` / `narration` / `notices` / `cards` is the
  VERBATIM event that was broadcast**, `type`, `seq` and `at` included. Feed
  them through the same handler you use for the live stream — do not write a
  second renderer for rejoin. A `cards` entry is exactly the `question` /
  `secret` / `permission` event that opened it (a re-emitted secret card
  replaces its predecessor under the same id, so `alreadySet` is current).
- **Replay them in `seq` order, across all four lists at once.** The lists are
  grouped for readability but they interleave in time — a `narration` block is
  emitted *between* two `probe` markers of one assistant message — so replaying
  group by group runs the stream backwards. Sort, then drop anything at or below
  the highest `seq` you have already processed. That guard is what makes an
  EventSource auto-reconnect (which delivers a second `hello`) idempotent
  instead of a duplicate render. *(Measured: without the sort, the seq guard
  eats the narration that a probe's higher seq has already advanced past.)*
- **`matrix`** is markdown, not an event, so it has no `seq`; guard it on its
  own content. **`terminal`** IS an event (`done` / `stopped` / `error`) and
  carries a `seq` like anything else — replay it and your terminal panel renders
  for a face that joined after the run ended.
- `phase` and `plan` stay at the TOP level as well as driving the replay,
  because a face needs the rail before it renders anything into it. Apply them
  first; a plan-declared phase id you have never seen is taken at face value.

Buffers are per-RUN: `POST /start` clears cards, probes, notices, narration,
matrix and terminal, so a face joining the second run is never handed the
first one's evidence. `seq` is NOT reset — it is the session's, not the run's.

Deliberately **not** in the replay: the agent's full transcript. The buffer is
capped at 20 narration blocks and 20 notices because a rejoin is meant to render
the run's current state, not to reconstruct its history.

## CORS — the studio origin

The studio page is served by the kp app and calls this server **cross-origin**:
`GET /events` (EventSource), every POST route, and the `/app/*` proxies.

- **Loopback origins only, reflected exactly.** `http://localhost:<port>`,
  `http://127.0.0.1:<port>` and `http://[::1]:<port>`, any port (the app's port
  is not fixed on a shared box) or none. The specific `Origin` is echoed back —
  never `*`: this server writes `.env.local` and approves shell commands, and an
  allowlist that matches everything is not one.
- **A non-loopback `Origin` gets no CORS headers at all.** Not a narrow grant, none.
- `Vary: Origin` rides on **every** response, including the ones with no grant —
  it is a cache-correctness header, not an access one, and without it a response
  cached for one origin could be replayed to another.
- `Access-Control-Expose-Headers: x-tts-voice, x-tts-provider, x-tts-elapsed-ms,
  x-tts-fallback-from` — without it the studio cannot read which engine actually
  spoke a sample, which is exactly the fact a "pick your default" screen must
  not hide.
- **Preflight**: `OPTIONS` on any route answers `204` with
  `Access-Control-Allow-Methods: GET, POST, OPTIONS`,
  `Access-Control-Allow-Headers: content-type, x-onboard-token` and
  `Access-Control-Max-Age: 600`. It is answered **before the token check** — a
  browser never attaches `x-onboard-token` to a preflight, so demanding one
  there would fail every cross-origin POST with what looks like a CORS bug and
  is really an auth one. The preflight grants nothing; the real request still
  has to carry the token.
- **No credentials.** `Access-Control-Allow-Credentials` is never sent and
  nothing here uses cookies.

**CORS is transport; the token is auth.** They are checked independently and
neither substitutes for the other: `/events` and every mutating route require
the token whatever the `Origin` says, and a request from a perfectly good
loopback origin without one gets a `403` — carrying CORS headers, so the browser
can actually read the 403 rather than reporting a network error. The token
travels as `?t=` (EventSource cannot set headers) or `x-onboard-token`.

## The hand-off URL

Once the app is confirmed up — the `app` event, or `hello.appPort` plus an
`/app/health` body with `ok:true` — the standalone page offers, prominently and
without redirecting:

```
http://localhost:<appPort>/setup/studio#wizard=<wizardPort>&t=<token>
```

- **The token is in the FRAGMENT, never the query.** A query string reaches the
  app's server logs, its access logs and any `Referer` it sends; a fragment
  never leaves the browser. The studio reads both values from `location.hash`.
- `<wizardPort>` is `hello.self.port`; `<appPort>` is `hello.appPort` /
  the `app` event.
- It is an **offer**, not a redirect, and it opens in a new tab: the operator is
  mid-run on a page they trust, and if `/setup/studio` is not there the run they
  are in the middle of is still on screen behind it.
- `KP_ONBOARD_STUDIO=0` withdraws it (`hello.studio` is omitted). The standalone
  page keeps working fully either way — it is the bootstrap face, and a machine
  whose app cannot boot never reaches this point at all.

## Host markers — the agent's structured-event channel

The wizard-mode preamble (`preamble()` in `server.mjs`) instructs the agent to
emit marker lines inside its narration. The host matches them **line-anchored**,
strips the line before the prose is emitted, and re-emits it as a typed event.

```
[[wizard:plan steps="assess:Looking around,voice:Voice interviews,done:Your install"]]
[[wizard:phase id=checks]]
[[wizard:status text="Probing the runtime"]]
[[wizard:probe name="node" status=ok detail="v24.14"]]
[[wizard:app port=3000]]
[[wizard:matrix]]
```

- Attribute values are `"quoted"` or bare. An unknown `probe` status degrades to
  `warn`; a phase id that is not slug-shaped is ignored.
- `[[wizard:plan steps="…"]]` is comma-separated `id:Label` pairs → one
  `{type:"plan", steps:[{id,label}]}` event. Ids are lowercased and must match
  `/^[a-z0-9][a-z0-9-]{0,31}$/`; malformed ids and duplicates are **dropped**
  rather than failing the marker, a step with no label falls back to its id, and
  the rail is capped at 12 steps. An empty result emits nothing. A second plan
  marker replaces the rail (a journey change) and re-emits the event.
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

## The recon-first run (v0.3)

Before v0.3 the default run marched a fully-configured machine through "Full
setup" — the mode question, every capability group, a boot verify of an app that
was already answering. The flow is now **recon-first**: the host hands the agent
what it already knows, the agent works out where the install actually is, and
the journey is proposed from findings rather than assumed.

Three pieces make that possible.

### 1. HOST INVENTORY (host → agent, once, in the preamble)

`hostInventory()` computes cheap facts before the child is spawned and injects
them between the preamble and the `/onboarding` invocation. Every run gets it —
`check` included, where it makes the doctor pass sharper.

| Fact | How |
| --- | --- |
| Set env variables | **NAMES ONLY** of variables with a non-empty value, parsed out of the env file (`KP_ONBOARD_ENV_FILE` honored). The block says in so many words that values are deliberately withheld |
| `node_modules/`, `data/kp.sqlite`, `.env.example` | `existsSync` |
| Dev server | `.next/dev/lock` → a port (JSON `port`, a `port=`/`port:` line, or a bare number) → `GET /api/health` on it with a ~1.2 s timeout. **"an app answers on :N" and "lock present but nothing answered" are different facts** (the second is a stale lock) and the block says which. With no lock — or a lock naming no port — it falls back to one probe of :3000, so a `next start` or a dev server launched outside dev-guard is still seen; that fallback says only that *something* answers, because without the lock the host cannot prove it is this checkout. Observed live: on a shared box a different product answered :3000 and the agent caught it |

A name in that list means the variable is SET — enough to decide which capability
groups are already configured, without a single value entering model context.

### 2. The env-file read guard (host, silent)

`Read`/`Grep`/`Glob`/`NotebookRead` are auto-allowed, which left the whole secret
contract with a hole big enough to drive a `Read .env.local` through: the host
writes values so the agent never sees them, and then the agent could just open
the file. Those tools are now **denied server-side** whenever any of
`file_path` / `path` / `notebook_path` / `pattern` / `glob` names the configured
env file's basename or a bare `.env` (including glob shapes like `.env*`), with:

```
The host manages the env file — use the HOST INVENTORY in your instructions.
```

`.env.example` carries no values and stays readable — it is the variable
catalogue the skill needs. The deny is **silent**: no permission card, no status
line, because there is nothing here for the operator to weigh up. Shell commands
are untouched — they already go through a confirm card, where a `cat .env.local`
is visible to the operator by construction (and since v0.4 a `.env` mention also
disqualifies a command from auto-allow outright, whatever prefix it matched).

**This guard was decorative until v0.4, and nothing said so.** The CLI's own
classifier settles a `Read` inside the cwd before the wire, exactly as it did for
`echo` — so a `Read .env.local` could be approved without ever reaching the code
above. The ask-hook's `*` matcher is what makes it real: `Read` now arrives as a
`can_use_tool` like everything else. Measured (spike 3): a `Read` and a shell
command, both on the wire, zero invisible. This is the reason the matcher is `*`
rather than `Bash|PowerShell` — the shell tools were only half the point.

Not covered, honestly: a repo-wide `Grep` for a variable NAME. ripgrep honors
`.gitignore` and the env file is ignored, so it does not surface there — but that
is ripgrep's behavior, not this guard's.

### 3. The flow contract

On the default run (`/start {run:"start"}`; `"full"` remains an accepted alias
for the same thing) the preamble prepends a **RECON FIRST** section that runs
before the skill's step 0:

1. **Assess silently** — `[[wizard:phase id=assess]]`, the HOST INVENTORY plus
   read-only runtime probes plus the check-mode verify probe of every group whose
   variables are set. No questions, no spend.
2. **Classify and offer a journey** — `fresh` / `addon` / `repair` / `complete`,
   then ONE `AskUserQuestion` with header `Journey` whose options are generated
   from the findings ("Add voice interviews (not configured)", "Fix CV analysis
   (GEMINI_API_KEY is set but the analysis probe fails)", "Just show my
   capability matrix", "Run the full setup anyway"). `complete` leads
   matrix-first. **The skill's install-mode question is asked only on `fresh`** —
   that question on a configured machine is the bug this contract fixes.
3. **Declare the plan** — one `[[wizard:plan …]]` marker naming the steps this
   journey will really walk, ending in `done`; later `[[wizard:phase]]` markers
   use those ids.
4. **Walk it** — the existing contracts unchanged, except that boot verify runs
   only when the boot state is unknown or something changed needs a restart. If
   the inventory already says an app answers, the agent emits
   `[[wizard:app port=N]]` and moves on rather than re-booting.

`check` and single-group runs keep their previous preamble (plus the inventory)
and their fixed phase ids.

### Verified live

One real-CLI `{run:"start"}` against this configured checkout (2026-09-01,
claude 2.1.252), answered "Just show my capability matrix":

- the agent assessed first — 9 probes, 10 read-only shell cards, **zero
  questions** — then asked ONE `Journey` card whose options were built from the
  findings: *"Start KP and check it (Recommended)"*, *"Set the missing
  KP_SECRET"*, *"Add email sending or calendar sync"*, *"Just show my capability
  matrix"*. Not one of them is the old fresh-install march;
- the install-mode question was **never asked** (this is not a `fresh` journey);
- `[[wizard:plan steps="assess:Looking around,done:Your install"]]` → one `plan`
  event, phases `assess → done`, and a 1.8 KB matrix;
- nothing was booted or restarted, and no card ever proposed reading the env
  file — the matrix was built from the inventory's variable NAMES plus the live
  probes, which the agent said out loud in its own narration.

## HTTP surface

`GET /` and any `.html` / `.js` / `.css` / `.svg` under `scripts/onboard-ui/` are
served **token-free** (extension allow-list plus a containment check, so nothing
outside that directory is readable) — they are the door, not the keys.
Everything else needs `?t=<token>` or an `x-onboard-token` header.
`OPTIONS` on any route is a preflight and is answered before the token check
(see [CORS](#cors--the-studio-origin)).

| Route | Body / result |
| --- | --- |
| `GET /events` | the SSE stream above, opening with `hello` |
| `POST /start` | `{run}` — `"start"` (default; the recon-first flow), `"full"` (accepted alias, same behavior), `"check"` or a group name |
| `POST /stop` | `{}` → `{ok, wasRunning}`; kills the tree (above) |
| `POST /answer` | `{id, answer}` — `answer` is a label, a joined multi-select array, or free text |
| `POST /decision` | `{id, allow, reason?}`. **`always` is accepted and ignored** — the "always allow for this run" affordance was removed in v0.4; repeat fatigue is answered by the safe-command policy and by exact-match memory of decisions already made, not by asking the operator to opt out of protection. Pages should stop sending it |
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

A route that settles a card also emits [`resolved`](#sse-event-contract) to
**every** connected face — `/answer`, `/decision` and `/secret`
(`save`/`keep`/`skip`), plus `withdrawn` for each card still open when a run
stops or the CLI exits. That is what keeps two faces in step: the decision has
always been server-side, but until v0.6 nothing on the wire said so, and the
face that did not answer was left holding a live-looking control nobody was
listening to.

### App + voice proxy

The standalone page cannot reach the booted app any other way, so the host
relays; the studio page is served BY that app and could call it directly, but
goes through the same proxy, because the proxy is where the cost control lives
(the sample text is chosen by the host, never accepted from a page). It learns
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

### v0.4 (2026-09-06, claude 2.1.263)

`spike-mode.mjs` / `spike2.mjs` / `spike3.mjs` produced the mode-delta,
settings-rule and matcher tables above; `policy-driver.mjs`,
`session-driver.mjs` (a scripted fake CLI behind `KP_CLAUDE_CLI`) and
`real-run.mjs` are the verification drivers. All scratchpad, none committed —
the shipped host still depends on nothing but `node:` builtins.

```
policy-driver:  101/101 — every allowed prefix, every veto, overlay-probe
                          parsing, exact-match repeat, env sanitising, and
                          10 poisoned argvs that must all trip the self-check
session-driver:  32/32  — real server.mjs + a scripted CLI: notices per kind,
                          `always:true` provably ignored (a second Write to the
                          same path with different content still asks — the old
                          shape key would have swallowed it), silent env deny,
                          the tripwire firing on an unasked run and NOT on
                          asked ones, and the child's real argv + env
real-run:        2 cards / 11 notices / 0 invisible (figures above)
npm run lint:    0 errors
```

### v0.5 (2026-09-06, claude 2.1.263)

Four new scratchpad drivers, none committed:

```
spike-updatedinput: allowing with a modified `updatedInput.command` makes the
                    CLI run the MODIFIED command — tool_result "REWRITTEN-BY-
                    HOST", the original never ran. The model noticed and said so.
spike-skillname:    a slash-command `/onboarding check` raises NO tool call;
                    the first wire frame is `Read .claude/onboarding/config.md`.
                    Under the wizard preamble the model uses the `Skill` tool.
spike-subagent:     the init tool list says `Task`, the wire says `Agent`; and a
                    subagent's own `Bash` call DOES arrive here as its own
                    can_use_tool, so allowing dispatch opens no hole.
spike-tools:        the CLI's own tool-name list off `system/init` (33 names) —
                    the authority for what the plumbing class may contain.

policy-driver:   63/63 — the python import class (8 allowed shapes, 13 that must
                         still card, including `import os; os.system('x')`), the
                         -o /dev/null probe vs 6 real downloads/non-GETs, the
                         timeout append and the 6 cases that must NOT be
                         rewritten, plus 15 regressions of the v0.4 policy
session-driver:  19/19 — real server.mjs + a scripted CLI: Skill/Agent/Task/
                         TodoWrite allowed and on the ledger with no card, the
                         embellished python probe allowed while `os.system`
                         cards, and the CLI RECEIVING
                         `… http://127.0.0.1:8787/ --max-time 4` — the append
                         proved end to end over the wire, not just in the policy
real-run:        0 cards / 15 notices / 0 invisible / matrix printed
npm run lint:    0 errors
```

### v0.6 (2026-09-06) — the split, CORS, the hand-off, two faces

The engine/shell split is a REFACTOR, so the claim to earn is "nothing moved
that anyone can observe". The v0.5 drivers were re-run unchanged against the
split — same numbers, same cards, same ledger — and three new ones cover what
v0.6 adds.

```
policy-driver:   63/63  — unchanged, imported through server.mjs's re-export
session-driver:  19/19  — unchanged: same 3 cards (Bash, WebFetch, Write),
                          same 7 notices, same updatedInput over the wire
cors-driver:     66/66  — 5 loopback origins reflected exactly (never `*`,
                          never with credentials); 5 foreign origins get NO
                          Access-Control-Allow-Origin; Vary: Origin on all of
                          them; preflight 204 on all 8 POST routes WITHOUT a
                          token; a foreign preflight gets 204 and no grant;
                          a good origin with a bad token still gets 403 — and
                          that 403 carries CORS so the browser can read it
dual-driver:     36/36 ×2 — two faces on one run. A joins idle, B joins with two
                          cards open: B's replay carries both cards VERBATIM
                          (deep-equal to the events A received), both probes,
                          the narration, the auto-allow notice, the plan, the
                          phase and the app port. A decision POSTed from B
                          emits `resolved` to A; an answer from A emits
                          `resolved` to B carrying what was picked. A third
                          face joining after the cards close sees none of them;
                          a fourth joining after the run sees its terminal
                          event. Run twice — once with KP_ONBOARD_STUDIO=0,
                          where `hello.studio` is absent and nothing else moves
page-driver:     18/18  — real server + real chromium: the hand-off block
                          renders once, points at
                          `http://localhost:<app>/setup/studio#wizard=<port>&t=…`
                          with NOTHING before the `#`, opens in a new tab, and
                          says this page keeps working. A decision and an answer
                          POSTed from outside the browser settle its cards. A
                          second tab renders the finished run from the replay
                          alone; a second `hello` on the same document renders
                          nothing twice
real-run:        one real `{run:"check"}` on this checkout, 157s: 0 cards,
                 12 auto-allowed notices, 0 repeat, 0 unrequested, 10 probes,
                 phases welcome -> checks -> capabilities -> voice -> done,
                 matrix printed. The declared probes ran VERBATIM through the
                 split engine — `python -c "import pipeline.jobfit.codegen"`
                 and `claude -p "say ok" --output-format json` both auto-allowed
npm run lint:    0 errors
```

One bug the drivers caught, worth keeping: replaying the `hello` groups one
after another (probes, then narration, then notices, then cards) runs the stream
out of order, because a `narration` block is emitted BETWEEN two `probe` markers
of the same assistant message. The seq guard then read the narration as already
seen and dropped it — a rejoin with no prose. Replaying the merged lists **in
`seq` order** is the fix, and it is the rule a second face has to follow too.
