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
//   superseded_pin        the current pin is a NEWER release of a family the grid
//                         measured (claude-sonnet-5-5 against a claude-sonnet-5
//                         cell): the grid predates the engine that runs today, so
//                         it cannot rank the pick against it, and no Pin button
//                         offers to move the use case back onto an older release.
//                         Re-bench, then re-bake.
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
  "superseded_pin",
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
  if (pin?.model && !ctx.measuredModels.includes(pin.model)) {
    return supersededBy(pin.model, ctx.measuredModels) ? "superseded_pin" : "unmeasured_pin";
  }
  return "pin_available";
}

// A model id read as family + release: the non-numeric tokens are the family
// ("claude-sonnet", "gemini-flash"), the version tokens the release ("5-5" -> [5, 5],
// "3.6" -> [3, 6], "v4" -> [4]). A token of six or more digits is a dated snapshot,
// not a release number, so it is in neither.
const VERSION_TOKEN = /^v?\d+(\.\d+)*$/;
function familyRelease(model: string): { family: string; release: number[] } {
  const family: string[] = [];
  const release: number[] = [];
  for (const token of model.toLowerCase().split("-")) {
    if (!VERSION_TOKEN.test(token)) family.push(token);
    else if (token.replace(/^v/, "").length < 6) release.push(...token.replace(/^v/, "").split(".").map(Number));
  }
  return { family: family.join("-"), release };
}

function newerRelease(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** The measured model the pin supersedes: same family, older release. Null when the
 *  grid never measured the pin's family, or measured only the same or a newer release. */
export function supersededBy(pinModel: string, measuredModels: readonly string[]): string | null {
  const pin = familyRelease(pinModel);
  if (!pin.release.length) return null;
  for (const measured of measuredModels) {
    const m = familyRelease(measured);
    if (m.family === pin.family && newerRelease(pin.release, m.release)) return measured;
  }
  return null;
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
