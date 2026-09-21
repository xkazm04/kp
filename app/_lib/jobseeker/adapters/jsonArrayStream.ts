// An incremental reader of a JSON ARRAY of objects from a byte stream, item by item,
// without ever holding the file. Written for the MPSV bulk vacancy file (~184 MB):
// `response.body` is iterated, each complete top-level element is JSON.parsed on
// its own and yielded, and the buffer is trimmed behind it. Bracket depth is tracked
// outside of strings, with escapes honoured, so a `]` inside a description never
// closes the array. No dependency — the grammar needed here is one loop.

export type JsonArrayStreamOptions = {
  /** Stop after this many items (the consumer's own cap; the stream is cancelled). */
  maxItems?: number;
  /** Refuse an element larger than this many characters (a malformed file, not a posting). */
  maxItemChars?: number;
  /** Where the array lives when the root is an OBJECT: the key whose value is the array. */
  arrayKey?: string | null;
};

const DEFAULT_MAX_ITEM_CHARS = 512 * 1024;

export async function* readJsonArrayStream(
  stream: ReadableStream<Uint8Array>,
  opts: JsonArrayStreamOptions = {}
): AsyncGenerator<unknown, void, undefined> {
  const maxItems = opts.maxItems ?? Infinity;
  const maxItemChars = opts.maxItemChars ?? DEFAULT_MAX_ITEM_CHARS;
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();
  let buf = "";
  let pos = 0; // next character to scan; survives across chunks
  let inArray = false;
  let depth = 0;
  let inString = false;
  let escape = false;
  let itemStart = -1;
  let rootDepth = 0;
  let yielded = 0;
  let seekingKey = Boolean(opts.arrayKey);
  const emit = (text: string): unknown => {
    if (text.length > maxItemChars) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined; /* a broken element is skipped; the file is not ours to fix */
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (seekingKey) {
        // Root object: skip to `"<arrayKey>" … [`.
        const needle = `"${opts.arrayKey}"`;
        const at = buf.indexOf(needle);
        if (at < 0) {
          buf = buf.slice(-needle.length);
          pos = 0;
          continue;
        }
        const bracket = buf.indexOf("[", at + needle.length);
        if (bracket < 0) continue;
        buf = buf.slice(bracket);
        pos = 0;
        seekingKey = false;
      }
      let needMore = false;
      while (pos < buf.length && !needMore) {
        const ch = buf[pos];
        if (!inArray) {
          // Before the array: a bare array root enters at once; an OBJECT root enters at
          // the first array that is a direct value of it (depth 1), skipping strings.
          if (inString) {
            if (escape) escape = false;
            else if (ch === "\\") escape = true;
            else if (ch === '"') inString = false;
          } else if (ch === '"') inString = true;
          else if (ch === "{") rootDepth++;
          else if (ch === "}") rootDepth--;
          else if (ch === "[" && rootDepth <= 1) {
            inArray = true;
            depth = 0;
          }
          pos++;
          continue;
        }
        if (inString) {
          if (escape) escape = false;
          else if (ch === "\\") escape = true;
          else if (ch === '"') {
            inString = false;
            if (depth === 0 && itemStart >= 0) {
              // A bare string element.
              const parsed = emit(buf.slice(itemStart, pos + 1));
              itemStart = -1;
              buf = buf.slice(pos + 1);
              pos = 0;
              if (parsed !== undefined) {
                yield parsed;
                if (++yielded >= maxItems) return;
              }
              continue;
            }
          }
          pos++;
          continue;
        }
        if (ch === '"') {
          inString = true;
          if (depth === 0 && itemStart < 0) itemStart = pos;
        } else if (ch === "{" || ch === "[") {
          if (depth === 0) itemStart = pos;
          depth++;
        } else if (ch === "}" || ch === "]") {
          if (depth === 0) return; // the closing `]` of the array
          depth--;
          if (depth === 0 && itemStart >= 0) {
            const parsed = emit(buf.slice(itemStart, pos + 1));
            itemStart = -1;
            buf = buf.slice(pos + 1);
            pos = 0;
            if (parsed !== undefined) {
              yield parsed;
              if (++yielded >= maxItems) return;
            }
            continue;
          }
        } else if (depth === 0 && itemStart < 0 && /[0-9tfn-]/.test(ch)) {
          // A scalar element (number/true/false/null): read to the next comma or `]`.
          const end = buf.slice(pos).search(/[,\]]/);
          if (end < 0) {
            needMore = true;
            break;
          }
          const parsed = emit(buf.slice(pos, pos + end).trim());
          buf = buf.slice(pos + end);
          pos = 0;
          if (parsed !== undefined) {
            yield parsed;
            if (++yielded >= maxItems) return;
          }
          continue;
        }
        pos++;
      }
      // Trim what is scanned and complete; keep the pending element (or the scalar tail).
      if (itemStart >= 0) {
        buf = buf.slice(itemStart);
        pos -= itemStart;
        itemStart = 0;
        if (buf.length > maxItemChars) {
          // An element that will not end: drop it and resynchronise at the next boundary.
          buf = "";
          pos = 0;
          itemStart = -1;
          depth = 0;
          inString = false;
          escape = false;
        }
      } else if (!needMore) {
        buf = "";
        pos = 0;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
