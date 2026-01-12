# Travel Agent

Personal travel planning agent with:
- Chat (Claude Agent SDK) + file uploads
- A living markdown itinerary rendered client-side (interactive TODOs)
- Local persistence per “trip” under `~/.travelagent`

## Prerequisites
- [Bun](https://bun.sh) 1.2+
- Environment variable `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`)

## Local Development
```bash
bun install
ANTHROPIC_API_KEY=sk-... DISABLE_AUTH=true bun run dev
```
Visit http://localhost:3000.

By default, trips are persisted under `~/.travelagent` (override with `TRAVEL_AGENT_HOME`).

### Type Checking
```bash
bun run typecheck
```

## CLI Debug Sessions

Use the CLI to run multi-turn chat sessions quickly and capture JSONL transcripts (plus optional Markdown).

```bash
bun run dev
bun run cli session run --input docs/session.example.json --trip "Debug Trip" --conversation "Debug"
```

Outputs a JSONL transcript to `debug/transcripts/session-<timestamp>.jsonl` by default. JSONL is also echoed to stdout by default (disable with `--no-stream`). Partial tokens are not emitted. Optional flags:

```bash
bun run cli session run --input docs/session.example.json --trip "Debug Trip" --no-stream --markdown debug/transcripts/session.md
bun run cli session repl --trip "Debug Trip"
bun run cli session replay debug/transcripts/session-123.jsonl
```

Single message without a session file:

```bash
bun run cli session run --message "Plan a 2-day Tokyo itinerary" --trip "Debug Trip"
```

List trips (for grabbing IDs):

```bash
bun run cli trips list
```

Auth + URL can be provided via environment:

```bash
TRAVEL_AGENT_URL=http://localhost:3000 TRAVEL_AGENT_PASSWORD=... bun run cli session run --input docs/session.example.json
```

To suppress non-JSON output (useful for automation), add `--quiet`.

## Authentication

The server requires basic password authentication for both WebSocket connections and API endpoints.

### Production
Set `AUTH_PASSWORD` as an environment variable. Without it, **all requests will be rejected**.

```bash
AUTH_PASSWORD=your-secure-password
```

Also accepts `BASIC_AUTH_PASSWORD` or `BASIC_AUTH_PASS` as aliases for compatibility with hosting platforms.

### Local Development
For convenience during development, you can disable authentication entirely:

```bash
DISABLE_AUTH=true
```

**Warning**: Never use `DISABLE_AUTH=true` in production.

## Generated trip map image

The itinerary pane includes a “Generate map” button. If configured, the server will call the Nano Banana Pro (Gemini image) API to generate a trip-wide map image; otherwise it generates a simple SVG placeholder.

Set:
- `NANO_BANANA_PRO_API_KEY` (or `GEMINI_API_KEY`)

Optional:
- `NANO_BANANA_PRO_MODEL` (default: `gemini-3-pro-image-preview`)
- `NANO_BANANA_PRO_IMAGE_SIZE` (default: `2K`, options: `1K`, `2K`, `4K`)
- `NANO_BANANA_PRO_ASPECT_RATIO` (default: `16:9`)
- `NANO_BANANA_PRO_API_URL` (override the Gemini endpoint)

## Notes

- The agent can persist itinerary and context via tools and shared files.
- Trips organize chats + itinerary + uploads by destination name.

## Using a Claude Max/Pro OAuth token instead of an API key
If you want billing to stay on your Claude Max/Pro subscription, you can supply a Claude Code OAuth token rather than an API key:

1. On a machine with a browser, install the Claude CLI (`npm i -g @anthropic-ai/claude-code`) and run `claude setup-token`. Sign in, then copy the displayed `sk-ant-oat01-...` token.
2. In Render, add a secret env var `CLAUDE_CODE_OAUTH_TOKEN=<your token>`. **Do not** also set `ANTHROPIC_API_KEY`, because the CLI will prefer an API key and switch back to metered API billing.
3. Redeploy. The agent will run headless using the OAuth token; tokens are valid for ~1 year, so plan to refresh and rotate this env var periodically.
