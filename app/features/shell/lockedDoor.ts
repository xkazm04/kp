// The locked-door view model: what a seat meets when it arrives at a tab its
// capability set cannot open (navCapabilities.ts panelFor), from ANY door — a rail
// click, a g-chord, a ?tab= arrival from a checkout return or a shared link.
//
// A 403 rendered as a failed load names nothing; a greyed row with a tooltip names
// the lack but no way in. This names the capability, the people in this workspace
// who hold it (GET /api/me/capability-holders — at most 5, name/email/role only),
// and an Ask link that carries the exact deep link, so the person who can grant the
// access lands on the same tab.
//
// Pure (no React, no fetch) so node:test pins the states under LockedTabPanel.tsx.

import { isMemberRole, type Capability, type MemberRole } from "@/app/_lib/auth/roles";
import { tabHref, type WorkspaceTabId } from "./tabs";

export type Holder = { name: string | null; email: string | null; role: MemberRole };

export type LockedDoorView =
  | { kind: "loading"; needs: Capability }
  | { kind: "holders"; needs: Capability; holders: Holder[] }
  /** Nobody in this workspace holds it (a lone viewer seat, a team whose owner
   *  left). Said, never rendered as an empty list: the copy sends the reader to the
   *  workspace owner by role. */
  | { kind: "noHolders"; needs: Capability }
  /** The holders read failed. The capability is still named — the explanation
   *  never depends on the second fetch. */
  | { kind: "holdersUnknown"; needs: Capability };

/** `holders`: null while loading, "failed" when the read failed, else the list. */
export function lockedDoorView(input: { needs: Capability; holders: readonly Holder[] | "failed" | null }): LockedDoorView {
  const { needs, holders } = input;
  if (holders === null) return { kind: "loading", needs };
  if (holders === "failed") return { kind: "holdersUnknown", needs };
  if (holders.length === 0) return { kind: "noHolders", needs };
  return { kind: "holders", needs, holders: [...holders] };
}

export function holdersUrl(cap: Capability): string {
  return `/api/me/capability-holders?cap=${encodeURIComponent(cap)}`;
}

/** Validate the wire and keep ONLY the three display fields — whatever else a
 *  future server adds never reaches the panel's props. null = malformed. */
export function parseHolders(body: unknown): Holder[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { holders?: unknown }).holders;
  if (!Array.isArray(raw)) return null;
  const out: Holder[] = [];
  for (const h of raw) {
    if (!h || typeof h !== "object") continue;
    const r = h as Record<string, unknown>;
    if (!isMemberRole(r.role)) continue;
    out.push({
      name: typeof r.name === "string" ? r.name : null,
      email: typeof r.email === "string" ? r.email : null,
      role: r.role,
    });
  }
  return out;
}

// A deliberately plain address: anything that could smuggle a header or a second
// recipient into the mailto (?, &, #, whitespace, a comma) is refused, not escaped.
const PLAIN_EMAIL = /^[^\s@?&#,;<>"]+@[^\s@?&#,;<>"]+$/;

/** A mailto asking `holder` for access, whose body is the tab's own deep link
 *  (`origin` + tabHref). null when the holder has no usable address — the panel
 *  then renders no Ask button rather than a broken one. */
export function askHref(holder: Holder, tab: WorkspaceTabId, origin: string, subject: string): string | null {
  const email = holder.email?.trim();
  if (!email || !PLAIN_EMAIL.test(email)) return null;
  const link = `${origin}${tabHref(tab)}`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(link)}`;
}
