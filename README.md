# Codex Classroom

Configuration and teaching tools for running Codex classes.

`codex-classroom` collects classroom workflows that make Codex easier to teach live.

## Classroom profiles

Classroom profiles open Codex Desktop with a class-ready local state.

They keep your account and plugin setup available, but hide your daily workspace. This gives students a clean first screen while still letting you use the plugins you already trust. Skills start empty, because installing or creating them is often part of the lesson.

Use classroom profiles when you want to demonstrate Codex from a clean interface, show Windows sandbox setup, teach skills from scratch, and restore your real Codex state after class.

Read the guide: [Classroom profiles](docs/classroom-profiles.md).

## Live narration

Live narration gives Codex a classroom voice.

While Codex works, it speaks short updates about the parts students need to notice: what it is trying, what changed, what failed, what it is checking, and when the class should pause to look at evidence. It is not meant to read every command aloud.

The narrator uses `gpt-realtime-2.1-mini` as a voice companion. It listens while the teacher explains, stays quiet when asked, and resumes when narration is useful again. This helps students who cannot read the terminal, file diffs, and chat stream fast enough during a live demo.

## Thread replay videos

Thread replay turns a completed Codex thread into a video lesson.

It takes a finished thread and produces a replay of what happened: the prompt, the main turns, the important changes, and the final result. This is useful when a workflow is too slow or unpredictable to run live in class.

Use thread replay when you want to show the shape of a long Codex task without making students wait through the whole run. For example, a `goal` workflow can be recorded once, edited into the important moments, and reused as teaching material.

## Teaching principles

- Start with less on screen.
- Keep the instructor's real workspace recoverable.
- Avoid live login or credential screens when they distract from the lesson.
- Leave skills empty when installing them is part of the lesson.
- Make Codex activity easier to follow for students who cannot read every detail live.
- Turn long agent work into reusable class material.
