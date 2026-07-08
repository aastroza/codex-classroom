# Codex Voice

Codex Voice lets Codex speak as itself during a live class.

Use it when a Codex thread will run long enough that students cannot read every update. Codex sends short cues through a skill, the local browser sidecar speaks them with `gpt-realtime-2.1-mini`, and the teacher can ask brief spoken questions about the current thread.

It is built for classroom rhythm, not narration of every command.

## How it works

Codex Voice has three parts:

- the `codex-classroom` CLI, which runs a local sidecar
- the `codex-voice` skill, which decides when a cue is worth sending
- a classroom semantic layer, which turns raw Codex events into phases, moments, and compact context

The sidecar opens a browser page. The browser handles microphone capture, audio playback, and the Realtime session. The OpenAI API key stays on the local server side.

The normal teaching flow is:

1. Start Codex Voice or Present mode.
2. Open or create a normal Codex Desktop thread.
3. Ask Codex to use `$codex-voice`.

The sidecar watches Codex Desktop `rollout-*.jsonl` session files, so it can follow threads created in the app after the sidecar starts. It also uses `codex app-server` events when that connection can attach to a thread. If app-server cannot read Desktop-created rollouts on the installed Codex version, the sidecar disables that source for the session and keeps using Desktop session files.

Codex can then send cues such as:

- "I am checking several sources because current news can change during class."
- "I am switching strategy because the app-server cannot read this Desktop thread."
- "The failing test shows the useful clue: the bug is in the command path."

The teacher can also ask:

- "Codex, what are you checking now?"
- "Codex, explain that failure in one sentence."
- "Codex, stay quiet while I explain this."
- "Codex, you can speak again."

## Quick start

Install the CLI:

```sh
npm install -g github:aastroza/codex-classroom
```

Install the skill:

```sh
codex-classroom voice install-skill
```

Restart Codex, then check the setup:

```sh
codex-classroom voice doctor
```

Start the sidecar before class:

```sh
codex-classroom voice start
```

By default it binds to `127.0.0.1:17321`, opens the browser, and uses:

- model: `gpt-realtime-2.1-mini`
- voice: `verse`
- language: `Spanish`

Useful options:

```sh
codex-classroom voice start --port 17322
codex-classroom voice start --language English
codex-classroom voice start --voice verse
codex-classroom voice start --model gpt-realtime-2.1-mini
codex-classroom voice start --no-open
codex-classroom voice start --replay src/core/fixtures/rollout-world-cup-news.jsonl
codex-classroom voice start --no-auto-narrate
```

Open a projector-friendly visual panel without starting audio:

```sh
codex-classroom present
```

`present` can run without `OPENAI_API_KEY`. It shows the current classroom task, inferred or real phases, the current moment, recent evidence, and the latest subtitle from the same local sidecar.

To open a finished or already-running thread in the panel, pass its thread id:

```sh
codex-classroom present <threadId>
```

Replay a saved rollout into Present for a demo or regression check:

```sh
codex-classroom present --replay src/core/fixtures/rollout-world-cup-news.jsonl
```

## Send cues manually

Send a plain cue:

```sh
codex-classroom voice say "I found the failing test and I am narrowing the fix."
```

Send a typed cue:

```sh
codex-classroom voice say orientation "I am framing the task so the class can see what success means."
codex-classroom voice say method "I am checking several current sources because one headline is not enough."
codex-classroom voice say evidence "The failing test now points to the command path, not the UI."
codex-classroom voice say decision "I am switching to the rollout watcher because it matches what the Desktop app records."
codex-classroom voice say risk "The app-server cannot read this Desktop thread, so I am falling back without stopping the class."
codex-classroom voice say wrap "The checks passed, so the class can try the replayable Present view."
```

Pause or resume:

```sh
codex-classroom voice pause
codex-classroom voice resume
```

Attach the sidecar to a specific Codex thread when automatic thread detection is not enough. This works with both app-server threads and Codex Desktop session files:

```sh
codex-classroom voice attach <threadId>
```

## Use the skill

The skill lives at [skills/codex-voice/SKILL.md](../skills/codex-voice/SKILL.md).

Install it when you want Codex to speak automatically during a teaching run:

```sh
codex-classroom voice install-skill
```

The skill assumes the sidecar is already running. It should send cues with `codex-classroom voice say`; it should not start the sidecar from inside an ordinary task.

Good cues are short teaching beats:

- `orientation`: frame the task
- `method`: explain the strategy
- `evidence`: point to a source, diff, or test outcome
- `decision`: explain a choice
- `risk`: name a blocker or uncertainty
- `wrap`: close with the useful result

Aim for at most 5 or 6 cues per task. Avoid cues for secrets, credentials, local paths, long terminal output, obvious file reads, or every small command in a loop. If Codex stays silent, the auto-narrator can speak sparse phase changes; explicit cues should add judgment, not coverage.

## Add thread context

Codex Voice builds context from two local sources:

- Codex Desktop session files under `~/.codex/sessions`
- `codex app-server` events, when app-server can attach to the thread

The Desktop session watcher is what makes this flow work reliably: start `codex-classroom voice start`, then create a thread in Codex Desktop, then ask that thread to use `$codex-voice`.

The context bridge maps local thread activity into compact classroom context:

- user task orientation
- search and tool activity
- inferred or real phases
- meaningful failures and checks
- final wrap moments

Run doctor to verify app-server support:

```sh
codex-classroom voice doctor
```

## Context storage

The context bridge stores recent classroom events in:

```text
~/.codex-classroom/voice/events.jsonl
```

The file is a bounded JSONL log. It keeps enough recent context for class without trying to archive the whole machine. Secret-looking values are redacted and long text is truncated.

Inspect the current context:

```sh
codex-classroom voice context
codex-classroom voice context 50
```

When the browser sidecar is open, it receives context events and shares them silently with the Realtime session. For a live class, start it before the thread begins. For an existing thread, pass the thread id to hydrate from stored session history.

## Present panel

Present mode is for the projector.

```sh
codex-classroom present
```

It opens `/present`, a focused classroom view with:

- the classroom task
- the current phase list
- the current teaching moment
- recent evidence
- the latest spoken cue or wrap as a subtitle

Pass a thread id when you want the panel to hydrate from stored thread history before listening for new updates:

```sh
codex-classroom present <threadId>
```

Use `--qr` when you want to print the panel URL for another device on the same machine or tunnel setup:

```sh
codex-classroom present --qr
```

## Implementation notes

Codex Voice is intentionally separate from Codex Desktop. It works across desktop platforms because the audio dependency is a modern browser.

The local sidecar:

- serves the browser UI
- serves the `/present` panel
- keeps the OpenAI credential server-side
- creates the Realtime session
- receives `voice say`, `pause`, `resume`, and context events
- watches Codex Desktop session files for live thread activity
- forwards compact context into the active voice session
- validates local host and origin headers
- requires a per-session token for local POST commands
- rejects oversized POST bodies
