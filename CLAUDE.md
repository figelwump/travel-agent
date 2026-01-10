This file provides guidance when working with code in this repository.

## Commands

```bash
bun install                          # Install dependencies
bun run dev                          # Start dev server with hot reload (port 3000)
bun run start                        # Start production server
bun run typecheck                    # Type check with tsc --noEmit
bun test                             # Run tests
```

For local development with auth disabled:
```bash
ANTHROPIC_API_KEY=sk-... DISABLE_AUTH=true bun run dev
```

## Testing Changes

Always test bug fixes and feature work using the Playwright MCP before considering work complete. Verify changes both visually and functionally:

1. Start the dev server if not already running
2. Use `browser_navigate` to open `http://localhost:3000`
3. Use `browser_snapshot` to inspect the UI state
4. Interact with the app using `browser_click`, `browser_type`, etc.
5. Verify the fix/feature works as expected end-to-end

**Important:** The user often runs their own dev server on port 3001. Do NOT kill processes on port 3001. When testing with Playwright:
- Start a test server on a different port (e.g., `PORT=3002 DISABLE_AUTH=true bun run dev`)
- Test against that port (e.g., `http://localhost:3002`)
- Only kill the server you started when done testing

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

The agent uses standard file tools (Read, Write, Edit) to persist data directly to the filesystem.

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
- `PORT` (default: 3000)
- `TRAVEL_AGENT_HOME` - Override default `~/.travelagent` data directory
- `ALLOWED_ORIGINS` - Comma-separated allowlist for CORS
