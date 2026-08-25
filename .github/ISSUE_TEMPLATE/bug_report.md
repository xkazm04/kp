---
name: Bug report
about: Something is broken. Tell us where it runs, what it can reach, and how to see it break.
labels: bug
---

<!--
This project is maintained by one person plus agents; issues are triaged weekly.
A report that can be reproduced in one sitting gets fixed first.
Security issues: do NOT open an issue — see SECURITY.md.
-->

## Deploy mode

<!-- One of: local dev (`npm run dev`) / self-hosted (`next start`, Docker, Helm).
     Include open mode vs password mode if auth is involved. -->

- Mode:
- Version / commit:
- OS / Node / Python:

## Capability context

<!-- KandiDate degrades gracefully without keys, so "broken" often means "running
     keyless by design". Paste the capability matrix from the /onboarding skill if
     you ran it, or say which rows of the README's "What each key unlocks" table
     apply to your install (which providers/keys are configured, KP_OFFLINE, etc.). -->

## What happened

<!-- What you did, what you expected, what you got. Errors verbatim. -->

## Reproduction

<!-- Numbered steps from a fresh state. If it needs seed data, say which. -->

1.
2.
3.
