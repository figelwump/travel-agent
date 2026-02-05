# Travel Agent OpenClaw Plugin

This directory contains the OpenClaw plugin for travel-agent, plus the UI
served from `/agents/travel`.

## Layout

- `openclaw/index.ts` — plugin entrypoint (tools + HTTP routes)
- `openclaw/openclaw.plugin.json` — plugin manifest (config schema)
- `openclaw/clawdbot.plugin.json` — alias manifest (same schema)
- `openclaw/ui/` — React UI (bundled on demand)
- `openclaw/workspace/` — default workspace root (untracked)
- `openclaw/scripts/copy-legacy-data.ts` — one-time copy of legacy data

## Workspace

By default, the plugin stores data under `openclaw/workspace`:

```
openclaw/workspace/
  trips/<tripId>/
    trip.json
    itinerary.md
    context.md
    chats/<conversationId>/
      conversation.json
      messages.jsonl
```

You can override the workspace root with plugin config (`workspaceRoot`).

## UI

The UI is served via the plugin HTTP handler at:

```
/agents/travel
```

It connects to the Gateway WebSocket. By default it uses:

```
ws(s)://<gateway-host>/ws
```

Override this by adding a query parameter:

```
/agents/travel?gatewayUrl=ws://localhost:18789
```

If your Gateway requires operator auth, you can pass:

```
/agents/travel?gatewayPassword=...   (or gatewayToken=...)
```

## Legacy Data Copy

This copies legacy data into the new workspace **without moving** the original:

```bash
npx tsx openclaw/scripts/copy-legacy-data.ts
```

Options:

```bash
npx tsx openclaw/scripts/copy-legacy-data.ts --source ~/.travelagent --dest openclaw/workspace
npx tsx openclaw/scripts/copy-legacy-data.ts --include-uploads --include-assets
```

The script also copies `global-context.md` and `scheduler/` into
`openclaw/workspace/legacy/` for reference.

## UI Build

Build the UI assets once before running the gateway:

```bash
npx tsx openclaw/scripts/build-ui.ts
```

This writes `openclaw/ui/dist/globals.css` and `openclaw/ui/dist/index.js`.
Ensure `esbuild`, `postcss`, `@tailwindcss/postcss`, and `autoprefixer` are
installed.
