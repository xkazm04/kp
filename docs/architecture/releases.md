# Releases — what an operator pins to, and how to go back

Green CI used to lead nowhere. Tests, lint and build ran; the `Dockerfile` and
the Helm chart existed; and an operator's only option was to pin a git SHA and
read `git log` to find out what it contained. There was no release boundary, and
an agent had no safe path to drive a deploy.

This page is that boundary.

## What you pin to

| You are running | Pin | Why |
| --- | --- | --- |
| Docker / Compose | `ghcr.io/xkazm04/kp:0.1.0` | a semver tag: readable, and it has release notes |
| Kubernetes (Helm) | `image.tag` (defaults to the chart's `appVersion`) | the chart and the image move together |
| Something that must never move | `ghcr.io/xkazm04/kp:sha-<commit>` | immutable; a semver tag is only re-pointed on a re-release, but `sha-` never is |
| Reproducing a report | the digest, `ghcr.io/xkazm04/kp@sha256:…` | the strongest guarantee available |

`latest` exists and you should not use it in production. It follows whatever was
released most recently, including a release you have not read the notes for.

## Versioning, as it applies here

Semantic versioning, read against the **self-host contract** rather than a
TypeScript API — nobody imports this package. A change is **major** when it
breaks one of:

- the environment-variable contract (a removed or renamed `KP_*` variable, a
  changed default, a new *required* one);
- the database, in a way an older image cannot read back;
- a public candidate URL shape (`/schedule/[token]`, `/apply/[id]`, …) — those
  links are already out in the world in people's inboxes;
- the Helm values schema.

**Minor** is a feature or a new optional variable. **Patch** is a fix.
Security fixes land on `main` and in the current tag; there are no maintained
back-branches (see [`SECURITY.md`](../../SECURITY.md)).

The chart's own `version` moves independently of `appVersion` — a chart-only
change (a template fix) bumps `version` alone.

## Cutting a release

```bash
node scripts/release/prepare.mjs --version 0.2.0 --dry-run   # read the notes first
node scripts/release/prepare.mjs --version 0.2.0
# review the CHANGELOG section, then:
git add CHANGELOG.md package.json deploy/helm/kp/Chart.yaml
git commit -m "release: v0.2.0"
git tag -a v0.2.0 -m "v0.2.0"
git push origin main v0.2.0
```

`prepare.mjs` owns the three places a version lives — `package.json`, the
chart's `appVersion`, and a `CHANGELOG.md` section — and cuts the section from
the conventional-commit subjects since the last tag (anything it cannot classify
lands under **Other**, never dropped).

### The subject line is an input to this file, so it is checked

Because the section is cut from subject lines, a subject that loses its `type:`
prefix does not fail anything at the time — it is filed under **Other** and
falls out of the release note. [`scripts/release/commit-msg.mjs`](../../scripts/release/commit-msg.mjs)
closes that: it derives its accepted vocabulary from `prepare.mjs`'s own
`SECTIONS` table (so the gate and the changelog cut cannot drift — a fixture
asserts it), and runs in two places:

| Where | When | On failure |
| --- | --- | --- |
| [`.githooks/commit-msg`](../../.githooks/commit-msg) | as the message is written (`core.hooksPath` is set by `npm install`) | the commit is rejected; amend and retry |
| `commit-convention` job in [`ci.yml`](../../.github/workflows/ci.yml) | every push and PR, over the whole range | the build is red until the subject is amended or waived |

Merge, revert and `fixup!` subjects are exempt — those are git's words, not
ours. An individual message is waived on the record with a
`Commit-convention-exemption: <why>` trailer in the body, the same shape as
`Gate-exemption:` and `Doc-sync:`.

`npm run release:check` runs the same coherence check in CI on **every** push,
so the three cannot drift between releases: a version with no release notes, or
a chart `appVersion` that disagrees with `package.json`, fails the build.

The tag is what triggers [`.github/workflows/release.yml`](../../.github/workflows/release.yml):

1. re-runs the gate (typecheck, lint, design, i18n, unit, docs, review **and
   dispatch** fixtures, build) — a tag never publishes something CI has not
   judged. `npm run test:agent` is in that list for the same reason
   `npm run test:review` is: the tools that judge and produce changes here are
   themselves shipped in this tree, so a tag certifies them too;
2. builds and pushes the image to GHCR as `x.y.z`, `sha-<commit>` and `latest`;
3. attaches a **build-provenance attestation** (`actions/attest-build-provenance`),
   so `gh attestation verify` can prove the image came from this repository at
   that commit, plus BuildKit's **SPDX attestation** of the image filesystem
   (`sbom: true`);
4. packages the Helm chart;
5. creates the GitHub Release, with the body taken from this version's
   `CHANGELOG.md` section, the chart tarball attached, and the **CycloneDX
   bill of materials** (`kp-<version>.cdx.json`).

**The signing story is only as strong as its least-pinned input.** Steps 2 and 3
run with `packages: write`, `id-token: write` and `attestations: write`, and some
of the actions they use still float on a major tag — a pointer whose owner can
move it into a signed artifact without a commit here. The refs that still float
are enumerated with a reason in
[`.github/actions-pin-allowlist.json`](../../.github/actions-pin-allowlist.json);
`npm run security:actions` blocks any **new** one on every push, and
[`pin-actions.yml`](../../.github/workflows/pin-actions.yml) resolves the
remaining ones to commit SHAs weekly and opens the pull request. Dependabot then
keeps a SHA pin moving, because it updates a reference in the form it finds it.

### The bill of materials

Provenance answers *where did this image come from*. The SBOM answers the
question an operator actually asks when an advisory lands: *is what I am running
affected?* [`scripts/release/sbom.mjs`](../../scripts/release/sbom.mjs) cuts it
in the `gate` job — the one that has both toolchains installed — because the
Python half is read from the **resolved environment**, not from
`requirements.txt`, which pins direct dependencies only and would omit exactly
the transitive packages advisories name.

```bash
npm run sbom                                  # dist/sbom/kp-<version>.cdx.json
gh release download v0.1.0 --pattern '*.cdx.json'
jq -r '.components[] | "\(.name) \(.version)"' kp-0.1.0.cdx.json
```

`npm run sbom` also runs on **every push** in CI, so a lockfile format change
breaks the build rather than the next release. The generator refuses to write a
document that lists implausibly little — see [`SECURITY.md`](../../SECURITY.md)
for the scope of each half and how it relates to the image's own SPDX
attestation.

## Rolling back

**The honest summary: the image rolls back cleanly; the database does not roll
itself back.** Schema migrations here are additive, idempotent DDL applied at
boot (`app/_lib/db/core.ts`) — there are no down-migrations, and there is no
schema-version table. In practice an older image usually reads a newer file
(the columns it does not know about are simply not selected), but *usually* is
not a guarantee, and a release that changes how existing data is interpreted is
not reversible by swapping the image back.

So: **take a dump before you upgrade.** It is one command and it is the entire
difference between a five-minute rollback and a bad afternoon.

### Before upgrading

```bash
# Compose: stop, copy the volume, restart
docker compose stop kp
docker run --rm -v kp-data:/data -v "$PWD:/backup" busybox \
  tar czf /backup/kp-data-$(date +%F).tar.gz -C /data .
docker compose start kp

# Or the portable, human-readable form (works anywhere the app runs):
npm run db:dump > kp-dump-$(date +%F).json
```

### Going back

1. **Repoint the image** to the previous tag and restart.
   - Compose: edit the tag, `docker compose up -d`.
   - Helm: `helm rollback kp` (Helm's own revision history), or
     `helm upgrade kp deploy/helm/kp --set image.tag=0.1.0`.
   - The chart pins one replica with the `Recreate` strategy, so this is a stop
     and a start, not a rolling swap. Expect ~10–30 s of downtime.
2. **Check the app comes up**: `GET /api/health` reports `db`, `seeds`, `clock`,
   engine availability and a `degradedReasons` list.
3. **If the data is wrong, not just the code**, restore the dump: stop the
   container, restore the volume tarball (or `npm run db:load`), start it.
4. **Say what happened** in the CHANGELOG of the next release. A rollback that
   is not written down repeats.

### What a rollback cannot undo

- **Sent communications.** The outbox delivers to real people; rolling back the
  code does not unsend an email. The outbox records `sent` / `queued` / `failed`
  truthfully, so the record survives the rollback — read it.
- **Provider spend.** LLM calls already made are billed.
- **Candidate-facing tokens already issued.** They keep working; that is the
  point of a capability link ([ADR 0005](decisions/0005-hmac-sessions-and-capability-tokens.md)).

## Known gaps

- No release has been cut yet. `v0.1.0` is the first tag; everything above is
  wired and unexercised until it is pushed.
- The image is attested but not additionally cosign-signed. Attestation covers
  provenance, which is the property that matters for "did this come from that
  commit"; add signing if a consumer's policy engine requires it.
- The Helm chart is packaged and attached to the release, but is not published
  to an OCI chart registry. `helm install` from the repo path still works.
- There is no automated canary or staged rollout: this is a single-replica,
  self-hosted product, so the deploy is a restart.
