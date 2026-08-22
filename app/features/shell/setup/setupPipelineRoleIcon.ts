// One glyph per stage ROLE, so a column's picture and its sentence come from the
// same fact.
//
// Keyed by role and not by stage id on purpose: ids are per-workspace data (a
// renamed or hand-added column has an id nothing else knows), while the seven roles
// are the closed vocabulary the product reasons about (decision-config-schema.ts).
// A column the operator invents therefore still gets a truthful glyph — `custom`,
// the puzzle piece — instead of falling through to a blank.
//
// Hoisted the moment the second read-only view wanted it (the /prototype rule):
// the journey and the board preview must not drift into two icon sets for one
// vocabulary.
import { BadgeCheck, Gauge, Handshake, Inbox, MessagesSquare, Puzzle, ScanSearch, type LucideIcon } from "lucide-react";

const ROLE_ICONS: Record<string, LucideIcon> = {
  entry: Inbox,
  screening: ScanSearch,
  interview: MessagesSquare,
  scoring: Gauge,
  offer: Handshake,
  terminal: BadgeCheck,
  custom: Puzzle,
};

/** The glyph for a stage role, falling back to `custom` for any role this build
 *  hasn't met — a forward-compatible axis renders, it doesn't gap. */
export function stageRoleIcon(role: string): LucideIcon {
  return ROLE_ICONS[role] ?? Puzzle;
}
