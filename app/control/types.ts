import type { CalibrationRationale } from "@/app/_lib/dev-outcomes";

// The shapes `/api/devcase/control` and `/api/devcase/outcomes` answer with, shared
// by the control room shell and its four panels. Type-only, so nothing here pulls the
// server-side outcome store into the client bundle.

export type Audit = { id: number; lifecycleId: string | null; actor: string; action: string; reason: string | null; createdAt: string };
export type LC = { id: string; title: string | null; stage: string; detail: string | null };
export type Gate = { id: string; title: string | null; detail: string | null };
export type Status = { autonomy: "on" | "paused"; lifecycles: LC[]; pendingGates: Gate[]; audit: Audit[] };

export type Outcome = { id: number; ref: string | null; candidateRef: string | null; predictedScore: number | null; outcome: string; performance: number | null; note: string | null; recordedAt: string };
export type CalBand = { label: string; lo: number; count: number; hireRate: number | null; meanPerformance: number | null };
export type Calibration = { resolved: number; bands: CalBand[]; predictive: boolean | null; currentFloor: number; suggestedFloor: number | null; rationale: CalibrationRationale };
export type OutcomeData = { outcomes: Outcome[]; calibration: Calibration; activeFloor: number };

// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #3): the two-step confirm the
// shell owns. A panel arms a consequential control by key and runs it on the second
// click of the SAME control; the shell keeps the single `armed` key so arming one
// control disarms every other.
export type Guard = (key: string, run: () => void | Promise<void>) => void;
