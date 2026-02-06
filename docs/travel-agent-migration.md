---
summary: "Findings and migration plan for integrating travel-agent into OpenClaw"
title: "Travel Agent Migration"
---

# Travel Agent Migration

This document captures confirmed findings and a concrete migration path for
porting the `travel-agent` and `fin-agent` projects to run natively inside
OpenClaw.

All paths and IDs below are examples. Replace them with your actual values.

Note: fin-agent work is deferred for now; travel-agent migration is the active scope.

## Placeholders and Terms

- `<openclaw-state-dir>`: OpenClaw state directory on the gateway host.
- `<openclaw-workspace>`: Agent workspace root for an OpenClaw agent.
- `<travel-workspace>`: Workspace root for the travel agent.
- `<fin-workspace>`: Workspace root for the finance agent.
- `<travel-data-dir>`: Legacy travel agent data directory.
- `<fin-data-dir>`: Legacy finance agent data directory.
- `<gateway-host>`: Machine running the OpenClaw Gateway.

## Key Findings

### OpenClaw agent runtime

- OpenClaw runs an embedded pi-mono runtime. The agent loop calls
  `runEmbeddedPiAgent`, and `subscribeEmbeddedPiSession` bridges agent events
  into OpenClaw streams.
- OpenClaw does not run the Claude Agent SDK inside the agent loop.
- Sessions are stored per agent under
  `<openclaw-state-dir>/agents/<agentId>/sessions/`.
- Each agent has its own workspace and agentDir. Isolation is the default.

### Session keys and scoping

- Direct chat sessions resolve to `agent:<agentId>:<mainKey>` where `mainKey`
  defaults to `main`.
- Group and channel sessions resolve to agent-scoped keys per channel and peer.

### Subagents and agent to agent messaging

- `sessions_spawn` starts a subagent run in a new session and posts an announce
  reply back to the requester chat.
- Cross-agent spawning is gated by `agents.list[].subagents.allowAgents`.
- `sessions_send` can ping another session and optionally do a short ping pong.
- Cross-agent messaging is gated by `tools.agentToAgent.enabled` and
  `tools.agentToAgent.allow`.
- Subagents cannot spawn subagents.
- Subagent context is minimal. Only `AGENTS.md` and `TOOLS.md` are injected.

### Memory behavior

- Memory is plain Markdown in each agent workspace: `MEMORY.md` and
  `memory/YYYY-MM-DD.md`.
- Memory search uses `memory_search` and can index extra paths via
  `agents.defaults.memorySearch.extraPaths`.
- Extra paths must be real paths. Symlinked files and directories are ignored
  by the memory indexer.
- Shared read and centralized write can be done by using a dedicated memory
  agent and pointing other agents at the memory workspace via `extraPaths`.

### Canvas

- Canvas is a node-controlled WebView surface for HTML, JS, and A2UI payloads.
- It is not the chat UI. It is a separate surface controlled via the
  `canvas` tool.
- Canvas content is served from a workspace directory such as
  `<openclaw-workspace>/canvas`.

### Tool policy and plugins

- Tool availability is governed by `tools.profile`, `tools.allow`, and
  `tools.deny`, plus per-agent overrides.
- Plugin tools are global to the Gateway but opt-in per agent via tool policy.
- Optional plugin tools require explicit allowlist entries to be usable.

### Option B timeouts

If OpenClaw invokes an external CLI agent:

- The travel agent CLI fails after 10 seconds if it cannot connect to the
  WebSocket server.
- In a sandbox, `localhost` is not the host. Any CLI that dials back to a
  server must use a reachable host address.
- OpenClaw `exec` will kill the CLI if the configured exec timeout expires.
- The overall agent run can time out if `agents.defaults.timeoutSeconds` is
  reached.

### Travel agent codebase observations

- The current travel agent uses the Claude Agent SDK and a Bun server plus
  WebSocket UI.
- The server depends on `Bun.serve`, `Bun.file`, and `Bun.build`.
- Trip tools are implemented in the server and scoped to `<travel-data-dir>`.
- A custom scheduler lives in the server process and stores its own lease
  file in the travel data directory.
- The UI is a React app under `web/` and talks to the server via WebSocket.

### Fin agent codebase observations

- The finance agent uses the Claude Agent SDK with a Bun server and WebSocket
  UI.
- Skills live under `.claude/skills/` and are written for Claude Code workflows.
- The workflow relies on Python CLI tooling and a SQLite data store.
- The web client and server use a custom WebSocket protocol for sessions.

## Porting Assessment

### Travel agent porting assessment

Primary friction points:

- Bun server runtime and APIs are not compatible with the Gateway process.
- Claude Agent SDK usage must be replaced with OpenClaw sessions and tools.
- Custom WebSocket protocol and auth do not map to Gateway events.
- Scheduler runs in-process with its own lease files and needs a new home.
- Storage paths are tied to `<travel-data-dir>` and must move to a workspace.

Clean ports:

- Trip model and storage format can move to `<travel-workspace>` with minor
  path changes.
- Tool logic for itinerary, context, maps, and todos can be translated to
  OpenClaw plugin tools.

### Fin agent porting assessment

Primary friction points:

- Claude Agent SDK and Claude Code skills need a full conversion to OpenClaw
  skills and tools.
- Bun server runtime and WebSocket protocol must be replaced or proxied.
- Python CLI workflows assume local venv and path structure that needs to be
  documented and wired into OpenClaw tool wrappers.
- Plaid integration currently lives in the Bun server and must move into a
  plugin HTTP handler or an external service.

Clean ports:

- The `fin_cli` Python package can remain intact behind OpenClaw tools.
- The SQLite schema and CSV workflows can stay with a new base path.

## Gateway UI Integration

The recommended UI strategy is to connect directly to the Gateway WebSocket
protocol as an operator client and drive sessions with `chat.*` methods.

### Operator connection

- Connect to the Gateway WebSocket protocol as role `operator`.
- Use `operator.read` and `operator.write` scopes for chat and sessions APIs.
- Expect to receive Gateway `event` frames for chat and agent updates.

### Chat send and streaming

- Use `chat.send` with `sessionKey`, `message`, and `idempotencyKey`.
- Optional fields include `thinking`, `attachments`, and `timeoutMs`.
- The response includes a `runId` and status `started` or `in_flight`.
- Streaming arrives via `event` frames with `event: "chat"`.

Chat event payloads include:

- `runId` and `sessionKey`.
- `seq` for ordered updates.
- `state` with one of `delta`, `final`, or `error`.
- `message` for `delta` and `final` states, `errorMessage` for `error`.

### Agent events and tool visibility

- `event: "agent"` streams include lifecycle, assistant, and tool events.
- Tool events are emitted only when verbose mode is enabled for the session or
  agent.

### History and session discovery

- Use `chat.history` to fetch the latest transcript for a session.
- Use `sessions.list` to enumerate known sessions and metadata.
- Use `sessions.preview` to show recent snippets for a session list.
- Use `sessions.resolve` to canonicalize session keys.

### Attaching to live sessions

- There is no direct Gateway RPC to call `sessions_spawn`.
- UI clients should send messages to the main agent via `chat.send` and let
  the agent invoke `sessions_spawn` or `sessions_send` as needed.
- To attach to an active session, fetch `chat.history` and then listen for
  `event: "chat"` updates filtered by `sessionKey`.

## Home screen and published artifacts

There is no built in agent UI registry or artifact publisher in OpenClaw
today. The Gateway does provide three native surfaces you can use without
adding a separate server:

1. Control UI static root
   - The Gateway serves static files from a configurable root.
   - You can replace the Control UI build with a custom home screen.
   - Config: `gateway.controlUi.root` and `gateway.controlUi.basePath`.
2. Plugin HTTP routes
   - Plugins can register HTTP routes on the Gateway HTTP server.
   - This lets you add a home screen and artifact endpoints on the same port.
   - Use `gateway.controlUi.basePath` to keep the stock UI at `/openclaw`
     and claim `/` for your home screen.
3. Canvas host static server
   - Separate HTTP server on `canvasHost.port` (default 18793).
   - Serves `/__openclaw__/canvas` from `canvasHost.root`.
   - No built in auth; best for private networks or node WebView usage.

### Home screen options

Option A: Custom Control UI build
- Build a small SPA that uses the Gateway WebSocket protocol.
- Use `agents.list` to populate agent tiles and a manifest file for agent UI links.
- Set `gateway.controlUi.root` to your build output.

Option B: Plugin HTTP route home
- Build a tiny web app served by a plugin HTTP route.
- Keep the stock Control UI at `gateway.controlUi.basePath` (for example `/openclaw`).
- The home app calls a JSON endpoint from the same plugin for agent and artifact lists.

Option C: Canvas host convention
- Put each agent UI under `<workspace>/canvas/<agentId>/`.
- Serve it via the Canvas host with a fixed URL pattern.
- Use a simple static index page under `canvasHost.root`.

### Published artifacts model

Recommended contract for artifacts:
- Each agent writes to `<workspace>/publish/<artifactId>/`.
- Each artifact includes a small `artifact.json` metadata file
  (title, summary, type, entrypoint, updatedAtMs).
- Maintain a top level index file: `<workspace>/publish/index.json`.

How this maps to OpenClaw:
- A plugin tool can write artifacts and update the index.
- A plugin HTTP route can serve `/publish` and `/publish/index.json`.
- The home screen can read the index and render a gallery.

### Auth and safety notes

- Plugin HTTP routes are raw handlers. The Gateway does not apply
  token or password auth to them automatically.
- If you expose the Gateway beyond loopback, add auth to plugin routes
  or keep the home screen behind Tailscale Serve.
- The Canvas host is a static file server with no auth; keep it private.

### Recommendation for this migration

Use Option B for the home screen and artifact publishing:
- Keep the stock Control UI at `/openclaw`.
- Add a plugin that serves `/` and `/publish`.
- Add tools to publish artifacts from agents without a separate server.

## Plugin Strategy

Plugins load once in the Gateway process, and their tools are global. Tool
usage is per-agent via tool allowlists.

Recommended plugin layout:

- Travel tools plugin that owns itinerary + per-trip context. (No `toggle_todo`
  tool; UI can edit/toggle via HTTP helpers.) Scheduler is handled by OpenClaw
  cron via a shared skill.
- Finance tools plugin that wraps the Python CLI tooling and exposes safe,
  opinionated actions.

Plugin requirements:

- A `openclaw.plugin.json` (or `clawdbot.plugin.json`) manifest with a JSON
  Schema for config.
- An entrypoint that registers tools and optional Gateway methods.
- Optional tools should be registered with `optional: true` and then enabled
  via `tools.allow` or `agents.list[].tools.allow`.
- For travel-agent, the plugin should live in `travel-agent/openclaw/`.

## Migration Plan Summary

### Phase 0: Decide target architecture

- Native OpenClaw agent runtime with plugin tools.
- Gateway WebSocket UI using `chat.*`.
- Optional Canvas UI for map and itinerary views.

### Phase 1: Define agent and workspace layout

- Create a dedicated `travel` agent and a dedicated `fin` agent.
- Set workspaces to `<travel-workspace>` and `<fin-workspace>`.
- Plan storage layout under the workspace:
  `trips/<tripId>/itinerary.md`,
  `trips/<tripId>/context.md`,
  `trips/<tripId>/uploads/`,
  `trips/<tripId>/assets/`.

### Phase 2: Port the system prompts

- Split the current prompts into `AGENTS.md`, `TOOLS.md`, and `SOUL.md`.
- Remove Claude SDK specific tool references and replace with OpenClaw tools.

### Phase 3: Implement tools via plugins

Travel tools:

- `read_itinerary`, `update_itinerary`
- `read_context`, `update_context`
- (Global context dropped for now; shared memory covers cross-trip knowledge.)
- (No `toggle_todo` tool; keep itinerary edits in UI only.)
- (Trip map tool deferred for first pass.)

Finance tools:

- Safe wrappers around `fin-scrub`, `fin-edit`, `fin-query`, `fin-analyze`.
- Optional tools for importing statements and running saved queries.

### Phase 4: Wire routing and agent to agent calls

- Add routing guidance in `AGENTS.md` for when to use the travel or finance
  agent.
- Use `sessions_send` to `agent:travel:main` or `agent:fin:main` for deep work.
- Reserve `sessions_spawn` for work that does not need full context or
  subagent fanout.

### Phase 5: UI integration

- Rewire the UI to use the Gateway WebSocket protocol.
- Use `chat.send` for messages and `chat.history` for transcripts.
- Optionally show `sessions.list` and `sessions.preview` for observability.
- Serve the UI via the travel plugin HTTP route at `/agents/travel`.

### Phase 6: Data migration

- Copy existing travel data into the workspace layout (do not move/delete).
- Prioritize conversations; uploads/maps can be skipped for first pass.
- Convert existing finance data into the workspace layout, or keep the SQLite
  database in `<fin-data-dir>` and point tools at it via config.

### Phase 7: Testing

- Run a direct agent call: `openclaw agent --agent travel --message "Plan a 2 day Reykjavik itinerary"`.
- Verify tool calls update the correct files.
- Test agent to agent messaging from the main agent.
- If using UI, verify chat streaming and session attachment flows.

## Migration Checklists

### Travel agent checklist

1. Choose the target UI path: Gateway chat UI, Canvas UI, or both.
2. Create the `travel` agent and set `<travel-workspace>`.
3. Port the prompt into `AGENTS.md`, `TOOLS.md`, and `SOUL.md`.
4. Define the workspace storage layout for trips and assets.
5. Build a travel tools plugin with itinerary + per-trip context (no global
   context, no `toggle_todo` tool, no map tool initially).
6. Use OpenClaw cron via a shared skill for scheduling experiments.
7. Copy existing travel data into the workspace layout (no move).
8. Enable the plugin and allowlist tools for the travel agent.
9. Configure the main agent to call `sessions_send` for travel requests.
10. Rewire the UI to Gateway chat events and test end to end.

### Fin agent checklist

1. Choose whether to keep the Python CLI as the system of record.
2. Convert `.claude/skills` into OpenClaw skills in `<fin-workspace>/skills`
   or a managed skills directory.
3. Update skill instructions to use OpenClaw placeholders and paths.
4. Build a finance tools plugin that wraps the `fin-*` CLI commands safely.
5. Decide how Plaid features are hosted. Options include plugin HTTP handlers
   or a separate service.
6. Set up Python tooling, env vars, and the SQLite database path.
7. Migrate or point to the existing finance database.
8. Enable the plugin and allowlist tools for the finance agent.
9. Rewire the UI to Gateway chat events or remove it if not needed.
10. Validate the full workflow with statement import, categorization, and
    analysis prompts.

## Next Steps for UI and Plugins

### UI next steps

1. Build a small operator client that connects to the Gateway via WebSocket.
2. Implement `chat.send`, `chat.history`, and `chat.abort`.
3. Subscribe to `event: "chat"` for streaming responses.
4. Optionally surface `event: "agent"` when verbose mode is enabled.
5. Add a session sidebar using `sessions.list` and `sessions.preview`.

### Plugin next steps

1. Create a plugin skeleton with `openclaw.plugin.json`.
2. Register travel tools and finance tools as optional where appropriate.
3. Add config schema for plugin settings and storage roots.
4. Enable the plugin and allowlist tools for the target agent.
5. Add integration tests that exercise the tool handlers against a temp
   workspace.
