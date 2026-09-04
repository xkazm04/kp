# kp vs. `kube-rs/kube` — peer design comparison

- **Source**: `kube-rs/kube`, clone `C:/t/kube`, pinned `7a4641d4cc2f693b2dee97b9fc15fadb96d7f62e`
- **Design record**: `librarian/sources/2026-09-03-kube-rs.md` (intake run `intake-kube-0903`, §3 design entries A1–A4 / B1–B3 / C1–C2 / D1 / E1–E2, §10 peer check Study 3)
- **Dimension**: **(b) Kubernetes / cluster operations only.** kp is TypeScript and Python; there is no Rust-craft comparison to make.
- **Why this peer**: kube-rs is not a chart — it is the runtime that *reads* charts' output. Every assumption it makes about a well-formed workload (what a probe means, who owns a field, what a controller may reconcile, what admission may refuse) is a statement about the shape kp's chart produces. And its e2e fixture, `C:/t/kube/e2e/deployment.yaml`, is a complete least-privilege workload manifest written by people whose day job is the API that consumes it.
- **The asymmetry, stated up front**: `scripts\deploy\check-chart.mjs` is the best cluster artifact in the fleet, and this study expects the inverse list to be long. The productive question is not "what should kp copy" — it is **what kp's own gate does not yet cover**, which is the narrow thing the operator's reading admitted for this project.
- **Verdicts** come from the closed set `adopt` / `adapt` / `keep ours` / `different forces`. A `keep ours` carries its reason exactly as an `adopt` does.
- Nothing here is a task. This is input for the owner's direction pass; the three proposals it implies sit beside it in this directory.

**Verdict tally: 22 points in 20 verdicts** — the three hardening policies (§1.4–1.6) share one. **8 `adapt`, 8 `keep ours`, 2 `adopt`, 2 `different forces`.** `keep ours` and `adapt` lead in equal measure, which is the honest shape here: nothing in this gate is wrong, and most of what is missing is reach rather than judgment.

---

## Part 1 — the twelve policies, one at a time

The gate is `scripts\deploy\check-chart.mjs` (350 lines, dependency-free `node:*`, no helm binary and no cluster — `:34-36`), run at `.github\workflows\ci.yml:139` on every push and PR, with fixtures immediately after at `:141`. `POLICIES` holds twelve entries (`:155-278`); `checkEnvContract` is the thirteenth check and reports per key rather than per rule (`:285-307`).

### 1.1 · `replicas-not-pinned` (`:156-165`) — the discriminator with kube, and both are right

kp requires the literal `replicas: 1`, because *"SQLite is one writer on a ReadWriteOnce volume; a second pod corrupts the database."* The template obeys at `deploy\helm\kp\templates\deployment.yaml:12`, `values.yaml:12-16` says `replicaCount` *"exists only for visibility"*, and the gate's header explains why a generic linter cannot help: *"A future edit that helpfully wires `replicas: {{ .Values.replicaCount }}` back up would pass every generic policy in existence"* (`:19-20`).

kube assumes the exact opposite: several independent writers converge on one record and are made safe by per-field ownership and markers rather than by exclusion — the tree ships **zero** leader-election code, which the design record establishes by an uncapped grep and argues is load-bearing rather than an oversight.

**Verdict: `different forces`, and this is the sentence the forge wave needs.** kube's writers converge on a server that arbitrates every write and records who owns which field (`C:/t/kube/kube-core/src/params.rs:660-710`). kp's writers would converge on a file that arbitrates nothing. Where the store adjudicates, make concurrency safe; where it does not, prevent it — and prove the prevention, because a comment does not. `backend-platform/work-execution/concurrency-guards`' `leadership-is-the-lock:20-27` covers the third case, where the store *itself* refuses non-leader writes: *"the refusal is the fence"*. SQLite is none of the three; it is a file, and kp's answer — never create the second writer — is the correct fourth.

### 1.2 · `strategy-not-recreate` (`:166-174`) — the deploy-window half of the same invariant

*"RollingUpdate overlaps the old and new pod on one RWO volume."* Enforced at `deployment.yaml:13-14`.

**Verdict: `keep ours`.** Worth naming because it is the half most projects miss: pinning `replicas: 1` and leaving the default strategy still produces two pods, briefly, on every deploy. **tracklight has exactly that defect** — `C:\Users\kazda\kiro\tracklight\deploy\helm\lighttrack\templates\deployment.yaml:7-11` sets no `strategy` and templates the replica count. kp is the fleet's only project that closed both halves.

### 1.3 · `security-context-not-applied` (`:176-185`) — declared **and** applied, which is the gate's best idea

The check asserts the Deployment still references `.Values.podSecurityContext` and `.Values.securityContext`, because *"Values nothing mounts are decoration; the hardening rules below would then be checking a comment"* (`:177`). Stated in the header as the general rule (`:26-29`): *"The values file is read for what it declares, AND the Deployment for whether it still applies it."*

**Verdict: `keep ours`, and it generalises past this repository.** tracklight's chart is the live proof: `values.yaml:42` declares `resources: {}` and the template applies it under `{{- with .Values.resources }}`, so an empty map emits no `resources:` block at all while the values file *looks* configured. A declared-only check would call that hardened. This is the transferable half of kp's gate and the one worth writing into `deployment-contract`'s technique lane.

### 1.4–1.6 · `runs-as-root` (`:186-197`), `privilege-escalation-allowed` (`:198-205`), `capabilities-not-dropped` (`:206-213`)

Three rules over `values.yaml:72-81`: `runAsNonRoot: true`, `runAsUser: 10001`, `allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`. Each with its reason — *"The image writes only /data; nothing about kp needs uid 0"*, *"A Next server and a spawned Python process need no Linux capabilities at all."*

**Verdict: `adapt`.** The values are right and the checks are right. What they are is **the client-side copy of a rule the cluster can enforce server-side**: these four assertions are, near enough, the `restricted` Pod Security Standard, which a cluster applies at admission by one namespace label. kube's design record makes the point from the enforcement side — a validating gate is *"one non-bypassable chokepoint"* that *"must bind every writer, including ones that predate the policy, so it cannot live in the clients"* (`C:/t/kube/kube-core/src/admission.rs:37-57`, `:276-315`).

`engineering-process/standards-and-gates/quality-gates`' `gate-laddering` is the governing pattern: the same rule at successive gates of increasing authority, with `enforcement-binding` deciding which one binds. kp's CI copy is the fast rung and should stay — it fails in three seconds with a fix instruction, which no admission controller does. The missing rung is the binding one: the chart should carry the namespace label (or document it in `docs/architecture/self-hosting.md`) so an operator who edits the rendered YAML by hand, or applies it without the chart, is still refused. Today the four hardening rules bind **the repository** and bind nothing about the cluster.

The boundary to state while doing it — and the failure `gate-laddering` warns about — is that two *implementations* of one rule drift. kp's regexes and Kubernetes' admission plugin are different implementations, so if they ever disagree the CI copy must lose.

### 1.7 · `privileged-pod` (`:214-224`) — correct policy, incomplete reach

Four keys (`privileged`, `hostNetwork`, `hostPID`, `hostIPC`) checked across four joined files: `deployment`, `service`, `configmap`, `secret` (`:217-218`).

**Verdict: `adapt`.** The rule is right and the *reach* is not, because the file list is an enumeration rather than a glob. `CHART_FILES` names five files (`:53-59`) and `loadChart` exits 2 when one is missing (`:319-327`) — so a **deleted** template is caught loudly. An **added** one is invisible. `deploy\helm\kp\templates\` today also holds `ingress.yaml`, `pvc.yaml`, `_helpers.tpl` and `NOTES.txt`, none of which any policy reads; a new `templates/worker.yaml` with a second container, a `hostPath` volume or `hostNetwork: true` passes all twelve rules. This is the single largest hole in the gate and it is one `fs.readdirSync` away.

### 1.8 · `service-exposed-by-default` (`:225-235`)

*"A default install should not put itself on a node port or ask a cloud for a public load balancer."* Satisfied at `values.yaml:48`.

**Verdict: `keep ours`.** kube has no equivalent because it is a client, not a workload. Recorded because the rule's reasoning — the *default* is the security posture, since the default is what an evaluator runs — is the one most self-host charts get wrong, and it is a one-line technique for `deployment-contract`.

### 1.9 · `secret-literal-in-values` (`:236-250`) — the reason is better than the policy

Two empty-value assertions plus five credential-shape regexes (`:140-146`: OpenAI-style, GitHub, Google, webhook signing, Slack), because *"values.yaml is the file people paste into tickets, commit to their infra repo and share"* (`:238`).

**Verdict: `keep ours`.** The reason names a human behaviour rather than a threat model, which is why it will survive contact with the next person who wants to "just put the key in for testing". The chart's other half is as good and is not a policy at all: `templates\secret.yaml:12-13` uses Helm's `required()` so an install without an operator password **fails** rather than deploying an app that *"runs KP OPEN with no login"* — an install-time gate, which a `NOTES.txt` warning is not. tracklight has the opposite arrangement and it is instructive: its Secret takes the admin key with no `required()` and no `existingSecret` escape (`tracklight\deploy\helm\lighttrack\templates\secret.yaml:9`), and warns *after* the install (`NOTES.txt:11-17`).

One gap inside the good design: when `existingSecret` is set the whole template is skipped (`secret.yaml:1`), so `required()` never fires and nothing checks that the referenced Secret actually carries `KP_OPERATOR_PASSWORD` and `KP_SECRET`. The failure mode is the same open app, reached by the recommended path (`values.yaml:24-26`). A `lookup`-based pre-flight or a `NOTES.txt` line naming the required keys closes it.

### 1.10 · `no-memory-limit` (`:251-259`)

Checks both that `resources` declares a memory limit and that the Deployment applies `.Values.resources` — *"The Python pipeline spawns subprocesses per request; an unbounded pod takes the node with it."* Values at `values.yaml:63-68`.

**Verdict: `keep ours`.** Note the deliberate asymmetry: memory is limited, CPU is requested but not limited. That is correct (a CPU limit throttles rather than protects) and it is the kind of decision a generic linter reverses. The values file says it in one comment — *"the Python pipeline spawns subprocesses — cap memory"*.

### 1.11 · `no-probes` (`:260-269`) — the rule holds, the rationale does not

The policy requires `livenessProbe` and `readinessProbe` to be **both declared and applied** (`:263-267`), for a reason that is exactly right: *"Without a readiness probe, Recreate hands traffic to a pod that has not opened its database yet."*

The probes it enforces are `values.yaml:84-97` — both `httpGet` on `path: /`, differing only in timing, with the values file explaining the choice at `:83`: *"any 2xx–3xx is healthy, so `/` works even with auth on (it 307s to /login)."* The rule is satisfied because the probes are declared and applied. Nothing checks what they observe.

**And kp already built the probe the rationale describes — the chart just never wired it.** `app\api\health\route.ts:12-15`:

> Readiness probe: confirms the DB opens, seeds loaded cleanly, and reports the task queue depth. Returns 200 when healthy, 503 when degraded — so a deploy check / uptime monitor can gate on a real signal instead of just "the process is up".

It opens the database and bails to 503 on failure (`:60-73`), checks seed integrity (`:41-45`), asserts the job catalogue is non-empty (`:48`), and reads the scheduler heartbeat and judges it by age — *"a wedged automation clock now degrades the probe (503) instead of hiding behind a green dot — and the reason names it"* (`:50-59`). It is registered as public so an unauthenticated prober can reach it (`app\_lib\auth\public-routes.ts:81`), and it splits its payload so the *verdict* is public and the tenant detail is operator-gated (`:17-31`, `:87-91`). Every property `health-checks` asks of an honest probe is in that file: it observes the real dependency, it names which sub-check failed rather than returning a mood (`:81-83`), and it refuses to lie by omission — *"an empty `degradedReasons` beside a 503 would be a confident lie about a probe that DID find reasons"* (`:88-90`).

So the finding is not that kp lacks a readiness probe. It is that **the chart probes `/` while the purpose-built endpoint sits unused**, and that rule 11 (`:260-269`) cannot tell the difference, because it checks that a probe is declared and applied and never what it points at.

The second half compounds it. Wiring `/api/health` to **both** probes would be worse than the status quo, because that endpoint 503s on a stalled scheduler clock (`:50-59`) and on an empty job catalogue (`:48`) — conditions where the correct remedy is to stop routing traffic and page someone, never to restart the container. `Recreate` means a restart is a full outage with no second pod, so a liveness probe reading a dependency verdict converts a degraded scheduler into a crash loop.

**Verdict: `adapt`, and this is the strongest finding in the study.** The mechanism (declared **and** applied) is right and stays; what it needs is a third clause about *what* is being read. `operations/service-operations/health-checks:81-85` is direct about the underlying rule:

> Each proxy check passes exactly when the proxy diverges from the target — which is the only situation the check existed for. The honest probe performs a minimal real interaction.

Two independent sightings say the same thing. kube gates work on **cache completeness**, armed exactly once at the first `InitDone`, never re-closed by a later resync (`C:/t/kube/kube-runtime/src/reflector/store.rs:33-34, 137-140, 196-215`), because a reconciler over a half-filled cache concludes its children are missing and recreates them. And **gravitone**, in this fleet, splits the pair and writes the reason in the template — `C:\Users\kazda\kiro\gravitone\deploy\helm\gravitone\templates\deployment.yaml:52-66`: *"/health returns 503 until the model is loaded — exactly what readiness wants. Liveness stays TCP so a long model (re)load never gets the pod killed"*, readiness `failureThreshold: 30`, liveness a bare `tcpSocket`.

Worth stating precisely, because it changes who is at fault: **the corpus does not carry this rule.** `readiness` and `liveness` appear in `health-checks` once, at `:27-28`, as two items in a flat list of check *domains* — there is no readiness-versus-liveness contract, no probe-asymmetry rule, and nothing about a dependency check inside a liveness probe. The nearest line is `techniques/probe-design.md:128-133`, *"Warm-up is declared, not discovered."* kp wrote a textbook readiness endpoint against a subject that never told it the pair was asymmetric, and then wired neither probe to it. That is a gap in the corpus as much as in the chart, and it is the amendment this study most wants to land.

### 1.12 · `volume-access-mode-shared` (`:270-277`)

*"ReadWriteMany would let the cluster schedule the second writer this chart spends two rules preventing."* Satisfied at `values.yaml:43`.

**Verdict: `keep ours`.** Three rules (1.1, 1.2, 1.12) enforcing one invariant from three directions — replica count, deploy window, storage class — is what a real invariant looks like when it is actually defended. Most charts defend it once.

---

## Part 2 — the env contract

### 2.1 · `env-contract-drift` (`:285-307`) — a strong technique with two blind spots

Every env key the chart *sets* must be one `.env.example` documents, with a single justified exemption (`:135-137`: `NODE_ENV`, *"a Node runtime convention, not a kp setting"*), because *"a key that exists on only one side of it is an upgrade break that surfaces as a setting that quietly stopped applying"* (`:300-302`). The exemption map carries its own guard rail: *"a growing exemption list is how an env contract stops being a contract."*

**Verdict: `adapt`.** Two things it cannot see, both structural:

**It cannot see forwarded keys.** `envKeysIn` matches `/^\s*([A-Z][A-Z0-9_]*):/` (`:108-118`). `templates\configmap.yaml:17-19` and `templates\secret.yaml:14-16` emit `{{ $key }}: {{ $val | quote }}` inside a `range` over `.Values.extraEnv` and `.Values.providerKeys` — lines that start with `{{`, which the regex cannot match. So the contract covers the keys the chart **hard-codes** and not the keys it **forwards**, and `providerKeys` is precisely the block that carries credentials.

**It is one-directional.** It catches a key the chart sets that `.env.example` does not document. It does not catch a key the app *reads* that the chart never sets — the other half of the same upgrade break, and the one that produces a silently-defaulted setting rather than an undocumented one. This is notable because kp checks its *other* contracts in both directions on purpose: `.ai\manifest.yaml`'s `gates` block is *"Compared IN BOTH DIRECTIONS against the workflow, so this cannot decay into a copy nobody re-reads: a step added to ci.yml that is not here fails as `gate-unlisted`, an entry ci.yml no longer runs fails as `gate-stale`."* The env contract is the one place that discipline was applied once instead of twice.

---

## Part 3 — the uncovered remainder of the gate

Seven properties of a well-formed workload that kube's runtime assumes, that this chart does not have, and that none of the thirteen checks would notice.

### 3.1 · No ServiceAccount, and an API token mounted into a hiring app

No `ServiceAccount`, `Role`, `RoleBinding` or `automountServiceAccountToken` anywhere in `deploy\helm\kp\templates\`, and no policy mentions pod identity. The pod therefore runs with the namespace's `default` ServiceAccount and its token projected into the container — an API credential inside a Next server that spawns Python subprocesses and stores candidate PII.

kube's *test fixture* is the better example: `C:/t/kube/e2e/deployment.yaml` ships a Namespace + ServiceAccount + Role + RoleBinding with an explicit five-verb list, for a job whose entire purpose is to create one Job and delete it.

**Verdict: `adopt`, and it is the cheapest improvement available.** The correct Role for kp is **none** — it calls no Kubernetes API — so this is not an RBAC design exercise. It is a dedicated ServiceAccount with `automountServiceAccountToken: false`, plus a thirteenth policy asserting the Deployment references it. `security/authorization` is the governing subject and the design record's own summary of it applies unchanged: moving the decision *"from N places that could forget to one place that cannot be bypassed"*.

### 3.2 · No PodDisruptionBudget

Absent from the chart and from the policies. With `replicas: 1` and `strategy: Recreate`, a `kubectl drain` evicts the only pod and kp is down for a reschedule plus a PVC reattach, with nothing telling the operator that anything single-instance was involved.

**Verdict: `adopt`.** A `PodDisruptionBudget` with `minAvailable: 1` over a one-replica Deployment blocks voluntary disruption **entirely** — and that is the correct, deliberately loud behaviour for a database that cannot be moved without downtime. It is the missing platform-level expression of the invariant rules 1.1/1.2/1.12 already defend three ways inside the pod spec. **Same finding lands in tracklight's study**; recorded in both because the artifact is per-project.

### 3.3 · No NetworkPolicy

Absent. kp ships `KP_OFFLINE: "1"` as a *hard no-egress mode* (`values.yaml:36`, referencing `docs/architecture/self-hosting.md §7`) — an application-level control over the same property a NetworkPolicy enforces at the CNI.

**Verdict: `adapt`, conditionally.** A NetworkPolicy is only meaningful where the cluster's CNI enforces one, and a chart that ships an unenforced one has produced a false sense of a boundary — the exact decoration `check-chart.mjs:176-185` exists to prevent in the other direction. The honest shape is `networkPolicy.enabled: false` with the condition stated, plus a `NOTES.txt` line, and — if `KP_OFFLINE` is the real product feature — a note that the two are different rungs of one rule, which is `gate-laddering` again.

### 3.4 · The image is pinned to a mutable tag, and everything else about the release is coherent

kp already checks more of this than almost any project would. `release:check` compares `package.json` ↔ `Chart.yaml` `appVersion` ↔ a CHANGELOG section on **every push**, not only on a tag (`.github\workflows\ci.yml:143-148`, implemented at `scripts\release\prepare.mjs:122-126`), with the reason: *"The chart's appVersion IS the image tag an operator gets by default — they must match."*

The remaining gap is that a tag is a name, not a build. `values.yaml:8` defaults `tag: ""` → `Chart.AppVersion`; two pushes of `kp:0.1.0` are two different images with one identity, and `pullPolicy: IfNotPresent` (`:9`) means a node that already has one never learns about the other.

**Verdict: `adapt`.** `engineering-process/continuous-integration/deployment-contract:26-29` is the standard the version check is already reaching for:

> A deployment is a claim that a **specific, verified build** reached a **named environment** through a **declared path**.

A tag satisfies "named environment" and "declared path"; only a digest satisfies "specific, verified build". The subject's `environment-promotion` technique states the corollary — production is reached by promoting a build that already exists, never by rebuilding. The narrow, honest change is to permit a digest (`image.digest`, preferred over `tag` when set) rather than to require one, since a self-host operator building their own image from `docs/architecture/self-hosting.md §9` has no registry digest to hand.

### 3.5 · The gate reads five files by name

Covered at 1.7 as the reason `privileged-pod` under-reaches, and repeated here because it is a property of the gate rather than of one rule: `CHART_FILES` (`:53-59`) is an enumeration. Every policy is blind to `ingress.yaml`, `pvc.yaml`, `_helpers.tpl`, `Chart.yaml`, `NOTES.txt`, and to anything added later.

**Verdict: `adapt`.** Glob `templates/*.yaml`, keep the five named files for the policies that need a specific one, and add a rule that a template the gate has never seen is itself a finding — the same instinct as `gates_doc`'s two-directional comparison in `.ai\manifest.yaml`.

### 3.6 · No `checksum/config` over the Secret

`deployment.yaml:22-24` rolls the pod when the ConfigMap changes — *"Roll the pod when the (non-secret) config changes"* — which is correct and is more than most charts do. The Secret is not in the checksum, so a `helm upgrade` that rotates `KP_SECRET` or a provider key updates the Secret and leaves the running pod holding the old value, because `envFrom.secretRef` (`:48-49`) is read once at container start.

**Verdict: `adapt`.** One line, and the failure it prevents is the worst kind: a rotated credential that appears to have been rotated. **tracklight has the same gap and no checksum at all**; this is a shared fleet finding.

### 3.7 · Ownership and field managers — what kube assumes and kp does not need

kube's recommended write carries a **required** `field_manager`; the server records which manager owns which field path and rejects a write that would take another's unless `force: true`, with the illegal combination refused client-side before a request is sent (`C:/t/kube/kube-core/src/params.rs:660-710`).

kp's chart has exactly one writer: Helm. Nothing else reconciles these objects.

**Verdict: `different forces`, with one thing worth naming.** Per-field ownership answers *"several independent controllers, plus humans, plus a deployment tool, all write the same record"*; kp has one of those three. But the chart does carry the fleet's nearest thing to a deletion-blocking marker, and it is a good one: `templates\pvc.yaml:8-10` annotates the PVC `helm.sh/resource-policy: keep` so an uninstall does not take the data — *"candidate PII lives here"*. That is the same instinct as kube's finalizer (*a marker on the record that says do not vanish yet*, `C:/t/kube/kube-runtime/src/finalizer.rs:75-120`) with the platform doing the enforcing. Three control-plane subjects — `declarative-resource-lifecycle`, `convergence-loop-and-requeue`, `watch-cache-and-resync` — are **being forged right now**: the `control-plane-operations` subcategory is declared at `knowledge/software-engineering/taxonomy.json:251-259` and no directory has been derived yet, so they are named here rather than cited. When the first lands, `resource-policy: keep` is kp's instance of its first technique.

---

## Part 4 — the operator question

### 4.1 · What an operator would reconcile for a self-hosted hiring app

kube exists to build controllers, so the fair question to ask of kp is: if someone wrote one for this chart, what would it converge?

Almost nothing — and that is the finding, not a deficiency. Every property this chart cares about is either a constant (`replicas: 1`, `Recreate`, RWO), enforced at admission (the security context), or already the platform's job (restart on crash, reschedule on node loss). The one genuine convergence loop is **backup**: candidate PII in one SQLite file on one volume, with `helm.sh/resource-policy: keep` protecting it from an uninstall and nothing protecting it from the volume. A CronJob that snapshots `/data` needs no controller. A controller would earn its place only at the point where kp gains multiple installs — which `scope.does` explicitly excludes (*"one organisation per install"*).

**Verdict: `keep ours`.** Recorded so a future reader does not mistake "kp ships no operator" for a gap. The absence is what `scope.does_not` implies, and inventing a reconciler here would be building the thing kube's own design record says to build only where independent writers exist.

### 4.2 · The single-instance invariant across the fleet, and the one line that matters

Three projects met the same constraint from three substrates, and each defended it differently:

- **kp**: a CI policy with a named rule, a reason, and a fixture (`check-chart.mjs:156-165`, `.github\workflows\ci.yml:139-141`).
- **politicas**: a comment. `C:\Users\kazda\kiro\politicas\fly.toml:4-7` — *"PGlite is single-connection per data dir (lib/db/config.ts): a second machine mounting the same store corrupts or blocks. Never scale count above 1."*
- **tracklight**: prose in `NOTES.txt:19-23`, and a template that does the opposite (`deploy\helm\lighttrack\templates\deployment.yaml:8` templates the replica count over a RWO SQLite volume).

**Verdict: `keep ours`.** One of the three made the invariant un-regressable. This convergence is the argument for the `deployment-contract` technique the design record wants — *gate the deployment artifact with a check that needs no platform* — and kp is where it should be written from, because kp is where it works.

---

## Tests to initiate

Paired, with the instrument named and the number that would move.

1. **The `_helpers.tpl` refactor.** On a scratch branch, move `securityContext` out of `deployment.yaml:39-40` into a named template in `_helpers.tpl` and include it. *Instrument*: `npm run deploy:check` findings. *Predicted*: rule 3 (`security-context-not-applied`) fires even though the pod is still hardened — a false positive. Then **delete** the include and confirm it still fires. If both cases produce the same verdict, the gate is measuring file text rather than deployed shape, and the honest answer is `helm template` in CI after all. This is the falsifier for the whole regex approach and it costs ten minutes.

2. **The unseen template.** Add `deploy/helm/kp/templates/worker.yaml` containing a Deployment with `hostNetwork: true` and a root container. *Instrument*: findings count. *Predicted*: **0** — every policy passes, because `CHART_FILES` (`:53-59`) never reads it. *Target after the fix*: at least the `privileged-pod` rule fires, plus a new "unknown template" finding.

3. **The readiness lie, and the endpoint that already knows.** Start the container with `/data` unwritable (or the SQLite file held by another process) and probe **both** paths: `/`, which the chart uses (`values.yaml:84-97`), and `/api/health`, which it does not. *Instrument*: the two HTTP statuses side by side, and whether the pod reaches `Ready`. *Predicted*: `/api/health` returns **503** with `db: "unavailable"` (`app\api\health\route.ts:60-73`) while `/` returns 2xx–3xx and the pod goes `Ready` — the same pod, two answers, and the chart reads the wrong one. *Target*: `NotReady`, no traffic. This is the cheapest test here and it converts 1.11 from a reading into a two-column table.

4. **The liveness trap, run before the fix rather than after.** Stall the scheduler heartbeat (stop the clock, or age `scheduler_heartbeat.last_tick_at` past the window) and probe `/api/health`. *Instrument*: HTTP status. *Predicted*: 503, per `app\api\health\route.ts:50-59`. *The point*: this is the state that must **not** restart the container. Run it first, so that whatever gets wired to `livenessProbe` is chosen knowing this endpoint 503s on conditions a restart cannot fix.

5. **The forwarded key.** Set `extraEnv: { KP_MADE_UP_KEY: "x" }` and run `npm run deploy:check`. *Instrument*: `env-contract-drift` findings. *Predicted*: **0**, because the templated `{{ $key }}` line is invisible to `envKeysIn` (`:108-118`). *Target*: one finding, or a documented reason why forwarded keys are outside the contract.

---

## Features, ranked, with why the scope admits each

`scope.does` says *"self-hostable (Docker), multi-locale, one organisation per install"*; `scope.does_not` bars agent fleets, other domains, and an observability product (`.ai\manifest.yaml`). The operator's reading of the fleet named kp **admitted, narrowly** — and was specific about the narrowness: *"the unbuilt part is not a capability but the uncovered remainder of its own gate."* Every item below is inside that sentence. kp does not need a Kubernetes *capability*; it needs its existing gate to reach the parts of the workload it does not yet read.

1. **Pod identity, and a gate that reads the whole chart** (§3.1, §3.5, §1.7). *Why the scope admits it*: *"self-hostable"* means a stranger installs this into their own cluster, and the two defects compound — an unnecessary API token in the pod, and a gate structurally unable to notice a template that adds another. Proposal `2026-09-03-deployment-contract.md`.
2. **Wire the readiness probe kp already wrote** (§1.11), and split it from liveness so it is safe to. *Why*: rule 11's stated reason — *"Recreate hands traffic to a pod that has not opened its database yet"* — is a promise the chart does not keep, and `Recreate` means there is no second pod to absorb the gap. The endpoint that keeps it exists, is public, and is unused by the chart (`app\api\health\route.ts:12-15`, `app\_lib\auth\public-routes.ts:81`). This is two values lines and a policy clause, not a feature. Proposal `2026-09-03-health-checks.md`.
3. **Disruption budget and a rotatable secret** (§3.2, §3.6), the two platform-level expressions of invariants the chart already defends inside the pod spec. *Why*: candidate PII on one volume behind one pod, and a `KP_SECRET` that encrypts stored provider keys and cannot currently be rotated without a manual restart. Proposal `2026-09-03-deployment-contract-hardening.md`.

Not proposed, recorded so the next sweep need not re-derive them: **§1.4–1.6's admission rung** is a `docs/architecture/self-hosting.md` paragraph plus one optional namespace label, and it should wait until somebody has run kp on a cluster with Pod Security enforcement — proposing it now would be guessing at the operator's platform. **§3.3 (NetworkPolicy)** is conditional on the CNI and would ship an unenforced object on most clusters. **§3.4 (image digest)** is real but is a *permit*, not a *require*, and belongs to whichever release change touches `prepare.mjs` next. **§4.1 (an operator)** is excluded by `scope.does`'s one-organisation-per-install clause.

---

## The inverse list — what kp does better

Expected to lead, and it does. Seven, each with the anchor a reader can open.

1. **A deployment gate that needs no platform.** `scripts\deploy\check-chart.mjs` — 350 lines of `node:*`, twelve policies plus an env contract, on every push, *"no helm binary, no `npm ci`, no cluster"* (`:34-36`). kube has no chart and nothing of this shape; the registry has no technique for it. This is the single best artifact either tree has on this dimension.
2. **The forces stated better than most golden paths state theirs.** `check-chart.mjs:4-10` — the chart was correct *"BY REVIEW"*, and *"`helm template` renders a privileged pod as happily as an unprivileged one, `helm lint` has no opinion about replica counts, and none of the seven CI workflows had ever read `deploy/`."* Quote it into the technique verbatim.
3. **Declared AND applied.** `:26-29` and rule 3 (`:176-185`). The rule that catches the failure a values-only checker calls a pass, and tracklight's `resources: {}` is the live proof it catches something real.
4. **Amendment discipline written into the gate.** `:38-40` — *"CHANGING A POLICY is a deliberate edit to POLICIES below with the reason, which a reviewer can read and disagree with. Loosening a value in values.yaml until the check goes quiet is the failure mode this file exists to prevent."* kube's nearest equivalent is `deny(clippy::pedantic)` with each `allow` justified inline (`C:/t/kube/kube-runtime/src/lib.rs:11-22`); kp states the anti-pattern explicitly and kube does not.
5. **A policy list with fixtures.** `npm run test:deploy` runs immediately after the gate (`.github\workflows\ci.yml:139-141`). A gate whose findings go to zero because its regexes stopped matching is the failure this pairing exists to catch, and almost nobody pairs them.
6. **The env contract as a shipped-with-artifact rule.** `:285-307` — every key the chart sets is one `.env.example` documents, with exactly one exemption carrying its justification and a comment on why the list must stay tiny (`:130-137`).
7. **An install-time credential gate, not a post-install warning.** `templates\secret.yaml:10-13` uses `required()` so an install without an operator password fails with a message naming the consequence — *"an empty operator password runs KP OPEN with no login"*. tracklight prints a warning after the install instead (`tracklight\deploy\helm\lighttrack\templates\NOTES.txt:11-17`); the two are not the same gate.

And one for the fleet: **gravitone's chart is the best in the fleet on reasoning** — asymmetric probes with the reason in the file, a three-way autoscaling switch that stops emitting `replicas:` when an autoscaler owns the field (`C:\Users\kazda\kiro\gravitone\deploy\helm\gravitone\templates\deployment.yaml:8-10`), and `terminationGracePeriodSeconds: 45` chosen to exceed the app's own drain (`:76-78`) — while **kp's is the best on enforcement.** Neither project has read the other's.
