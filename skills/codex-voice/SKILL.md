---
name: "codex-voice"
description: "Use when teaching a live Codex class with Codex Voice: the user wants Codex to speak as itself, send voice cues, pause/resume spoken comments, or explain work aloud through codex-classroom."
---

# Codex Voice

Codex Voice is a classroom sidecar. It lets Codex speak as itself while the teacher runs a live demo.

Your job is not to narrate every step. Your job is to send a few first-person teaching beats that help students understand why the current work matters.

## Commands

Start the sidecar only when the user explicitly asks for it:

```sh
codex-classroom voice start
```

Check local setup when the user asks why voice cues are not working:

```sh
codex-classroom voice doctor
```

Open the projection panel when the teacher wants a visual classroom view:

```sh
codex-classroom present
```

If the teacher already started `codex-classroom voice start` or `codex-classroom present`, do not start another sidecar. Send cues into the running sidecar as the thread progresses.

Install or repair the local skill only when the user asks for setup:

```sh
codex-classroom voice install-skill
```

Inspect recorded thread context when the teacher asks what the voice knows:

```sh
codex-classroom voice context
```

Attach the sidecar to a specific thread when automatic detection is not enough:

```sh
codex-classroom voice attach <threadId>
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

- `orientation`: name the task or frame the work.
- `method`: explain the strategy.
- `evidence`: point to a result, source, diff, or test outcome.
- `decision`: explain a choice or change of direction.
- `risk`: name a blocker, failure, or uncertainty.
- `wrap`: close the loop with the useful result.

Legacy aliases still work: `started` maps to `method`, `changed` and `note` map to `evidence`, `blocked` maps to `risk`, and `verified` maps to `wrap`.

## Editorial Quota

Send at most 5 or 6 cues per task, and usually no more than one cue per kind.

Every cue must answer this question:

```text
Why does this matter to someone who does not code?
```

The auto-narrator already covers phase transitions when you stay silent. Your cues are for judgment: decisions, evidence, risk, and the final meaning of the work.

Never narrate that you are using this skill or reading its instructions. Never repeat the meaning of your previous cue. Never include local paths.

## Cue Examples

Orientation:

```sh
codex-classroom voice say orientation "I am turning the student's question into a concrete task so the class can follow what success will look like."
```

Bad:

```sh
codex-classroom voice say orientation "Voy a usar la skill codex-voice porque la pediste explicitamente..."
```

Method:

```sh
codex-classroom voice say method "I am checking several current sources because recent news can change during the workshop."
```

Bad:

```sh
codex-classroom voice say method "I am reading a file."
```

Evidence:

```sh
codex-classroom voice say evidence "The failing test now gives us the useful clue: the bug is in the command path, not the UI."
```

Bad:

```sh
codex-classroom voice say evidence "Ya reuni fuentes recientes y estoy separando resultados cerrados..."
```

Decision:

```sh
codex-classroom voice say decision "I am switching to the rollout watcher because it matches what students can see in the Desktop app."
```

Bad:

```sh
codex-classroom voice say decision "I will try something else."
```

Risk:

```sh
codex-classroom voice say risk "The app-server cannot read this Desktop thread, so I am falling back to the local session log instead of stopping the class."
```

Bad:

```sh
codex-classroom voice say risk "There was an error."
```

Wrap:

```sh
codex-classroom voice say wrap "The checks passed, so the class can now test the new Present view with a replay instead of waiting for a live thread."
```

Bad:

```sh
codex-classroom voice say wrap "Done."
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

Keep credentials, secrets, private account details, local paths, and long command output out of the cue. Summarize the outcome instead.

## Failure Handling

If `codex-classroom voice say` fails because the sidecar is not running, report that once in chat and continue the coding task silently.

If a cue command fails for another reason, summarize the failure once. Do not retry cues in a loop.

If `codex-classroom` is not on `PATH`, tell the user to install the CLI globally and continue the task silently:

```sh
npm install -g github:aastroza/codex-classroom
```
