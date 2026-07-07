# Codex Voice

Codex Voice lets Codex speak as itself during a live class.

Use it when a Codex thread will run long enough that students cannot read every update. Codex sends short cues through a skill, the local browser sidecar speaks them with `gpt-realtime-2.1-mini`, and the teacher can ask brief spoken questions about the current thread.

It is built for classroom rhythm, not narration of every command.

## How it works

Codex Voice has three parts:

- the `codex-classroom` CLI, which runs a local sidecar
- the `codex-voice` skill, which decides when a cue is worth sending
- a context bridge, which watches Codex Desktop sessions and uses Codex app-server when available

The sidecar opens a browser page. The browser handles microphone capture, audio playback, and the Realtime session. The OpenAI API key stays on the local server side.

The normal teaching flow is:

1. Start Codex Voice or Present mode.
2. Open or create a normal Codex Desktop thread.
3. Ask Codex to use `$codex-voice`.

The sidecar watches Codex Desktop `rollout-*.jsonl` session files, so it can follow threads created in the app after the sidecar starts. It also uses `codex app-server` events when that connection can attach to a thread.

Hooks are still available as an extra fallback for older setups:

```sh
codex-classroom voice start --context-source hooks
codex-classroom voice start --context-source both
```

Codex can then send cues such as:

- "I am checking why the test failed."
- "I changed strategy because the config path was wrong."
- "This is a good moment to inspect the diff."

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
- voice: `marin`
- language: `Spanish`

Useful options:

```sh
codex-classroom voice start --port 17322
codex-classroom voice start --language English
codex-classroom voice start --voice marin
codex-classroom voice start --model gpt-realtime-2.1-mini
codex-classroom voice start --no-open
```

Open a projector-friendly visual panel without starting audio:

```sh
codex-classroom present
```

`present` can run without `OPENAI_API_KEY`. It shows plan, command, and cue updates from the same local sidecar.

To open a finished or already-running thread in the panel, pass its thread id:

```sh
codex-classroom present <threadId>
```

## Send cues manually

Send a plain cue:

```sh
codex-classroom voice say "I found the failing test and I am narrowing the fix."
```

Send a typed cue:

```sh
codex-classroom voice say started "I am reading the repository before editing."
codex-classroom voice say changed "I updated the README and added a focused test."
codex-classroom voice say blocked "I cannot verify audio without a configured OpenAI credential."
codex-classroom voice say verified "TypeScript and tests passed."
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

- the intent before a multi-step change
- why a strategy changed
- the result of a failing or passing test
- a meaningful file or behavior change
- a blocker worth explaining out loud
- evidence students should inspect on screen

Avoid cues for secrets, credentials, long terminal output, obvious file reads, or every small command in a loop.

## Add thread context

Codex Voice builds context from two local sources:

- Codex Desktop session files under `~/.codex/sessions`
- `codex app-server` events, when app-server can attach to the thread

The Desktop session watcher is what makes this flow work reliably: start `codex-classroom voice start`, then create a thread in Codex Desktop, then ask that thread to use `$codex-voice`.

The context bridge maps local thread activity into compact classroom context:

- plan updates
- command starts and completions
- meaningful failures or successful checks
- turn completion

Run doctor to verify app-server support:

```sh
codex-classroom voice doctor
```

Classroom hooks are still useful as an end-of-turn cue source:

```sh
codex-classroom voice install-hook
```

Then open `/hooks` in Codex and trust the new hook. Codex requires review before non-managed command hooks run.

The hook set records:

- `UserPromptSubmit`: the next classroom task
- `PostToolUse`: important tool outcomes
- `Stop`: the end of a Codex turn

The `Stop` hook also sends a short final spoken cue when the sidecar is running.

Remove hooks after class:

```sh
codex-classroom voice uninstall-hook
```

The hooks exit successfully even when the sidecar is not running, so they should not block Codex.

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

- the current plan
- the current command
- the latest cue as a subtitle

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
