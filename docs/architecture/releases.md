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

All four scripts here shell out through one wrapper —
[`scripts/release/git.mjs`](../../scripts/release/git.mjs), which also serves the
doc-sync gate — so the range reader, the rev check and the 64MB stdout buffer a
long `git log` needs exist once rather than in three copies that drift.

Merge, revert and `fixup!` subjects are exempt — those are git's words, not
ours. An individual message is waived on the record with a
`Commit-convention-exemption: <why>` trailer in the body, the same shape as
`Gate-exemption:` and `Doc-sync:`.

#### A prefix is not a description

The vocabulary check above accepts `fix: Done. Here's what I found and did`,
which is a real subject from this history, and so are these:

```
fix: All four items are settled. Here's what I found and did
fix: Done. Three of the four were already answered in-tree; one was
```

They carry a type, they are under the cap, and they describe a *session* rather
than a change — the last one stops mid-clause because it was sliced out of an
agent's closing message. Roughly half the commits here are written by an agent,
so `git log` is the primary record of what those agents did, and a log in this
shape cannot be bisected, summarised into a release note, or read after an
incident.

`checkShape()` in the same file is the smallest rule an automated lane can
satisfy without a human editing messages: **the subject is one clause about the
change.** It rejects

| Shape | Example |
| --- | --- |
| a second sentence in the subject | `fix(auth): stop the leak. It was in the cookie` |
| a session-report opener | `Done.` · `Here's what I found` · `Successfully …` |
| the first person | `fix(auth): I moved the token check` |
| a line cut mid-phrase | `… when the candidate and` · `… one was` · `retry the outbox,` |
| an unclosed delimiter | ``fix(db): stop the write in `pipeline`` |
| a trailing full stop | `fix(auth): stop the leak.` |

"Cut mid-phrase" is a **tail-word** rule, and it is deliberately narrow in two
ways a reader should know about, because the cost of a false rejection is that
the author reaches for the waiver trailer this gate exists to make unnecessary.
The tail is read as a **whole word, digits included** — `chore(perfect): ship
wave 21a` ends on `21a`, not on the article `a`, which is what a letters-only
tail regex saw. And `DANGLING_TAIL` holds only words that *require* a following
word: `one`, `it`, `do`, `does` and `did` end a clause perfectly well (`… into
one`, `… why we did`) and are not in it, while the copulas (`is`, `was`) are,
because a subject ending on one really was cut. The list is pinned in both
directions by a fixture in
[`commit-msg.test.mjs`](../../scripts/release/__tests__/commit-msg.test.mjs), so
growing it by intuition is a deliberate act rather than a quiet one.

`checkTypeAgainstFiles()` adds the one claim the diff settles outright: a
commit whose files are **all** documentation is not a `feat` or a `fix`, and one
whose files are **all** tests is not either — a release note would otherwise
announce a user-visible change that does not exist. A mixed commit is never
judged on its type; that judgement belongs to the review lens, not to a regex.

The narrative is not unwelcome, it is *relocated*: the body has no length limit
and `git log --format=%s` never prints it. Both rules run in the same two places
as the table above, and both are waived by the same trailer.

#### …and a description is not a record of who wrote it

Fixing the subject makes the log *readable*. It does not make it *queryable*, and
those are different problems with the same cause. Recording that a lane committed
on an agent's behalf is genuine provenance discipline — it is also prose, phrased
differently by every lane, so none of the questions worth asking about
agent-authored change can be answered without reading each message by hand:

> which changes did an agent write, under which model · which of them closed a
> dispatched task · when a module went wrong, was the change that touched it
> agent-authored · is the agent share going up or down?

Each is one `git log` away once the facts are **trailers**, which git already
parses. [`scripts/release/provenance.mjs`](../../scripts/release/provenance.mjs)
defines the vocabulary — `Agent-Provenance: agent=…; model=…; lane=…; task=…`,
`Co-Authored-By:`, `Ascent-Resolves:` (shapes and rationale in
[CONTRIBUTING.md](../../CONTRIBUTING.md#provenance-trailers--say-who-wrote-it-in-a-form-git-log-can-read))
— and reads it two ways:

| Command | Answers |
| --- | --- |
| `npm run provenance` | over a range: the agent share, the models, the lanes, the tasks closed, and how many agent commits are recognisable but **not** attributable |
| `npm run provenance -- --json` | the same, for a script |

The validation rides the existing `commit-convention` job rather than adding a
gate: an **absent** trailer is never a finding, because a rule demanding one that
no lane writes yet would go red on every automated commit and be bypassed within
a day. A trailer that is **present and malformed** is — an empty value, an
`Agent-Provenance:` carrying no `key=value` pair, a `Co-Authored-By:` with no
`<email>`. Those look like a recorded fact and answer nothing.

**The half this repository cannot close by itself.** The reader works on today's
history, because `Co-Authored-By:` already carries the agent and the model. Lane
and task only become answerable when the lane emits `Agent-Provenance:`, and a
lane's commit template is not a file in this tree. `npm run provenance` prints
the unattributed count precisely so the size of that gap is a number rather than
an impression.

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

**The document is reproducible, so it can be checked rather than trusted.** The
component lists are sorted and the serial number is a SHA-256 of them, and the
timestamp — the one remaining input that made two cuts of the same tag differ
byte for byte — is pinned: `--timestamp` (epoch seconds or an ISO instant), or
the `SOURCE_DATE_EPOCH` convention when it is not passed. The release workflow
passes the **tagged commit's own commit time**, so re-cutting the document from
that tag reproduces the published file exactly:

```bash
git checkout v0.1.0
node scripts/release/sbom.mjs --version 0.1.0 --commit "$(git rev-parse HEAD)" \
  --timestamp "$(git log -1 --format=%cI)" --out /tmp/kp-0.1.0.cdx.json
diff /tmp/kp-0.1.0.cdx.json kp-0.1.0.cdx.json   # the asset downloaded above
```

A `--timestamp` that is neither form is an **error**, not a fallback: a caller
that asked for a reproducible document must not silently receive a clock.

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

### The drill is rehearsed on every push

Everything below used to be prose that nobody had executed, which is the same
failure class as a doc naming a file that moved: it reads as a procedure and is
a plan. [`app/_lib/db/rollback-drill.test.ts`](../../app/_lib/db/rollback-drill.test.ts)
runs it for real in `npm run test:unit` — the `node-tests` job in `ci.yml` **and**
the `gate` job in `release.yml`, so a tag cannot publish a version whose rollback
has not just been performed. It covers the two halves separately, because they
fail differently:

| What it rehearses | The failure it catches | When it goes red |
| --- | --- | --- |
| **Downgrade compatibility.** The column shape a v0.1.x image issues SQL against is pinned as `V0_1_X_SHAPE`, and every one of those columns must still exist on the current schema with the same declared type. | A migration that drops or renames a column, or a PK-widening table rebuild that loses one. Repointing the image back then produces an app that will not start. | On the change that removes the column — not on the operator's laptop six months later. |
| **Downgrade writability.** The `INSERT` statements an older image performs are executed against the current schema and rolled back. | A column added since that is `NOT NULL` with no `DEFAULT`. The rolled-back image boots, looks fine, and fails every write — the worst of the outcomes, because it reads as a successful rollback. | Same. |
| **The restore drill.** A v0.1.x workspace is dumped, a bad 0.1.1 upgrade wrecks it (schema moved *and* rows corrupted), and the documented recovery below is run. Schema and every row must come back byte-identical. Also asserts that without `--replace` the loader refuses **and writes nothing**. | `db-dump.mjs` / `db-load.mjs` drifting apart, a lost index, or a half-applied restore. | Whenever either script changes in a way that breaks the round trip. |

Redness here has a specific meaning, and it is not "fix the test": per
[Versioning](#versioning-as-it-applies-here), a change the database cannot be
read back through is a **major** release. If the break is intended, cut the major
and edit `V0_1_X_SHAPE` in the same commit, so the incompatibility is a line in a
diff somebody approved.

What the drill deliberately does *not* claim: it does not boot the previous
image. It proves the file an older image would open still has the shape that
image reads and writes, which is the strongest thing assertable from inside one
checkout — the remaining risk is **semantic** (a release that reinterprets
existing data), and that is what the dump exists for.

### Does every migration have a down step?

No — and that is the decision, not an oversight. There is no `down()` anywhere
in `app/_lib/db/core.ts`; migrations are forward-only additive DDL. The reverse
direction is served by the **dump**, not by a down-migration, for the reason
[ADR 0002](decisions/0002-sqlite-single-file-persistence.md) gives: the whole
database is one file, so a byte-exact restore is cheaper and more trustworthy
than a hand-written inverse of each `ALTER`, and it also reverses the data
changes a `down()` never could. The drill above is what keeps that trade honest —
it is the test that a forward-only scheme still leaves a way back.

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
