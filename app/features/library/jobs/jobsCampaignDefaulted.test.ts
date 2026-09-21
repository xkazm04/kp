// Pins campaign-pack assumed-fact chips (scan-sweep jobs-posting-campaign).
// `["location","seniority"]` paints two chips; `[]` paints none. Unknown slugs
// use the generic "assumed {field}" key rather than vanishing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignPackSchema } from "@/app/_lib/schemas.ts";
import { campaignDefaultedChips, campaignDefaultedLabels } from "./jobsCampaignDefaulted.ts";

const t = (key: string, values?: { field: string }) =>
  key === "generic" ? `Assumed ${values?.field ?? ""}` : `known:${key}`;

test("location+seniority paints two known chips; empty paints none", () => {
  const chips = campaignDefaultedChips(["location", "seniority"]);
  assert.deepEqual(chips, [
    { slug: "location", kind: "known" },
    { slug: "seniority", kind: "known" },
  ]);
  assert.deepEqual(campaignDefaultedLabels(["location", "seniority"], t), [
    "known:location",
    "known:seniority",
  ]);
  assert.deepEqual(campaignDefaultedChips([]), []);
  assert.deepEqual(campaignDefaultedLabels([], t), []);
});

test("an unknown slug uses the generic assumed-{field} chip", () => {
  const chips = campaignDefaultedChips(["location", "mystery_field"]);
  assert.deepEqual(chips, [
    { slug: "location", kind: "known" },
    { slug: "mystery_field", kind: "generic" },
  ]);
  assert.equal(campaignDefaultedLabels(["mystery_field"], t)[0], "Assumed mystery_field");
});

test("the pack schema accepts defaultedFields as an optional string list", () => {
  assert.equal(campaignPackSchema.safeParse({ defaultedFields: ["location", "seniority"] }).success, true);
  assert.equal(campaignPackSchema.safeParse({ defaultedFields: [] }).success, true);
});
