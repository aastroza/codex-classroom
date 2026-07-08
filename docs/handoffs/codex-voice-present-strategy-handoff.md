# Codex Voice and Present Strategy Handoff

This handoff is for a follow-up agent that should improve the classroom strategy for Codex Voice and Present mode.

The current implementation works mechanically, but the teaching value is weak. In the reference test thread, Present did not become a useful classroom surface, and the spoken voice cues were too generic. The next pass should focus less on transport and more on editorial judgment: what should be surfaced, when, and in what form.

## Reference Thread

Thread id:

```text
019f3e7e-bf97-71d3-9b9f-f246a0d4859b
```

Local rollout file:

```text
C:\Users\Alonso\.codex\sessions\2026\07\07\rollout-2026-07-07T17-32-01-019f3e7e-bf97-71d3-9b9f-f246a0d4859b.jsonl
```

User prompt in that thread:

```text
Busca en Internet las noticias mas importantes sobre el mundial de futbol de las ultimas 24 horas. Usa [$codex-voice](C:\Users\Alonso\.codex\skills\codex-voice\SKILL.md) para narrar lo que estas haciendo.
```

Observed issue:

- Present stayed mostly unhelpful as a teaching surface.
- The voice spoke, but the content was mediocre: it narrated process instead of adding classroom value.
- The voice cues did not make the room smarter about the task.
- Present mostly mirrored raw activity instead of distilling the work.

## Current Architecture

`codex-classroom voice start` runs a local HTTP sidecar. It serves:

- `/`: browser UI for microphone, playback, Realtime session, and manual cues
- `/present`: projector-friendly classroom panel
- `/events`: Server-Sent Events stream consumed by both pages
- `/cue`: local POST endpoint for `codex-classroom voice say`
- `/context-event`: local POST endpoint for local context injection
- `/attach`: local POST endpoint to attach a specific thread id
- `/context`: recent compact context from `~/.codex-classroom/voice/events.jsonl`

The sidecar currently receives context from two places:

- Codex Desktop rollout files under `~/.codex/sessions`
- `codex app-server`, when it can attach to a thread

The code lives mainly in:

- `src/commands/voice.ts`
- `src/core/rollout-watcher.ts`
- `src/core/event-mapper.ts`
- `src/core/app-server-client.ts`
- `src/core/voice-context.ts`
- `skills/codex-voice/SKILL.md`

## App-Server Data for the Reference Thread

The current app-server probe was run against the reference thread. The important result is that app-server starts and initializes, but cannot read this Codex Desktop rollout.

Probe output:

```json
{
  "initialize": {
    "userAgent": "Codex Desktop/0.140.0 (Windows 10.0.19045; x86_64) dumb (codex_classroom; 0.7.1)",
    "codexHome": "C:\\Users\\Alonso\\.codex",
    "platformFamily": "windows",
    "platformOs": "windows"
  },
  "loaded": {
    "data": [],
    "nextCursor": null
  },
  "resume": {
    "error": "{\"code\":-32603,\"message\":\"failed to read thread: thread-store internal error: failed to read thread C:\\\\Users\\\\Alonso\\\\.codex\\\\sessions\\\\2026\\\\07\\\\07\\\\rollout-2026-07-07T17-32-01-019f3e7e-bf97-71d3-9b9f-f246a0d4859b.jsonl: rollout at C:\\\\Users\\\\Alonso\\\\.codex\\\\sessions\\\\2026\\\\07\\\\07\\\\rollout-2026-07-07T17-32-01-019f3e7e-bf97-71d3-9b9f-f246a0d4859b.jsonl does not start with session metadata\"}"
  },
  "read": {
    "error": "{\"code\":-32603,\"message\":\"failed to read thread: thread-store internal error: failed to read thread C:\\\\Users\\\\Alonso\\\\.codex\\\\sessions\\\\2026\\\\07\\\\07\\\\rollout-2026-07-07T17-32-01-019f3e7e-bf97-71d3-9b9f-f246a0d4859b.jsonl: rollout at C:\\\\Users\\\\Alonso\\\\.codex\\\\sessions\\\\2026\\\\07\\\\07\\\\rollout-2026-07-07T17-32-01-019f3e7e-bf97-71d3-9b9f-f246a0d4859b.jsonl does not start with session metadata\"}"
  }
}
```

Implication:

- Do not assume app-server can read Desktop-created threads.
- The rollout watcher is currently the only reliable source for this reference thread.
- app-server can still be useful for future threads if its version/schema aligns with Desktop, but it should not be the only source.

## Rollout Data for the Reference Thread

Parsed raw rollout summary:

```json
{
  "lines": 68,
  "rawCounts": {
    "session_meta": 1,
    "event_msg": 24,
    "response_item": 42,
    "turn_context": 1
  },
  "payloadCounts": {
    "task_started": 1,
    "message": 9,
    "user_message": 1,
    "reasoning": 14,
    "agent_message": 6,
    "function_call": 5,
    "function_call_output": 5,
    "token_count": 6,
    "web_search_end": 9,
    "web_search_call": 9,
    "task_complete": 1
  }
}
```

Mapped output produced by the current `rollout-watcher`:

```json
{
  "mapped": 24,
  "presentCounts": {
    "subtitle": 14,
    "command": 10
  },
  "contextKinds": {
    "turn-started": 1,
    "assistant-message": 7,
    "agent-message": 6,
    "command-started": 5,
    "command-completed": 5
  }
}
```

Representative first Present events:

```json
[
  {
    "type": "subtitle",
    "text": "Codex started working."
  },
  {
    "type": "subtitle",
    "text": "Busca en Internet las noticias mas importantes sobre el mundial de futbol de las ultimas 24 horas. Usa [$codex-voice](C:\\\\Users\\\\Alonso\\\\.codex\\\\skills\\\\codex-voice\\\\SKILL.md) para narrar lo que estas haciendo."
  },
  {
    "type": "subtitle",
    "text": "Voy a usar la skill `codex-voice` porque la pediste explicitamente, y voy a verificar noticias recientes en la web antes de resumirlas. Primero leo sus instrucciones para seguir el modo de narracion correcto."
  },
  {
    "type": "command",
    "command": "Get-Content -Raw C:\\Users\\Alonso\\.codex\\skills\\codex-voice\\SKILL.md",
    "status": "running"
  }
]
```

Representative last Present events:

```json
[
  {
    "type": "command",
    "command": "codex-classroom voice say note \"Ya reuni fuentes recientes y estoy separando resultados cerrados de partidos en vivo; observen que las notas importantes salen de varias fuentes, no de un solo titular.\"",
    "status": "running"
  },
  {
    "type": "command",
    "command": "codex-classroom voice say verified \"Ya verifique las noticias principales con fuentes recientes; ahora voy a entregar un resumen que distingue resultados confirmados de coberturas aun en vivo.\"",
    "status": "passed",
    "exitCode": 0
  },
  {
    "type": "subtitle",
    "text": "**Resumen Ultimas 24 Horas** Estas son las noticias mas importantes del Mundial 2026 que encontre hasta hoy, **martes 7 de julio de 2026**: 1. **Argentina remonto 3-2 a Egipto y paso a cuartos** La vigente campeona estuvo 0-2 abajo, pero reacciono con goles d..."
  }
]
```

## What Present Currently Shows

The Present panel UI is rendered in `renderPresentPage()` inside `src/commands/voice.ts`.

It keeps four pieces of browser state:

- `plan`: latest `PresentEvent` of type `plan`
- `now`: latest `PresentEvent` of type `command`
- `diff`: latest `PresentEvent` of type `diff`
- `subtitle`: latest `PresentEvent` of type `subtitle`

The display has:

- title: "Codex is working"
- left card: "Plan"
- right card: "Now"
- bottom subtitle bar
- optional diff pill

Current event behavior:

- `subtitle` replaces the bottom bar text.
- `command` replaces the "Now" card.
- `plan` replaces the "Plan" card.
- `diff` is tracked, but the rollout watcher currently does not generate diff events.

Why this failed pedagogically:

- There was no `update_plan` call in the reference thread, so the Plan card stayed empty.
- Web search activity was not represented well. Raw `web_search_call` and `web_search_end` payloads exist, but the mapper ignores them.
- The panel showed terminal/skill mechanics, not the classroom story.
- Duplicate assistant/agent messages were mapped twice in some cases.
- `voice say` commands appeared as commands, which is noisy. They are already cues; Present should treat them as spoken teaching beats, not as terminal work.

## What Voice Currently Receives

Voice receives explicit cues through:

```sh
codex-classroom voice say <kind> "<text>"
```

The sidecar stores those cues as:

- `VoiceCue` in memory
- `VoiceContextEvent` in `~/.codex-classroom/voice/events.jsonl`
- `subtitle` Present events

The Realtime browser session also receives context events from `/events`, but the current strategy relies too much on Codex voluntarily calling `voice say` at good moments.

In the reference thread, the explicit voice cues were:

```text
Ya reuni fuentes recientes y estoy separando resultados cerrados de partidos en vivo; observen que las notas importantes salen de varias fuentes, no de un solo titular.
Ya verifique las noticias principales con fuentes recientes; ahora voy a entregar un resumen que distingue resultados confirmados de coberturas aun en vivo.
```

These are acceptable but not strong:

- They say what happened, but not enough about why students should care.
- They do not explain the search strategy concretely.
- They do not translate tool activity into concepts.
- They do not create a classroom moment, question, or visual focus.

## Current Skill Weakness

The skill file is:

```text
skills/codex-voice/SKILL.md
```

It tells Codex to send "teaching beats" and gives examples. The weak point is not that it lacks instructions, but that the instructions are still too broad.

Observed behavior:

- Codex narrated that it was using the skill.
- Codex narrated that it was gathering sources.
- Codex did not produce a clear "classroom translation" of the task.
- Codex did not give Present enough structured state.

The skill should probably force a stronger cue taxonomy:

- "orientation": what kind of task this is
- "method": how Codex will approach it
- "evidence": what students should inspect
- "decision": why Codex chooses one branch over another
- "risk": what could be wrong or incomplete
- "wrap": what changed or what was learned

## Main Strategic Problem

The current system maps events too literally.

That creates two bad outcomes:

1. Present becomes a debug console with prettier styling.
2. Voice becomes a shallow narrator of activity.

The classroom needs a semantic layer between raw thread events and classroom output.

Raw event:

```text
web_search_call
```

Bad classroom output:

```text
Codex is searching the web.
```

Better classroom output:

```text
Codex is checking multiple current sources before summarizing because news can change quickly.
```

Raw event:

```text
codex-classroom voice say verified ...
```

Bad Present output:

```text
Command passed: codex-classroom voice say verified ...
```

Better Present output:

```text
Verified: recent sources checked; final summary separates confirmed results from live coverage.
```

## Recommended Next Design

Add a classroom event layer.

Instead of sending raw mapped events directly to Present and context, introduce an intermediate event type:

```ts
type ClassroomMoment =
  | { type: "orientation"; title: string; detail: string }
  | { type: "method"; title: string; detail: string }
  | { type: "tool"; title: string; detail: string; status: "running" | "done" | "failed" }
  | { type: "evidence"; title: string; detail: string }
  | { type: "decision"; title: string; detail: string }
  | { type: "risk"; title: string; detail: string }
  | { type: "wrap"; title: string; detail: string };
```

Then map `ClassroomMoment` to:

- Present cards
- Voice context
- optional automatic voice suggestions

This would let Present show:

- What problem is being solved
- What phase Codex is in
- What evidence is on screen
- What changed since the last moment
- What the teacher might pause to explain

## Specific Improvements to Investigate

### 1. Ignore `voice say` as command noise

Currently `codex-classroom voice say ...` appears as a command in Present.

Instead:

- parse it as a cue event
- display the spoken text as a subtitle
- do not make it the main "Now" command

### 2. Map web search events

The reference rollout includes:

- `web_search_call`: 9
- `web_search_end`: 9

These are currently ignored.

For a news task, those are the most important classroom events. Present should show something like:

```text
Checking current sources
Comparing recent reports before summarizing.
```

### 3. Generate a synthetic plan when no `update_plan` exists

The reference thread had no mapped `plan` events.

Present should not leave Plan empty. For common task patterns, infer a coarse plan:

- Understand the prompt
- Gather evidence
- Compare/check sources
- Produce answer

For coding tasks:

- Inspect context
- Identify change
- Edit
- Verify
- Summarize

### 4. Deduplicate agent and assistant messages

The rollout often contains both `agent_message` and `message` with nearly identical content.

Add a rolling text hash or similarity check before emitting another subtitle.

### 5. Separate "teacher-facing" from "student-facing"

`VoiceContextEvent.summary` can be detailed. Present and voice cues should be edited down.

Add fields like:

```ts
{
  internalSummary: string;
  classroomTitle: string;
  classroomSubtitle: string;
  speakable: boolean;
}
```

### 6. Make the skill produce structured cues

The current CLI accepts only free text. Consider adding:

```sh
codex-classroom voice say evidence "I found three current sources that agree on the main result."
codex-classroom voice say method "I am checking multiple sources because sports news can change while matches are live."
```

Or keep CLI kinds stable and put tags in the cue payload if the skill can call a richer command later.

### 7. Add automatic classroom summarization

The sidecar could run a lightweight local summarizer or a Realtime instruction pattern over recent context:

- input: last N raw events
- output: one classroom moment

This avoids depending entirely on Codex to remember to speak well.

The first version can be rule-based:

- web search started -> "Checking current sources"
- many web searches finished -> "Comparing sources"
- final assistant message -> "Ready to summarize"
- command failed -> "Blocked by setup/check failure"

## Debug Commands for the Next Agent

Run build and tests:

```sh
npm run build
npm test
```

Open Present for the reference thread:

```sh
node dist\cli.js present 019f3e7e-bf97-71d3-9b9f-f246a0d4859b --no-open --port 17324
```

Inspect the SSE stream:

```sh
node --input-type=module -e "const req=await fetch('http://127.0.0.1:17324/events'); const reader=req.body.getReader(); let text=''; const deadline=Date.now()+1500; while(Date.now()<deadline){ const r=await Promise.race([reader.read(), new Promise(resolve=>setTimeout(()=>resolve(null),200))]); if(!r) continue; if(r.done) break; text += new TextDecoder().decode(r.value); } await reader.cancel(); console.log(text);"
```

Analyze rollout mapping:

```sh
node --input-type=module -e "import fs from 'node:fs'; import { mapRolloutText } from './dist/core/rollout-watcher.js'; const file='C:/Users/Alonso/.codex/sessions/2026/07/07/rollout-2026-07-07T17-32-01-019f3e7e-bf97-71d3-9b9f-f246a0d4859b.jsonl'; const events=mapRolloutText(fs.readFileSync(file,'utf8')); console.log(JSON.stringify(events.filter(e=>e.present).map(e=>e.present), null, 2));"
```

Probe app-server:

```sh
node --input-type=module -e "import { AppServerClient } from './dist/core/app-server-client.js'; const client=new AppServerClient(); try { await client.start(); console.log(await client.initialize()); console.log(await client.loadedThreads()); console.log(await client.resumeThread('019f3e7e-bf97-71d3-9b9f-f246a0d4859b')); } finally { client.stop(); }"
```

## Acceptance Criteria for the Next Pass

A good next version should make this reference thread understandable to a nontechnical classroom.

Minimum bar:

- Present shows a non-empty plan or phase list even when the thread did not call `update_plan`.
- Present does not show `codex-classroom voice say ...` as the main command.
- Web search activity becomes a meaningful classroom moment.
- Duplicate messages are reduced.
- Voice cues explain why the step matters, not only what Codex is doing.
- The final state distinguishes "sources gathered", "claims checked", and "answer ready".

The goal is not more narration. The goal is better classroom signal.
