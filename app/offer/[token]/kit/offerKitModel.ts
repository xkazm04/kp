// The offer letter's data -> parts mapping, the PURE half of the kit view (Gate 2, kit-unification).
//
// OfferKitView renders the SAME state OfferClient owns (the load, the revalidation, the one
// in-flight accept/decline guard and the decline confirm all stay in OfferClient and are shared by
// both views); what the kit view adds is only which part each fact lands in. That choice lives here,
// where node:test can reach it: offerKitModel.test.ts.
//
// No `@/` alias and type-only imports: the unit runner resolves neither.

/** The fields of GET /api/offer/[token]'s projection this view reads (OfferClient's OfferView). */
export type OfferKitInput = {
  company: string | null;
  jobTitle: string | null;
  candidateLabel: string | null;
  currency: string | null;
  salary: number | null;
  notes: string | null;
  startDate: string | null;
  expiresAt: string | null;
  hoursRemaining: number | null;
  minutesRemaining: number | null;
};

/** What the lower half of the letter shows: the decision, or one of the three terminal outcomes. */
export type OfferKitPhase = "decide" | "accepted" | "declined" | "expired";

export function offerKitPhase(result: "accepted" | "declined" | "expired" | null): OfferKitPhase {
  return result ?? "decide";
}

/** The letter head: the company rides in the eyebrow (today's monogram header), the role is the h1. */
export type OfferKitHead = { company: string | null; title: { key: "jobTitle"; text: string } | { key: "roleAt"; company: string } | { key: "roleGeneric" }; preparedFor: string | null };

export function offerKitHead(o: OfferKitInput): OfferKitHead {
  const title: OfferKitHead["title"] = o.jobTitle
    ? { key: "jobTitle", text: o.jobTitle }
    : o.company
      ? { key: "roleAt", company: o.company }
      : { key: "roleGeneric" };
  return { company: o.company || null, title, preparedFor: o.candidateLabel || null };
}

/** The terms strip and the notes block. Same presence rules as today's card: a blank note or start
 *  date is omitted, a null salary is omitted, and the currency is never invented. */
export type OfferKitTerms = {
  salary: { value: number; unit: string | null } | null;
  /** The raw stored start date (the view formats it with useDateFormat, falling back to the raw). */
  startDate: string | null;
  notes: string | null;
};

export function offerKitTerms(o: OfferKitInput): OfferKitTerms {
  return {
    salary: o.salary != null ? { value: o.salary, unit: o.currency || null } : null,
    startDate: o.startDate?.trim() || null,
    notes: o.notes?.trim() || null,
  };
}

/** The deadline line under the prompt: shown only with a server-computed hours figure AND a
 *  deadline; coral inside the final 48h; minutes inside the final hour. */
export type OfferKitDeadline = { urgent: boolean; unit: "minutes"; minutes: number } | { urgent: boolean; unit: "hours"; hours: number };

export function offerKitDeadline(o: Pick<OfferKitInput, "expiresAt" | "hoursRemaining" | "minutesRemaining">): OfferKitDeadline | null {
  const hrs = o.hoursRemaining;
  if (hrs === null || !o.expiresAt) return null;
  const urgent = hrs <= 48;
  const mins = o.minutesRemaining;
  return mins !== null && mins <= 60 ? { urgent, unit: "minutes", minutes: mins } : { urgent, unit: "hours", hours: hrs };
}
