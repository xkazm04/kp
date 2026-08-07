/*
 * Pure colour resolution for the Market Pulse charts. Kept out of the .tsx parts
 * module (and free of React / next-intl) so it is unit-testable under the bare
 * `node --test` runner, and so the two DISTINCT colour scales can never be
 * confused for one another again:
 *
 *   • familyColor(family) — colour-keys a role FAMILY by its taxonomy position.
 *   • orgColor(org)       — colours an EMPLOYER type (private / public / agency).
 *
 * The bug this split fixes (landing-marketing #3): `JdCard` coloured its sector
 * label with `familyColor(item.orgType)`, but an org key is never in
 * `FAMILY_ORDER`, so `indexOf` returned -1, the `Math.max(0, …)` clamp forced
 * index 0, and EVERY card rendered `FAMILY_COLORS[0]` = CORAL (which in `OrgSplit`
 * specifically signals "private"). Narrowing `familyColor` to `FamilyKey` turns
 * that mismatched call site into a compile error, and `orgColor` is the correct,
 * distinct-per-sector scale that `JdCard` and `OrgSplit` now share.
 */
import { CORAL, MOSS, AMBER, STEEL } from "../tokens";
import { FAMILY_ORDER, type FamilyKey, type OrgKey } from "./data";

/** The 4-colour set families cycle through, in taxonomy order. */
export const FAMILY_COLORS = [CORAL, MOSS, AMBER, STEEL];

/** Colour-key a role family by its taxonomy position (cycles the 4-colour set).
 *  Typed to `FamilyKey` on purpose: an org key (`private`/…) is a type error here,
 *  which is what made the old all-CORAL bug silent. */
export function familyColor(family: FamilyKey): string {
  const i = Math.max(0, (FAMILY_ORDER as readonly string[]).indexOf(family));
  return FAMILY_COLORS[i % FAMILY_COLORS.length];
}

/** Distinct per-sector colours — the single source of truth for org-type
 *  colouring, shared by `OrgSplit` and `JdCard`. */
export const ORG_COLORS: Record<OrgKey, string> = {
  private: CORAL,
  public: STEEL,
  agency: AMBER,
};

/** Colour an employer / org type. Unlike a family lookup these are three fixed,
 *  distinct hues — never the accidental all-CORAL the family scale produced. */
export function orgColor(org: OrgKey): string {
  return ORG_COLORS[org];
}
