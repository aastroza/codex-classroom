---
name: "codex-voice"
description: "Use when teaching a live Codex class with Codex Voice: the user wants Codex to speak as itself, send voice cues, pause/resume spoken comments, or explain work aloud through codex-classroom."
---

# Codex Voice

Codex Voice is a classroom sidecar. It lets Codex speak as itself while the teacher runs a live demo.

Your job is to send first-person teaching beats that help students follow observable work.

A teaching beat is a short spoken update at a meaningful transition. It tells the class what you are doing, why it matters, and what evidence or result to notice.

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

## Teaching beat coverage

Before sending a cue, classify the moment.

Send a cue for every teaching beat:

- `started`: you are beginning a new phase such as implementation or verification.
- `changed`: you made or are about to make a user-visible change in behavior or teaching material.
- `blocked`: an assumption failed, an API rejected a request, a command failed, a setup dependency is missing, or progress needs a decision.
- `verified`: a check passed or failed, a manual test confirms behavior, a package/build result matters, or a commit/push completed.
- `note`: the teacher asks you to explain, students should inspect evidence on screen, or you are switching strategy.

Routine commands can stay silent when they do not change the story: simple file reads, directory listing, repeated retries, or mechanical formatting.

Coverage criterion: every meaningful phase has at least one cue. If you work through several tool calls without speaking, send a `note` cue at the next transition that summarizes the progress.

## Cue Style

Write cues as Codex speaking in first person.

Use one sentence, or two short clauses. Include enough context for students who cannot read the screen quickly.

Prefer this shape:

```text
I am <doing X> because <class-relevant reason>; watch <evidence/result>.
```

Keep private reasoning out of the cue. Explain observable strategy and evidence.

Good cues:

```sh
codex-classroom voice say started "I am checking the CLI command path before editing so the class can see where voice setup lives."
codex-classroom voice say changed "I added install and doctor commands; watch how the skill now has a reproducible setup path."
codex-classroom voice say blocked "The API rejected the response event shape, so I am simplifying it to the documented Realtime event."
codex-classroom voice say verified "The TypeScript check and package dry run passed, so the shipped CLI includes the voice files."
```

Weak cues:

```sh
codex-classroom voice say note "I am reading a file."
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
