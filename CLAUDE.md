This file provides guidance when working with code in this repository.

## Commands

```bash
bun install                          # Install dependencies
bun run dev                          # Start dev server with hot reload (port 3001)
bun run start                        # Start production server
bun run typecheck                    # Type check with tsc --noEmit
bun test                             # Run tests
```

For local development with auth disabled:
```bash
ANTHROPIC_API_KEY=sk-... DISABLE_AUTH=true bun run dev
```

## Testing Changes

Prefer validating bug fixes and feature work via the CLI session runner first. Only use the Playwright MCP when changes affect the UI or require browser-only verification. When you do use Playwright, verify changes both visually and functionally:

1. Start the dev server if not already running
2. Use `browser_navigate` to open `http://localhost:3001`
3. Use `browser_snapshot` to inspect the UI state
4. Interact with the app using `browser_click`, `browser_type`, etc.
5. Verify the fix/feature works as expected end-to-end

When testing with Playwright:
- Start a test server on a different port (e.g., `PORT=3002 DISABLE_AUTH=true bun run dev`)
- Test against that port (e.g., `http://localhost:3002`)
- Only kill the server you started when done testing

Always run `bun test` after making changes.

## Commit Guidance

When asked to commit, only include changes made by the agent for the current task. Ignore unrelated working tree changes. If there are changes unrelated changes, do not ask the user to reconfirm the commit -- just go ahead and commit the changes you made.

## CLI Debug Sessions

When testing a new feature or debugging agent behavior (multi-turn chat, tool calls, response flow), use the CLI session runner to capture a clean JSONL transcript and iterate until it looks good. The CLI does **not** emit partial token streams and echoes JSONL to stdout by default.

Use this whenever possible to test a feature, verify a fix, debug issues, etc that are related to the agent behavior. For changes that are related to the UI behavior, test in-browser.

Run a session (single message):
```bash
TRAVEL_AGENT_URL=http://localhost:3002 bun run cli session run --message "..." --trip "Debug Trip"
```
By default, `--trip` creates a new trip even if a matching name exists. Use `--trip-id` or `--reuse-trip` when you need to reuse an existing trip.

Run a multi-turn session:
```bash
TRAVEL_AGENT_URL=http://localhost:3002 bun run cli session run --input docs/session.example.json --trip "Debug Trip"
```

Working with an existing trip (by ID):
```bash
TRAVEL_AGENT_URL=http://localhost:3002 bun run cli trips list
# pick an id from the output, then:
TRAVEL_AGENT_URL=http://localhost:3002 bun run cli session run --message "..." --trip-id <tripId>
```

Creating a new trip via the CLI:
```bash
TRAVEL_AGENT_URL=http://localhost:3002 bun run cli session run --message "..." --trip "New Trip Name"
```
CLI-created trips are deleted after the session by default; use `--no-cleanup` to keep them.

Use `--no-create` to avoid creating new trips/conversations; pair it with `--trip-id`, `--reuse-trip`, or `--conversation-id` to reuse existing data. The CLI creates a new conversation by default; use `--reuse-conversation` when you want to attach to an existing conversation by title.

Transcripts are saved under `debug/transcripts/session-<timestamp>.jsonl`. Use the transcript to verify fixes, then keep iterating until the session looks correct for the issue being debugged or the feature being tested.

### Safe Trip Copies (avoid polluting real trips)

When testing prompt behavior against a real itinerary, copy the trip first so you don’t add debug chats or edits to the original trip.

```bash
bun run cli trips copy --trip-id <id> --name "Trip Name (Copy)"
```

Notes:
- Chat history is **not** copied by default. Pass `--include-conversations` only if you need it.
- Uploads and assets are copied by default; disable with `--no-include-uploads` or `--no-include-assets`.
- The copied trip is created locally under `~/.travelagent/trips/<newTripId>/`.

## Architecture

This is a personal travel planning agent with a Bun server backend and React frontend. The agent uses the Claude Agent SDK to run agentic conversations with tool use.

### Server (`server/`)

- **server.ts** - Bun HTTP server entry point. Handles routing, WebSocket upgrades, auth, and serves the web client with on-the-fly TypeScript/CSS transpilation via Bun.build and PostCSS/Tailwind.
- **api.ts** - REST API handlers for trips, conversations, itineraries, context, uploads, and assets.
- **ws-handler.ts / ws-session.ts** - WebSocket connection management. `ConversationSession` manages per-conversation state and streams Claude Agent SDK responses to connected clients.
- **storage.ts** - Filesystem-based persistence layer. All trip data lives under `~/.travelagent/trips/<tripId>/` (itinerary.md, context.md, uploads/, assets/, chats/).
- **nano-banana.ts** - General-purpose image generation client for Gemini/Nano Banana Pro API. Used by `storage.generateTripMap()` for trip maps.

### Agent SDK Integration (`agentsdk/`)

- **agent-client.ts** - Wraps `@anthropic-ai/claude-agent-sdk` query function. Configures allowed tools, sandboxes file writes to `~/.travelagent/`, and appends the travel agent system prompt.
- **system-prompt.ts** - Base system prompt for the sandboxed travel agent.

The agent uses trip tools (`read_itinerary`, `update_itinerary`, `read_context`, `update_context`, `read_global_context`, `update_global_context`, `toggle_todo`) to work with trip data. These are custom tools defined in `server/tools/entity-tools.ts`.

### Web Client (`web/`)

React SPA served directly by Bun (no separate build step). Key files:
- **App.tsx** - Main app with auth, trip/conversation selection, WebSocket handling.
- **ChatPanel.tsx** - Chat interface with message history and input.
- **ItineraryPane.tsx** - Renders markdown itinerary with interactive TODOs (toggle via API).
- **hooks/useWebSocket.ts** - WebSocket hook for real-time chat streaming.

### Skills (`.claude/skills/`)

Claude Code skills for this project:
- **nano-banana** - Image generation skill using the Nano Banana Pro API.
- **cron-manager** - Scheduled task management.

## Data Model

Trip data stored at `~/.travelagent/trips/<tripId>/`:
```
itinerary.md           # Source-of-truth markdown itinerary
context.md             # Trip context (details, preferences, bookings)
uploads/               # User-uploaded context files (PDFs, images)
assets/                # Generated assets (itinerary-map.png/svg)
chats/<conversationId>/
  conversation.json    # Metadata + SDK session ID for resume
  messages.jsonl       # Chat history
```

Global data stored at `~/.travelagent/`:
```
global-context.md      # Global travel profile shared across trips
```

## Environment Variables

Required:
- `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` - For Claude Agent SDK

Auth:
- `AUTH_PASSWORD` - Required in production (also accepts `BASIC_AUTH_PASSWORD`)
- `DISABLE_AUTH=true` - Skip auth for local dev

Image generation (optional):
- `NANO_BANANA_PRO_API_KEY` or `GEMINI_API_KEY`
- `NANO_BANANA_PRO_MODEL` (default: `gemini-3-pro-image-preview`)

Other:
- `PORT` (default: 3001)
- `TRAVEL_AGENT_HOME` - Override default `~/.travelagent` data directory
- `ALLOWED_ORIGINS` - Comma-separated allowlist for CORS
