import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";

import { readLimitedText, validateLocalRequest, validateVoiceToken } from "./voice-session.js";

test("validateLocalRequest rejects foreign origins", () => {
  const request = { headers: { host: "127.0.0.1:17321", origin: "https://example.com" } } as IncomingMessage;
  assert.equal(validateLocalRequest(request, "127.0.0.1", 17321), "Forbidden origin.");
});

test("validateVoiceToken requires exact token", () => {
  const request = { headers: { "x-voice-token": "wrong" } } as unknown as IncomingMessage;
  assert.equal(validateVoiceToken(request, "secret"), "Invalid voice token.");
});

test("readLimitedText rejects oversized bodies", async () => {
  const request = new EventEmitter() as IncomingMessage;
  request[Symbol.asyncIterator] = async function* () {
    yield Buffer.from("abcdef");
  };
  await assert.rejects(readLimitedText(request, 3), /exceeds 3 bytes/);
});
