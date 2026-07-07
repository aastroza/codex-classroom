# codex-classroom

Configuration and teaching tools for running Codex classes.

`codex-classroom` is a small CLI and project space for classroom-focused Codex workflows. The repo started with reversible classroom profiles, but it is meant to grow into a set of tools that make live Codex teaching easier.

## Features

### Classroom profiles

Status: available.

Classroom profiles open Codex Desktop with a class-ready local state. They hide your daily workspace while keeping your account and plugin setup ready.

Use this when you want to start a class from a clean interface, teach skills from scratch, and restore your real Codex state after class.

Read the full guide: [Classroom profiles](docs/classroom-profiles.md).

Quick start:

```sh
npx codex-classroom init intro
npx codex-classroom doctor intro
npx codex-classroom enter intro
```

After class:

```sh
npx codex-classroom restore
```

### Live narration

Status: planned.

Live narration will let Codex speak short, useful updates while it works in front of a class. The goal is not to read every command aloud. It is to help students follow the important moments: what Codex is trying, what changed, what failed, what it is about to verify, and when the teacher should draw attention to something.

The intended design is a voice companion built with `gpt-realtime-2.1-mini`. It should be able to:

- narrate important Codex actions in plain language
- listen while the teacher explains
- stay quiet when the teacher asks it to pause
- resume narration when asked
- add short comments when the class would otherwise miss context

This is not implemented yet.

## Current CLI

```text
codex-classroom init [profile]
codex-classroom enter [profile]
codex-classroom restore
codex-classroom rescue
codex-classroom status [profile]
codex-classroom doctor [profile]
codex-classroom profiles
codex-classroom reset [profile]
```

For command details, see [Classroom profiles](docs/classroom-profiles.md).

## Teaching principles

- Start with less on screen.
- Keep the instructor's real workspace recoverable.
- Avoid live login or credential screens when they distract from the lesson.
- Leave skills empty when installing them is part of the lesson.
- Make Codex activity easier to follow for students who cannot read every detail live.

## Platform support

The CLI is Node-based and should work on:

- macOS
- Linux
- Windows

It expects the `codex` CLI to be available on `PATH`.

## Development

```sh
npm install
npm run build
npm test
```

Run locally:

```sh
npm run dev -- status intro --dry-run
```

## License

MIT
