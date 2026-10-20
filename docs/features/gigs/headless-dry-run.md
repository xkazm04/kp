# Running a gig dry run headless

This is the operator-free path through the [Gigs pipeline](./README.md): drive it end
to end over kp's HTTP routes, substituting the UI clicks, up to a **drafted deliverable
on the review desk** — and stop there. It exists to prove that the pipeline lands work
for review without anyone clicking. It is a *dry run*, not a send.

Orchestrator: [`scripts/gigs/dry-run.mjs`](../../../scripts/gigs/dry-run.mjs)
(`npm run gigs:dry-run`). Node builtins only; no dependencies.

## The human-send gate stays

The orchestrator has **no path** to the attempt `mark_sent` action. It never calls the
review door (`POST /api/gigs/attempts/[id]`), never approves, never submits, bids or
posts anything. Its final act is to print the drafted deliverable and stop with:

> Drafted and on the review desk. Nothing was sent. Review/approve in the Gigs tab; the
> operator is the only actor that submits.

Sending stays a deliberate human act in the Gigs tab, under the operator's own account
(the whole [README](./README.md) rests on this). The `dry-run.test.mjs` fixtures assert
the gate structurally: across a full happy-path run, no request the orchestrator makes is
the review door, and no request body carries `mark_sent` or `approve`.

## The one irreducible manual step: start Personas

The specialist agents run in **Personas**, and Personas' management API — pairing,
project creation, hire, execute, the execution reads the sync polls — exists **only while
the Tauri desktop app is running**. The `personas-daemon` does *not* serve it. There is no
way to make that headless from kp's side, so starting the desktop app is the one step a
human (or a supervisor process) must take.

The orchestrator therefore **detects** rather than assumes. Its preflight reads
`GET /api/agents/bridge`; if kp is not paired with Personas it prints the exact start
command and exits `3` instead of hanging or launching anything silently:

```
set PERSONAS_HEADLESS_BRIDGE=1 && <path to>\personas-desktop.exe
```

(from the personas repo root, on Windows). The dev alternative is `npm run tauri dev`.

### The `PERSONAS_HEADLESS_BRIDGE` security note

`PERSONAS_HEADLESS_BRIDGE=1` makes pairing **auto-approve**: any local origin can mint a
real bridge key with no human approval in the Personas UI. That is what lets the
orchestrator pair without a click — and it is a real weakening of the pairing trust
boundary. Omit the env var and Personas requires a human to approve the pairing request
in its UI (which the orchestrator will wait for, polling `claim`).

The `--start-personas` flag lets the orchestrator spawn the desktop app itself, but only
when explicitly passed, and it prints this one-line note **before** spawning:

> SECURITY: spawning Personas with `PERSONAS_HEADLESS_BRIDGE=1` lets ANY local origin mint
> a real bridge key without human approval.

`--start-personas` needs `PERSONAS_DESKTOP_EXE` set to the desktop app's path (kp does not
know where Personas is installed), and it only sets `PERSONAS_HEADLESS_BRIDGE=1` on the
spawned process when the caller already set it in the environment — opting into the
weakened pairing is explicit, never the default.

## The sequence the orchestrator runs

All HTTP is against `KP_BASE_URL` (or `--kp`), default `http://localhost:3000`.

1. **Preflight** — `GET /api/agents/bridge`. Prints the bridge base URL and `paired`.
   Unpaired and no `--start-personas` → print the start command, exit `3`.
2. **Pair** (only when unpaired and `--start-personas`) — `POST /api/agents/pair`
   `{phase:"start"}` for a nonce, then polls `{phase:"claim", nonce}` every 2 s until it
   pairs or the timeout runs out. If it never pairs: *"Personas did not auto-approve —
   start it with `PERSONAS_HEADLESS_BRIDGE=1` or approve the pairing in its UI"*, exit `3`.
3. **Prepare the workspace** — `POST /api/gigs/[id]/workspace`. Prints the gig's folder
   and whether the Personas project linked (`personas.linked`), with the reason when not
   (the folder is made either way; see [Workspaces and projects](./README.md#workspaces-and-projects)).
4. **Hire the specialist** — `POST /api/gigs/specialists {arena, niche}` (defaults arena
   `oss_bounty`, niche `frontend / CSS`), then polls `GET /api/gigs/specialists` until the
   matching specialist's hired agent has a Personas persona id and a non-terminal status.
   Reports `reused` vs a new hire.
5. **Dispatch** — `POST /api/gigs/[id]/dispatch`. Prints the attempt id and execution id.
6. **Pull the deliverable** — loops `POST /api/gigs/sync` then `GET /api/gigs/[id]` every
   ~3 s until the dispatched attempt is `drafted` (a deliverable is present) or terminal
   `failed`, or the timeout runs out. `POST /api/gigs/sync` is the on-demand analogue of
   the clock's `gig_sync` job: it pulls each in-flight attempt's execution from Personas
   and lands what finished, so the run does not wait the ~15-minute scheduler.
7. **Stop** — prints the deliverable (or the failure) and the stop line. Nothing is sent.

### Flags

| Flag | Effect |
| --- | --- |
| `--gig <id>` | the gig to run (default `gig-mug1865t-veryo9`, the print-stylesheet bounty) |
| `--kp <url>` | the kp base URL (default `http://localhost:3000`, or `KP_BASE_URL`) |
| `--arena <a>` | specialist arena to hire (default `oss_bounty`) |
| `--niche <n>` | specialist niche to hire (default `frontend / CSS`) |
| `--start-personas` | spawn the Personas desktop app when unpaired (prints the security note first; needs `PERSONAS_DESKTOP_EXE`) |
| `--pair-only` | stop after preflight + pairing (steps 1–2) |
| `--prepare-only` | stop after preparing the workspace (steps 1–3) |
| `--no-dispatch` | stop after the specialist is ready (steps 1–4) |
| `--timeout-s <n>` | seconds to wait for pairing / a specialist / a draft (default `300`) |
| `--help`, `-h` | usage |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | success — a deliverable was drafted, or a `--*-only` scope completed |
| `1` | an operational failure — kp unreachable, a refused/failed dispatch, a timeout, a failed run |
| `2` | a usage error (bad flags) |
| `3` | Personas is unreachable/unpaired and could not be paired |

### Auth

In open dev mode (`KP_OPERATOR_PASSWORD` unset) the routes are open, so the orchestrator
works locally with no cookie. On a password-gated deploy, set `KP_SESSION_COOKIE` to a
valid session cookie; it rides every request as the `Cookie` header.

## How to read the printed deliverable

The end of a successful run prints a compact view of the drafted attempt
([`GigDeliverable`](../../../app/_lib/gigs/types.ts)):

- **summary** — one line of what the specialist did.
- **artifacts** — the concrete outputs (`pr`, `file`, `submission`, `report`, `text`),
  each with its reference.
- **evidence** — what the specialist actually ran. Each line is marked `PASS`, `FAIL`, or
  `UNVERIFIED`. `UNVERIFIED` is the honest rendering of `passed: null` ("ran, no pass/fail
  meaning") — it is **never** shown as a failure. Do not read a missing pass mark as a
  red result.
- **disclosure** — the AI-use disclosure sentence that would go out with the work. The
  review desk requires this to be ticked before `mark_sent`; the dry run stops well short
  of that.
- **confidence** — the specialist's own `0..1` figure. It is displayed, never used as a
  score.
- **gig folder** — the gig's own folder on disk, where its files live.

On a failed run the orchestrator prints `Run FAILED` with the attempt's `fallbackReason`
(e.g. `no_deliverable_block`, `personas_incomplete`, `personas_scope_missing`,
`dispatch_interrupted`) and exits `1`. The reason vocabulary is the sync step's, documented
in [`sync.ts`](../../../app/_lib/gigs/sync.ts).

## Keyless behaviour

The orchestrator itself needs no API keys. Whether the *run* produces real work depends on
the specialist's Personas persona and its model. With no Personas pairing the orchestrator
stops at preflight (exit `3`) with the start command; with a paired-but-down Personas the
prepare step reports `personas.linked: false` with a reason, dispatch is refused, and a
sync pass moves nothing (`{ synced: 0 }`) — the degrade-never-crash posture the rest of
the pipeline keeps.
