// The credential card's data -> parts mapping, the PURE half of the kit view (Gate 2, kit-unification).
//
// page.tsx stays the server page: it rate-limits, verifies the signature, resolves the trust state and
// formats the date, then hands this view a plain, serializable `SkillKitCard` (no refetch). What the kit
// view adds is only which part each fact lands in, decided here where node:test can reach it
// (skillKitModel.test.ts). No `@/` alias and type-only imports: the unit runner resolves neither.
import type { MarkKind } from "../../../_components/kit/types.ts";

/** The trust states of app/_lib/skill-profile.ts (SkillProfileCardState), plus the page's throttle. */
export type SkillKitState = "verified" | "revoked" | "tampered" | "incomplete" | "unverifiable" | "stale";

export type SkillKitCard =
  | { kind: "throttled" }
  | {
      kind: "card";
      state: SkillKitState;
      /** skillProfileShowsScoreCard(state), decided server-side (the one gate on showing numbers). */
      showsScores: boolean;
      transferScore: number;
      confidencePct: number;
      /** Formatted server-side in the reader's locale. */
      issued: string;
      version: string;
      /** Why a stale credential is stale (only read when state === "stale"). */
      staleReason: "age" | "methodology" | null;
      /** Axis name as stored, its localized label (resolved server-side), its 0..100 score. */
      axes: { name: string; label: string; score: number }[];
    };

/** The verdict line: the mark whose SHAPE carries the trust state, the badge copy, and the body copy
 *  a withheld state owes the reader. Today's colours map one to one: green = ok, amber = caution,
 *  red = fail, the three stone (neutral) states = unknown, so revoked and unverifiable never read as
 *  an accusation of forgery. */
export type SkillVerdict = {
  mark: MarkKind;
  label: SkillKitState;
  body: "revokedBody" | "tamperedBody" | "unverifiableBody" | null;
};

export function skillVerdict(state: SkillKitState): SkillVerdict {
  switch (state) {
    case "verified":
      return { mark: "ok", label: state, body: null };
    case "stale":
      return { mark: "caution", label: state, body: null };
    case "tampered":
      return { mark: "fail", label: state, body: "tamperedBody" };
    case "revoked":
      return { mark: "unknown", label: state, body: "revokedBody" };
    case "unverifiable":
      return { mark: "unknown", label: state, body: "unverifiableBody" };
    case "incomplete":
      return { mark: "unknown", label: state, body: null };
  }
}

/** What fills the letter under the verdict: the scores (trusted states only), the "issued without a
 *  summary" block (incomplete only, the one state it is true of), or nothing. */
export function skillBody(card: Extract<SkillKitCard, { kind: "card" }>): "scores" | "summary" | "none" {
  if (card.showsScores) return "scores";
  return card.state === "incomplete" ? "summary" : "none";
}

/** The stale note's copy key: why the genuine credential is not current. */
export function skillStaleKey(card: Extract<SkillKitCard, { kind: "card" }>): "staleMethodology" | "staleAge" | null {
  if (card.state !== "stale") return null;
  return card.staleReason === "methodology" ? "staleMethodology" : "staleAge";
}

/** The two headline figures, rounded the way today's card prints them. */
export function skillFigures(card: Extract<SkillKitCard, { kind: "card" }>): { transfer: number; confidencePct: number } {
  return { transfer: Math.round(card.transferScore), confidencePct: card.confidencePct };
}
