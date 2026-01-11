---
name: travel-planner
description: "[DEPRECATED] Use entity tools (read_entity, update_entity) directly instead. This skill is kept for reference documentation only."
allowed-tools: Read
---

# Travel Planner (DEPRECATED)

> **This skill has been deprecated.** The travel agent now uses entity tools directly:
> - `read_entity(entityType: "itinerary", id: tripId)` - Read the itinerary
> - `update_entity(entityType: "itinerary", id: tripId, content: ...)` - Update the itinerary
> - `read_entity(entityType: "context", id: tripId)` - Read trip context/preferences
> - `update_entity(entityType: "context", id: tripId, content: ...)` - Update context
>
> **Do not invoke this skill.** Use the entity tools from the system prompt.

## Reference Documentation

The following reference files are still useful for formatting guidelines:

- `$SKILL_ROOT/reference/itinerary-conventions.md` – formatting conventions and markers
- `$SKILL_ROOT/reference/inline-linking.md` – inline linking guidelines

## Data Model

Trip data stored at `~/.travelagent/trips/<tripId>/`:

- `itinerary.md` — source-of-truth itinerary (markdown)
- `context.md` — trip context, preferences, and bookings (markdown)
- `uploads/` — user-provided context files (PDFs, screenshots, etc.)
- `assets/` — generated assets (e.g., itinerary-map image)
- `chats/<conversationId>/` — chat history (messages + metadata)
