// Adapter-seam tests for provider failover at connect (Direction 3). The route
// wiring (persisting the served provider, logging) is verified at the lib level
// here because the route test would hit the worktree NextRequest artifact; these
// pin the failover CONTRACT the route depends on: which provider serves, whether a
// failover happened, and which brief path runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectWithFailover, type ConnectableAdapter } from "./connect-failover.ts";
import type { VoiceAvailability, VoiceConnect, VoiceProviderId } from "./types.ts";

const OAI_CONNECT: VoiceConnect = { provider: "openai", model: "gpt-realtime", clientSecret: "sec", callsUrl: "https://calls" };
const EL_CONNECT: VoiceConnect = { provider: "elevenlabs", signedUrl: "wss://signed" };

/** An adapter whose connect resolves with the given payload or rejects. */
function stubAdapter(behavior: VoiceConnect | Error): ConnectableAdapter {
  return {
    async connect() {
      if (behavior instanceof Error) throw behavior;
      return behavior;
    },
  };
}

function adapters(map: Partial<Record<VoiceProviderId, ConnectableAdapter>>) {
  const calls: VoiceProviderId[] = [];
  const getAdapter = (id: VoiceProviderId): ConnectableAdapter => {
    calls.push(id);
    const a = map[id];
    if (!a) throw new Error(`no stub for ${id}`);
    return a;
  };
  return { getAdapter, calls };
}

const bothAvailable: VoiceAvailability = { openai: true, elevenlabs: true };
const onlyEl: VoiceAvailability = { openai: false, elevenlabs: true };

const noPrompt = () => null;

test("preferred provider succeeds: no failover, no second attempt", async () => {
  const { getAdapter, calls } = adapters({ openai: stubAdapter(OAI_CONNECT), elevenlabs: stubAdapter(EL_CONNECT) });
  const res = await connectWithFailover({
    preferred: "openai",
    instructions: "brief",
    language: "en",
    getAdapter,
    availability: bothAvailable,
    resolveAgentPrompt: noPrompt,
  });
  assert.equal(res.provider, "openai");
  assert.equal(res.failedOver, false);
  assert.deepEqual(calls, ["openai"]);
});

test("EL preferred throws, OpenAI available → fails over to OpenAI (server-grounded, no prompt)", async () => {
  const { getAdapter, calls } = adapters({
    elevenlabs: stubAdapter(new Error("EL signed-url 503")),
    openai: stubAdapter(OAI_CONNECT),
  });
  // resolveAgentPrompt would return null for OpenAI — assert the route closure is
  // consulted with the SERVED provider.
  const seen: VoiceProviderId[] = [];
  const res = await connectWithFailover({
    preferred: "elevenlabs",
    instructions: "brief",
    language: "en",
    getAdapter,
    availability: bothAvailable,
    resolveAgentPrompt: (served) => {
      seen.push(served);
      return null;
    },
  });
  assert.equal(res.provider, "openai");
  assert.equal(res.failedOver, true);
  assert.equal(res.connect.provider, "openai");
  assert.equal(res.agentPrompt, null);
  assert.deepEqual(calls, ["elevenlabs", "openai"]);
  assert.deepEqual(seen, ["openai"]);
});

test("OpenAI preferred throws, EL available (candidate) → fails over to EL with its candidate-safe prompt", async () => {
  const { getAdapter } = adapters({
    openai: stubAdapter(new Error("OpenAI client_secrets 500")),
    elevenlabs: stubAdapter(EL_CONNECT),
  });
  const res = await connectWithFailover({
    preferred: "openai",
    instructions: "brief",
    language: "cs",
    getAdapter,
    availability: bothAvailable,
    // Mirrors the route's closure: EL candidate → the candidate-safe brief.
    resolveAgentPrompt: (served) => (served === "elevenlabs" ? "candidate-safe brief" : null),
  });
  assert.equal(res.provider, "elevenlabs");
  assert.equal(res.failedOver, true);
  assert.equal(res.agentPrompt, "candidate-safe brief");
});

test("preferred throws but the OTHER provider is not available → re-throws the ORIGINAL error (today's behavior)", async () => {
  const { getAdapter, calls } = adapters({ elevenlabs: stubAdapter(new Error("EL signed-url 503")) });
  await assert.rejects(
    connectWithFailover({
      preferred: "elevenlabs",
      instructions: "brief",
      language: "en",
      getAdapter,
      availability: onlyEl, // openai not configured
      resolveAgentPrompt: noPrompt,
    }),
    /EL signed-url 503/
  );
  // No attempt on the unavailable provider.
  assert.deepEqual(calls, ["elevenlabs"]);
});

// ONLY a connect may trigger a failover. Pre-fix the prompt build ran inside the
// same try, so a throwing resolveAgentPrompt looked exactly like a dead provider:
// the preferred provider had ALREADY minted a real credential, and the "rescue"
// minted a SECOND one on the other provider — the PAID one when the preferred is a
// self-hosted (free) service — then flipped the session onto it and logged a
// failover that never happened.
test("a throwing resolveAgentPrompt is NOT a connect failure — no second (paid) mint", async () => {
  const { getAdapter, calls } = adapters({
    elevenlabs: stubAdapter(EL_CONNECT),
    openai: stubAdapter(OAI_CONNECT),
  });
  await assert.rejects(
    connectWithFailover({
      preferred: "elevenlabs",
      instructions: "brief",
      language: "en",
      getAdapter,
      availability: bothAvailable,
      // Only the EL brief path fails; OpenAI needs no client prompt — so pre-fix
      // this RESOLVED on OpenAI instead of surfacing the real failure.
      resolveAgentPrompt: (served) => {
        if (served === "elevenlabs") throw new Error("candidate-safe brief build failed");
        return null;
      },
    }),
    /candidate-safe brief build failed/
  );
  assert.deepEqual(calls, ["elevenlabs"], "the preferred provider connected — the alternate must not be dialled");
});

test("both providers throw → surfaces the PREFERRED provider's error", async () => {
  const { getAdapter } = adapters({
    elevenlabs: stubAdapter(new Error("EL primary boom")),
    openai: stubAdapter(new Error("OAI fallback boom")),
  });
  await assert.rejects(
    connectWithFailover({
      preferred: "elevenlabs",
      instructions: "brief",
      language: "en",
      getAdapter,
      availability: bothAvailable,
      resolveAgentPrompt: noPrompt,
    }),
    /EL primary boom/
  );
});

test("the director's tools reach whichever provider dials — a failover keeps the protocol", async () => {
  const seen: { id: VoiceProviderId; tools: unknown }[] = [];
  const recording = (id: VoiceProviderId, behavior: VoiceConnect | Error): ConnectableAdapter => ({
    async connect(opts) {
      seen.push({ id, tools: opts.tools });
      if (behavior instanceof Error) throw behavior;
      return behavior;
    },
  });
  const tools = [{ name: "begin_topic", description: "d", parameters: { type: "object" } }];
  await connectWithFailover({
    preferred: "elevenlabs",
    instructions: "brief",
    language: "en",
    tools,
    getAdapter: (id) => (id === "elevenlabs" ? recording(id, new Error("EL down")) : recording(id, OAI_CONNECT)),
    availability: bothAvailable,
    resolveAgentPrompt: noPrompt,
  });
  assert.deepEqual(seen.map((s) => s.id), ["elevenlabs", "openai"]);
  assert.ok(seen.every((s) => s.tools === tools));
});

// ── challenge-r09 voice-provider-io/A: the helper holds the money rule and walks an
// ordered list of alternates ─────────────────────────────────────────────────────

// The free-to-paid rule used to live in ONE route as `{ ...voiceAvailability(),
// openai: false }`; any other caller of the helper silently lost it. A session a free
// (self-hosted) provider was chosen for skipped /simulate's minute gate, so rescuing it
// onto a paid provider prices and debits a call against a reservation never taken.
test("a free preferred provider is never rescued onto a paid one — the helper holds the rule", async () => {
  const { getAdapter, calls } = adapters({
    elevenlabs: stubAdapter(new Error("local voice service down")),
    openai: stubAdapter(OAI_CONNECT),
  });
  await assert.rejects(
    connectWithFailover({
      preferred: "elevenlabs",
      instructions: "brief",
      language: "en",
      getAdapter,
      availability: bothAvailable,
      isFree: (id) => id === "elevenlabs",
      resolveAgentPrompt: noPrompt,
    }),
    /local voice service down/
  );
  assert.deepEqual(calls, ["elevenlabs"], "the paid provider must not be dialled");
});

test("more than two providers: alternates are walked in order; all failing rethrows the preferred error", async () => {
  const LOCAL = "local" as VoiceProviderId;
  const order = ["openai", "elevenlabs", LOCAL] as readonly VoiceProviderId[];
  const availability = { openai: true, elevenlabs: true, local: true } as VoiceAvailability;
  const LOCAL_CONNECT = { provider: LOCAL, signedUrl: "ws://127.0.0.1/local" } as unknown as VoiceConnect;

  const served = adapters({
    openai: stubAdapter(new Error("OAI primary boom")),
    elevenlabs: stubAdapter(new Error("EL alternate boom")),
    [LOCAL]: stubAdapter(LOCAL_CONNECT),
  });
  const res = await connectWithFailover({
    preferred: "openai",
    instructions: "brief",
    language: "en",
    getAdapter: served.getAdapter,
    availability,
    order,
    isFree: () => false,
    resolveAgentPrompt: noPrompt,
  });
  assert.equal(res.provider, LOCAL);
  assert.equal(res.failedOver, true);
  assert.deepEqual(served.calls, ["openai", "elevenlabs", LOCAL]);

  const dead = adapters({
    openai: stubAdapter(new Error("OAI primary boom")),
    elevenlabs: stubAdapter(new Error("EL alternate boom")),
    [LOCAL]: stubAdapter(new Error("local alternate boom")),
  });
  await assert.rejects(
    connectWithFailover({
      preferred: "openai",
      instructions: "brief",
      language: "en",
      getAdapter: dead.getAdapter,
      availability,
      order,
      isFree: () => false,
      resolveAgentPrompt: noPrompt,
    }),
    /OAI primary boom/
  );
  assert.deepEqual(dead.calls, ["openai", "elevenlabs", LOCAL]);
});
