---
subject: software-engineering/health-checks
project: kp
raised_by: intake intake-kube-0903 (peer comparison)
source: librarian/sources/2026-09-03-kube-rs.md
stage: deploy/helm/kp/values.yaml's two probe blocks, and the `no-probes` policy in scripts/deploy/check-chart.mjs that currently cannot tell what they point at
size: 3 files / ~60 lines / S
status: accepted
---

## Why the scope implies it

`scope.does` says *"self-hostable (Docker)"* and *"one organisation per install"* (`.ai\manifest.yaml`). One organisation means one pod: `deploy\helm\kp\templates\deployment.yaml:12-14` pins `replicas: 1` with `strategy: Recreate`, so there is never a second pod to absorb a bad rollout. Everything about kp's availability therefore rests on the platform knowing, accurately, whether that one pod can serve — which is exactly what a readiness probe is and exactly what this chart does not have.

**kp already wrote the right probe. The chart points somewhere else.**

`app\api\health\route.ts:12-15` opens with its own contract:

> Readiness probe: confirms the DB opens, seeds loaded cleanly, and reports the task queue depth. Returns 200 when healthy, 503 when degraded — so a deploy check / uptime monitor can gate on a real signal instead of just "the process is up".

It is a genuinely good probe by the subject's own standards. It opens the database and bails to 503 when it cannot (`:60-73`). It checks seed integrity (`:41-45`) and asserts the job catalogue is non-empty (`:48`). It reads the scheduler heartbeat and judges it **by age**, not by existence — *"a wedged automation clock now degrades the probe (503) instead of hiding behind a green dot — and the reason names it"* (`:50-59`), which is `health-checks:135-144`'s staleness rule reached independently. It names which sub-check failed rather than returning a number (`:81-83`), which is `:151-157`'s rollup-honesty rule. And it refuses to lie by omission: for an untrusted caller the detail is dropped rather than blanked, because *"an empty `degradedReasons` beside a 503 would be a confident lie about a probe that DID find reasons"* (`:88-90`). It is registered public so a prober with no session can reach it (`app\_lib\auth\public-routes.ts:81`).

The chart's probes are `deploy\helm\kp\values.yaml:84-97`: both `httpGet` on `path: /`, differing only in timing, chosen because *"any 2xx–3xx is healthy, so `/` works even with auth on (it 307s to /login)"* (`:83`). `/` is a server-rendered auth gate (`app\page.tsx`), which is a fine liveness signal and is not a readiness signal at all.

**And the gate cannot see the difference.** `scripts\deploy\check-chart.mjs:260-269` requires `livenessProbe` and `readinessProbe` to be both declared and applied — a strong rule, and the reason it gives is exactly right: *"Without a readiness probe, Recreate hands traffic to a pod that has not opened its database yet."* That is a promise about **what the probe observes**, and the check verifies only that a probe exists. Rule 11 is green today on a chart that breaks its own rationale.

`operations/service-operations/health-checks:81-85` names the failure mode precisely:

> Each proxy check passes exactly when the proxy diverges from the target — which is the only situation the check existed for. The honest probe performs a minimal real interaction.

`/` diverges from "this pod can serve" precisely during a cold start, a locked SQLite file, or a failed seed — the three situations `Recreate` makes dangerous.

**The trap on the way to the fix, which is why this is not a one-line change.** Pointing *both* probes at `/api/health` would be worse than the status quo. That endpoint 503s on a stalled scheduler clock (`:50-59`) and on an empty job catalogue (`:48`) — conditions where the correct remedy is to stop routing traffic and tell someone, never to restart the container. With `Recreate` and one replica, a liveness probe reading a dependency verdict converts a degraded scheduler into a crash loop, and the crash loop makes the scheduler no healthier.

**The corpus does not state the asymmetry, and that is worth recording rather than working around.** In `health-checks`, `readiness` and `liveness` appear exactly once, at `:27-28`, as two items in a flat list of check *domains*. There is no readiness-versus-liveness contract, no probe-asymmetry rule, and nothing about a dependency check inside a liveness probe. The nearest line in the whole subject is `techniques/probe-design.md:128-133`, *"Warm-up is declared, not discovered."* Two peers reached the rule independently:

- **gravitone**, in this fleet, writes it in the template: *"/health returns 503 until the model is loaded — exactly what readiness wants. Liveness stays TCP so a long model (re)load never gets the pod killed"* — readiness `failureThreshold: 30`, liveness a bare `tcpSocket` (`C:\Users\kazda\kiro\gravitone\deploy\helm\gravitone\templates\deployment.yaml:52-66`).
- **kube-rs** reaches the readiness half from the runtime side: work is gated on cache completeness, armed exactly once at the first `InitDone` and **never re-closed** by a later resync, because closing it would deadlock work already in flight (`C:/t/kube/kube-runtime/src/reflector/store.rs:33-34, 137-140, 196-215`).

## What the first context contains

**Two probe blocks that read different endpoints**, in `deploy\helm\kp\values.yaml:84-97`.

- `readinessProbe` → `/api/health`. It already returns the verdict this needs, publicly, with the sub-check named. `failureThreshold` sized to the slowest legitimate cold start rather than left at the default 3, which is gravitone's lesson.
- `livenessProbe` → a path that answers *is this process wedged* and nothing else. `/` is defensible (it is what the chart uses today and it observes no dependency); a `tcpSocket` on the container port is stronger and is what gravitone chose, because it cannot accidentally acquire a dependency later when somebody adds a check to a page.

Both stay values-driven, so an operator with a slow volume raises a threshold rather than editing a template.

**A `startupProbe`**, which is the piece that lets the two thresholds be independent: it suppresses liveness entirely until the pod passes once, so "a long first boot with seeding and migration" and "a wedged steady-state process" stop competing for one `initialDelaySeconds`. Without it, the liveness delay must be sized for the worst cold start, which is the same as having no liveness probe for the first half-minute of every pod's life.

**A third clause in `no-probes` (`scripts\deploy\check-chart.mjs:260-269`)** — the part that makes this un-regressable rather than fixed-once, and the reason this direction is worth more than the two values lines it changes. The rule keeps its declared-and-applied check and gains: the readiness probe's `path` must not equal the liveness probe's `path`. That is a weaker assertion than "readiness must hit `/api/health`" and deliberately so — a policy that names one route breaks the first time the route moves, while "these two probes answer different questions" is the actual rule and survives a rename. Its `why` line carries the reason in the file's existing register: *a readiness probe and a liveness probe that read one endpoint have one remedy for two failures, and `Recreate` has no second pod to absorb the wrong one.*

**A fixture** in `scripts\deploy\__tests__\check-chart.test.mjs` — a scratch chart with both probes on one path must fail — matching the existing pairing at `.github\workflows\ci.yml:139-141`.

**What it must NOT absorb.** Not `app\api\health\route.ts` itself: it is correct, it is well-argued, and the whole finding is that the chart ignores it. Not the payload-splitting decision at `:17-31` — the public-verdict / operator-detail split is right and a probe consuming only the status code is unaffected by it. Not `/api/ops`, which is the operator surface for the same numbers. Not pod identity, disruption budgets or the gate's file-globbing — those are `2026-09-03-deployment-contract.md` and `2026-09-03-deployment-contract-hardening.md`. Not a change to what makes `/api/health` 503; the empty-job-catalogue condition (`:48`) may or may not deserve to gate traffic, and that is a product question this proposal deliberately does not open.

## The measurable

**Requests routed to a pod that cannot serve them: currently every request during a cold start or a degraded database, target 0.**

Measured directly and cheaply, without a cluster. Start the container with `/data` unwritable, then probe both paths and compare: `/api/health` returns **503** with `db: "unavailable"` (`route.ts:60-73`); `/` returns 2xx–3xx. Today the pod is `Ready` on the second answer. After, it is `NotReady` on the first. The number is a two-column table and it takes one `docker run`.

**Second number, the one that says the fix did not overshoot: restarts caused by a degraded-but-recoverable dependency. Currently 0 (because nothing is checked), and it must stay 0.** This is the regression the `startupProbe` and the separate liveness path exist to prevent, and it is why the naive fix — point both probes at `/api/health` — is worse than doing nothing. Test: stall the scheduler heartbeat so `/api/health` 503s per `route.ts:50-59`, and assert the container is not restarted. If it is, the liveness probe acquired a dependency.

**Third, and the one that keeps it true: `no-probes` fixture count, 1 → 2.** A policy without a must-fail case is a policy that has stopped reading.

## What would make this wrong

**If `/api/health` is too expensive at probe cadence.** It runs `coreTableCounts()` — described in its own header as *"a deployment-wide `SELECT COUNT(*)` over jobs/profiles/pipeline\_entries/analyses/tasks"* — plus `countActiveTasks()` and a heartbeat read (`route.ts:46-56`). At `periodSeconds: 10` that is six full-table scans a minute forever, on the same SQLite file serving the app, growing with the install. If that cost is real on a large install, the correct shape is a cheaper readiness variant — the DB open and the seed check, without the counts — or a cached record per `health-checks/techniques/probe-caching.md`, whose TTL rule is written for exactly this. **Measure the endpoint's latency on a seeded database before wiring it**; this is the falsifier most likely to fire, and it changes the proposal from "two values lines" to "one new route".

**If the detail split makes the verdict wrong for an anonymous prober.** The kubelet probes with no session, so `isOperator()` is false (`route.ts:33`) and the response omits `tables`, `queue` and `degradedReasons` (`:88-90`). The **status code** is unaffected, which is all a probe reads — but that should be confirmed rather than assumed, because it is the single line this whole proposal rests on. One `curl` with no cookie against a degraded install settles it.

**If an empty job catalogue should not remove a pod from service.** `route.ts:48` adds a degraded reason when `tables.jobs === 0`, which 503s the endpoint. On a brand-new install that has not been seeded yet, wiring this to readiness means the pod never becomes `Ready` and the operator sees a hung deploy rather than an empty app they could go and fill. If that is the real first-run experience, the readiness probe needs a narrower verdict than `ok` — the `db` sub-check alone — and the proposal grows a route rather than reusing one. Check what a fresh install returns before wiring it.

**If nobody runs kp on Kubernetes.** `scope.does` says *"self-hostable (Docker)"*, and Docker is the named path; the chart is the additional one. If every real install is `docker run` or compose, then probes are the platform's concern in neither case and this direction is polish on a surface nobody uses — in which case the honest answer is the same one that applies to the whole cluster lane here: say so in `docs/architecture/self-hosting.md`, and stop adding policies to a gate whose artifact is decorative. Nothing else in this study is worth doing if that is the answer, so it is the first question to ask.
