---
name: travel-agent
description: Handle travel planning - itineraries, flights, lodging, routes, budgets, and trip logistics. Use when user asks to plan a trip, build/revise an itinerary, or needs destination suggestions and logistics.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Travel Agent

Personal travel planning agent with chat, file uploads, and a living markdown itinerary.

## When To Use

- User asks to plan a trip or build/revise an itinerary
- User wants destination suggestions, timing advice, or logistics
- User needs a structured plan or options for travel decisions
- User asks about managing trips, conversations, or travel data

## Inputs To Gather

Before planning, gather these details from the user:

| Input | Required | Example |
|-------|----------|---------|
| Origin city | Yes | "San Francisco" |
| Destination(s) | Yes | "Tokyo, Kyoto, Osaka" |
| Dates or duration | Yes | "March 15-25" or "10 days" |
| Budget range | Recommended | "$3000" or "mid-range" |
| Preferences | Optional | Pace, interests, lodging type |

## CLI Reference

The `travel-agent` CLI provides commands for managing trips, conversations, and debug sessions.

### Trip Management

```bash
travel-agent trips list
travel-agent trips delete --trip-id <id>
travel-agent trips copy --trip-id <id> [--name "New name"] [--include-conversations]
```

### Conversation Management

```bash
travel-agent conversations list --trip-id <id>
travel-agent conversations delete --trip-id <id> --conversation-id <id>
```

### Debug Sessions

Run single-message or multi-turn sessions:

```bash
travel-agent session run --message "Plan a 2-day Tokyo itinerary" --trip "Debug Trip"
travel-agent session run --input session.json --trip "Debug Trip"
travel-agent session repl --trip "Debug Trip"
travel-agent session replay <transcript.jsonl>
```

### Options

| Option | Description |
|--------|-------------|
| `--url <baseUrl>` | Base URL (default: http://localhost:3001) |
| `--ws <wsUrl>` | WebSocket URL override |
| `--auth <password>` | Password for Basic auth |
| `--trip-id <id>` | Trip ID for selection |
| `--trip <name>` | Trip name (creates new unless `--reuse-trip`) |
| `--conversation-id <id>` | Conversation ID for selection |
| `--conversation <title>` | Conversation title for selection |
| `--message <text>` | Single user message |
| `--input <path>` | Session input JSON file |
| `--out <path>` | Transcript JSONL output path |
| `--markdown <path>` | Optional markdown transcript output |
| `--stream/--no-stream` | Echo events to stdout (default: on) |
| `--quiet` | Suppress non-JSON output |
| `--create/--no-create` | Allow creating trips/conversations (default: true) |
| `--reuse-trip` | Reuse existing trip by name |
| `--reuse-conversation` | Reuse existing conversation by title |
| `--cleanup/--no-cleanup` | Delete CLI-created trips after session (default: true) |
| `--include-conversations` | Include chat history when copying trips |
| `--include-uploads` | Include uploads when copying (default: true) |
| `--include-assets` | Include assets when copying (default: true) |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TRAVEL_AGENT_URL` | Base URL (default: http://localhost:3001) |
| `TRAVEL_AGENT_PASSWORD` | Password for Basic auth |

## Data Model

Trip data is stored at `~/.travelagent/trips/<tripId>/`:

```
itinerary.md           # Source-of-truth markdown itinerary
context.md             # Trip context (details, preferences, bookings)
uploads/               # User-uploaded context files (PDFs, images)
assets/                # Generated assets (maps, exports)
chats/<conversationId>/
  conversation.json    # Metadata + session ID
  messages.jsonl       # Chat history
```

Global data at `~/.travelagent/`:

```
global-context.md      # Global travel profile shared across trips
```

## Outputs

When planning a trip, produce:

- A structured itinerary (day-by-day)
- Key options and rationale (flights/lodging/activities)
- A short summary for quick review

## Memory Rules

- Durable travel preferences go to `~/.emptyos/memory/agents/travel/context.md`
- Global preferences go to `~/.emptyos/memory/global/profile.md`

## Artifacts

If the result is a document (PDF, itinerary export, map image), publish it:

```bash
emptyos artifacts publish <file> --agent travel --description "<desc>"
```

Return the artifact URL to the user.

## Examples

### List trips and select one

```bash
travel-agent trips list
travel-agent session run --message "Show me the itinerary" --trip-id abc123
```

### Copy a trip for testing

```bash
travel-agent trips copy --trip-id abc123 --name "Japan Trip (Test)"
```

### Run a debug session

```bash
travel-agent session run --message "Add a day trip to Nikko" --trip "Japan 2026" --reuse-trip
```

### Interactive REPL

```bash
travel-agent session repl --trip "New Trip" --no-cleanup
```

## Cross-Skill Transitions

- **After generating images:** Use the `emptyos-artifacts` skill to publish trip maps or destination images
- **For scheduled reminders:** Use the `cron-manager` skill to set up deadline reminders for bookings
- **For image generation:** Use the `nano-banana` skill to create destination visualizations
