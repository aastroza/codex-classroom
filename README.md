# codex-classroom

Launch Codex Desktop with clean, local classroom profiles.

`codex-classroom` is a small CLI for teaching Codex without showing a crowded personal workspace. It starts Codex with `CODEX_HOME` pointed at a separate local profile, while reusing your existing Codex login when you choose to copy `auth.json`.

## Why

When you teach Codex, students often need a low-noise first screen. Your real Codex setup may have projects, chats, automations, plugins, skills, and history that are useful for daily work but distracting in class.

This tool creates a local classroom profile instead of modifying your real profile.

## Quick Start

Run without installing:

```sh
npx codex-classroom init intro
npx codex-classroom doctor intro
npx codex-classroom start intro
```

Or install globally:

```sh
npm install -g codex-classroom
codex-classroom init intro
codex-classroom start intro
```

The default profile name is `intro`, so this also works:

```sh
codex-classroom init
codex-classroom start
```

## Commands

```text
codex-classroom init [profile]
codex-classroom start [profile]
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

By default it copies:

- `~/.codex/auth.json`
- `~/.codex/config.toml`

into the classroom profile. It does not copy sessions, automations, plugins, skills, or local state databases.

Skip auth or config copying:

```sh
codex-classroom init intro --no-copy-auth
codex-classroom init intro --no-copy-config
```

### `start`

Launches Codex Desktop with `CODEX_HOME` pointed at the classroom profile.

```sh
codex-classroom start intro
```

Pass extra `codex app` arguments after `--`:

```sh
codex-classroom start intro -- --enable some-feature
```

Preview without launching:

```sh
codex-classroom start intro --dry-run
```

### `status`

Shows where the profile lives and whether key files exist.

```sh
codex-classroom status intro
codex-classroom status intro --json
```

### `doctor`

Checks the real Codex home, classroom profile, source auth file, and `codex` executable.

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

Deletes one classroom profile. It refuses to delete outside the classroom root.

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

Override either:

```sh
codex-classroom init intro \
  --classroom-root ~/Teaching/codex-classroom \
  --real-codex-home ~/.codex
```

Profile layout:

```text
~/.codex-classroom/
  profiles/
    intro/
      codex-home/
        auth.json
        config.toml
      workspace/
      manifest.json
```

## Safety Model

`codex-classroom` is designed to be reversible:

- It does not move, rename, or delete your real `~/.codex`.
- It only writes inside the classroom root.
- It refuses to reset paths outside the classroom root.
- It never prints token values.
- `--dry-run` is available for commands that write or launch.
- `--json` output is intended for scripts and automation.

The one sensitive operation is copying `auth.json`. That lets the classroom profile use your existing Codex login, but the copied file remains sensitive and should not be committed or shared.

## Platform Support

The CLI is Node-based and should work on:

- macOS
- Linux
- Windows

It expects the `codex` CLI to be available on `PATH`.

## Current Limitations

- The tool relies on Codex honoring `CODEX_HOME`.
- It does not inject CSS or hide UI sections inside Codex.
- It does not manage the Codex Desktop process after launch.
- It does not publish or sync classroom profiles.

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
