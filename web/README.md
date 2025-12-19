# Claude Agent Sandbox Web Client

This directory contains a lightweight React UI that talks to the Claude Agent runtime over WebSockets. The goal is to provide a neutral, domain-agnostic chat surface that mirrors the experience from the Fin Agent project without any finance-specific workflows.

## Current Features
- Streams assistant responses and tool invocations via the Claude Agent WebSocket protocol.
- Renders user, assistant, system, and tool-result messages in a compact console-inspired UI.
- Loads optional suggested prompts from `config/suggestions.yaml` so the UI can surface domain-specific helpers without code changes.
- Includes a screenshot mode atom to hide sensitive content when grabbing UI captures.

## Layout
```
web/
├── App.tsx              # Root component + WebSocket wiring
├── components/          # Chat UI, message renderers, dashboard widgets
├── config/              # YAML config for suggested prompts, etc.
├── context/             # Screenshot-mode provider
├── globals.css          # Tailwind layer + shared styles
├── hooks/               # Reusable hooks (WebSocket, etc.)
├── index.html           # Static HTML shell served by Bun
├── index.tsx            # Entry point that mounts <App />
└── store/               # Jotai atoms for lightweight global state
```

## Development Notes
- The UI expects to be served from `/web/` with static assets (CSS, TSX modules) directly accessible to the browser.
- `App.tsx` automatically points to the current origin for its WebSocket connection, so the same bundle works locally and in cloud deployments.
- Tailwind CSS is imported via `globals.css`; additional component-level styles should extend that layer instead of inlined `<style>` tags.

Local dev tooling (Bun scripts, server entry point, etc.) will be added as part of the broader runtime work in this repository.
