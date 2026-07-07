# Codex Voice

Codex Voice lets Codex speak as itself during a class without coupling the feature to one operating system.

The first version runs as a local sidecar:

- `codex-classroom voice start` opens a local browser console.
- The browser captures the teacher's microphone and plays Codex's audio through WebRTC.
- The local CLI keeps the OpenAI credential on the local server side and sends session setup to the Realtime API.
- `codex-classroom voice say` sends short classroom cues into the active voice session.
- The `codex-voice` skill teaches Codex when a cue is worth sending.

This is intentionally separate from Codex Desktop. It works the same way across desktop platforms because the only audio dependency is a modern browser.

## Start the voice

```sh
codex-classroom voice start
```

By default the server binds to `127.0.0.1:17321`, opens the browser, and uses:

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

## Send cues

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

Pause or resume Codex Voice:

```sh
codex-classroom voice pause
codex-classroom voice resume
```

## Skill

The skill lives at [skills/codex-voice/SKILL.md](../skills/codex-voice/SKILL.md).

Install or copy it into a Codex skills directory when you want Codex to send cues automatically during a teaching run. The skill keeps Codex's spoken comments sparse: it should mark meaningful transitions, not every command.

## Classroom guidance

Use Codex Voice for moments students might miss:

- the intent before a multi-step change
- the result of a failing or passing test
- a meaningful file or behavior change
- a blocker worth explaining out loud
- evidence students should inspect on screen

Avoid spoken comments for:

- secrets, credentials, account screens, or private paths
- long terminal output
- obvious file reads
- every small command in a loop
- moments when the teacher is already explaining the same thing

## Teacher conversation

The teacher can talk to Codex through the browser tab. Keep that exchange short during class:

- "Codex, what are you checking now?"
- "Codex, explain that failure in one sentence."
- "Codex, stay quiet while I explain this."
- "Codex, you can speak again."
