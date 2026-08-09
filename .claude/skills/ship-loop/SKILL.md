---
name: ship-loop
description: Milestone-driven ship-readiness loop for the kp app. Maintains a 9-dimension scorecard + append-only backlog, batches items into user-gated milestones (CP checkpoints), executes with atomic commits, and certifies each milestone with the full verification gate. Resumable across sessions — all state lives in .claude/ship-loop/ at the repo root. Invoke with `/ship-loop` (resumes) or `/ship-loop boot` (fresh loop after archiving prior state).
category: Development
memory: none
version: 1.0
---

# Ship Loop — milestone-driven ship readiness (kp)

A permanent loop that moves the app toward a user-defined **ship bar** through scored audits, user-gated milestone picks, and hard verification gates. Any session can resume it: the state files are the single source of truth, and this file is the procedure.

> Origin note: the loop ran Boot→M8 on kp during 2026-07 with no skill definition; the procedure was codified in the personas repo from this repo's precedent and is adopted back here. State stays where the kp loop always kept it: `.claude/ship-loop/`.

## State files (in `.claude/ship-loop/` at the repo root)

| File | Contract |
|---|---|
| `state.md` | Current truth: ship bar, scorecard, milestone status, harness notes. Rewrite freely; keep it one screen of load-bearing facts. |
| `backlog.md` | Item table `# / status / dimension / size / description`. **Numbering append-only — never renumber.** Statuses: ☐ todo · ◐ in progress · ☑ done · ✕ cut. |
| `journal.md` | Append-only, one line per event (item done w/ commit SHA, CP resolution, gate result, root-caused saga). Never edit past lines. |
| `decisions.md` | CP answers from the user + auto-decisions taken while AFK (each marked "pending user review at CPn"). |
| `value-case.md` | Dimension-9 (value & market) synthesis. Written once by the value lens, corrected only with code-verified evidence. |
| `archive-*/` | Frozen state of previous loops (different app or restarted loop). Read-only. |

## The 9 scorecard dimensions

1-Build · 2-Func(tionality) · 3-Tests · 4-UAT · 5-Billing & LLM value · 6-Sec(urity) · 7-UX · 8-Ops (CI/deploy/self-host) · 9-Value & market. Each is 🔴/🟡/🟢 on the scorecard in `state.md`. Dimensions 4 and 9 are run as **lenses** (audit passes that emit backlog items — `/uat` and the value lens), not fixed at boot.

## Phases

### Boot (`/ship-loop boot` — only for a fresh loop)
1. Archive any existing `.claude/ship-loop/` contents to `.claude/ship-loop/archive-<slug>/`.
2. Run the audit lenses (build health, functionality honesty vs docs, test coverage of load-bearing paths, security posture, ops/release path) → seed `backlog.md` + initial scorecard in `state.md`.
3. **CP0**: present scorecard + backlog to the user; ask for the ship bar, cadence, and first milestone scope. If AFK, record provisional picks in `decisions.md` and proceed on the least-destructive batch.

### Resume (default)
1. Read `state.md`, then `backlog.md` and the tail of `journal.md`. Do NOT re-audit what the scorecard already scores.
2. Reconcile against reality before proposing anything: `git status` + branch vs `main` — parallel CLI sessions ship commits outside the loop (it has happened repeatedly; see CP7). Backlog premises may have moved.
3. Continue: an in-flight milestone → keep executing; a completed one → run/finish its gate; gate green → next checkpoint.

### Checkpoint (CPn — before each milestone)
- Present: scorecard delta, recommended next milestone (a coherent batch of backlog items, usually 4-8 by theme), and any product decisions the work needs. One question at a time, single-keystroke answerable.
- **AFK protocol**: ask twice ~60s apart; if silent, record a provisional pick in `decisions.md` (least-destructive option, marked for re-ask), avoid boot-path/product-call edits while AFK, and never commit destructive changes on a provisional.

### Execute (milestone)
- One backlog item = one atomic commit, referenced by SHA in `journal.md`. Fan out parallel subagents only for disjoint paths.
- Respect foreign in-flight work (`git status` scan; stage only your paths). Defer any item whose files are another session's hot area — mark it in `backlog.md` with the reason, don't fight over files.
- Premise-check before executing: audits overstate, and parallel sessions close items out-of-band — verify the claim against current code first; correct the backlog item if the premise moved.

### Gate (after every milestone — certifies it)
1. `npx tsc --noEmit` · `npm run lint` (0 errors; the 373-warning baseline is out of scope) · `npm run test:unit` · `npm run test:python:gate` · `npm run build` — sequential (schemas:gen is shared).
2. UI touched → deterministic e2e (Playwright, key-gated specs stay out) and verify new surfaces in **both themes** (Studio Light + Spark Dark, per CLAUDE.md). Full `/uat` runs are backlog items (dimension 4), not per-milestone.
3. Test-only diffs may justified-skip e2e — record the justification.
4. Record the gate line in `journal.md`; flip milestone ☑ in `state.md`; update the scorecard.
5. **Run the gate before any push.** Parallel sessions pushing ungated commits to main is the loop's known failure mode (CI red all day at CP7).

### Wrap (session end)
Update `state.md` + journal (commit SHAs), leave no uncommitted work of the loop's own. The next session resumes from files alone.

## Invariants

- **User owns product calls.** Ship bar, scope narrowing, feature hide/delete, security trade-offs are CP questions — never auto-decided, only provisionally deferred.
- **Honesty over green.** A gate that passes while the claim is unverified is not done — distinguish "code-verified" from "subagent-claimed" in every journal line.
- **Lenses emit items, items get numbers, numbers never change.**

---

## Skill Reflection

After the run’s real work is done, reflect twice — autonomously, without asking the user. Be honest about volume: most runs produce NOTHING for lane 2. An empty reflection is a valid result; a forced lesson is pollution. Calibration: nothing (common) / one line (sometimes) / a lesson entry (occasionally) / a redesign proposal (rare).

Lane 1 — PROJECT learnings (what the next session in THIS repo needs): write via the MEMORY BLOCK contract if this prompt carries one, else append node lines to `.personas/memory-outbox.jsonl` per that contract. Project-specific insight only.

Lane 2 — METHOD learnings (what would improve THIS SKILL for every project):
1. If nothing generalizes beyond this repo, stop here.
2. Append an entry to `LESSONS.md` in this skill’s directory: `## <version-used> — <YYYY-MM-DD> — <project-name>` followed by `- ` bullets (create the file with a `# Lessons — <skill>` heading if absent). Record the version the run USED, not a bump target. Wrap a bullet in a `### Redesign proposal` sub-block when it argues for a methodic redesign you are NOT applying now.
3. Version bump — ONLY when you also edit SKILL.md to apply the improvement in the same change: minor (1.2 → 1.3) for a prompt/step refinement, major (1.x → 2.0) for a methodic redesign. Update the `version:` frontmatter field (add `version: 1.1` if the file had none — absent means 1.0). Never bump without an applied edit; never edit the method without a bump.
4. Sync ritual (only when you bumped): (a) commit the skill directory as a STANDALONE commit on the current branch — message `skill(<name>): v<new> — <one-line reason>` — containing nothing but this skill’s files; (b) copy the updated skill directory to `~/.claude/skills/<name>/` (overwrite) so sibling projects can adopt it. EXCEPTION: read `.personas/skill-registry.json` first — if the library already carries a HIGHER version than yours, do not overwrite it; keep your lesson in LESSONS.md and note the version conflict in the entry.

Sibling awareness: `.personas/skill-registry.json` (repo root, when present) lists this skill’s installed version, the workspace library version, and which sibling projects run it at which version with recent usage. Use it to judge whether a lesson is worth a bump (heavily-used siblings raise the bar for majors) and to notice you are BEHIND (library newer than yours → prefer recording the lesson over editing a stale method).
