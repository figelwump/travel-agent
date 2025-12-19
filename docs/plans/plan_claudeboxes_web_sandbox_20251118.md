# plan_claudeboxes_web_sandbox_20251118

Plan for this repo to:
- Extract a minimal, general-purpose Claude Agent web client from the existing `fin-agent/web_client`.
- Stand up a simple Bun-based agent runtime for local development.
- Deploy that stack to a cloud host (Fly.io or Render) so the agent can be accessed over the internet.

This plan is intentionally scoped to a first-pass experiment: one agent, one runtime container, no separate per-session sandbox service yet.

---

## A. Web client extraction (this repo only)

Goal: copy the existing Fin Agent web client into this repo and simplify it into a generic “Claude Agent chat UI”, without touching the `fin-agent` repository.

- [x] A1. Copy web client sources into this repo
  - [x] Create a `web/` directory in `claudeboxes`.
  - [x] Copy the following from `../fin-agent/web_client` into this repo:
    - `App.tsx`, `index.tsx`, `index.html`, `globals.css`.
    - `components/ChatInterface.tsx`.
    - `components/message/*` (message rendering).
    - `hooks/useWebSocket.ts`, `hooks/useFileSelection.ts`.
    - `context/` + `store/` as needed (e.g., screenshot mode pieces).
    - `config/suggestions.yaml` as a starting point (we can swap out finance-specific prompts later).
  - [x] Wire up a local Bun dev server in this repo (initially just for static serving) so `http://localhost:3000` loads the copied UI.

- [x] A2. Generalize naming for Agent SDK integration in this repo
  - [ ] When we bring over the runtime pieces that talk to the Claude Agent SDK (the `ccsdk` equivalents), use neutral names in this repo:
    - Directory: `agentsdk/` (not `ccsdk/`).
    - Files: `agent-client.ts` (instead of `cc-client.ts`, etc.).
    - Class: `AgentClient` (instead of `CCClient`).
  - [x] Keep the original `fin-agent/ccsdk` untouched; only the copies in this repo are renamed/generalized.
  - [x] In this repo’s runtime code, avoid baking in financial-domain prompts; use a generic system prompt or allow the prompt to be passed in from configuration.

- [x] A3. Strip Fin Agent–specific UI and finviz from this repo’s web client
  - [ ] Remove all finviz-specific code from the copied UI:
    - [x] Delete `components/viz/VizRenderer.tsx` and associated Finviz types.
    - [x] Remove `VizRenderer` imports and `finviz` markdown fence handling from `AssistantMessage.tsx`.
    - [x] Remove the markdown-table → finviz fallback logic from `AssistantMessage.tsx`.
  - [ ] Remove import/finance-specific blocks:
    - [x] Remove `ImportSummaryBlock.tsx` and `ImportProgressBlock.tsx` usage, and their types from `components/message/types.ts`, in this repo’s copy.
    - [x] Remove `ImportStatementsButton.tsx` and the statement-import flow from `ChatInterface.tsx` here (Fin Agent keeps its flow).
    - [x] If we still want a “suggested prompts” row, keep the mechanism but make the text in `suggestions.yaml` domain-agnostic.
  - [ ] Generalize text and branding in this repo:
    - [x] Change “Fin Agent” heading to something like “Claude Agent Sandbox”.
    - [x] Update the `<title>` in `index.html` accordingly.
    - [x] Remove any copy that mentions “statements”, “Plaid”, or other finance terms from this repo’s UI (while leaving them intact in `fin-agent`).

Outcome: `claudeboxes` will have a lightweight chat UI that can render user, assistant, and generic tool_use messages, with streaming support, and no finance-specific logic.

---

## B. Agent runtime in this repo (no external sandbox yet)

Goal: stand up a minimal Claude Agent SDK runtime inside this repo that serves the web UI over HTTP and handles WebSocket chat, similar to `fin-agent` but domain-neutral and simplified.

- [x] B1. Copy and adapt the session + WebSocket handler
  - [x] Create an `agentsdk/` directory in this repo.
  - [x] Copy the following from `../fin-agent/ccsdk` into `agentsdk/`:
    - `session.ts` (conversation/session management with Claude Agent SDK).
    - `websocket-handler.ts` (per-connection handling and session routing).
    - `types.ts` (WebSocket message types, SDK types re-exports).
  - [x] Apply the naming changes from A2:
    - [x] Rename `CCClient` to `AgentClient` inside the copied client file.
    - [x] Update imports in `session.ts` to use `AgentClient` instead of `CCClient`.
  - [x] Remove or neutralize any fin-specific references from the copied session code (e.g., log messages that reference “finance assistant”), while preserving the core streaming behavior and WebSocket protocol.

- [x] B2. Add a generic AgentClient (copied + simplified from cc-client)
  - [x] Copy `../fin-agent/ccsdk/cc-client.ts` into `agentsdk/agent-client.ts` in this repo.
  - [x] Rename the class to `AgentClient` and the file name accordingly.
  - [x] Replace `FIN_AGENT_PROMPT` with:
    - Either a generic system prompt suitable for a general-purpose sandbox agent, or
    - A configuration-based prompt loaded from env or a small config file in this repo.
  - [x] Keep the tool whitelist broad (Bash, Read, Write, Edit, MultiEdit, WebFetch, WebSearch, Skill, etc.), but:
    - [ ] Replace the `.finagent`-specific file-write guard with a generic “session-root” guard in a future step (not required for very first local run, but a clear TODO).

- [x] B3. Minimal Bun server for this repo
  - [x] Copy `../fin-agent/server/server.ts` into `server/server.ts` in this repo as a starting point.
  - [x] Strip out Plaid and bulk import endpoints; keep only:
    - [x] `/` → serves the web client HTML.
    - [x] `/ws` → upgrades to WebSocket and routes to `WebSocketHandler`.
    - [x] Static file handling for `/web/` for TSX/CSS.
  - [x] Update imports to use `agentsdk/WebSocketHandler` and `AgentClient`.
  - [x] Ensure the server reads the port from `process.env.PORT` (with a default like `3000`) to play nicely with cloud hosting.

Note on B1 from the earlier discussion:
- The previous mention of a `SandboxRunner` abstraction was about a future architecture where agent tools (Bash, Read, Write, etc.) are executed inside a dedicated per-session sandbox service instead of directly on the host.
- For this first pass in this repo, we will **not** introduce a `SandboxRunner` layer yet; tools will run in the container/VM that hosts the Bun server.
- If/when we add Cloudflare Sandbox, E2B, or similar, we can introduce that abstraction then, but it is explicitly out of scope for this initial implementation.

---

## C. First cloud deployment (Fly.io vs Render)

Goal: deploy the Bun server + web client + Agent SDK runtime so that you can access the agent over the internet.

- [ ] C1. Choose a hosting platform for the first experiment
  - Render vs Fly.io tradeoffs:
    - Render:
      - Simpler initial setup (can auto-detect a Dockerfile or build command).
      - Good logs and dashboard; nice for first-pass debugging.
      - WebSockets are supported on web services.
    - Fly.io:
      - Very flexible, closer to “raw containers”.
      - Good when you want fine-grained control over networking, volumes, and scaling.
  - For a first-pass experiment, we can:
    - Default to **Render** for simplicity (single web service with Bun and WebSockets).
    - Keep Fly.io in mind as a follow-up if we want more control over placement, volumes, or multi-region.

- [ ] C2. Containerize the runtime
  - [ ] Add a `Dockerfile` in this repo that:
    - [ ] Installs Bun (or uses an official Bun base image).
    - [ ] Copies the `claudeboxes` source into the image.
    - [ ] Installs dependencies (`bun install` or equivalent).
    - [ ] Sets the default CMD to run the Bun server (`bun run server/server.ts`).
  - [ ] Verify that the container runs locally and that:
    - [ ] `http://localhost:$PORT/` serves the UI.
    - [ ] `ws://localhost:$PORT/ws` accepts WebSocket connections.

- [ ] C3. Render deployment (first target)
  - [ ] Add a minimal `render.yaml` or documented settings for a Render “Web Service”:
    - [ ] Use the Dockerfile or specify a build command.
    - [ ] Expose the correct port (via `PORT` env var).
    - [ ] Set required env vars (e.g., `CLAUDE_API_KEY`).
  - [ ] Deploy once and confirm:
    - [ ] The UI loads over HTTPS.
    - [ ] WebSocket connections work from the browser.
    - [ ] The agent can answer simple questions using the Claude Agent SDK.

- [ ] C4. Document deployment steps
  - [ ] Add a short `README.md` section in this repo describing:
    - [ ] How to run locally (Bun + env).
    - [ ] How to deploy to Render (and optionally Fly.io later).
    - [ ] Any security considerations (e.g., treat the container filesystem as ephemeral, avoid putting sensitive secrets into the agent’s working directory).

---

## D. Future work (optional / later phases)

These are intentionally out of scope for the first pass but worth noting:

- [ ] D1. Add a `SandboxRunner` abstraction
  - [ ] Define an internal interface for executing commands, reading/writing files, and managing per-session working directories.
  - [ ] Implement a local “in-container” runner first (basically codifying what we already do).
  - [ ] Later, add providers for Cloudflare Sandbox, E2B, or Modal without changing the web client.

- [ ] D2. Per-session filesystem isolation
  - [ ] Introduce a per-session working directory inside the container.
  - [ ] Update file-related tools to enforce path constraints relative to that root.

- [ ] D3. Browser automation tools
  - [ ] Add an optional “Browser” tool (e.g., via Playwright or a provider’s browser API).
  - [ ] Render basic browser results back to the UI (screenshots or text snapshots).

For now, focus is on A + B + C: get a generic, Claude Agent–driven web chat UI running locally in this repo, then deploy it once to the cloud as a single-container experiment.
