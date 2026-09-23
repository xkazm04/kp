// Recommended routing: join the Quality board's computed pick (llm-quality.ts
// `recommendForUseCase`) against what is pinned today (GET /api/llm/config rows)
// into the state a row shows and the exact PUT body its Pin button sends through
// `saveRoutingPin`. Pure, so node:test pins it without a DOM.
//
//   pinned                the effective pin (own row, else '*') already names the
//                         pick's bench target (provider AND model)
//   provider_unavailable  the pick's provider is not in the routing catalogue
//   pin_forbidden         the reader is KNOWN not to hold org:manage (the PUT's
//                         requireModelAdmin would answer MODEL_ADMIN_FORBIDDEN)
//   unmeasured_pin        the current pin's model is not on the scorecard, so the
//                         board cannot compare it; the pick is still pinnable
//   pin_available         a different, measured (or default) pin; one click re-pins
//
// Capability UNKNOWN (null: the read has not landed, or failed) fails open, the
// shell's own rule (app/features/shell/useCapabilities.ts): the server refuses
// regardless, and hiding an owner's button over a blipped GET is the worse failure.

import type { LlmConfigRow } from "@/app/_lib/db/llm";
import type { UseCaseRecommendation } from "@/app/_lib/llm-quality";

export const PICK_ROW_STATES = [
  "pinned",
  "pin_available",
  "unmeasured_pin",
  "pin_forbidden",
  "provider_unavailable",
] as const;
export type PickRowState = (typeof PICK_ROW_STATES)[number];

export type PickRowContext = {
  /** QUALITY_SCORES.models - the slugs the board can compare a pin against */
  measuredModels: readonly string[];
  /** does the reader hold org:manage? null = unknown (fails open) */
  canPin: boolean | null;
};

type PinRow = Pick<LlmConfigRow, "useCase" | "provider" | "model" | "params" | "updatedAt">;

const ownRow = (useCase: string, rows: readonly PinRow[]) => rows.find((r) => r.useCase === useCase) ?? null;

/** The pin a use case actually runs under: its own row, else the '*' catch-all. */
const effectiveRow = (useCase: string, rows: readonly PinRow[]) =>
  ownRow(useCase, rows) ?? rows.find((r) => r.useCase === "*") ?? null;

export function pickRowState(
  useCase: string,
  rec: UseCaseRecommendation,
  rows: readonly PinRow[],
  providers: readonly string[],
  ctx: PickRowContext
): PickRowState {
  const target = rec.pick.target;
  const pin = effectiveRow(useCase, rows);
  if (target && pin && pin.provider === target.provider && pin.model === target.model) return "pinned";
  if (!target || !providers.includes(target.provider)) return "provider_unavailable";
  if (ctx.canPin === false) return "pin_forbidden";
  if (pin?.model && !ctx.measuredModels.includes(pin.model)) return "unmeasured_pin";
  return "pin_available";
}

export type PinPayload = {
  useCase: string;
  provider: string;
  model: string;
  params: Record<string, unknown>;
  /** the OWN row's updatedAt, or null when this use case has no row of its own - the
   *  PUT then creates one, so a '*' catch-all's version is not this row's version */
  expectedUpdatedAt: string | null;
};

/** The PUT body for pinning the pick. Null when the bake named no target. Params
 *  pass through from the own row so a one-click pin never drops maxTokens/timeoutS. */
export function pinPayload(useCase: string, rec: UseCaseRecommendation, rows: readonly PinRow[]): PinPayload | null {
  const target = rec.pick.target;
  if (!target) return null;
  const own = ownRow(useCase, rows);
  return {
    useCase,
    provider: target.provider,
    model: target.model,
    params: own?.params ?? {},
    expectedUpdatedAt: own?.updatedAt ?? null,
  };
}
