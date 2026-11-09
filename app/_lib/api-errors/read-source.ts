import { readFileSync } from "node:fs";
import path from "node:path";

/** TEST HELPER. The text of api-response.ts plus the two catalogs it re-exports
 *  (api-errors/store-errors.ts, api-errors/refusal-errors.ts), concatenated, for the
 *  source-text contract tests that match catalog entries or helper code by regex.
 *  Reading the three together keeps every such assertion exactly as strong as when the
 *  catalogs lived in api-response.ts. Pass the path of api-response.ts. */
export function readApiResponseSource(apiResponsePath: string): string {
  const dir = path.dirname(apiResponsePath);
  return ["", path.join("api-errors", "store-errors.ts"), path.join("api-errors", "refusal-errors.ts")]
    .map((rel) => readFileSync(rel ? path.join(dir, rel) : apiResponsePath, "utf8"))
    .join("\n");
}
