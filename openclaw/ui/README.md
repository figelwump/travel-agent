# Travel Agent Web Client

This directory contains a lightweight React UI that talks to the Travel Agent runtime over WebSockets. It provides a focused chat surface for itinerary updates, trip context, and tool activity.

## Current Features
- Streams assistant responses and tool invocations via the Claude Agent WebSocket protocol.
- Renders user, assistant, system, and tool-result messages in a compact console-inspired UI.

## Layout
```
web/
├── App.tsx              # Root component + WebSocket wiring
├── components/          # Chat UI and message renderers
├── globals.css          # Tailwind layer + shared styles
├── hooks/               # Reusable hooks (WebSocket, etc.)
├── index.html           # Static HTML shell served by Bun
└── index.tsx            # Entry point that mounts <App />
```

## Development Notes
- The UI expects to be served from `/web/` with static assets (CSS, TSX modules) directly accessible to the browser.
- `App.tsx` automatically points to the current origin for its WebSocket connection, so the same bundle works locally and in cloud deployments.
- Tailwind CSS is imported via `globals.css`; additional component-level styles should extend that layer instead of inlined `<style>` tags.
