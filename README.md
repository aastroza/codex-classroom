# codex-classroom

Temporarily switch Codex Desktop into a clean classroom profile.

`codex-classroom` is a small CLI for teaching Codex without showing a crowded personal workspace. It swaps your local Codex state into a reversible classroom profile, launches Codex Desktop, and restores your real state after class.

## Why

When you teach Codex, students often need a low-noise first screen. Your real Codex setup may have projects, chats, automations, plugins, skills, and history that are useful for daily work but distracting in class.

Codex Desktop currently keeps sidebar state outside the CLI `CODEX_HOME` launcher path, so a simple `CODEX_HOME=... codex app` launch is not enough. This tool uses a stricter local state switcher.

## Quick Start

Run without installing:

```sh
npx codex-classroom init intro
npx codex-classroom doctor intro
npx codex-classroom enter intro
```

After class, close Codex Desktop and restore:

```sh
npx codex-classroom restore
```

Run `enter` and `restore` from a normal external terminal after closing Codex Desktop. Do not run them from inside Codex itself, because the active Codex process locks `~/.codex` on Windows.

Or install globally:

```sh
npm install -g codex-classroom
codex-classroom init intro
codex-classroom enter intro
codex-classroom restore
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

Creates a classroom profile.

```sh
codex-classroom init intro
```

By default it copies only:

- `~/.codex/auth.json`

into the classroom profile, then writes a sterile classroom `config.toml`. It does not copy sessions, automations, plugins, skills, local state databases, or Desktop app state.

The sterile config keeps the class profile signed in with your existing Codex account, but starts from a low-noise setup with skills, plugins, browser tools, computer-use tools, and app connectors disabled. Plugins and skills configured during class stay inside the classroom profile and are restored away from your real setup after `restore`.

Skip auth copying or copy your real config instead:

```sh
codex-classroom init intro --no-copy-auth
codex-classroom init intro --copy-config
```

By default, the clean config does not write a `[windows]` sandbox section. That leaves the class profile as close to first-run state as the app allows.

To explicitly show Windows sandbox setup during class, request a Windows sandbox mode:

```sh
codex-classroom init intro --windows-sandbox-mode elevated
codex-classroom init intro --windows-sandbox-mode unelevated
```

Use `elevated` when you want to demonstrate the elevated Windows setup path. Use `unelevated` when you want the Windows sandbox setting present but with fewer Windows ACL prompts.

If you want to avoid showing Windows sandbox setup and reuse the existing local sandbox support files:

```sh
codex-classroom init intro --copy-windows-sandbox
```

Codex may still generate caches, sqlite files, and bundled system folders inside the classroom profile after first launch. Those generated files stay in the profile and do not contaminate your real Codex state.

To copy your daily config, including your existing plugins and skills:

```sh
codex-classroom init intro --copy-config
```

### `enter`

Switches local Codex state into the classroom profile, then launches Codex Desktop.

```sh
codex-classroom enter intro
```

This command:

1. Refuses to run if Codex appears to be open.
2. Writes an `active-session.json` recovery file.
3. Moves your real `~/.codex` to a backup folder.
4. Moves your classroom `codex-home` into `~/.codex`.
5. Moves your real Codex Desktop app state to a backup folder.
6. Moves the classroom Desktop app state into the real Desktop state location.
7. Opens Codex Desktop.

On Windows, also close VS Code windows using the OpenAI/Codex extension, Chrome extension helpers, and any `codex.exe` app-server process. `--force` only skips the process check; it cannot unlock files that Windows is actively using.

Pass extra `codex app` arguments after `--`:

```sh
codex-classroom enter intro -- --enable some-feature
```

Preview without moving files:

```sh
codex-classroom enter intro --dry-run
```

Switch state without opening Codex Desktop:

```sh
codex-classroom enter intro --no-launch
```

Skip the confirmation prompt:

```sh
codex-classroom enter intro --yes
```

### `restore`

Restores your real local Codex state after class.

```sh
codex-classroom restore
```

Close Codex Desktop before running this. The command refuses to run if Codex appears to be open, unless you pass `--force`.

```sh
codex-classroom restore --force
```

### `rescue`

Shows the active session and whether each target, profile, and backup path exists.

```sh
codex-classroom rescue
codex-classroom rescue --json
```

Use this if your machine shuts down during an active classroom session or a restore fails.

### `status`

Shows where the profile lives and whether key files exist.

```sh
codex-classroom status intro
codex-classroom status intro --json
```

### `doctor`

Checks the real Codex home, Desktop state home, classroom profile, source auth file, and `codex` executable.

```sh
codex-classroom doctor intro
codex-classroom doctor intro --json
```

### `profiles`

Lists classroom profiles.

```sh
codex-classroom profiles
```

### `reset`

Deletes one inactive classroom profile. It refuses to delete outside the classroom root.

```sh
codex-classroom reset intro
codex-classroom reset intro --yes
codex-classroom reset intro --dry-run
```

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

Override paths:

```sh
codex-classroom enter intro \
  --classroom-root ~/Teaching/codex-classroom \
  --real-codex-home ~/.codex \
  --desktop-state-home "$HOME/Library/Application Support/Codex"
```

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

## Safety Model

`codex-classroom` is designed to be reversible:

- It refuses to enter or restore while Codex appears to be running.
- It writes `active-session.json` before moving state.
- It stores the real state under `~/.codex-classroom/backups/<backup-id>`.
- It only manages profile and backup paths inside the classroom root.
- It refuses to reset paths outside the classroom root.
- It never prints token values.
- It generates a clean classroom config by default instead of copying your daily config.
- `--dry-run` is available for commands that move or launch.
- `--json` output is intended for scripts and automation.

The one sensitive default operation is copying `auth.json`. That lets the classroom profile use your existing Codex login, but the copied file remains sensitive and should not be committed or shared. If you pass `--copy-config`, your real `config.toml` may also contain private paths or plugin configuration.

## Important Limitation

`codex-classroom start` is kept as a legacy launcher. It sets `CODEX_HOME` for `codex app`, but it does **not** isolate Codex Desktop sidebar state. Use `enter` and `restore` for real classroom mode.

## Platform Support

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
