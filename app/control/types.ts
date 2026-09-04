import type { CalibrationRationale, OutcomeSource } from "@/app/_lib/dev-outcomes";

// The shapes `/api/devcase/control` and `/api/devcase/outcomes` answer with, shared
// by the control room shell and its four panels. Type-only, so nothing here pulls the
// server-side outcome store into the client bundle.

export type Audit = { id: number; lifecycleId: string | null; actor: string; action: string; reason: string | null; createdAt: string };
export type LC = { id: string; title: string | null; stage: string; detail: string | null };
export type Gate = { id: string; title: string | null; detail: string | null };
export type Status = { autonomy: "on" | "paused"; lifecycles: LC[]; pendingGates: Gate[]; audit: Audit[] };

// `source` is the row's PROVENANCE, and it is what the panel branches on. It used to
// branch on `note.startsWith("auto-recorded")` — an English sentence the store persisted,
// treated as an enum and printed verbatim to a reader in any of the four locales.
export type Outcome = { id: number; ref: string | null; candidateRef: string | null; predictedScore: number | null; outcome: string; performance: number | null; note: string | null; source: OutcomeSource; recordedAt: string };
export type CalBand = { label: string; lo: number; count: number; hireRate: number | null; meanPerformance: number | null };
// `resolvedOf` is the scan cap when calibrate() actually hit it (else null): `resolved`
// then describes the newest N rows, not the whole corpus, and the panel says so.
export type Calibration = { resolved: number; resolvedOf: number | null; bands: CalBand[]; predictive: boolean | null; currentFloor: number; suggestedFloor: number | null; rationale: CalibrationRationale };
export type OutcomeData = { outcomes: Outcome[]; calibration: Calibration; activeFloor: number };

// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #3): the two-step confirm the
// shell owns. A panel arms a consequential control by key and runs it on the second
// click of the SAME control; the shell keeps the single `armed` key so arming one
// control disarms every other.
export type Guard = (key: string, run: () => void | Promise<void>) => void;
