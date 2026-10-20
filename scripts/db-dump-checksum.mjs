import { createHash } from "node:crypto";

// Hash the complete logical dump before adding its own checksum field. JSON's
// insertion order is retained by JSON.parse, so the loader hashes the same bytes
// even when the dump file is pretty-printed for inspection.
export function dumpChecksum(payload) {
  const { checksum: _checksum, ...contents } = payload;
  return createHash("sha256").update(JSON.stringify(contents), "utf8").digest("hex");
}
