---
subject: software-engineering/deployment-contract
project: kp
raised_by: intake intake-kube-0903 (peer comparison)
source: librarian/sources/2026-09-03-kube-rs.md
stage: deploy/helm/kp/templates — the two platform-level expressions of invariants the chart already defends three ways inside the pod spec
size: 3 files / ~50 lines / S
status: accepted
---

## Why the scope implies it

`scope.does` says *"self-hostable (Docker), multi-locale, one organisation per install"* (`.ai\manifest.yaml`). One organisation per install means one pod, one SQLite file, one volume — and the chart defends that from three directions already, which is more than most projects manage: `replicas: 1` as a literal (`scripts\deploy\check-chart.mjs:156-165`), `strategy: Recreate` (`:166-174`), and `accessMode: ReadWriteOnce` (`:270-277`). Three rules, one invariant, each with its reason.

Every one of those defences is **inside the pod spec**. Two things the platform does to a pod from the outside are undefended, and both are ordinary operations that a competent cluster administrator performs without knowing kp is special.

**One — a node drain takes the whole service, silently.** No `PodDisruptionBudget` exists in `deploy\helm\kp\templates\`, and no policy mentions one. `kubectl drain` on the node evicts the only replica; kp is down for a reschedule plus a PVC reattach, and nothing anywhere told the operator that a single-instance stateful workload was involved. Every signal the chart carries about its single-writer nature — `Chart.yaml:4-7`, `values.yaml:12-16`, the comment at `deployment.yaml:8-11`, `NOTES.txt:19-20` — is addressed to whoever runs `helm install`. None of it is addressed to whoever runs `kubectl drain`, and those are frequently different people on different days.

A PDB with `minAvailable: 1` over a one-replica Deployment blocks voluntary disruption **entirely**. That is not a limitation to work around; it is the correct and deliberately loud behaviour for a database that cannot be moved without downtime, and it converts a silent outage into a refused command with a name attached.

**Two — `KP_SECRET` cannot be rotated without a manual restart, and appears to have been.** `deployment.yaml:22-24` rolls the pod when the ConfigMap changes: `checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}` — *"Roll the pod when the (non-secret) config changes."* Correct, and more than most charts do. The Secret is not in the checksum. Credentials arrive via `envFrom.secretRef` (`:48-49`), which the container reads **once at start**. So `helm upgrade --set auth.secret=<new>` updates the Secret object, leaves the running pod holding the old value, and reports success.

The stakes are named by the chart itself: `values.yaml:19-20` — *"KP\_SECRET: encrypts stored provider keys"*. A rotation that appears to have happened and has not is the worst shape a credential change can take, because the operator's next action is to treat the old secret as retired.

**What the corpus says both are.** `engineering-process/continuous-integration/deployment-contract:26-29`:

> A deployment is a claim that a **specific, verified build** reached a **named environment** through a **declared path**. Every part of that claim the repository does not control in writing — where the build runs, what triggers it, what configuration it sees — is a part that will eventually diverge silently.

*What configuration it sees* is exactly the checksum gap: the manifest says one thing and the process holds another. And the subject's `deployment-config-as-code` technique — declare everything the platform can read from the repo — is what a PDB is: the single-instance constraint moved out of four prose locations and into an object the platform enforces.

**The peer's angle, and it is a contrast rather than a model.** kube's runtime assumes several independent writers converging on one record, made safe by markers and per-field ownership rather than by exclusion (`C:/t/kube/kube-core/src/params.rs:660-710`); the tree ships zero leader-election code. That is the opposite of kp's situation and both are right — kube's writers converge on a server that arbitrates, kp's would converge on a file that does not. But kp already carries the fleet's nearest instance of kube's *marker* idea and it is a good one: `templates\pvc.yaml:8-10` annotates the PVC `helm.sh/resource-policy: keep` so an uninstall does not take the data — *"candidate PII lives here"* — which is the same shape as a finalizer's *do not vanish yet* (`C:/t/kube/kube-runtime/src/finalizer.rs:75-120`), with the platform doing the enforcing. A PDB is that instinct applied to the pod instead of the volume: the chart already tells the platform not to delete the data; it does not yet tell it not to evict the writer.

## What the first context contains

**`deploy/helm/kp/templates/pdb.yaml`** — one `PodDisruptionBudget`, `minAvailable: 1`, selecting the same labels as the Deployment (`_helpers.tpl:31-34`). Values-gated (`podDisruptionBudget.enabled`, default `true`) so an operator who deliberately wants drainable-with-downtime can turn it off, with the comment saying what turning it off means. The comment above it carries the reason in the register the rest of this chart uses — that this is the same invariant as `replicas: 1`, addressed to a different audience.

**One line in `deployment.yaml`'s annotations** (`:22-27`), beside the existing ConfigMap checksum: a `checksum/secret` over `secret.yaml`. Guarded on `not .Values.existingSecret`, because when the operator supplies their own Secret the chart does not render it and has nothing to hash — which is a real hole and is named below rather than papered over.

**Two policies in `POLICIES` (`check-chart.mjs:155-278`)**, in the existing shape:

| rule | why |
| --- | --- |
| `no-disruption-budget` | one replica on one RWO volume; a node drain is a full outage and the three in-pod rules cannot see it coming |
| `secret-not-in-rollout-checksum` | `envFrom.secretRef` is read once at container start, so a rotated credential that does not roll the pod is a rotation that appears to have happened |

**Fixtures** for both, in `scripts\deploy\__tests__\check-chart.test.mjs`, matching the pairing at `.github\workflows\ci.yml:139-141`.

**What it must NOT absorb.** Not `NetworkPolicy` — meaningful only where the CNI enforces one, and a chart that ships an unenforced one has manufactured exactly the decoration `check-chart.mjs:176-185` exists to prevent in the other direction. Not the image-digest question (`values.yaml:6-9`, `scripts\release\prepare.mjs:122-126`), which is real but is a *permit* rather than a *require* and belongs to whichever release change touches that file next. Not pod identity or the gate's file globbing (`2026-09-03-deployment-contract.md`). Not the probes (`2026-09-03-health-checks.md`). Not the `existingSecret` pre-flight gap — named below as a falsifier, because it may be the better direction than the checksum.

## The measurable

**Voluntary-disruption outages: currently every node drain, target 0 refused-loudly.** The instrument is the operation itself: `kubectl drain <node>` on a reference install. Today it succeeds and kp is down. After, it blocks with the PDB named in the message, and the operator makes a decision instead of discovering one. This is binary and takes one command.

**Rotations that do not take effect: currently every `KP_SECRET` change, target 0.** Instrument: `helm upgrade --set auth.secret=<new>`, then read the running container's environment. Today the old value is still there and `helm` reported success. After, the pod has rolled. Also binary, also one command, and it is the more alarming of the two because the failure is silent by construction.

**And the number that keeps both true: policies with a must-fail fixture, +2.** kp already runs `test:deploy` immediately after `deploy:check` (`ci.yml:139-141`) precisely because a rule that cannot fail has stopped reading; two new rules earn two new fixtures or they are not landed.

## What would make this wrong

**If a PDB on one replica is worse than none.** `minAvailable: 1` over `replicas: 1` blocks *all* voluntary eviction — including a `drain` for genuine node maintenance, a cluster upgrade, and some autoscaler scale-downs. On a managed cluster with automatic node rotation, that can stall a control-plane upgrade indefinitely and produce a support ticket rather than a resolved decision. The argument above says the block is correct because the alternative is a silent outage; the counter-argument is that a stalled cluster upgrade is also an outage, arriving later and angrier. If the reference deployment target is a managed cluster with unattended node rotation, the honest artifact may be `maxUnavailable: 1` — which permits the eviction but makes it visible in the PDB's status — plus a `NOTES.txt` line, and the strong form is wrong. **Decide which cluster kp is deployed to before choosing the field**; the two produce opposite behaviour from a near-identical manifest.

**If `existingSecret` is the recommended path, the checksum covers the minority case.** `values.yaml:24-26` recommends `existingSecret` *"for real deployments so secrets aren't in Helm release data"*, and `templates\secret.yaml:1` skips the whole template when it is set. So on the recommended path there is no chart-rendered Secret to hash, and the checksum fixes only the deployments that took the discouraged route. If most real installs use `existingSecret`, the right direction is different and larger: a `lookup`-based checksum over the referenced Secret, or an explicit `podAnnotations` convention documented in `docs/architecture/self-hosting.md` for operators who rotate. That path also closes the related hole this study found at §1.9 — when `existingSecret` is set, `required()` never fires and nothing checks that the referenced Secret carries `KP_OPERATOR_PASSWORD` and `KP_SECRET` at all, so a typo'd name deploys an app that *"runs KP OPEN with no login"* (`secret.yaml:10-13`). If that is the real risk, **it outranks the checksum** and this proposal should be rewritten around it.

**If nothing has ever rotated `KP_SECRET`.** The credential encrypts stored provider keys (`values.yaml:19-20`), and rotating it may not even be a supported operation — if the stored keys are encrypted with it, changing it without re-encrypting them makes them unreadable. In that case a pod that keeps the old value is accidentally *protective*, the rollout checksum would break installs, and the actual finding is that `docs/architecture/self-hosting.md` needs a rotation procedure rather than the chart needing an annotation. **Read what changing `KP_SECRET` does to existing rows before adding the line**; this falsifier inverts the change rather than shrinking it.

**If nobody runs kp on Kubernetes at all.** `scope.does` names Docker as the self-host path and the chart is the additional one. If every real install is `docker run` or compose, then neither a PDB nor a rollout checksum has an audience, and the honest move is to say so in `docs/architecture/self-hosting.md` and stop growing a gate whose artifact nobody applies. This applies to every cluster item in this study and should be settled once, first.
