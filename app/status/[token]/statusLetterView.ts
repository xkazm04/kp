// The candidate's feedback-letter card, as pure rules (spark interview-feedback-letter,
// WP-beta): which state of the letter shows which copy, and how the request door's answer
// folds back into the view. React-free so statusLetterView.test.ts pins every branch a
// candidate can land on.
//
// THE PROMISE THE CARD MAKES is only what the record and the deployment can keep:
//   * a person reviews the letter before it is sent — true by construction (only a human
//     approve sends; interview-letters.ts refuses any other actor);
//   * "we will email you" only when a delivery relay exists (REC-10, the page's existing
//     rule) — otherwise "it will appear on this page";
//   * and, whichever it is, that a decision NOT to send is also said here, so a decline
//     is never silence (the page is the one channel a decline always reaches).

import type { CandidateLetterView } from "@/app/_lib/interview-letter-types";

export type StatusLetterPhase = "hidden" | "offer" | "requested" | "preparing" | "sent" | "declined";

/** Which state the card is in. `hidden` = nothing to say: no letter and no right to ask
 *  (including every consent-withheld page, whose view is blank by construction). */
export function statusLetterPhase(view: CandidateLetterView | null | undefined): StatusLetterPhase {
  if (!view) return "hidden";
  switch (view.state) {
    case "requested":
      return "requested";
    case "drafted":
      // A draft exists and a person has it. To the candidate that is "being prepared":
      // the draft itself never crosses onto this page.
      return "preparing";
    case "sent":
      // The projection carries the text only once sent; a sent state with no text is not
      // a letter anyone can read here, and the card says nothing rather than something
      // empty.
      return view.text ? "sent" : "hidden";
    case "declined":
      return "declined";
    default:
      return view.canRequest ? "offer" : "hidden";
  }
}

/** The catalog keys (under `status`) the card renders for a phase: the body line, and the
 *  follow-up line that says how the answer will arrive. */
export type StatusLetterCopyKey =
  | "letter.offer"
  | "letter.requested"
  | "letter.preparing"
  | "letter.sentIntro"
  | "letter.declined"
  | "letter.whenReadyEmail"
  | "letter.whenReadyPage";

export function statusLetterCopy(
  phase: StatusLetterPhase,
  relayConfigured: boolean | undefined
): { body: StatusLetterCopyKey | null; followUp: StatusLetterCopyKey | null } {
  // The page's own reading of the flag (StatusClient `emailPromised`): only an explicit
  // `false` withholds the email promise.
  const followUp: StatusLetterCopyKey = relayConfigured === false ? "letter.whenReadyPage" : "letter.whenReadyEmail";
  switch (phase) {
    case "offer":
      return { body: "letter.offer", followUp: null };
    case "requested":
      return { body: "letter.requested", followUp };
    case "preparing":
      return { body: "letter.preparing", followUp };
    case "sent":
      return { body: "letter.sentIntro", followUp: null };
    case "declined":
      return { body: "letter.declined", followUp: null };
    default:
      return { body: null, followUp: null };
  }
}

export type LetterRequestOutcome =
  /** The door answered with the letter's state (a new request, or the one already made):
   *  the card shows that state. */
  | { kind: "letter"; letter: CandidateLetterView }
  /** Not available for this application: the button goes, and the card says so once. */
  | { kind: "not_eligible"; code: string }
  /** Did not land: say so, keep the button. `code` null when no answer arrived at all. */
  | { kind: "failed"; code: string | null };

function isLetterView(value: unknown): value is CandidateLetterView {
  const v = value as Partial<CandidateLetterView> | null;
  return !!v && typeof v === "object" && typeof v.canRequest === "boolean" && "state" in v;
}

/** Fold the request door's answer (POST /api/status/[token]/letter). A repeated click is
 *  answered 409 STATUS_LETTER_ALREADY_REQUESTED WITH the existing letter's state, which is
 *  exactly as good as a 200 to the candidate: they see where their one request stands. */
export function foldLetterRequest(res: { ok: boolean; status: number } | null, body: unknown): LetterRequestOutcome {
  const b = (body && typeof body === "object" ? body : {}) as { letter?: unknown; code?: unknown };
  if (res && isLetterView(b.letter) && (res.ok || b.code === "STATUS_LETTER_ALREADY_REQUESTED")) {
    return { kind: "letter", letter: b.letter };
  }
  const code = typeof b.code === "string" ? b.code : null;
  if (res && code === "STATUS_LETTER_NOT_ELIGIBLE") return { kind: "not_eligible", code };
  return { kind: "failed", code };
}
