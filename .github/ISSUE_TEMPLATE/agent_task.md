---
name: Agent task
about: A change small and specific enough that an agent can draft it. A maintainer adds `agent:go` to dispatch.
labels: agent-task
---

<!--
Filing this does NOT dispatch anything. A maintainer adds the `agent:go` label
(or comments `/agent`), and only someone with write access on this repository
can do that — see docs/development/change-review.md.

What comes back is a DRAFT pull request written by a model that has read the
files it asked for and nothing else. It goes through the same required checks as
any other change. Nothing is merged automatically.

The agent will DECLINE, and say why, if this issue does not tell it enough. That
is the intended outcome for a vague request — so the sections below are the
difference between a draft and a decline.
-->

## What should be true afterwards

<!-- The observable end state, not the implementation. "The Ledger shows the
build's failure reason instead of a blank row." -->

## Where it lives

<!-- Any paths you already know: a route, a component, a lib module, the doc that
describes it. The agent sees a file list and asks for what it wants to read, so
naming one real file is worth more than a paragraph of description. -->

## How to tell it worked

<!-- The command, the screen, or the test. If you cannot name one, this issue is
probably not ready to dispatch. -->

## Out of scope

<!-- What it must NOT touch. The agent is already refused the workflows, the
ruleset, the hooks, `.claude/` and `scripts/{review,security,hooks,docs,agent}`;
this is for the rest. -->
