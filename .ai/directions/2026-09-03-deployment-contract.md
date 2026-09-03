---
subject: software-engineering/deployment-contract
project: kp
raised_by: intake intake-kube-0903 (peer comparison)
source: librarian/sources/2026-09-03-kube-rs.md
stage: scripts/deploy/check-chart.mjs — the node-quality job in .github/workflows/ci.yml, where the gate already runs on every push
size: 3 files / ~120 lines / S
status: accepted
---

## Why the scope implies it

`scope.does` says *"self-hostable (Docker)"* and *"one organisation per install"* (`.ai\manifest.yaml`). A stranger installs this into their own cluster, with their own candidate PII in it, and the only thing standing between them and a badly-shaped workload is `scripts\deploy\check-chart.mjs`. That file is the best artifact of its kind in the fleet and it is already right about the twelve things it checks. This direction is about the parts of the chart it structurally cannot see.

**Two defects, one root cause.**

**One — the gate reads five files by name.** `CHART_FILES` (`check-chart.mjs:53-59`) enumerates `values`, `deployment`, `service`, `configmap`, `secret`. `loadChart` exits 2 when one is missing (`:319-327`), so a **deleted** template is caught loudly. An **added** one is invisible. `deploy\helm\kp\templates\` already holds four files no policy reads (`ingress.yaml`, `pvc.yaml`, `_helpers.tpl`, `NOTES.txt`), and the rule most affected says so structurally: `privileged-pod` (`:214-224`) joins exactly four file bodies and greps them for `privileged`, `hostNetwork`, `hostPID`, `hostIPC`. A new `templates/worker.yaml` carrying a root container on the host network passes all twelve policies and the env contract, silently.

This is the one hole that makes the gate's own claim untrue. Its header says *"EVERY RULE IS ANCHORED TO THE TREE"* (`:26`); five files is not the tree.

**Two — no pod identity, and a policy set silent about it.** No `ServiceAccount`, `Role`, `RoleBinding` or `automountServiceAccountToken` exists anywhere in `deploy\helm\kp\templates\`, and none of the twelve rules mentions pod identity. The pod therefore runs with the namespace's `default` ServiceAccount and its API token projected into the container — a live Kubernetes credential inside a Next server that spawns Python subprocesses on request and stores candidate PII on a mounted volume. kp calls no Kubernetes API, so the token buys nothing and costs a credential.

**The peer's *test fixture* is the example.** `C:/t/kube/e2e/deployment.yaml` ships a Namespace + ServiceAccount + Role + RoleBinding with an explicit five-verb list — for a throwaway job whose entire purpose is to create one Job and delete it. A library's disposable CI manifest is more careful about pod identity than this production chart, and the reason is not that kube-rs is more diligent: it is that the gate here has never had a rule to make anyone think about it. `security/authorization` is the governing subject, and the design record's reading of it is the argument in one line — moving the decision *"from N places that could forget to one place that cannot be bypassed"*.

`engineering-process/continuous-integration/deployment-contract:26-29` is the standard both halves serve:

> A deployment is a claim that a **specific, verified build** reached a **named environment** through a **declared path**. Every part of that claim the repository does not control in writing — where the build runs, what triggers it, what configuration it sees — is a part that will eventually diverge silently.

A template the gate never reads is a part of the claim the repository does not control in writing.

## What the first context contains

**`scripts/deploy/check-chart.mjs` — the loader globs.** `loadChart` (`:319-327`) reads `templates/*.yaml` in addition to the five named files, keeping the named handles for the policies that need a specific document (`replicas-not-pinned` must read the Deployment, not "some template"). Two consequences follow and both are the point:

- `privileged-pod` (`:214-224`) joins **every** template rather than four, so its four keys reach anything the chart renders.
- A new rule, `unreviewed-template`: a template the gate has not seen before is itself a finding, resolved by naming it in an explicit list with the reason it is exempt from the specific policies. This is the two-directional discipline kp already applies to its CI gates and nowhere else — `.ai\manifest.yaml`'s `gates` block is *"Compared IN BOTH DIRECTIONS against the workflow… a step added to ci.yml that is not here fails as `gate-unlisted`, an entry ci.yml no longer runs fails as `gate-stale`."* The chart deserves the same treatment.

**`deploy/helm/kp/templates/serviceaccount.yaml`** — one ServiceAccount, no Role, no RoleBinding, with `automountServiceAccountToken: false`. The comment above it states the reason, in the register the rest of this chart uses: kp calls no Kubernetes API, so the correct permission set is empty and the correct token count is zero. The Deployment references it by `serviceAccountName` (`deployment.yaml:28-35`) and sets `automountServiceAccountToken: false` at the pod level as well, since the pod-level setting is the one that binds when both exist.

**Two new policies in `POLICIES` (`:155-278`)**, each with its `why` line in the existing style:

| rule | why |
| --- | --- |
| `service-account-token-mounted` | kp calls no Kubernetes API; a projected token is a credential with no purpose and a real blast radius in a pod that holds candidate PII |
| `unreviewed-template` | a policy set that reads five named files cannot see the sixth; the gate's claim to be anchored to the tree requires the tree |

**`scripts/deploy/__tests__/check-chart.test.mjs`** — a fixture per new rule, matching the existing pairing at `.github\workflows\ci.yml:139-141`. The `unreviewed-template` fixture is the important one: a scratch chart with an extra template must fail, and the same chart with that template listed must pass.

**What it must NOT absorb.** Not RBAC design — the Role is empty and adding one would be inventing a requirement. Not the probe work (`2026-09-03-health-checks.md`) or the disruption/rotation work (`2026-09-03-deployment-contract-hardening.md`), both of which this gate would then hold. Not the four hardening rules' *admission* rung: making the cluster enforce the `restricted` Pod Security Standard is a real second rung, it is `gate-laddering`, and it should wait until somebody has run kp on a cluster with Pod Security enforcement rather than be guessed at now. Not `helm template` in CI — the gate's dependency-free property (*"no helm binary, no `npm ci`, no cluster"*, `:34-36`) is why it runs on every push, and it is not being traded away for this.

## The measurable

**Policies covering pod identity: 0 → 1. Templates the gate reads: 5 → all of them.**

Both are exact and both are checkable by running the gate. The second is the one with a moving denominator, which is the whole point — today it is 5 of 9 files in `templates/`, and the failure mode is that the denominator grows while the numerator does not.

**The number that says it worked, though, is the fixture count.** `npm run test:deploy` must gain one must-fail case per new rule, and the `unreviewed-template` case must be run **in both directions** — an unlisted template fails, a listed one passes. A gate whose findings go to zero because its rules stopped matching is the failure the existing fixture pairing exists to catch (`ci.yml:139-141`), and a glob-based rule is more susceptible to it than a regex over a fixed file, not less.

**Second number, one an operator would feel**: projected service-account tokens in the kp pod. Currently 1, target 0, readable with `kubectl exec … ls /var/run/secrets/kubernetes.io/serviceaccount` on any install.

## What would make this wrong

**If globbing breaks the exit-2 contract.** `loadChart` returning `{ error }` on a missing file is a deliberate, load-bearing behaviour — *"A missing one is exit 2, never a quiet pass"* (`:52`). A glob has no missing files by definition, so the five named handles must stay required and only the *additional* documents may be discovered. If that distinction cannot be kept cleanly, the honest change is smaller: extend `privileged-pod`'s join to a glob and leave `loadChart` alone. That preserves the contract and closes most of the hole.

**If the extra token is not actually mounted.** Some distributions and some install paths disable service-account token projection by default, and a few operators run kp under a ServiceAccount they created themselves. If `kubectl exec` on a reference install shows no token, then the defect is theoretical and this half reduces to a policy that documents an intent rather than fixes a leak — still worth having, but S-minus and not worth ranking first. Check it on one real install before writing the template; it is one command.

**If nobody has ever added a template.** The `unreviewed-template` rule's value is proportional to how often this chart grows. `deploy\helm\kp\templates\` has nine files and the chart is at `version: 0.1.0` (`Chart.yaml:10`). If the git history shows the template set unchanged since it was authored, the rule is machinery guarding a case that has not occurred, and the honest sequencing is to land the glob for `privileged-pod`, skip the new rule, and record this as its return condition: **the first time a template is added.**

**If an empty Role is the wrong answer.** This proposal asserts kp calls no Kubernetes API. That is read from the chart's shape, not from the application code. If any code path performs service discovery, reads a ConfigMap at runtime, or resolves a Secret through the API rather than through `envFrom`, then the correct artifact is a scoped Role — kube's five-verb fixture as the model — and not a ServiceAccount with nothing attached. Grep before writing.
