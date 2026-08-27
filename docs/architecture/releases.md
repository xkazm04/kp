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
the conventional-commit subjects since the last tag (~90% of subjects here carry
a prefix; anything it cannot classify lands under **Other**, never dropped).

`npm run release:check` runs the same coherence check in CI on **every** push,
so the three cannot drift between releases: a version with no release notes, or
a chart `appVersion` that disagrees with `package.json`, fails the build.

The tag is what triggers [`.github/workflows/release.yml`](../../.github/workflows/release.yml):

1. re-runs the gate (typecheck, lint, design, i18n, unit, docs, review fixtures,
   build) — a tag never publishes something CI has not judged;
2. builds and pushes the image to GHCR as `x.y.z`, `sha-<commit>` and `latest`;
3. attaches a **build-provenance attestation** (`actions/attest-build-provenance`),
   so `gh attestation verify` can prove the image came from this repository at
   that commit;
4. packages the Helm chart;
5. creates the GitHub Release, with the body taken from this version's
   `CHANGELOG.md` section and the chart tarball attached.

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
