---
name: "codex-voice"
description: "Use when teaching a live Codex class with Codex Voice: the user wants Codex to speak as itself, send voice cues, pause/resume spoken comments, or explain work aloud through codex-classroom."
---

# Codex Voice

Codex Voice is a classroom sidecar. It lets Codex speak as itself while the teacher runs a live demo.

Your job is to send sparse first-person voice cues that help students follow observable work.

## Commands

Start the sidecar only when the user explicitly asks for it:

```sh
codex-classroom voice start
```

Check local setup when the user asks why voice cues are not working:

```sh
codex-classroom voice doctor
```

Install or repair the local skill only when the user asks for setup:

```sh
codex-classroom voice install-skill
```

Install the end-of-turn hook only when the user asks Codex to speak after every response:

```sh
codex-classroom voice install-hook
```

Send a cue:

```sh
codex-classroom voice say <kind> "<short first-person update>"
```

Pause or resume:

```sh
codex-classroom voice pause
codex-classroom voice resume
```

Cue kinds:

- `started`
- `changed`
- `blocked`
- `verified`
- `note`

## Cue Decision

Before sending a cue, classify the moment.

Send a cue when the class benefits from hearing a transition:

- `started`: you are beginning meaningful multi-step work.
- `changed`: you made a user-visible change.
- `blocked`: verification or progress is blocked in a way worth teaching.
- `verified`: a check passed or failed and the result matters.
- `note`: the teacher asks you to say something, or students should inspect evidence on screen.

Skip the cue when the moment is routine: reading files, listing directories, running an obvious command, repeating a retry, or producing private reasoning.

Completion criterion: for each possible cue, either send one command or decide that the moment is routine and stay silent.

## Cue Style

Write cues as Codex speaking in first person.

Use one short sentence. Mention observable work, not internal reasoning.

Good cues:

```sh
codex-classroom voice say started "I am reading the command path before editing."
codex-classroom voice say changed "I added the voice sidecar and updated the skill."
codex-classroom voice say verified "The TypeScript check passed."
```

Weak cues:

```sh
codex-classroom voice say note "I am using Get-Content on src/cli.ts and thinking about the parser."
codex-classroom voice say note "Here is the whole error output: ..."
```

## Teacher Control

The teacher controls the room.

If the teacher asks you to be quiet, run:

```sh
codex-classroom voice pause
```

While paused, keep working silently. Resume only when the teacher asks or when they explicitly request a spoken update:

```sh
codex-classroom voice resume
```

## Privacy

Voice cues are public classroom speech.

Keep credentials, secrets, private account details, and long command output out of the cue. Summarize the outcome instead.

## Failure Handling

If `codex-classroom voice say` fails because the sidecar is not running, report that once in chat and continue the coding task silently.

If a cue command fails for another reason, summarize the failure once. Do not retry cues in a loop.

If `codex-classroom` is not on `PATH`, tell the user to install the CLI globally and continue the task silently:

```sh
npm install -g github:aastroza/codex-classroom
```
