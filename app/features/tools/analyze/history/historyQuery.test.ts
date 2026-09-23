// History's client query door (challenge-r09 cv-analyze-workspace/A).
//
// History used to fetch the newest 200 groups and filter them on the client. It now
// sends the query to /api/analyses, pages with the server's cursor, and fills its
// dropdowns from the server's facets. These cases pin the pure half: what goes on the
// wire, how a second page joins the first, and how a body is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = () => import("./historyQuery.ts");
const row = (slug: string) => ({ slug, candidate_label: slug, jd_slug: null, score: null, role_family: null, seniority: null, created_at: "2026-01-01T00:00:00.000Z" });

test("toSearchParams sends only what narrows: blanks and whitespace are dropped, q is trimmed", async () => {
  const { toSearchParams } = await load();
  assert.equal(toSearchParams({ q: "  ", family: "", seniority: "", disposition: "undecided" }), "disposition=undecided");
  assert.equal(toSearchParams({ q: "", family: "", seniority: "", disposition: "" }), "");
  assert.equal(
    toSearchParams({ q: " Čapek ", family: "data_ai", seniority: "senior", disposition: "" }, "c1"),
    "q=%C4%8Capek&family=data_ai&seniority=senior&cursor=c1"
  );
});

test("mergeHistoryPages dedupes by slug and keeps server order", async () => {
  const { mergeHistoryPages } = await load();
  const prev = [row("c"), row("b")];
  // 'b' is on both pages: a row saved between the two loads shifted nothing on a
  // keyset page, but a re-grouped row can still come back; it is shown once.
  const merged = mergeHistoryPages(prev, [row("b"), row("a")]);
  assert.deepEqual(merged.map((r) => r.slug), ["c", "b", "a"]);
  assert.equal(merged[0], prev[0], "rows already on screen keep their identity");
});

test("readHistoryPage reads the cursor and the workspace facets, defensively", async () => {
  const { readHistoryPage } = await load();
  const page = readHistoryPage({
    analyses: [row("a")],
    truncated: true,
    limit: 1,
    nextCursor: "abc",
    facets: { families: ["data_ai", 7, ""], seniorities: ["senior"] },
  });
  assert.equal(page.nextCursor, "abc");
  assert.equal(page.truncated, true);
  assert.deepEqual(page.facets, { families: ["data_ai"], seniorities: ["senior"] });
  const bare = readHistoryPage({ analyses: [row("a")], nextCursor: 5 });
  assert.equal(bare.nextCursor, null);
  assert.equal(bare.facets, null, "no facets is 'not answered', never an empty vocabulary");
  assert.equal(readHistoryPage(null).analyses.length, 0);
});

test("isHistoryFiltering is true only for a query that narrows", async () => {
  const { isHistoryFiltering } = await load();
  assert.equal(isHistoryFiltering({ q: "   ", family: "", seniority: "", disposition: "" }), false);
  assert.equal(isHistoryFiltering({ q: "", family: "", seniority: "", disposition: "hold" }), true);
});

test("HistoryTab asks the server and no longer filters a loaded slice", () => {
  const tab = readFileSync(path.join(here, "HistoryTab.tsx"), "utf8");
  assert.match(tab, /toSearchParams\(/, "the fetch carries the query");
  assert.match(tab, /mergeHistoryPages\(/, "Load more joins pages through the pure merge");
  assert.doesNotMatch(tab, /historyRowMatchesQuery/, "the client predicate is retired");
  assert.doesNotMatch(tab, /distinct\(\(rows/, "dropdowns come from the server's facets, not the loaded rows");
  assert.doesNotMatch(tab, /fetch\("\/api\/analyses"\)/, "never the bare, unqueried door");
});
