# Live narration

Live narration gives Codex a voice during a class without coupling the feature to one operating system.

The first version runs as a local sidecar:

- `codex-classroom narrator start` opens a local browser console.
- The browser captures the teacher's microphone and plays the narrator audio through WebRTC.
- The local CLI keeps the OpenAI credential on the local server side and sends session setup to the Realtime API.
- `codex-classroom narrator say` sends short classroom cues into the active narrator session.
- The `live-narrator` skill teaches Codex when a cue is worth sending.

This is intentionally separate from Codex Desktop. It works the same way across desktop platforms because the only audio dependency is a modern browser.

## Start the narrator

```sh
codex-classroom narrator start
```

By default the server binds to `127.0.0.1:17321`, opens the browser, and uses:

- model: `gpt-realtime-2.1-mini`
- voice: `marin`
- language: `Spanish`

Useful options:

```sh
codex-classroom narrator start --port 17322
codex-classroom narrator start --language English
codex-classroom narrator start --voice marin
codex-classroom narrator start --model gpt-realtime-2.1-mini
codex-classroom narrator start --no-open
```

## Send cues

Send a plain cue:

```sh
codex-classroom narrator say "Codex found the failing test and is narrowing the fix."
```

Send a typed cue:

```sh
codex-classroom narrator say started "Codex is reading the repository before editing."
codex-classroom narrator say changed "Codex updated the README and added a focused test."
codex-classroom narrator say blocked "Codex cannot verify audio without a configured OpenAI credential."
codex-classroom narrator say verified "TypeScript and tests passed."
```

Pause or resume narration:

```sh
codex-classroom narrator pause
codex-classroom narrator resume
```

## Skill

The skill lives at [skills/live-narrator/SKILL.md](../skills/live-narrator/SKILL.md).

Install or copy it into a Codex skills directory when you want Codex to send cues automatically during a teaching run. The skill keeps narration sparse: it should mark meaningful transitions, not every command.

## Classroom guidance

Use narration for moments students might miss:

- the intent before a multi-step change
- the result of a failing or passing test
- a meaningful file or behavior change
- a blocker worth explaining out loud
- evidence students should inspect on screen

Avoid narration for:

- secrets, credentials, account screens, or private paths
- long terminal output
- obvious file reads
- every small command in a loop
- moments when the teacher is already explaining the same thing
