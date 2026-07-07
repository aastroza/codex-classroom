---
name: "codex-voice"
description: "Use during live Codex classroom demos to let Codex speak concise first-person cues through codex-classroom."
---

# Codex Voice

Use this skill when the teacher wants Codex to speak as itself during a live class.

Codex Voice is a sidecar started with:

```sh
codex-classroom voice start
```

Send cues with:

```sh
codex-classroom voice say <kind> "<short first-person classroom update>"
```

Supported cue kinds:

- `started`
- `changed`
- `blocked`
- `verified`
- `note`

Pause or resume Codex Voice:

```sh
codex-classroom voice pause
codex-classroom voice resume
```

## When to Send a Cue

Send a cue only when it helps students follow your work:

- before a meaningful multi-step action
- after a user-visible change
- when a command fails in a way worth teaching
- when verification passes or fails
- when the class should look at evidence on screen

Do not send cues for routine file reads, obvious shell commands, repeated retries, or private reasoning.

Never include credentials or secrets. Summarize command output instead of reading it aloud.

## Cue Style

Write one short first-person sentence in English for the cue text. Codex Voice will adapt it to the configured spoken language.

Good cues:

```sh
codex-classroom voice say started "I am reading the command path before editing."
codex-classroom voice say changed "I added the voice sidecar and a skill for sparse cues."
codex-classroom voice say verified "The TypeScript check and test suite passed."
```

Poor cues:

```sh
codex-classroom voice say note "I am using Get-Content on src/cli.ts and thinking about the parser."
codex-classroom voice say note "Here is the whole error output: ..."
```

## Operating Rules

- Keep cues sparse.
- Never include secrets or private account details.
- Prefer observable work over internal reasoning.
- If the teacher asks for silence, run `codex-classroom voice pause`.
- If Codex Voice is paused, do not resume unless the teacher asks or the task clearly requires it.
