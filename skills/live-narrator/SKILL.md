---
name: "live-narrator"
description: "Use during live Codex classroom demos to emit concise narration cues through codex-classroom."
---

# Live Narrator

Use this skill when the teacher wants Codex activity narrated during a live class.

The narrator is a sidecar started with:

```sh
codex-classroom narrator start
```

Send cues with:

```sh
codex-classroom narrator say <kind> "<short classroom update>"
```

Supported cue kinds:

- `started`
- `changed`
- `blocked`
- `verified`
- `note`

Pause or resume narration:

```sh
codex-classroom narrator pause
codex-classroom narrator resume
```

## When to Send a Cue

Send a cue only when it helps students follow the work:

- before a meaningful multi-step action
- after a user-visible change
- when a command fails in a way worth teaching
- when verification passes or fails
- when the class should look at evidence on screen

Do not send cues for routine file reads, obvious shell commands, repeated retries, or private reasoning.

Never include credentials or secrets. Summarize command output instead of reading it aloud.

## Cue Style

Write one short sentence in English for the cue text. The voice narrator will adapt it to the configured spoken language.

Good cues:

```sh
codex-classroom narrator say started "Codex is reading the command path before editing."
codex-classroom narrator say changed "Codex added the narrator sidecar and a skill for sparse cues."
codex-classroom narrator say verified "The TypeScript check and test suite passed."
```

Poor cues:

```sh
codex-classroom narrator say note "I am using Get-Content on src/cli.ts and thinking about the parser."
codex-classroom narrator say note "Here is the whole error output: ..."
```

## Operating Rules

- Keep cues sparse.
- Never include secrets or private account details.
- Prefer observable work over internal reasoning.
- If the teacher asks for silence, run `codex-classroom narrator pause`.
- If narration is paused, do not resume unless the teacher asks or the task clearly requires it.
