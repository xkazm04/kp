import assert from "node:assert/strict";
import { test } from "node:test";
import { softWrapsJoined } from "./cvParagraphs.ts";

const HEADINGS = new Set(["profile", "work experience", "education", "skills"]);
const isHeading = (line: string) => HEADINGS.has(line.replace(/:$/, "").toLowerCase());

// A synthetic CV, printed the way a PDF's text comes out: one printed line per line.
const PRINTED = [
  "ALEX MORGAN",
  "DATA ENGINEER",
  "+44 7700 900123 alex.morgan@example.com",
  "github.com/alexmorgan",
  "PROFILE",
  "Data engineer building streaming pipelines, analytics platforms and",
  "internal tooling for product teams. Six years across retail and",
  "logistics.",
  "WORK EXPERIENCE",
  "Northwind Ltd. 03/2021 - 05/2025",
  "Senior Data Engineer",
  "Kafka ingestion redesign: moved nightly batches onto a stream with",
  "Flink, cutting the report delay from a day to minutes.",
  "Platform design; prototype-to-",
  "production hand-over for three teams, including",
  "on-call and runbooks.",
  "",
  "EDUCATION",
  "University of Leeds",
  "Computer Science - BSc",
];

test("a soft-wrapped paragraph reads as one, and nothing is added or lost", () => {
  const out = softWrapsJoined(PRINTED, isHeading);
  assert.deepEqual(out, [
    "ALEX MORGAN",
    "DATA ENGINEER",
    "+44 7700 900123 alex.morgan@example.com",
    "github.com/alexmorgan",
    "PROFILE",
    "Data engineer building streaming pipelines, analytics platforms and internal tooling for product teams. Six years across retail and logistics.",
    "WORK EXPERIENCE",
    "Northwind Ltd. 03/2021 - 05/2025",
    "Senior Data Engineer",
    "Kafka ingestion redesign: moved nightly batches onto a stream with Flink, cutting the report delay from a day to minutes.",
    "Platform design; prototype-to-production hand-over for three teams, including on-call and runbooks.",
    "EDUCATION",
    "University of Leeds",
    "Computer Science - BSc",
  ]);
  const words = (lines: string[]) => lines.join(" ").replace(/-\s/g, "-").split(/\s+/).filter(Boolean).join(" ");
  assert.equal(words(out), words(PRINTED.map((l) => l.trim())).replace("prototype-to- production", "prototype-to-production"));
});

test("the name, a heading, an item start and contact data are never joined", () => {
  assert.deepEqual(softWrapsJoined(["Jana Nováková", "analytička dat"], isHeading), ["Jana Nováková", "analytička dat"], "the first line is the name");
  assert.deepEqual(softWrapsJoined(["x", "Built dashboards with", "Skills"], isHeading), ["x", "Built dashboards with", "Skills"], "a heading stands alone");
  assert.deepEqual(softWrapsJoined(["x", "Reporting and", "Skills", "python"], isHeading), ["x", "Reporting and", "Skills", "python"], "nothing joins a heading");
  assert.deepEqual(softWrapsJoined(["x", "Led the migration of", "• Kubernetes rollout"], isHeading), ["x", "Led the migration of", "• Kubernetes rollout"]);
  assert.deepEqual(softWrapsJoined(["x", "Consultant at Acme and", "03/2020 - 04/2022"], isHeading), ["x", "Consultant at Acme and", "03/2020 - 04/2022"]);
  assert.deepEqual(softWrapsJoined(["x", "alex@example.com", "linkedin.com/in/alex"], isHeading), ["x", "alex@example.com", "linkedin.com/in/alex"]);
});

test("a finished sentence or label stops the join; a blank line ends a paragraph", () => {
  assert.deepEqual(softWrapsJoined(["x", "Shipped the billing rewrite.", "reduced churn by a tenth"], isHeading), ["x", "Shipped the billing rewrite.", "reduced churn by a tenth"]);
  assert.deepEqual(softWrapsJoined(["x", "Tools:", "python, dbt"], isHeading), ["x", "Tools:", "python, dbt"]);
  assert.deepEqual(softWrapsJoined(["x", "LLM RELATED", "n8n workflows"], isHeading), ["x", "LLM RELATED", "n8n workflows"], "a label in capitals");
  assert.deepEqual(softWrapsJoined(["x", "Worked on search and", "", "ranking"], isHeading), ["x", "Worked on search and", "ranking"]);
});
