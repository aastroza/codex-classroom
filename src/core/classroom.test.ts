import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  classifyTask,
  createClassroomMapper,
  inferPhase,
  isDuplicateText,
  phasesForTask,
  type ClassroomMoment,
} from "./classroom.js";
import { maybeAutoNarrateMoment } from "./classroom-templates.js";
import { mapRolloutText } from "./rollout-watcher.js";

const fixture = "src/core/fixtures/rollout-world-cup-news.jsonl";

function fixtureMoments(): ClassroomMoment[] {
  return mapRolloutText(fs.readFileSync(fixture, "utf8"))
    .map((event) => event.moment)
    .filter((moment): moment is ClassroomMoment => Boolean(moment));
}

test("classifyTask detects research prompts in Spanish and English", () => {
  assert.equal(classifyTask("Busca noticias recientes del Mundial"), "research");
  assert.equal(classifyTask("search latest World Cup news"), "research");
  assert.equal(classifyTask("implementa una correccion del test"), "coding");
});

test("inferPhase advances through a research sequence", () => {
  const mapper = createClassroomMapper();
  mapper.ingest({ kind: "user-prompt", text: "Busca noticias recientes", at: "2026-07-07T00:00:00.000Z" });
  mapper.ingest({ kind: "web-search-call", query: "world cup", at: "2026-07-07T00:00:01.000Z" });
  mapper.ingest({ kind: "web-search-end", query: "one", at: "2026-07-07T00:00:02.000Z" });
  mapper.ingest({ kind: "web-search-end", query: "two", at: "2026-07-07T00:00:03.000Z" });
  mapper.ingest({ kind: "web-search-end", query: "three", at: "2026-07-07T00:00:04.000Z" });
  mapper.ingest({ kind: "agent-message", text: "x".repeat(350), at: "2026-07-07T00:00:05.000Z" });
  mapper.ingest({ kind: "task-complete", at: "2026-07-07T00:00:06.000Z" });

  assert.deepEqual(mapper.phases().map((phase) => phase.status), ["done", "done", "done", "done", "done"]);
  assert.equal(inferPhase(phasesForTask("research"), { kind: "user-prompt", text: "Busca noticias", at: "x" })[0].status, "active");
});

test("fixture emits no voice say shell commands as tool moments", () => {
  const toolMoments = fixtureMoments().filter((moment) => moment.type === "tool");
  assert.equal(toolMoments.some((moment) => /voice say/i.test(`${moment.title} ${moment.detail} ${moment.internal ?? ""}`)), false);
});

test("fixture collapses web search events into a small number of moments", () => {
  const searchMoments = fixtureMoments().filter((moment) => moment.momentId.startsWith("search-"));
  assert.ok(searchMoments.length >= 1);
  assert.ok(new Set(searchMoments.map((moment) => moment.momentId)).size <= 3);
  assert.ok(fixtureMoments().some((moment) => moment.type === "method" && /varias fuentes/.test(moment.detail)));
});

test("fixture exposes a non-empty phase list and ends done", () => {
  const last = fixtureMoments().at(-1);
  assert.ok(last?.phases);
  assert.ok((last.phases ?? []).length >= 3);
  assert.equal(last?.phases?.at(-1)?.status, "done");
});

test("isDuplicateText catches near-identical duplicate subtitles", () => {
  assert.equal(
    isDuplicateText(
      "Voy a verificar noticias recientes en la web antes de resumirlas.",
      "Voy a verificar noticias recientes en la web antes de resumirlas.",
    ),
    true,
  );
  const subtitles = fixtureMoments().filter((moment) => moment.detail);
  for (let i = 1; i < subtitles.length; i += 1) {
    assert.equal(isDuplicateText(subtitles[i - 1].detail, subtitles[i].detail), false);
  }
});

test("fixture orientation and wrap are projection-safe", () => {
  const moments = fixtureMoments();
  const orientation = moments.find((moment) => moment.type === "orientation");
  const final = moments.at(-1);
  assert.ok(orientation);
  assert.equal(/[A-Za-z]:\\\\/.test(orientation.detail), false);
  assert.ok(orientation.detail.length <= 160);
  assert.equal(final?.type, "wrap");
  assert.ok((final?.detail.length ?? 0) <= 200);
});

test("auto narration waits for silence and deduplicates spoken text", () => {
  const moment: ClassroomMoment = {
    type: "method",
    momentId: "m1",
    title: "Comparando fuentes",
    detail: "Estoy comparando varias fuentes porque una sola fuente no basta.",
    speakable: true,
    phase: "checking",
    at: "2026-07-07T00:01:00.000Z",
  };

  assert.equal(maybeAutoNarrateMoment(moment, {
    lastExplicitCueAt: Date.parse("2026-07-07T00:00:30.000Z"),
    paused: false,
    autoNarrate: true,
  }, Date.parse(moment.at), isDuplicateText).cue, undefined);

  const decision = maybeAutoNarrateMoment(moment, {
    lastExplicitCueAt: Date.parse("2026-07-07T00:00:00.000Z"),
    paused: false,
    autoNarrate: true,
  }, Date.parse(moment.at), isDuplicateText);
  assert.equal(decision.cue?.source, "auto");
  assert.equal(decision.cue?.kind, "method");

  assert.equal(maybeAutoNarrateMoment(moment, {
    lastExplicitCueAt: Date.parse("2026-07-07T00:00:00.000Z"),
    lastSpokenText: moment.detail,
    paused: false,
    autoNarrate: true,
  }, Date.parse(moment.at), isDuplicateText).dropped, true);
});

test("fixture can produce an automatic cue during replay silence", () => {
  const moments = fixtureMoments();
  let lastExplicitCueAt = 0;
  const auto = moments.flatMap((moment) => {
    if (!moment.speakable) {
      return [];
    }
    const decision = maybeAutoNarrateMoment(moment, {
      lastExplicitCueAt,
      paused: false,
      autoNarrate: true,
    }, Date.parse(moment.at), isDuplicateText);
    if (decision.cue) {
      lastExplicitCueAt = Date.parse(decision.cue.at);
      return [decision.cue];
    }
    return [];
  });
  assert.ok(auto.some((cue) => cue.source === "auto"));
});
