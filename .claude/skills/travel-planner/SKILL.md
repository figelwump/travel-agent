---
name: travel-planner
description: Plan, create, or update a personal trip itinerary. Use when the user wants to start a new trip, update or refine an existing itinerary, add destinations/days, adjust schedules, add maps/images, verify time-sensitive details (hours, closures, ticketing), track booking TODOs, or persist preferences + a markdown itinerary under ~/.travelagent.
allowed-tools: Read, Write, Edit, MultiEdit, Bash, Glob, WebSearch, WebFetch
---

# Travel Planner

Create and maintain a living markdown itinerary for a trip, plus lightweight structured preferences ("prefs") for personalization.

## Configuration

**Resource root (do not `cd` here):** `$SKILL_ROOT` = `.claude/skills/travel-planner`

## Data Model (Filesystem)

Default storage root: `~/.travelagent` (override via `TRAVEL_AGENT_HOME` on the server).

Each trip is a directory:

- `~/.travelagent/trips/<tripId>/itinerary.md` — source-of-truth itinerary (markdown)
- `~/.travelagent/trips/<tripId>/prefs.json` — user/trip preferences (JSON)
- `~/.travelagent/trips/<tripId>/uploads/` — user-provided context files (PDFs, screenshots, etc.)
- `~/.travelagent/trips/<tripId>/assets/` — generated assets (e.g., itinerary-map image)
- `~/.travelagent/trips/<tripId>/chats/<conversationId>/` — chat history (messages + metadata)

## Workflow

1. **Determine trip mode**
   - Ask: "Is this a new trip, or do you want me to update an existing itinerary?"
   - If existing: request the current itinerary + any constraints/bookings/changes.

2. **Interview for preferences (new trip)**
   - Destination(s) and approximate dates
   - Travelers (adults/kids + ages), mobility constraints
   - Budget range, pace (fast/slow), interests (nature/city/food/museums/beach)
   - Lodging style, transportation preferences
   - Must-dos / avoid list

3. **Confirm before drafting**
   - Ask: "Do you want me to create/update the itinerary now?"

4. **Verify time-sensitive details**
   - Use WebSearch/WebFetch to confirm hours, closure days, admission rules, and ticketing for museums/attractions.
   - Prefer official venue websites; cross-check with reputable secondary sources if needed.
   - Update the itinerary and TODOs with verified details and link the venue name to the official site.
   - Keep Google Maps links for locations (add a maps link if the venue name links to the official site).
   - If verification fails, keep the TODO and ask the user for confirmation.

5. **Draft/update the itinerary (markdown)**
   - Use headings for hierarchy and optional `<details>` blocks for collapsible day sections.
   - **Link inline at first mention** — see `$SKILL_ROOT/reference/inline-linking.md` for examples.
   - Add 1–2 images per destination section (stable public URLs preferred).
   - Track open decisions and bookings as TODO task items (`- [ ]` / `- [x]`).

6. **Persist**
   - Write the updated markdown to `itinerary.md`.
   - Write inferred preferences to `prefs.json` (only what the user has stated or clearly implied).

## Itinerary Format Notes

Recommended structure:
- `# Trip Title`
- `## Overview` (dates, travelers, constraints, pace)
- `## Destinations` (bullet list)
- Then day-by-day:
  - `### Day N — ...` or a collapsible block:
    - `<details open><summary><strong>Day N — …</strong></summary> ... </details>`

## Automatic Chat Title Generation

After your **first substantive response** to the user in a conversation (not just a greeting), generate a descriptive title for the chat. This helps users identify conversations in the sidebar.

Use the **Skill tool** to invoke the `chat-title-generator` skill as a background task:
- Pass the user's message(s), a summary of what was discussed, and the tripId/conversationId
- The skill will generate a 3-6 word title and update `~/.travelagent/trips/<tripId>/chats/<conversationId>/conversation.json`

**When NOT to generate a title:**
- If the conversation already has a descriptive title (not "Chat", "Planning", or "Question about itinerary")
- For very short exchanges that don't have a clear topic yet

## Common Errors

- **Missing details**: If dates, travelers, or constraints are unknown, add explicit TODOs instead of guessing.
- **Fabricated reservations**: Never invent confirmation codes, ticket numbers, prices, or real-time availability.
- **Unclear scope**: If the user wants a high-level plan first, produce an overview before day-by-day detail.

## Reference

- `$SKILL_ROOT/reference/itinerary-conventions.md` – formatting conventions and markers
- `$SKILL_ROOT/reference/inline-linking.md` – inline linking guidelines (IMPORTANT)
