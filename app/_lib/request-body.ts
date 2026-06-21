// Read a request body as text under a HARD byte budget, ABORTING the stream the
// moment accumulated bytes exceed `maxBytes`. The `content-length` header is advisory
// only — a caller can omit it (chunked transfer) or lie (declare 10, stream 50 MB) —
// so the real cap must be measured on the bytes actually read off the wire, not on an
// attacker-controlled header. Returns `null` when the budget is exceeded (the caller
// maps that to 413) and the empty string for an absent body. Used by public,
// token-only endpoints where an unbounded body is a memory-pressure / DoS vector.
export async function readTextWithLimit(request: Request, maxBytes: number): Promise<string | null> {
  const body = request.body;
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
