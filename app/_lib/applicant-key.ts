import { createHash } from "node:crypto";
import { normalizeApplicantName, normalizeContact } from "./apply-intake";

// The filing identity behind pipeline_entries.applicant_key (partial UNIQUE on
// workspace, job, key). It replaced applyDedupeKey, which put the email IN CLEAR into
// the entry's primary key. A domain-separated sha256: pseudonymous, not anonymous, so
// erasure NULLs it. Server-only (node:crypto); apply-intake.ts stays client-importable.

/** The applicant's dedupe identity: the email when one was given (the stronger
 *  identity), else the provided name; "" for an anonymous, address-less applicant,
 *  who is never deduped. Casing and spacing variants of one applicant agree. */
export function applicantKey(name: string, email?: string | null): string {
  const e = normalizeContact(email);
  if (e) return digest("email", e);
  const n = normalizeApplicantName(name);
  return n ? digest("name", n) : "";
}

function digest(kind: "email" | "name", value: string): string {
  return createHash("sha256").update(`kp-applicant-key:v1:${kind}:${value}`).digest("hex");
}
