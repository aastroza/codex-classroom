# Classroom profiles

Classroom profiles let you teach the Codex app from a clean local state while still using your real OpenAI account.

Use this when your daily Codex workspace is too busy for the start of a class. The profile hides projects, chats, skills, automations, and Desktop sidebar state. It keeps your sign-in and inherited plugin setup so you can teach with the same account, models, limits, and plugins you use in practice.

## How it works

`codex-classroom` temporarily swaps two local Codex state folders:

- the Codex home, normally `~/.codex`
- the Codex Desktop app state, such as `%APPDATA%\Codex` on Windows or `~/Library/Application Support/Codex` on macOS

When you enter a classroom profile, your real state is moved to a backup, the classroom state is moved into place, and Codex Desktop opens. When class ends, `restore` moves your real state back.

The classroom profile is intentionally clean. Skills start empty, because installing or creating skills can be part of the lesson. Plugins are inherited, because reconnecting plugins live can show account screens or credentials.

## Quick start

Install the CLI:

```sh
npm install -g github:aastroza/codex-classroom
```

Run from a normal terminal after closing Codex Desktop:

```sh
codex-classroom init intro
codex-classroom doctor intro
codex-classroom enter intro
```

After class, close Codex Desktop and restore:

```sh
codex-classroom restore
```

Do not run `enter` or `restore` from inside Codex itself. On Windows, the active Codex process can lock `~/.codex`.

## Common classroom flows

Start clean but keep plugin setup:

```sh
codex-classroom init intro
codex-classroom enter intro
```

Show Windows sandbox setup during class:

```sh
codex-classroom init intro --windows-sandbox-mode elevated
codex-classroom enter intro
```

Reuse existing Windows sandbox support files:

```sh
codex-classroom init intro --copy-windows-sandbox
```

Copy your full daily config instead of generating a classroom config:

```sh
codex-classroom init intro --copy-config
```

Preview the state switch without moving files:

```sh
codex-classroom enter intro --dry-run
```

Switch state without opening Codex Desktop:

```sh
codex-classroom enter intro --no-launch
```

## Commands

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

### `init`

Creates or refreshes a classroom profile.

By default it copies:

- `~/.codex/auth.json`
- plugin-related config sections
- local plugin support caches

It does not copy:

- projects
- chats and local thread history
- automations
- skills
- memories
- secrets
- Desktop app state

The result is signed in, has your plugins ready, and starts with an empty skills surface.

### `enter`

Moves the classroom profile into the real Codex state locations and opens Codex Desktop.

It refuses to run if Codex appears to be open. On Windows, also close VS Code windows using the OpenAI/Codex extension, Chrome extension helpers, and any `codex.exe` app-server process. `--force` skips the process check, but it cannot unlock files Windows is actively using.

Useful options:

```sh
codex-classroom enter intro --yes
codex-classroom enter intro --dry-run
codex-classroom enter intro --no-launch
codex-classroom enter intro -- --enable some-feature
```

### `restore`

Restores your real local Codex state after class.

```sh
codex-classroom restore
codex-classroom restore --force
```

Close Codex Desktop before running it.

### Recovery and inspection

```sh
codex-classroom rescue
codex-classroom status intro
codex-classroom doctor intro
codex-classroom profiles
codex-classroom reset intro
```

Use `rescue` if your machine shuts down during an active classroom session or a restore fails. Use `doctor` before class to check that the expected files and Codex executable are available.

Most commands support `--json` for scripts.

## Paths

Default classroom root:

```text
~/.codex-classroom
```

Default real Codex home:

```text
~/.codex
```

Default Desktop state home:

- Windows: `%APPDATA%\Codex`
- macOS: `~/Library/Application Support/Codex`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/Codex`

Profile layout:

```text
~/.codex-classroom/
  active-session.json
  backups/
    2026-07-06T20-00-00-000Z-abc123/
      codex-home/
      desktop-state/
  profiles/
    intro/
      codex-home/
        auth.json
        config.toml
      desktop-state/
      workspace/
      manifest.json
```

Override paths when needed:

```sh
codex-classroom enter intro \
  --classroom-root ~/Teaching/codex-classroom \
  --real-codex-home ~/.codex \
  --desktop-state-home "$HOME/Library/Application Support/Codex"
```

## Safety model

Classroom profiles are designed to be reversible:

- They refuse to enter or restore while Codex appears to be running.
- They write `active-session.json` before moving state.
- They store the real state under `~/.codex-classroom/backups/<backup-id>`.
- They only manage profile and backup paths inside the classroom root.
- They refuse to reset paths outside the classroom root.
- They never print token values.
- They generate a classroom config by default instead of copying your daily config wholesale.
- They inherit plugin setup while resetting skills.
- `--dry-run` is available for commands that move or launch.
- `--json` output is intended for scripts and automation.

The sensitive default operations are copying `auth.json` and plugin support state. That lets the classroom profile use your existing Codex login and plugin setup, but the copied files remain sensitive and should not be committed or shared. If you pass `--copy-config`, your real `config.toml` may also contain private paths, projects, and other daily-work settings.
