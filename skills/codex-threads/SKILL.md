---
name: codex-threads
description: Export and import Codex chat threads for classroom preparation with codex-classroom. Use when the user wants to save a finished Codex thread as a .codex-thread.zip archive, import prepared threads into a clean classroom profile, move chats between Codex homes, or install the thread portability workflow.
---

# Codex Threads

Use this skill when a teacher wants to prepare finished Codex chats for class.

The workflow is chat-only. Do not copy projects, credentials, plugins, automations, skills, or workspace files into a thread archive.

## Commands

Install this skill:

```sh
codex-classroom threads install-skill
```

Export the latest thread:

```sh
codex-classroom threads export latest --out lesson.codex-thread.zip
```

Export a specific thread:

```sh
codex-classroom threads export <thread-id> --out lesson.codex-thread.zip
```

Import into the active Codex home:

```sh
codex-classroom threads import lesson.codex-thread.zip
```

Import into a specific classroom profile without swapping active state:

```sh
codex-classroom threads import lesson.codex-thread.zip --real-codex-home <profile-codex-home>
```

Replace an existing imported thread only when the user explicitly wants replacement:

```sh
codex-classroom threads import lesson.codex-thread.zip --force
```

## Classroom Workflow

Prefer this sequence:

1. Prepare the good thread in a normal Codex session.
2. Export it with `codex-classroom threads export`.
3. Create or enter a clean classroom profile.
4. Import the `.codex-thread.zip` before opening Codex Desktop.
5. Open Codex and show the imported thread when the class reaches that point.

## Safety

Thread archives are private. They contain the full rollout JSONL, which can include prompts, assistant messages, tool output, local paths, and attached-file metadata.

Before import, ask the user to close Codex Desktop if the command reports an active SQLite sidecar such as `state_5.sqlite-wal` or `state_5.sqlite-shm`.

If export cannot find a very recent thread, ask the user to close Codex Desktop and retry so the local indexes are flushed.

Do not upload thread archives to cloud storage unless the user explicitly asks for that destination.
