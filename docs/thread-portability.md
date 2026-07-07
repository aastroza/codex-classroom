# Thread portability

Thread portability saves a finished Codex chat as a `.codex-thread.zip` archive and restores it into another Codex home.

Use it when you prepare a class in advance and want to bring one or more good finished threads into a clean classroom profile.

## What gets exported

An archive contains:

- the thread rollout JSONL under `sessions/`
- the matching `session_index.jsonl` entry
- the matching `threads` row from `state_5.sqlite`
- a manifest used to rebuild paths on import

It does not contain:

- project files
- credentials
- plugins
- automations
- skills
- full desktop state

Treat archives as private. The rollout JSONL can include prompts, assistant messages, tool output, local paths, instructions, and attachments metadata.

## Export a thread

Export the most recently updated thread:

```sh
codex-classroom threads export latest --out lesson.codex-thread.zip
```

Export a specific thread:

```sh
codex-classroom threads export 019f39af-8576-7ea3-8308-0e2619868925 --out lesson.codex-thread.zip
```

Use another Codex home:

```sh
codex-classroom threads export latest \
  --real-codex-home ~/.codex-classroom/profiles/intro/codex-home \
  --out lesson.codex-thread.zip
```

## Import into a clean profile

Create or enter the classroom profile first:

```sh
codex-classroom init intro
codex-classroom enter intro --no-launch
```

Import before opening Codex Desktop:

```sh
codex-classroom threads import lesson.codex-thread.zip
```

Then open Codex:

```sh
codex app
```

If you want to import directly into a profile home without swapping active state:

```sh
codex-classroom threads import lesson.codex-thread.zip \
  --real-codex-home ~/.codex-classroom/profiles/intro/codex-home
```

## Conflicts

Import fails if the thread already exists.

Replace it explicitly:

```sh
codex-classroom threads import lesson.codex-thread.zip --force
```

## Safety

Close Codex Desktop before importing. The command refuses to write when `state_5.sqlite-wal` or `state_5.sqlite-shm` are active, because that means SQLite may have pending state.

Export works best after Codex has finished writing the thread. If a very recent thread cannot be found, close Codex Desktop and retry.

## Skill

Install the packaged skill:

```sh
codex-classroom threads install-skill
```

Restart Codex after installing the skill.
