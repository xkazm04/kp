import type { RefusalErrorCode } from "./api-response";

// The throwable half of the refusal vocabulary (docs/architecture/api-contracts.md §1.1).
// A lib module that DECIDES a failure throws a Refusal carrying code + status; the route
// answers it with `answerFailure(err, route, storeCode)` (api-response.ts), which sends
// `jsonRefusal` for a Refusal and `safeJsonError` for anything else.
//
// Pure on purpose: the one import is a type, so any store or engine module can throw a
// Refusal without pulling NextResponse — and the default `.message` is the code, because
// the REFUSAL_ERRORS catalog lives beside NextResponse. A class that carries a refusal
// code extends Refusal; the tree guard in refusal.test.ts turns a new fork red.

/** The brand answerFailure recognises. A registry symbol, so api-response.ts can check it
 *  without importing this module — every route imports api-response, and a runtime import
 *  there would put this file on every route's graph (perf-budget.json). */
export const REFUSAL_BRAND = Symbol.for("kp.refusal");

export type RefusalOptions = {
  /** Operator detail: becomes `.message`, logged at info level, never on the wire. */
  detail?: string;
  /** DATA the client's localized sentence needs, sent beside the code. */
  extra?: Record<string, unknown>;
};

export class Refusal extends Error {
  readonly [REFUSAL_BRAND] = true;
  readonly code: RefusalErrorCode;
  readonly status: number;
  readonly detail?: string;
  readonly extra?: Record<string, unknown>;
  constructor(code: RefusalErrorCode, status: number, options: RefusalOptions = {}) {
    super(options.detail ?? code);
    this.name = "Refusal";
    this.code = code;
    this.status = status;
    this.detail = options.detail;
    this.extra = options.extra;
  }
}
