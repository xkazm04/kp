---
id: "0006"
title: AGPL-3.0-only plus a CLA; hosting is the commercial boundary
status: accepted
date: 2026-08-26
supersedes: []
superseded-by: null
tags: [licence, product, governance]
sources:
  - LICENSE
  - CLA.md
  - package.json
  - CONTRIBUTING.md
---

# AGPL-3.0-only plus a CLA; hosting is the commercial boundary

## Context

kp went public on 2026-08-19. The choice at that point was where to draw the
commercial line, and the usual options all have a failure mode:

- **Permissive (MIT/Apache)** — a cloud vendor can host it without contributing
  anything back.
- **Open core** — the interesting parts get held back, and the open part slowly
  becomes a demo. That is corrosive to the self-host promise in
  [ADR 0004](0004-keyless-degradation-is-a-product-property.md).
- **Source-available (BSL/SSPL)** — not open source; loses the audience.

There is a second force specific to this product: it processes candidate PII.
An operator running it themselves should be able to *read* the code that handles
that data, all of it.

## Decision

**AGPL-3.0-only** for the entire repository. Everything ships open — there is no
withheld tier, and self-hosted installs are unmetered. The commercial boundary
is **hosting**: running it for you is the paid thing, not unlocking it.

Contributors sign a **CLA** (`CLA.md`), which keeps relicensing possible without
chasing every contributor. The CLA is deliberately still a draft rather than a
signature wall on the first PR.

Consequences that follow and are already true in the tree: BYOM as a paid
capability was **withdrawn**, and all AI routes to the operator's own keys
([ADR 0004](0004-keyless-degradation-is-a-product-property.md)). Repository
history was **not** rewritten at the point of opening, so the full record stands.

## Consequences

**Good.** A self-hoster gets the real product, auditable end to end — which is
what a company handing it CVs should demand. The network-use clause means a
hosted fork has to publish its changes.

**Bad, and accepted.** AGPL is a hard "no" at some enterprises, and that is
lost revenue we chose. The CLA is friction on a first contribution. And the
paid offering has to win on operations rather than on features, which is a
harder business to run.

**Do not** add a proprietary component, a licence-key check, or a feature that
only works against kp-hosted infrastructure. Any of those breaks the promise
this ADR exists to protect.

## What would change our mind

A concrete enterprise deal blocked purely on AGPL could justify a **dual**
licence (AGPL + a commercial licence for the same code) — which is exactly what
the CLA preserves the option to do. It would not justify open core.
