# Codex Classroom

Teaching support toolkit for live Codex app classes.

`codex-classroom` collects small workflows that make Codex easier to teach in front of a room. It is built for classes where students may be new to programming, new to agents, or intimidated by a busy Codex workspace.

The goal is simple: start with less on screen, keep the teacher's real setup available, and make long Codex work easier to follow.

## Why this exists

When I teach the Codex app, my real workspace is the wrong first screen. It has projects, chats, skills, plugins, automations, and long-running loops. That setup is useful for me, but it can make beginners feel that Codex is only for technical people.

At the same time, I do not want a second account just for teaching. I want to use my Pro account, the models and plugins I already rely on, higher limits, subagents, and Fast mode. In a live class, waiting breaks attention.

`codex-classroom` solves that teaching problem in three ways:

- **Classroom profiles**: temporarily open Codex Desktop with a clean local state while keeping the teacher's account and plugin setup available.
- **Codex Voice**: let Codex speak short first-person teaching cues during long agent work, and let the teacher ask spoken questions about the current thread.
- **Present mode**: open a projection-friendly panel that follows Codex plans, commands, diffs, and spoken cues without requiring the room to read the full thread.

The tools are experimental. They are meant for instructors who are willing to test their setup before class and keep a restore path ready.

## Classroom profiles

Use classroom profiles when you want to start a class from a fresh Codex app without losing your real Codex setup.

This helps when you want to:

- show the first-run Codex experience
- teach workspace and sandbox setup
- avoid exposing old chats, projects, automations, or personal workspace history
- keep your signed-in account and plugin setup ready
- teach skills from a clean slate
- return to your real workspace later and show more advanced loops

Install once:

```sh
npm install -g github:aastroza/codex-classroom
```

Basic flow:

```sh
codex-classroom init intro
codex-classroom doctor intro
codex-classroom enter intro
```

After class:

```sh
codex-classroom restore
```

Read the guide: [Classroom profiles](docs/classroom-profiles.md).

## Codex Voice

Use Codex Voice when a Codex thread will run long enough that students cannot read every update.

Codex Voice runs a local browser sidecar. Codex sends short cues through the `codex-voice` skill, the voice speaks them aloud, and the teacher can ask brief questions during class.

For the normal live-class flow, start the sidecar first, then open or create a Codex Desktop thread and ask Codex to use `$codex-voice`. The sidecar watches Codex Desktop session files, so Present mode can follow Desktop-created threads even when they were not started by the sidecar.

This helps when you want Codex to say things like:

- what it is trying now
- why it changed strategy
- what failed or passed
- what evidence the class should inspect
- when it is useful to pause

Start it:

```sh
codex-classroom voice start
```

Install the skill:

```sh
codex-classroom voice install-skill
```

Read the guide: [Codex Voice](docs/codex-voice.md).

## Present mode

Use Present mode when the projector should show only the classroom signal: the current plan, the command being run, and the latest spoken or written classroom cue.

It can run as a visual panel even when no OpenAI API key is configured for voice:

```sh
codex-classroom present
```

For an existing thread:

```sh
codex-classroom present <threadId>
```

You can also run the full voice sidecar and open the presentation panel from the same local server:

```sh
codex-classroom voice start
```

Then open `/present` on the printed local URL.

Present mode reads Codex Desktop session history and also uses `codex app-server` when available. This makes the common teaching flow work: start Present, create a normal Codex Desktop thread, and let the panel fill as Codex works.

## Teaching principles

- Start quiet.
- Add complexity only when the class is ready for it.
- Keep the instructor's real workspace recoverable.
- Avoid live credential screens unless credentials are the lesson.
- Let Codex speak only when it helps the room follow the work.
