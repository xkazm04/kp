import assert from "node:assert/strict";
import test from "node:test";
import { CHANNEL_SECTIONS, resolveChannelSection } from "./channelsSections.ts";

test("Channels deep links resolve every section and reject unknown ids", () => {
  for (const section of CHANNEL_SECTIONS) {
    assert.equal(resolveChannelSection(section.id), section.id);
  }
  assert.equal(resolveChannelSection(null), "comms");
  assert.equal(resolveChannelSection("unlisted"), "comms");
});
