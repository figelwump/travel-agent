---
name: travel-planner
description: Plan or refine a personal trip itinerary. Use when the user wants to start a new trip, revise an existing itinerary, add destinations/days, add maps/images, track booking TODOs, or persist preferences + a markdown itinerary under ~/.travelagent.
allowed-tools: Read, Write, Edit, MultiEdit, Bash, Glob
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
   - Ask: "Is this a new trip, or do you already have an itinerary you want to refine?"
   - If existing: request the itinerary + any constraints/bookings.

2. **Interview for preferences (new trip)**
   - Destination(s) and approximate dates
   - Travelers (adults/kids + ages), mobility constraints
   - Budget range, pace (fast/slow), interests (nature/city/food/museums/beach)
   - Lodging style, transportation preferences
   - Must-dos / avoid list

3. **Confirm before drafting**
   - Ask: "Do you want me to create/update the itinerary now?"

4. **Draft/update the itinerary (markdown)**
   - Use headings for hierarchy and optional `<details>` blocks for collapsible day sections.
   - Add Google Maps links per destination/day.
   - Add 1–2 images per destination section (stable public URLs preferred).
   - Track open decisions and bookings as TODO task items (`- [ ]` / `- [x]`).

5. **Persist**
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

## Common Errors

- **Missing details**: If dates, travelers, or constraints are unknown, add explicit TODOs instead of guessing.
- **Fabricated reservations**: Never invent confirmation codes, ticket numbers, prices, or real-time availability.
- **Unclear scope**: If the user wants a high-level plan first, produce an overview before day-by-day detail.

## Reference

- `$SKILL_ROOT/reference/itinerary-conventions.md` – formatting conventions and markers

