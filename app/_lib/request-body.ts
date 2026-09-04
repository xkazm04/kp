// Read a request body as text under a HARD byte budget, ABORTING the stream the
// moment accumulated bytes exceed `maxBytes`. The `content-length` header is advisory
// only — a caller can omit it (chunked transfer) or lie (declare 10, stream 50 MB) —
// so the real cap must be measured on the bytes actually read off the wire, not on an
// attacker-controlled header. Returns `null` when the budget is exceeded (the caller
// maps that to 413) and the empty string for an absent body. Used by public,
// token-only endpoints where an unbounded body is a memory-pressure / DoS vector.
/** Anything with a byte stream to read under a budget. Written structurally rather
 *  than as `Request` because the *outbound* side needs the same cap: a `Response`
 *  from a bridge kp dials is as unbounded as a request body off the network, and one
 *  reader with one set of tests beats two that drift (see `agent-hire/bridge-client`). */
export type BoundedBodySource = { body: Request["body"] };

export async function readTextWithLimit(source: BoundedBodySource, maxBytes: number): Promise<string | null> {
  const body = source.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Returned by `readJsonWithLimit` when the body exceeded its budget — a value no
 *  request body can produce, so a route cannot confuse "too large" with "the caller
 *  legitimately sent that". Compare with `===` and answer 413. */
export const BODY_TOO_LARGE: unique symbol = Symbol("kp.body-too-large");

/**
 * `readTextWithLimit` + `JSON.parse`, which is what every public JSON door actually
 * wants. Written as one helper because the alternative is six lines repeated across
 * twenty routes, and the line that gets dropped in the twenty-first is always the cap.
 *
 * Three outcomes, all of them deliberate:
 *   • over budget → `BODY_TOO_LARGE`, and the route answers 413 with the cap as data.
 *   • absent / not JSON → `fallback`. A malformed body is NOT a distinct answer here:
 *     every one of these routes already validates the shape it needs and refuses with
 *     a specific code, so a parse error and an empty object reach the same refusal —
 *     and a candidate mid-application must never meet a parser message.
 *   • otherwise → the parsed value, cast to the route's own body type.
 *
 * The `content-length` header is checked first as a cheap early-out ONLY. It is
 * advisory — a caller can omit it (chunked) or lie — so the real cap is the one
 * `readTextWithLimit` measures on the bytes actually read off the wire.
 */
export async function readJsonWithLimit<T>(
  request: Request,
  maxBytes: number,
  fallback: T
): Promise<T | typeof BODY_TOO_LARGE> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return BODY_TOO_LARGE;
  const raw = await readTextWithLimit(request, maxBytes);
  if (raw === null) return BODY_TOO_LARGE;
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    // `JSON.parse("null")` is valid and yields null; a route asking for an object
    // shape must not then read properties off it.
    return (parsed ?? fallback) as T;
  } catch {
    // Not JSON at all — the same caller mistake as an absent body, answered by the
    // route's own shape refusal rather than by a parser message.
    return fallback;
  }
}
