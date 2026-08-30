# Fault injection — what happens when a provider answers, badly

The best-tested failure in this repository is a provider that is **absent**: no
key, no CLI, `available()` False, deterministic fallback. It is gated on every
push (`automation_eval --no-llm --strict`), it is a stated product property
(ADR 0004), and it is the easy case — the call site knows before it spends
anything.

This page is about the other failure: a provider that **responds**. Slowly. With
prose where JSON was promised. With a truncated object. With values outside every
range the prompt named. With a fluent rejection letter that explains itself by
naming the candidate's age.

Absence is a dependency that disappears; this is a dependency that lies. The two
degrade through completely different code, and only one of them used to be
exercised.

## Run it

```bash
npm run test:eval:fault                                   # the gate, --strict
python -m pipeline.jobfit.eval.fault_eval --mode hang     # one fault
python -m pipeline.jobfit.eval.fault_eval --json          # every row
python -m pipeline.jobfit.eval.fault_eval --no-color      # for a log
```

Keyless, in-process, no network, seconds to run: the faults are constructed
locally, so a red run is a regression in this code and never a provider having a
bad day.

## The two pieces

| File | What it is |
| --- | --- |
| [`pipeline/jobfit/llm/fault.py`](../../pipeline/jobfit/llm/fault.py) | `FaultProvider` — a real `TextProvider` subclass that fails in one declared way |
| [`pipeline/jobfit/eval/fault_eval.py`](../../pipeline/jobfit/eval/fault_eval.py) | the drill: every fault × every automation task × three scenarios, with a recorded expectation per fault |
| [`pipeline/jobfit/tests/test_fault_injection.py`](../../pipeline/jobfit/tests/test_fault_injection.py) | unit-level pins for the seam itself (call bounds, the protected-language guard) |

`FaultProvider` is handed to the **real** call sites — `automation.screen_candidate`,
`draft_rejection`, the letter drafters — through the same
`provider_availability()` contract `automation_cli.py` uses. So what the drill
records is the shipped behaviour: the real retry policy, the real total-deadline
gate, the real single corrective re-prompt in `complete_json`, the real coercers.

It is **deliberately not routable**. `FaultProvider` appears in neither
`adapters.ADAPTERS` nor `capabilities.PROVIDER_CAPABILITIES`, so
`resolve_provider` can never hand it out and `provider: "fault"` is not a valid
`KP_LLM_CONFIG` entry. A fault is something a harness constructs on purpose.

## The faults, and what each one degrades to

| mode | the lie it tells | what the product owes | paid calls |
| --- | --- | --- | --- |
| `unavailable` | `available()` is False — the CONTROL row | the keyless path; nothing is spent | 0 |
| `transient` | a retryable 503 on every attempt | bounded retry, then the deterministic answer | ≤ 3 |
| `hang` | sleeps, then times out, every attempt | bounded by the TOTAL deadline, not attempts × timeout | ≤ 3 |
| `malformed` | confident prose, no JSON at all | one corrective re-prompt, then deterministic | ≤ 2 |
| `truncated` | a JSON object cut off mid-value | one corrective re-prompt, then deterministic | ≤ 2 |
| `empty` | an empty string | one corrective re-prompt, then deterministic | ≤ 2 |
| `wrong_shape` | valid JSON of the wrong type (a list) | parsed, coerced away, reported as deterministic | 1 |
| `nonsense` | a well-formed object, every value out of range | every value clamped into range; invariants hold | 1 |
| `fairness_attack` | a plausible hard REJECT at max confidence, aimed at the early-career candidate | the fairness gate overrules the model's verdict | 1 |
| `protected_language` | a well-formed letter blaming age, marital status and disability | the letter is discarded whole for the deterministic one | 1 |

The call ceilings are derived, not guessed: 3 is `base._MAX_ATTEMPTS`, 2 is one
call plus `complete_json`'s single corrective re-prompt, 1 is "the provider
answered, there was nothing to retry", 0 is "availability said no, so nothing was
ever spent". A provider that fails is a provider being paid to fail, and the
ceiling is where that is held.

## What is asserted, per fault × task × scenario

- **SHAPE** — the task's own reliability check passes: the identical function
  `automation_eval` gates the keyless path with, fairness invariants included (no
  early-career auto-reject, no protected-characteristic language in a rejection,
  no re-match below floor). *A lying provider must not be able to break an
  invariant that an absent provider cannot break.*
- **THE WIRE** — for a fault that produces nothing usable, the answer is the
  deterministic one **and says so** (`source == "deterministic"`). Truthful source
  labelling is what makes every other eval readable, so output that silently poses
  as model output fails even when its content is fine.
- **THE BOUND** — the paid-completion count for one task run, against the ceiling
  in the table above.
- **THE CLOCK** — a hanging provider is bounded by the total deadline. This is the
  regression `base.complete`'s deadline gate was written for; the assertion carries
  3 s of slack for a loaded runner, because it is there to catch an
  attempts × timeout blow-out, not to measure latency.

Deliberately **not** asserted: a source label for `nonsense` and
`fairness_attack`. Their payloads are well-formed, so coercion legitimately keeps
parts of them — the contract there is the invariant, and everything those two
modes prove sits in the SHAPE column.

### The threshold is not a quality bar

`FAULT_THRESHOLD` is `1.0` and
[`thresholds.py`](../../pipeline/jobfit/eval/thresholds.py) raises at import if
anyone lowers it: a degradation contract either holds or it does not. This is the
one eval in the tree with no acceptable-margin discussion, which is also why an
empty `--mode` filter is a failure rather than a vacuous pass.

## Where it runs

`ci.yml` → **Python gated suite** → `npm run test:eval:ci`, which is
`matching_eval` + `automation_eval --no-llm` + `fault_eval`, all `--strict`. A
failed expectation exits non-zero and fails the job. The unit pins in
`test_fault_injection.py` ride the same job through `npm run test:python:gate`.

## Adding a fault

1. Add the mode to `MODES` in `llm/fault.py` (and to `NO_PAYLOAD_MODES` if it
   cannot produce a usable payload), with the payload it returns.
2. Add an `Expectation` to `EXPECTATIONS` in `eval/fault_eval.py` — the ceiling
   on paid calls, and one line of `degrades_to` prose that a reader can check the
   report against.
3. Add its row to the table above.

Step 2 is not optional and cannot be forgotten: `fault_eval` raises at import
when a declared mode has no recorded expectation, because a fault that runs and
asserts nothing is worse than one that does not run.

## Known gaps

- **A mid-call degradation leaves no ledger reason.** When availability fails, the
  CLIs call `emit_deterministic` and the operator can read *why* the answer was
  deterministic. When a provider answers unusably, `automation._generate` swallows
  the exception without one — so the operator sees a deterministic answer and
  cannot tell "no key configured" from "the provider lied". Closing it means
  threading a use case into `_generate`. It is worth doing and is not done.
- **The drill runs three scenarios, not six** (`student_weak_fairness`,
  `czech_outreach`, `bau_weak`). The matrix is fault × task; widening the scenario
  axis mostly multiplies the two modes that intentionally spend wall-clock.
- **Telemetry.** Fault calls go through the real `TextProvider.complete`, so they
  reach `monitor.emit_result` / `emit_error` like any other call — deliberate, but
  it means a run with `KP_LLM_USAGE_LOG` pointed at a real sidecar writes
  zero-cost fault lines into it. Run the drill without it (the default).
