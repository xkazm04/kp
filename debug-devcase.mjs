import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";

process.env.KP_DB_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), "kp-devcase-")), "kp.sqlite");

const { POST } = await import("./app/api/devcase/route.ts");

const role = { title: "Backend Engineer", seniority: "senior" };
const strongProbes = [
  { id: "p1", kind: "trap", where: "src/index.ts", reveals: "handles the retry edge case", decisionSpace: ["retry with backoff", "fail fast"] },
  { id: "p2", kind: "trap", where: "src/db.ts", reveals: "avoids the N+1 query", decisionSpace: ["batch load", "loop per row"] },
];

function post(body) {
  return new Request("http://localhost/api/devcase", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

try {
  const res = await POST(post({ role, case: { title: "Strong case", coverProbes: strongProbes } }));
  const body = await res.json();
  console.log("status:", res.status, "body:", JSON.stringify(body));
} catch (e) {
  console.error("ERROR:", e.message, e.stack);
}
