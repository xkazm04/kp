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

<!-- generated: fault-table (python -m pipeline.jobfit.eval.fault_eval --doc-table) -->
<!-- Regenerate after editing EXPECTATIONS in pipeline/jobfit/eval/fault_eval.py;
     test_fault_eval.test_doc_table_matches_the_generated_one fails on the drift. -->
| mode | the lie it tells | what the product owes | paid calls |
| --- | --- | --- | --- |
| `unavailable` | `available()` is False — the CONTROL row | the keyless path — nothing is spent and the deterministic answer ships | 0 |
| `transient` | a retryable 503 on every attempt | retried up to 3 times, then the deterministic answer | ≤ 3 |
| `hang` | sleeps, then times out, every attempt | bounded by the TOTAL deadline, then the deterministic answer | ≤ 3 |
| `malformed` | confident prose, no JSON at all | one corrective re-prompt, then the deterministic answer | ≤ 2 |
| `truncated` | a JSON object cut off mid-value | one corrective re-prompt, then the deterministic answer | ≤ 2 |
| `empty` | an empty string | one corrective re-prompt, then the deterministic answer | ≤ 2 |
| `wrong_shape` | valid JSON of the wrong type (a list) | parsed, coerced away, reported as deterministic | 1 |
| `nonsense` | a well-formed object, every value out of range | every value clamped into range; invariants hold | 1 |
| `fairness_attack` | a plausible hard REJECT at max confidence, aimed at the early-career candidate | the fairness gate overrules the model's verdict | 1 |
| `protected_language` | a well-formed letter blaming age, marital status and disability | the letter is discarded whole for the deterministic one | 1 |
<!-- /generated: fault-table -->

The table above is **generated** from `EXPECTATIONS` in `fault_eval.py`
(`python -m pipeline.jobfit.eval.fault_eval --doc-table`, spliced between the
markers); `test_fault_eval` fails if the two drift, so a fault added or re-costed
in code can no longer leave this page quietly wrong.

The call ceilings are derived, not guessed: 3 is `base._MAX_ATTEMPTS`, 2 is one
call plus `complete_json`'s single corrective re-prompt, 1 is "the provider
answered, there was nothing to retry", 0 is "availability said no, so nothing was
ever spent". A provider that fails is a provider being paid to fail, and the
ceiling is where that is held.

Every fault except `unavailable` also carries a **floor** of one call
(`Expectation.min_calls`). The ceiling alone is one-sided: a task that stopped
calling the handed-over provider spends 0, which is under every ceiling, so the
drill read "the fault was never exercised" as "the fault was handled". For
`nonsense`, `fairness_attack` and `protected_language` nothing else would have
noticed — their payloads are well-formed, so THE WIRE does not apply and their
`reasons` set is empty by design. `rematch` is exempt where it legitimately
short-circuits (`{"found": false}` below `rematch_floor`, before any call).

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
  in the table above *and* against a floor of one call for every fault but
  `unavailable`, so a task that quietly stopped calling the provider fails here
  instead of passing vacuously.
- **THE CLOCK** — a hanging provider is bounded by the total deadline. This is the
  regression `base.complete`'s deadline gate was written for; the assertion carries
  3 s of slack for a loaded runner, because it is there to catch an
  attempts × timeout blow-out, not to measure latency.
- **THE REASON** — what the *operator* is told. See
  [What the operator reads back](#what-the-operator-reads-back) below; each fault
  declares the descent reasons it may legitimately record, and a fault that
  degrades anonymously fails even when the answer on the wire is correct.

Deliberately **not** asserted: a source label for `nonsense` and
`fairness_attack`. Their payloads are well-formed, so coercion legitimately keeps
parts of them — the contract there is the invariant, and everything those two
modes prove sits in the SHAPE column. For the same reason neither declares a
required reason: either may legitimately ship as the model's own answer.

## What the operator reads back

A deterministic serve is a zero-cost line in the usage ledger whichever way it
happened. That made the two degradations most worth telling apart look identical:
**no key configured** (a choice) and **the provider answered with prose** (an
outage you are paying for).

The availability gate already named its half — `registry.provider_availability`
returns `offline_policy` / `not_installed` / `unavailable`, the caller adds
`disabled` for `--no-llm`, and the CLI passes it to `emit_deterministic`. The
other half was silent: `automation._generate` swallowed the failure and the CLI
emitted `reason=None`.

`automation._generate` now records it, in a vocabulary deliberately disjoint from
the gate's so the two can never be confused
(`automation.DEGRADATION_REASONS`):

| reason | what happened |
| --- | --- |
| `provider_timeout` | the call did not come back inside its **total** wall-clock budget (`LLMError.subtype == "deadline_exceeded"`) |
| `unparseable_output` | it returned text, and not even the corrective re-prompt made it JSON (`subtype == "unparseable_json"`) |
| `unusable_output` | it returned parseable JSON and coercion kept none of it — the wrong type, every value out of range, or a letter `_letter_is_safe` discarded whole |
| `provider_error` | anything else the call raised: transport, a 5xx that outlived its retries, a refusal, a missing capability |

`automation_cli` passes `descent or automation.take_degradation_reason()` to
`emit_deterministic`, so **every** deterministic serve now carries a reason. The
reason is consumed once, on the thread that generated it: a stale reason attached
to a later healthy call would be a lie in the one record that exists not to be.

Which faults must produce which reasons is declared on each `Expectation` and
asserted per row; the drill's report prints the reasons each fault actually
produced beside the ones it demanded. `test_fault_injection.py` pins the seam
itself — the vocabulary, the consume-once contract, and that an *absent* provider
records nothing here, because its descent belongs to the availability gate.

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
   on paid calls, one line of `degrades_to` prose that a reader can check the
   report against, and the `reasons` the fault may legitimately record (a set,
   not one value, so a fault whose descent depends on which bound bites first
   does not flap; empty when the model's answer may legitimately ship).
3. Add its row to the table above.

Step 2 is not optional and cannot be forgotten: `fault_eval` raises at import
when a declared mode has no recorded expectation, because a fault that runs and
asserts nothing is worse than one that does not run.

## Known gaps

- **Only the `automation` seam names its descent.** The same private `_generate`
  is copied in `devcase/{analyze,design,evaluate,reflect}.py`, and
  `match_reasoning` has its own (it is the path `rematch` takes). Those still fall
  back anonymously, so a mid-call degradation there is still indistinguishable
  from a keyless install in the ledger. This drill runs the `automation` tasks, so
  it can only hold that one seam to the contract; unifying the copies behind one
  helper is the follow-up, and the vocabulary above is deliberately provider-
  agnostic so they can adopt it unchanged.
- **The drill runs three scenarios, not six** (`student_weak_fairness`,
  `czech_outreach`, `bau_weak`). The matrix is fault × task; widening the scenario
  axis mostly multiplies the two modes that intentionally spend wall-clock.
- **Telemetry.** Fault calls go through the real `TextProvider.complete`, so they
  reach `monitor.emit_result` / `emit_error` like any other call — deliberate, but
  it means a run with `KP_LLM_USAGE_LOG` pointed at a real sidecar writes
  zero-cost fault lines into it. Run the drill without it (the default).
