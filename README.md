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

The itinerary pane includes a “Generate map” button. If configured, the server will call a Nano Banana Pro API to generate a trip-wide map image; otherwise it generates a simple SVG placeholder.

Set:
- `NANO_BANANA_PRO_API_URL`
- `NANO_BANANA_PRO_API_KEY`

## Notes

- The agent can persist itinerary and prefs via special markers in its output (see `.claude/skills/travel-planner`).
- Trips organize chats + itinerary + uploads by destination name.

## Using a Claude Max/Pro OAuth token instead of an API key
If you want billing to stay on your Claude Max/Pro subscription, you can supply a Claude Code OAuth token rather than an API key:

1. On a machine with a browser, install the Claude CLI (`npm i -g @anthropic-ai/claude-code`) and run `claude setup-token`. Sign in, then copy the displayed `sk-ant-oat01-...` token.
2. In Render, add a secret env var `CLAUDE_CODE_OAUTH_TOKEN=<your token>`. **Do not** also set `ANTHROPIC_API_KEY`, because the CLI will prefer an API key and switch back to metered API billing.
3. Redeploy. The agent will run headless using the OAuth token; tokens are valid for ~1 year, so plan to refresh and rotate this env var periodically.
