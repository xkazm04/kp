// C5 — the binding smtp rule (operator, 2026-10-28), proven against the deck's wire and its hook:
// what the deck reads on load is GETs only (no probe of anything, so none of smtp), a press on
// smtp makes NO request (its probe is a real letter, sent only by the owner's Send test on the
// sender level), and the hook's effects never reach the probe at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadDeck, pressProbe, type Fetcher } from "./connectorsDeckReads.ts";

function recorder(respond: (url: string) => unknown = () => ({ connectors: [] })) {
  const calls: { url: string; method: string }[] = [];
  const f: Fetcher = async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET" });
    return new Response(JSON.stringify(respond(url)), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { f, calls };
}

test("loading the deck reads only GETs and never touches a probe door", async () => {
  const { f, calls } = recorder();
  await loadDeck(f);
  assert.ok(calls.length > 0);
  for (const c of calls) {
    assert.equal(c.method, "GET", c.url);
    assert.ok(!c.url.includes("/probe"), `no probe on load: ${c.url}`);
    assert.ok(!c.url.includes("/smtp"), `no smtp call on load: ${c.url}`);
  }
});

test("a press on smtp makes no request: the deck sends the owner to the sender level", async () => {
  const { f, calls } = recorder();
  const out = await pressProbe("smtp", f);
  assert.deepEqual(out, { kind: "sender" });
  assert.equal(calls.length, 0);
});

test("a press on another connector is ONE POST to its probe door, and the row it left comes back", async () => {
  const { f, calls } = recorder(() => ({ health: "connected", connector: { id: "ats_webhook", health: "connected", lastOkAt: "2026-10-28T08:00:00Z", lastFailure: null } }));
  const out = await pressProbe("ats_webhook", f);
  assert.deepEqual(calls, [{ url: "/api/connect/ats_webhook/probe", method: "POST" }]);
  assert.equal(out.kind, "row");
  assert.equal(out.kind === "row" && out.row.health, "connected");
});

test("the hook never probes from an effect, a live refresh or a load: only its press calls pressProbe", () => {
  const src = readFileSync(fileURLToPath(new URL("./useConnectorsDeck.ts", import.meta.url)), "utf8");
  // The load the effects run is loadDeck; pressProbe appears only inside the press callback.
  const loadBody = src.slice(src.indexOf("const load = useCallback("), src.indexOf("useLiveRefresh(load);"));
  assert.ok(loadBody.includes("loadDeck("), "the effects run loadDeck");
  assert.ok(!/probe/i.test(loadBody), "neither the load nor the effects mention a probe");
  assert.equal(src.match(/pressProbe\(/g)?.length, 1, "pressProbe is called exactly once, in the press");
  assert.ok(src.indexOf("pressProbe(") > src.indexOf("const probe = useCallback("), "the call is inside the press callback");
  assert.ok(!/setInterval|setTimeout/.test(src), "no polling");
});

test("no deck component probes on mount: the level reaches a probe only through an onClick", () => {
  for (const file of ["./ChannelsNightConnectorsLevel.tsx", "./ConnectorCard.tsx"]) {
    const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    assert.ok(!/pressProbe|\/api\/connect\//.test(src), `${file} never calls the wire itself`);
    // Each effect body (up to its deps array) never names a probe.
    for (const chunk of src.split("useEffect(").slice(1)) {
      const body = chunk.slice(0, chunk.indexOf("}, ["));
      assert.ok(!/probe/i.test(body), `${file} has an effect that mentions a probe: ${body.slice(0, 120)}`);
    }
    assert.ok(!/setInterval/.test(src), `${file} does not poll`);
  }
});
