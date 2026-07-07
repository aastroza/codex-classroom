# Codex Classroom

Configuration and teaching tools for running Codex classes.

`codex-classroom` collects classroom workflows that make Codex easier to teach live.

## Classroom profiles

Classroom profiles open Codex Desktop with a class-ready local state.

They keep your account and plugin setup available, but hide your daily workspace. This gives students a clean first screen while still letting you use the plugins you already trust. Skills start empty, because installing or creating them is often part of the lesson.

Use classroom profiles when you want to demonstrate Codex from a clean interface, show Windows sandbox setup, teach skills from scratch, and restore your real Codex state after class.

Read the guide: [Classroom profiles](docs/classroom-profiles.md).

## Codex Voice

Codex Voice lets Codex speak as itself during a live class.

While Codex works, it can say short first-person updates about the parts students need to notice: what it is trying, what changed, what failed, what it is checking, and when the class should pause to look at evidence. It is not meant to read every command aloud.

Codex Voice uses `gpt-realtime-2.1-mini` as a voice companion. It listens while the teacher explains, answers brief spoken questions, stays quiet when asked, and resumes when useful again. This makes the demo feel more like a conversation between Codex and the professor.

Codex Voice ships as a CLI plus a skill. Install the CLI globally, run `codex-classroom voice install-skill`, and use `codex-classroom voice doctor` to check that the current Codex setup can find it. A removable `Stop` hook can make Codex speak when a turn ends.

Read the guide: [Codex Voice](docs/codex-voice.md).

## Teaching principles

- Start with less on screen.
- Keep the instructor's real workspace recoverable.
- Avoid live login or credential screens when they distract from the lesson.
- Leave skills empty when installing them is part of the lesson.
- Make Codex activity easier to follow for students who cannot read every detail live.
- Turn long agent work into reusable class material.
