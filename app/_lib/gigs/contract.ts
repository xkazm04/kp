import {
  GIG_ARTIFACT_KINDS,
  GIG_DELIVERABLE_CONTRACT,
  GIG_DELIVERABLE_FENCE,
  GIG_EVIDENCE_KINDS,
} from "./types";

// The deliverable contract as the SPECIALIST reads it - one text, rendered into two places:
//
//   - the specialist's system prompt (specialist.ts), and
//   - DELIVERABLE-CONTRACT.md in every gig folder (workdir.ts), which kp owns and rewrites
//     on every prepare.
//
// Why the folder copy exists (found by the 2026-09-25 dry run): Personas' autonomous build
// gives a hired persona its own structured prompt, and when one exists the runner renders
// THAT instead of the system prompt kp sent - so kp's contract never reached the run, and
// Personas appends its own output protocol after the model's last words, so "end with the
// fenced block, nothing after it" could not hold either. The contract therefore travels
// with the WORK: the run executes in the gig folder, reads this file there, and writes the
// deliverable to `kp-deliverable.json` at the folder root, which sync.ts reads when the
// output carries no block.
//
// Pure and dependency-light on purpose: workdir.ts renders it without pulling the
// specialist/hire graph.

/** The file at the gig folder ROOT the specialist writes its deliverable object to. Not
 *  under deliverable/ - that folder is what the client receives. */
export const GIG_DELIVERABLE_FILE = "kp-deliverable.json";

/** The kp-owned contract file in every gig folder (rewritten on each prepare). */
export const GIG_CONTRACT_FILE = "DELIVERABLE-CONTRACT.md";

/** The disclosure sentence every deliverable must carry (the specialist may adapt the
 *  wording to the venue, never drop it). */
export const GIG_DISCLOSURE_SENTENCE =
  "This work was prepared with the assistance of an AI agent and reviewed by me before sending.";

/** The contract section, Markdown. `heading` is the level-2 title line. */
export function gigDeliverableContractMarkdown(): string {
  const example = {
    version: 1,
    summary: "One paragraph: what you did and what the operator should check first.",
    draftText: "The full text the operator would send.",
    artifacts: [{ kind: "file", ref: "deliverable/report.md", title: "What this artifact is" }],
    evidence: [{ kind: "test", command: "the command you ran", result: "what it printed", passed: true }],
    disclosure: GIG_DISCLOSURE_SENTENCE,
    confidence: 0.6,
    questions: ["Anything you could not resolve and need the operator to answer."],
  };
  return [
    `## Deliverable contract (${GIG_DELIVERABLE_CONTRACT})`,
    `Every run ends by writing ONE JSON object of exactly this shape to \`${GIG_DELIVERABLE_FILE}\` in the gig folder ROOT (not under \`deliverable/\`, which is what the client receives). Overwrite the file if an earlier attempt left one. Then also end your final message with the same object in one fenced block tagged \`${GIG_DELIVERABLE_FENCE}\`; if your runtime adds its own messages after it, the file is what counts.`,
    "```" + GIG_DELIVERABLE_FENCE,
    JSON.stringify(example, null, 2),
    "```",
    "- Use exactly these keys. `version` is the number 1. `summary`, `draftText` and `disclosure` are required non-empty strings; `confidence` is a number; `artifacts`, `evidence` and `questions` are arrays (empty when you have none).",
    `- artifacts[].kind is one of: ${GIG_ARTIFACT_KINDS.join(", ")}; a file you wrote is kind \`file\` with \`ref\` its path relative to the gig folder. evidence[].kind is one of: ${GIG_EVIDENCE_KINDS.join(", ")}.`,
    "- evidence lists only what you actually ran; `passed` is null when the result has no pass/fail meaning.",
    "- confidence is your own estimate from 0 to 1; it is shown to the operator, never used as a score.",
    "- If you cannot produce acceptable work, still write the object: say why in `summary`, put your questions in `questions`, and keep confidence low.",
  ].join("\n");
}

/** DELIVERABLE-CONTRACT.md's full content. */
export function gigContractFileMarkdown(): string {
  return [
    "# Deliverable contract",
    "",
    "_Written by kp for every run in this gig folder, and rewritten whenever kp prepares the gig. Do not edit: your edits are overwritten._",
    "",
    gigDeliverableContractMarkdown(),
    "",
  ].join("\n");
}
