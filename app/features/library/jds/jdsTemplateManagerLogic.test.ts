// Pins the template manager's CRUD contract — the React-free half the hook drives
// (jdsTemplateClient.ts). The template manager was the one write surface in the JD
// library with NO test: a failed list load had no rejection path, every refusal
// arrived as English prose, and an edit was last-writer-wins.
//
//   node scripts/run-unit-tests.mjs app/features/library/jds/jdsTemplateManagerLogic.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyTemplateResponse,
  loadManagedTemplates,
  sendTemplateWrite,
  templateErrorKey,
  templateSaveRequest,
} from "./jdsTemplateClient.ts";
import type { TemplateFieldError } from "@/app/features/shared/renderTemplate";

function stub(res: { status: number; body?: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      json: async () => {
        if (res.body === undefined) throw new Error("no body");
        return res.body;
      },
    } as Response;
  };
  return { impl, calls };
}

test("a create POSTs its scope; an edit PUTs the loaded stamp and never re-sends scope", () => {
  const create = templateSaveRequest({ scope: "org" }, { name: "Standard", body: "{{role}}" });
  assert.deepEqual(create, { url: "/api/templates", method: "POST", payload: { name: "Standard", body: "{{role}}", scope: "org" } });

  const edit = templateSaveRequest({ id: "tpl-1", scope: "team", updatedAt: "2026-09-01T10:00:00.000Z" }, { name: "N", body: "B" });
  assert.equal(edit.method, "PUT");
  assert.equal(edit.url, "/api/templates/tpl-1");
  // The CAS token — without it the server keeps the old last-writer-wins path.
  assert.equal(edit.payload.expectedUpdatedAt, "2026-09-01T10:00:00.000Z");
  assert.equal("scope" in edit.payload, false, "an edit never re-sends the tier it was created in");

  const noStamp = templateSaveRequest({ id: "tpl-1", scope: "team" }, { name: "N", body: "B" });
  assert.equal("expectedUpdatedAt" in noStamp.payload, false, "no loaded stamp = the old unconditional write, not an empty CAS");
});

test("the response classifier separates the gate, the conflict and everything else", () => {
  assert.equal(classifyTemplateResponse(401, null), "gate");
  assert.equal(classifyTemplateResponse(403, { code: "FORBIDDEN_CAPABILITY" }), "gate");
  assert.equal(classifyTemplateResponse(409, { code: "TEMPLATE_STALE" }), "conflict");
  assert.equal(classifyTemplateResponse(400, { code: "TEMPLATE_LAST_ONE" }), "error");
  assert.equal(classifyTemplateResponse(404, { code: "TEMPLATE_NOT_FOUND" }), "error");
  assert.equal(classifyTemplateResponse(200, { template: null }), "ok");
});

test("a stale save comes back as a conflict CARRYING the winning row (the one-click reload)", async () => {
  const winner = { id: "tpl-1", name: "Theirs", body: "theirs", isDefault: false, scope: "team" as const, updatedAt: "2026-09-02T09:00:00.000Z" };
  const { impl, calls } = stub({ status: 409, body: { code: "TEMPLATE_STALE", error: "…", template: winner } });
  const r = await sendTemplateWrite(templateSaveRequest({ id: "tpl-1", scope: "team", updatedAt: "old" }, { name: "Mine", body: "mine" }), impl);
  assert.equal(r.outcome, "conflict");
  assert.equal(r.body?.template?.body, "theirs");
  assert.equal(calls[0].init?.method, "PUT");
});

test("a delete refusal is a CODE the reader's language resolves, never the server's prose", async () => {
  for (const [status, code] of [
    [400, "TEMPLATE_LAST_ONE"],
    [400, "TEMPLATE_IS_DEFAULT"],
    [404, "TEMPLATE_NOT_FOUND"],
  ] as const) {
    const { impl, calls } = stub({ status, body: { code, error: "English prose" } });
    const r = await sendTemplateWrite({ url: "/api/templates/tpl-1", method: "DELETE" }, impl);
    assert.equal(r.outcome, "error");
    assert.equal(r.body?.code, code, "the code is what the manager keys on");
    assert.equal(calls[0].init?.method, "DELETE");
    assert.equal(calls[0].init?.body, undefined, "a DELETE sends no body and no content-type");
  }
});

test("an operator-gated write is the gate outcome on both 401 and 403", async () => {
  for (const status of [401, 403]) {
    const r = await sendTemplateWrite({ url: "/api/templates", method: "POST", payload: { name: "n", body: "b" } }, stub({ status, body: {} }).impl);
    assert.equal(r.outcome, "gate");
  }
});

test("loading the list THROWS on a failed request or an unusable body — never a silent empty list", async () => {
  await assert.rejects(() => loadManagedTemplates(stub({ status: 500, body: { error: "boom" } }).impl));
  await assert.rejects(() => loadManagedTemplates(stub({ status: 200, body: { nope: 1 } }).impl));
  await assert.rejects(() => loadManagedTemplates(stub({ status: 200 }).impl), "an unparseable body is a failure, not an empty library");

  const rows = [{ id: "tpl-1", name: "Standard", body: "{{role}}", isDefault: true, scope: "org" as const, updatedAt: "2026-09-01T00:00:00.000Z" }];
  assert.deepEqual(await loadManagedTemplates(stub({ status: 200, body: { templates: rows } }).impl), {
    templates: rows,
    truncated: false,
  });
  assert.deepEqual(
    await loadManagedTemplates(stub({ status: 200, body: { templates: [] } }).impl),
    { templates: [], truncated: false },
    "a genuinely empty library is an empty array"
  );
  // The bounded read's honesty flag survives the client. The manager is the surface that
  // claims to show a WHOLE library, so a page it cannot tell from the whole thing would
  // under-report what exists. Absent or non-true is false: never guessed from a full page.
  assert.deepEqual(await loadManagedTemplates(stub({ status: 200, body: { templates: rows, truncated: true } }).impl), {
    templates: rows,
    truncated: true,
  });
  assert.equal(
    (await loadManagedTemplates(stub({ status: 200, body: { templates: rows, truncated: "yes" } }).impl)).truncated,
    false
  );
});

test("every validation refusal maps to a catalog key (no code falls through unlocalized)", () => {
  const cases: TemplateFieldError[] = [
    { code: "bothRequired" },
    { code: "nameEmpty" },
    { code: "bodyEmpty" },
    { code: "tooLong", field: "name", max: 80 },
    { code: "tooLong", field: "body", max: 20000 },
    { code: "unknownTokens", tokens: ["{{nope}}", "{{alsoNope}}"] },
  ];
  const keys = cases.map((c) => templateErrorKey(c));
  assert.deepEqual(
    keys.map((k) => k.key),
    ["errBothRequired", "errNameEmpty", "errBodyEmpty", "errNameTooLong", "errBodyTooLong", "errUnknownTokens"]
  );
  assert.equal(keys[3].values?.max, 80, "the cap rides as an ICU value, not baked into an English sentence");
  assert.equal(keys[5].values?.count, 2, "the plural count comes from the token list");
});
