import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VOICE_PORT,
  buildCuePrompt,
  buildRealtimeSessionConfig,
  parseCueKind,
  parsePort,
} from "./voice.js";

test("parsePort uses the default and validates user input", () => {
  assert.equal(parsePort(undefined), DEFAULT_VOICE_PORT);
  assert.equal(parsePort("3000"), 3000);
  assert.throws(() => parsePort("0"));
  assert.throws(() => parsePort("abc"));
});

test("parseCueKind validates supported voice cue kinds", () => {
  assert.equal(parseCueKind(undefined), "evidence");
  assert.equal(parseCueKind("wrap"), "wrap");
  assert.equal(parseCueKind("verified"), "wrap");
  assert.throws(() => parseCueKind("other"));
});

test("buildRealtimeSessionConfig keeps the realtime model configuration compact", () => {
  const config = buildRealtimeSessionConfig({
    model: "gpt-realtime-2.1-mini",
    voice: "verse",
    language: "Spanish",
  });

  assert.equal(config.type, "realtime");
  assert.equal(config.model, "gpt-realtime-2.1-mini");
  assert.deepEqual(config.reasoning, { effort: "low" });
  assert.match(String(config.instructions), /Codex speaking as yourself/);
});

test("buildCuePrompt maps control cues to Codex Voice behavior", () => {
  assert.match(buildCuePrompt({ kind: "pause", text: "", at: new Date().toISOString() }), /Pause/);
  assert.match(
    buildCuePrompt({ kind: "evidence", text: "Updated README", at: new Date().toISOString() }),
    /Evidence/,
  );
});
