# Security policy

KandiDate processes candidate CVs, contact details and interview transcripts.
A vulnerability here is a personal-data breach for somebody who never chose to
use this software — the candidate. Please treat it accordingly, and so will we.

Where that data actually goes — every hop from the upload to the model provider,
what comes to rest in SQLite, and which adapters can send it off the machine — is
mapped in
[`docs/architecture/candidate-data-flow.md`](./docs/architecture/candidate-data-flow.md).
Read it before assessing impact; it also lists the gaps we already know about.

## Reporting a vulnerability

**Do not open a public issue.**

Report privately via GitHub's [private vulnerability
reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (Security → Report a vulnerability), or by email to the
address in the repository's profile.

Useful reports include: affected version or commit, deployment shape
(self-hosted / hosted, open mode or password mode), reproduction steps, and what
an attacker gets. A proof of concept is welcome; testing against somebody else's
live instance is not.

**Response targets:** acknowledgement within 3 working days, an initial
assessment within 10. If a fix will take longer than that, you'll get the reason
and a date rather than silence.

Please give us a reasonable window to ship a fix before disclosing publicly. We
will credit you in the advisory unless you'd rather we didn't.

## Disclosing a vulnerability — the outbound half

Everything above is how a report reaches **us**. This section is how a fix
reaches **you**, and until 2026-09-08 this file did not describe it at all: an
operator running a self-hosted KandiDate had no way to learn that a KandiDate
vulnerability affected them except by watching the commit log.

**The channel is a GitHub Security Advisory, one per fixed vulnerability.** They
are published from Security → Advisories on this repository, they name the
affected versions and the fixed version, and a CVE can be requested from the same
draft (GitHub is a CNA). The fix is prepared in the advisory's private fork, so
the advisory and the release land together rather than the commit arriving first
and explaining itself later.

**Target latency: the advisory is published within 5 working days of the fix
landing in a tagged release.** That is a *target*, not a guarantee — it is set
where a small team can actually meet it rather than where it looks best. One case
is tighter, and it is a rule rather than a target: where we know a vulnerability
to be **actively exploited**, the advisory goes out *with* the release, not after
it. That case is also the one the **Cyber Resilience Act** (Regulation (EU)
2024/2847) puts on a statutory clock from **11 September 2026**, when its Art. 14
reporting obligations start applying (the rest of the Regulation applies from 11
December 2027). Art. 14(1) requires an actively exploited vulnerability to be
notified to the **CSIRT designated as coordinator and to ENISA via the single
reporting platform** — an early warning within **24 hours** of becoming aware, a
fuller notification within **72 hours**, and a final report within **14 days** of
a corrective or mitigating measure being available. Art. 14(8) separately
requires *impacted users* to be told about the vulnerability and about the
mitigation they can deploy. So this is one process with two addressees, not two
processes: the advisory is how Art. 14(8) is discharged here, and the regulator
notification runs beside it on the shorter clock.

**What this channel does not do, and you should not assume it does.** KandiDate
is not a published npm package (`"private": true` in `package.json`); it is
distributed as a git checkout and as the `ghcr.io/xkazm04/kp` image. A GitHub
advisory about a *dependency* reaches you through `npm audit` and Dependabot
because that package has a registry coordinate to match on. An advisory about
**KandiDate itself** has no such coordinate, so nothing surfaces it in your build
automatically. The channel is real, and it is pull, not push.

**Which means: if you self-host, subscribe to it now.** The duty to act on an
advisory is yours, and it costs a minute to make sure you will see one.

- **Watch this repository** — Watch → Custom → **Releases**. (Custom → *Security
  alerts* is about Dependabot alerts on repositories you administer; it is not
  the option you want here.)
- Or point whatever already reads feeds at
  <https://github.com/xkazm04/kp/releases.atom>, if you would rather not carry a
  GitHub notification.
- **Security → Advisories** on this repository is the canonical list. Check it
  when a release note points at one.
- **Record the version you run.** Every release ships a CycloneDX SBOM (see
  below), which is what turns "does this affect me" into something answerable
  rather than guessed.

**Whose duty this is, stated as a reading rather than as a fact.** Art. 3 of the
CRA defines an *open-source software steward* as a legal person, other than a
manufacturer, that systematically provides sustained support for the development
of a free and open-source product intended for commercial activities and ensures
its viability. That is our best characterisation of this project's vendor, and it
puts us under **Art. 24** rather than the manufacturer chain: a documented
cybersecurity policy (this file and the process it describes), cooperation with
market surveillance authorities, and Art. 14(1) *"to the extent that they are
involved in the development of the products"*, with Art. 14(3) and (8) reaching
severe incidents affecting systems the steward itself provides.

Three things that reading does **not** license us to say:

- **It is not settled, and we do not resolve the ambiguity in our own favour.**
  Art. 24(3) names Art. 14(1), (3) and (8). It does **not** name Art. 14(2) —
  which is where the 24-hour / 72-hour / 14-day mechanics actually live. Whether
  that clock binds a steward as such is arguable. We treat it as binding.
- **A heavier classification is plausible.** A steward must be a *legal person*,
  and free and open-source software developed outside a commercial activity is
  outside the Regulation altogether; both of those readings mean *less* duty than
  the one above. The reading that means *more* is that a hosted offering makes
  the vendor a **manufacturer** for what it places on the market, which pulls in
  the full Art. 13/14 chain — conformity assessment, CE marking and all. We have
  not settled that question, and this file describes the steward-level process
  only.
- **There is no compliance claim here and no certification.** KandiDate is not
  "CRA compliant". There is no CE marking, no conformity assessment and no
  notified body. What exists is a named channel, a stated latency and a written
  process — the part a reviewer can actually check.

If you are yourself an essential or important entity under NIS2, the same
advisories are your notification source and your own clock is separate from ours;
that is set out in
[`docs/architecture/self-hosting.md` §1b](./docs/architecture/self-hosting.md).

*This section is an engineering artifact, not legal advice.*

## Scope

In scope: this repository's application code, the Python pipeline, the container
and Helm packaging, and the default configuration they ship with.

Out of scope: findings that depend on a deliberately insecure configuration the
docs already warn about (see below), vulnerabilities in third-party model
providers, and reports generated by a scanner with no demonstrated impact.

## Things that are the operator's job, not a vulnerability

A self-hosted install is only as safe as its configuration. These are documented
behaviours, not bugs — see [`docs/architecture/self-hosting.md`](./docs/architecture/self-hosting.md):

- **`KP_OPERATOR_PASSWORD` unset means the app runs fully open.** Every operator
  route is reachable with no login. This is the intended local-development mode.
  A production build refuses to start in this state unless `KP_ALLOW_OPEN=1` is
  set explicitly, which exists so that "I opened it to the internet without a
  password" has to be a decision rather than an accident.
- **`KP_SECRET` unset means provider API keys are not encrypted at rest.** Set it.
- **Public candidate surfaces are capability links.** `/schedule/[token]`,
  `/interview/[token]`, `/status/[token]` and friends are unguessable URLs, not
  sessions. Anyone holding the link holds the capability, by design. Forwarding
  one is equivalent to forwarding the access.
- **No TLS is provided by the container.** Terminate TLS in front of it.

## Hardening worth knowing about

- `KP_OFFLINE=1` installs a global egress guard: no outbound network call leaves
  the process except to loopback and the private endpoints you configured
  (`app/_lib/offline.ts`, mirrored on the Python side). For air-gapped and
  data-residency deployments.
- All AI routes to **your** provider keys. There is no KandiDate-hosted inference
  in the path of a self-hosted install, and the local engines (Claude CLI,
  Ollama) need no key at all.
- Candidate consent gates PII reads and expires on a configurable TTL; erasure
  runs as one transaction across transcripts, scorecards and the outbox.

## What runs automatically

The duty of care above is enforced by machinery, not by remembering. All of it
lives in [`.github/`](./.github) and runs on every push and pull request:

| Check | Where | Fails the build when |
| --- | --- | --- |
| CodeQL (`security-extended`) over TypeScript **and** the Python pipeline | [`workflows/security.yml`](./.github/workflows/security.yml) | a new alert appears on the change; results land in the Security tab |
| `npm audit` | same | a **critical** advisory exists in the npm tree (high and below are reported to the run summary and triaged as Dependabot PRs) |
| `pip-audit` over the resolved Python environment | same | any advisory affects an installed package |
| Dependency update PRs — npm (root + `edge/`), pip, GitHub Actions | [`dependabot.yml`](./.github/dependabot.yml) | n/a — it opens PRs; CI decides whether they land |
| SBOM generation (`npm run sbom`) | [`workflows/ci.yml`](./.github/workflows/ci.yml) | the bill of materials cannot be produced, or lists suspiciously little |
| Committed-credential scan over every **tracked file** (`npm run security:secrets`, [`secret-scan.mjs`](./scripts/security/secret-scan.mjs)) | [`workflows/ci.yml`](./.github/workflows/ci.yml) | a file git tracks carries an API key, token, service-account file or private-key block. The same table gates each diff as the constitution lens's `secret` rule, which is the one finding a `Gate-exemption:` trailer may **not** waive — the fix is removing the literal and **rotating** the credential, because it is in the object database from the moment the commit exists |

## What is in the image you are running

Every release carries a **CycloneDX 1.5 bill of materials** as a release asset,
`kp-<version>.cdx.json`, generated by
[`scripts/release/sbom.mjs`](./scripts/release/sbom.mjs) in the job that
certifies the tag. It covers both runtimes:

- **npm** — the lockfile's *production* closure (dev dependencies excluded),
  each component with its resolved version and its integrity hash. The image
  ships Next's traced subset of that closure, so the document is a superset: a
  package absent from it is absent from the image.
- **Python** — the *resolved* environment the image's `/opt/venv` is built from
  (`pip list`), so transitive dependencies are listed too, not only the direct
  pins in `requirements.txt`.

The image additionally carries BuildKit's own SPDX attestation of its built
filesystem — that one includes the base OS packages:

```bash
# what the release declares it depends on
gh release download v0.1.0 --pattern '*.cdx.json'
jq -r '.components[] | "\(.name) \(.version)"' kp-0.1.0.cdx.json | grep -i pypdf

# what the image actually contains, as scanned at build time
docker buildx imagetools inspect ghcr.io/xkazm04/kp:0.1.0 --format '{{ json .SBOM }}'
```

The generator **refuses to write** a document that lists implausibly little
(`checkSbom` in the same file). An empty SBOM published as if it were complete
is worse than none at all: an operator triaging a CVE would read "not affected"
from an omission.

Two deliberate choices worth stating:

- **No `ignore` rules in `dependabot.yml`.** A GitHub ignore rule silences
  security updates as well as version updates, so muting a deliberately-pinned
  package (`next` is pinned exactly, in lockstep with `eslint-config-next`)
  would suppress exactly the alerts that matter most. Pins are defended in
  review instead.
- **Every workflow declares `permissions:`.** `GITHUB_TOKEN` is read-only by
  default in this repository's CI; only the CodeQL job widens it, and only to
  `security-events: write` so it can upload its SARIF result.

## Supported versions

This is a young project on a single release line. Security fixes land on `main`
and in the current container tag. There are no maintained back-branches yet; if
you need one, that conversation belongs in an issue.
