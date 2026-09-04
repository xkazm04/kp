// Shared note/editor-state shapes for ProfileTab.tsx and its split-out hook/modal.
import type { ProfilePayload } from "@/app/features/shared/profileTypes";
import type { EditorMode } from "./ProfileEditor";

// A note's tone picks its color + a11y role from the mapped status shades (all
// present in the dark ramp). No new primitive — the same red-50/red-700 pattern
// the app already uses, extended with the info (blue) and success (green) mates.
export type NoteTone = "info" | "success" | "error";
export const NOTE_TONE: Record<NoteTone, string> = {
  info: "bg-blue-50 text-blue-700",
  success: "bg-green-50 text-green-800",
  error: "bg-red-50 text-red-700",
};

export type EditorState = {
  mode: EditorMode;
  editingId: string | null;
  initialPayload: ProfilePayload | null;
  // The row's `updated_at` when this editor opened. Rides into the PUT as
  // `expectedUpdatedAt` so a save is refused rather than overwriting a newer version.
  initialUpdatedAt?: string | null;
  // Set when the editor was opened FROM a saved CV analysis (build-from-analysis or
  // rebuild-from-latest) — carried into the save so lineage is stamped.
  sourceAnalysisSlug?: string | null;
  // Bumped on every open. The editor is keyed on it, so re-opening the SAME profile
  // (the answer to a refused stale save) genuinely remounts with the fresh payload
  // instead of keeping the state it was built with.
  nonce?: number;
};

export type RebuildWarn = { slug: string; profileId: string; editedAt: string | null; updatedAt?: string | null };

/** The remount identity of an editor session: mode + row + open. */
export function editorKey(editor: EditorState): string {
  return `${editor.mode}:${editor.editingId ?? "new"}:${editor.nonce ?? 0}`;
}
