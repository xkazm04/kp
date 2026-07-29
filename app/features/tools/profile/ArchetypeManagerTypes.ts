// Shared draft/slot types for ArchetypeManager and its view/edit panels.
export type Slot = "skills" | "career" | "personal";
export const SLOTS: Slot[] = ["skills", "career", "personal"];

export type Draft = {
  id: string;
  label: string;
  badge: string;
  applyLabel: string;
  scoringModel: string;
  fairnessProtected: boolean;
  pct: Record<Slot, number>; // weights as whole-number percentages
  dim: Record<Slot, string>;
};
