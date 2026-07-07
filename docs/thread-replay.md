# Thread replay

Thread replay turns recorded Codex classroom events into a video project.

It uses the Codex Voice context bridge. During class, hooks record a compact event stream. After the run, `codex-classroom replay export` turns that stream into a Remotion project.

## Record a thread

Install the hooks:

```sh
codex-classroom voice install-hook
```

Open `/hooks` in Codex and trust the new hooks. Codex will skip untrusted command hooks.

Start Codex Voice if you also want live audio:

```sh
codex-classroom voice start
```

Run the Codex task you want to teach. The hooks can record context even if the voice sidecar is not open.

Check that events were captured:

```sh
codex-classroom voice context
```

## Export a replay project

```sh
codex-classroom replay export ./lesson-replay
```

The command writes a portable Remotion project:

```text
lesson-replay/
  package.json
  remotion.config.ts
  src/
    Root.tsx
    Replay.tsx
    data/
      events.json
      brief.txt
```

## Preview and render

```sh
cd lesson-replay
npm install
npm run preview
npm run render
```

The render script writes:

```text
out/codex-thread-replay.mp4
```

## Why Remotion

Remotion fits the first replay workflow because the source data is JSON and this repo is already TypeScript. The generated project can be edited like a React app: change layout, timing, typography, captions, or add screen recordings later.

HyperFrames is still a good fit for more designed HTML-first video compositions. Use it when the lesson needs stronger motion design, title cards, captions, overlays, or a full editorial treatment.

## Limits

The first replay format is event-based. It does not yet capture a pixel-perfect recording of the Codex window. It shows the teaching structure of the thread: prompt, tool outcomes, voice cues, and turn completions.

For best results, send useful voice cues during the run. The replay becomes better when the event stream contains the moments students should notice.
