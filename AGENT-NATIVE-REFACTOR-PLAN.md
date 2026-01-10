# Refactor Travel Planner to Agent-Native Architecture

## Summary

Transform the travel-agent from a **skill-invocation model** (stateless, on-demand) to an **agent-native architecture** (event-driven, atomic primitives, prompt-defined outcomes). The agent should use judgment to compose tools, not execute pre-defined skill workflows.

---

## Key Design Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| **MCP server vs inline tools?** | Inline tools | Expose as custom tools in SDK config. No MCP server, no hooks. Simplest option. |
| **Activity logging?** | Already exists | `messages.jsonl` + `toolActivity` metadata on responses. Sufficient for improvement feedback. |
| **context.md vs prefs.json?** | Consolidate to context.md | Single agent-readable file for learnings + preferences. More agent-native. |
| **nano-banana skill?** | Keep as Skill | Image generation is distinct capability. Keep `Skill` in allowedTools for this. |
| **chat-title-generator?** | Move server-side | Auto-generate from first user message in ws-session.ts. No agent involvement. |

---

## Current State Diagnosis

**Signs the current implementation isn't agent-native:**

| Red Flag | Current State |
|----------|---------------|
| Tool that encodes workflow | `travel-planner` skill contains business logic (interview → plan → verify → persist) |
| Agent calls functions instead of figuring things out | System prompt says "invoke travel-planner skill IMMEDIATELY" |
| Prompts specify HOW not WHAT | Skill has detailed 7-step workflow |
| Artificial limits | Agent can't list trips, create trips, or do anything the UI can do |

**Key Files:**
- `agentsdk/agent-client.ts` - Agent configuration, tool allowlist, write sandboxing
- `agentsdk/system-prompt.ts` - 19-line base prompt (minimal)
- `server/ws-session.ts` - WebSocket session, SDK message handling
- `server/storage.ts` - Filesystem CRUD operations (already has primitives!)
- `.claude/skills/travel-planner/SKILL.md` - Monolithic skill with embedded workflow

---

## Target Architecture

From the agent-native architecture skill:

> **THE CARDINAL SIN: Agent executes your code instead of figuring things out**

The fix: Move behavior from code (skill) into prompts. Simplify tools into primitives. Let the agent compose primitives with judgment.

---

## Implementation Plan

### Phase 1: Dynamic Capability Discovery Pattern

**Issue with static tools:** Creating `read_itinerary`, `read_context` as separate tools is the anti-pattern. When we add "bookings" or "reservations" later, we'd need code changes.

**Better:** Dynamic capability discovery with generic read/write tools.

**Files to Create:**
```
server/tools/
  index.ts              # Tool registry
  entity-tools.ts       # Generic CRUD for any entity type
  completion-tools.ts   # complete_task with shouldContinue: false
```

**Tool Design (Custom Tools in SDK Config):**

```typescript
// server/tools/entity-tools.ts
// These are registered as custom tools in the SDK query() options
import { z } from "zod";
import * as storage from "../storage";

// Entity type registry - add new types here, no tool changes needed
const entityHandlers = {
  trip: {
    list: () => storage.listTrips(),
    read: (id: string) => storage.getTrip(id),
    create: (data: any) => storage.createTrip(data.name),
    update: (id: string, data: any) => storage.updateTrip(id, data),
    // delete not implemented in storage yet
  },
  itinerary: {
    read: (tripId: string) => storage.readItinerary(tripId),
    update: (tripId: string, content: string) => storage.writeItinerary(tripId, content),
  },
  context: {
    // Replaces prefs.json - stores preferences, bookings, learnings
    read: (tripId: string) => storage.readContext(tripId),
    update: (tripId: string, content: string) => storage.writeContext(tripId, content),
  },
  uploads: {
    list: (tripId: string) => storage.listUploads(tripId),
  },
  conversations: {
    list: (tripId: string) => storage.listConversations(tripId),
  },
};

export const entityTools = [
  // Discovery tool - agent learns what's available
  tool(
    "list_entity_types",
    "List available entity types and their operations",
    {},
    async () => {
      const types = Object.entries(entityHandlers).map(([type, ops]) => ({
        type,
        operations: Object.keys(ops),
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(types, null, 2) }],
      };
    }
  ),

  // Generic read - works for any entity type
  tool(
    "read_entity",
    "Read any entity by type",
    {
      entityType: z.string().describe("Entity type (trip, itinerary, context, etc.)"),
      id: z.string().optional().describe("Entity ID (tripId for most types)"),
    },
    async ({ entityType, id }) => {
      const handler = entityHandlers[entityType as keyof typeof entityHandlers];
      if (!handler?.read) {
        return {
          content: [{ type: "text", text: `Unknown entity type or read not supported: ${entityType}` }],
          isError: true,
        };
      }
      const result = await handler.read(id!);
      return {
        content: [{ type: "text", text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
      };
    }
  ),

  // Generic create - works for any entity type that supports create
  tool(
    "create_entity",
    "Create any entity by type",
    {
      entityType: z.string().describe("Entity type"),
      content: z.any().describe("Content to create"),
    },
    async ({ entityType, content }) => {
      const handler = entityHandlers[entityType as keyof typeof entityHandlers];
      if (!handler?.create) {
        return {
          content: [{ type: "text", text: `Create not supported for: ${entityType}` }],
          isError: true,
        };
      }
      const result = await handler.create(content);
      return {
        content: [{ type: "text", text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
      };
    }
  ),

  // Generic update - works for any entity type that supports update
  tool(
    "update_entity",
    "Update any entity by type",
    {
      entityType: z.string().describe("Entity type"),
      id: z.string().describe("Entity ID"),
      content: z.any().describe("Content to update"),
    },
    async ({ entityType, id, content }) => {
      const handler = entityHandlers[entityType as keyof typeof entityHandlers];
      if (!handler?.update) {
        return {
          content: [{ type: "text", text: `Update not supported for: ${entityType}` }],
          isError: true,
        };
      }
      await handler.update(id, content);
      return {
        content: [{ type: "text", text: `Updated ${entityType} for ${id}` }],
      };
    }
  ),

  // Generic list - for collections
  tool(
    "list_entities",
    "List entities of a type",
    {
      entityType: z.string().describe("Entity type (trip, uploads, conversations)"),
      parentId: z.string().optional().describe("Parent ID if scoped (e.g., tripId)"),
    },
    async ({ entityType, parentId }) => {
      const handler = entityHandlers[entityType as keyof typeof entityHandlers];
      if (!handler?.list) {
        return {
          content: [{ type: "text", text: `List not supported for: ${entityType}` }],
          isError: true,
        };
      }
      const result = await handler.list(parentId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  ),

  // Specialized tool for TODO toggling (atomic operation)
  tool(
    "toggle_todo",
    "Toggle a TODO checkbox in the itinerary",
    {
      tripId: z.string(),
      lineNumber: z.number().describe("1-based line number"),
    },
    async ({ tripId, lineNumber }) => {
      const result = await storage.toggleTodoAtLine(tripId, lineNumber);
      return {
        content: [{ type: "text", text: result.updated ? `Toggled TODO on line ${lineNumber}` : `No TODO found on line ${lineNumber}` }],
      };
    }
  ),
];
```

**Why this is better:**
- Adding "bookings" = add handler entry + prompt update (no new tools)
- Agent can discover capabilities at runtime
- API validates entity types, not hardcoded enums
- Fewer tools = smaller context overhead

**Completion Tool:**

```typescript
// server/tools/completion-tools.ts
tool(
  "complete_task",
  "Signal that the current task is complete",
  {
    summary: z.string().describe("Summary of what was accomplished"),
    status: z.enum(["success", "partial", "blocked"]).optional(),
  },
  async ({ summary, status = "success" }) => {
    return {
      content: [{ type: "text", text: summary }],
      shouldContinue: false,  // Signals loop should stop
    };
  }
)
```

### Phase 2: Expand System Prompt (Behavior in Prose)

Move the workflow from `SKILL.md` into the system prompt as guidance, not commands.

**Current (in skill):**
```markdown
1. Check for active trip context FIRST
2. Determine trip mode (only if NO trip context provided)
3. Interview for preferences (new trip only)
4. Execute the user's request directly
5. Verify time-sensitive details
6. Draft/update the itinerary
7. Persist
```

**After (in system prompt):**
```markdown
# TravelAgent

You are a personal travel planning assistant. You have tools to discover and work with trip data.

## Discovering Capabilities

Use `list_entity_types` to see what data types are available and their operations.

## Core Tools
- **list_entity_types**: Discover available entity types (trip, itinerary, context, etc.)
- **list_entities**: List items of a type (e.g., all trips, all uploads for a trip)
- **read_entity**: Read any entity (itinerary, preferences, context)
- **create_entity**: Create any entity
- **update_entity**: Update any entity
- **toggle_todo**: Check/uncheck a TODO item by line number
- **WebSearch, WebFetch**: Research venues, verify hours/tickets
- **complete_task**: Signal when you're done

## Judgment Guidelines

**Working with itineraries:**
- Read the current itinerary first to understand context
- Make the change the user requested
- Verify time-sensitive details (hours, tickets) via WebSearch before adding activities
- Link venue names to official websites
- Track uncertainties as TODO items (`- [ ]`)
- Update the itinerary via `update_entity`

**Working with context:**
- Read context at the start to see what's been learned about this trip
- Update context when you learn preferences or confirm bookings
- Don't hold everything in memory—persist important learnings

**What NOT to do:**
- Don't fabricate confirmation codes, prices, or availability
- Don't guess when you can verify via web search
- Don't add excessive detail if user wants high-level

## Completing Tasks

When you've accomplished the user's request:
1. Verify your work (read back what you modified)
2. Call `complete_task` with a summary of changes
3. Don't keep working after the goal is achieved

If blocked, call `complete_task` with status "blocked" and explain why.

## Mutation Policy

Use `create_entity` for new records and `update_entity` for changes. Avoid other write paths for trip data.
```

**Files to Modify:**
- `agentsdk/system-prompt.ts` - Replace 19-line prompt with comprehensive guide

### Phase 3: Context Injection (Dynamic State)

Inject available resources into the system prompt at runtime.

**Current context injection** (`ws-session.ts:buildTripContextPrompt`):
```typescript
`<CURRENT_TRIP_CONTEXT>
trip_name: ${trip?.name}
trip_id: ${tripId}
itinerary_path: ...
</CURRENT_TRIP_CONTEXT>`
```

**Enhanced context injection:**
```typescript
async buildTripContextPrompt(): Promise<string> {
  const trip = await storage.getTrip(this.tripId);
  const context = await storage.readContext(this.tripId);
  const itinerary = await storage.readItinerary(this.tripId);

  // Count TODOs
  const todoMatches = itinerary.match(/- \[ \]/g) || [];
  const doneMatches = itinerary.match(/- \[x\]/gi) || [];

  return `
## Current Trip Context

**Trip:** ${trip?.name ?? this.tripId}
**Trip ID:** ${this.tripId}
**Pending TODOs:** ${todoMatches.length}
**Completed TODOs:** ${doneMatches.length}

**Known Context:**
${context}

Use read_entity(itinerary) to see the current plan, update_entity(itinerary) to update it.
`.trim();
}
```

### Phase 4: Consolidate to context.md (Replace prefs.json)

Consolidate `prefs.json` into `context.md` - single agent-readable file for all accumulated knowledge.

**Data model change:**
```
~/.travelagent/trips/<tripId>/
  context.md           # Replaces prefs.json - all learnings and preferences
  itinerary.md
  # prefs.json         # DEPRECATED - migrate to context.md
```

**Context.md structure:**
```markdown
# Trip Context

## Trip Details
- Dates: Jan 15-22, 2025
- Travelers: 2 adults

## Confirmed Bookings
- Flight: Delta 1234, Jan 15, SFO→CDG
- Hotel: Le Marais Boutique, Jan 15-20

## Preferences
- Pace: relaxed, 2-3 activities per day
- Interests: art, food, history
- Dietary: allergic to shellfish
- Prefers morning activities

## Pending Decisions
- Which Louvre entrance to use
- Day trip to Versailles or Giverny?

## Last Updated
2025-01-09T10:30:00Z
```

**No migration needed:** Just remove prefs.json code and use context.md. Clean cutover.

**Storage functions to add:**
```typescript
// storage.ts
export async function readContext(tripId: string): Promise<string> { ... }
export async function writeContext(tripId: string, content: string): Promise<void> { ... }
```

**Update entity handlers:**
```typescript
// Remove 'prefs' handler, context handles everything
context: {
  read: (tripId: string) => storage.readContext(tripId),
  update: (tripId: string, content: string) => storage.writeContext(tripId, content),
},
```

**System prompt guidance:**
```markdown
## Context Management

Your context.md file stores everything you've learned about this trip:
- Trip details (dates, travelers)
- Confirmed bookings
- User preferences (pace, interests, dietary)
- Pending decisions

Read context at conversation start. Update it when you learn something new.
```

### Phase 5: Update Skill Usage

**Travel-planner skill:** Deprecated - logic moves to system prompt + entity tools.

**nano-banana skill:** Keep - image generation is a distinct capability. Agent uses `Skill` tool to invoke it for trip maps.

**chat-title-generator:** Move to server-side - auto-generate from first user message in `ws-session.ts`. No agent involvement needed. Simpler.

**Updated allowedTools:**
```typescript
allowedTools: [
  // File tools (for edge cases)
  "Read", "Edit", "Write",
  // Web tools
  "WebFetch", "WebSearch",
  // Keep Skill for nano-banana image generation
  "Skill",
  // Dynamic entity tools (inline, not MCP)
  "list_entity_types",  // Discover what's available
  "list_entities",      // List items of any type
  "read_entity",        // Read any entity
  "create_entity",      // Create any entity
  "update_entity",      // Update any entity
  "toggle_todo",        // Atomic TODO operation
  "complete_task",      // Explicit completion signal
]
```

**Server-side title generation** (in `ws-session.ts`):
```typescript
// After first assistant message, auto-generate title if needed
if (!hasTitle && isFirstResponse) {
  const title = generateTitleFromMessage(userMessage); // Simple extraction
  await storage.updateConversation(tripId, conversationId, { title });
}
```

**Keep skill reference docs** (inject into system prompt):
- `.claude/skills/travel-planner/reference/itinerary-conventions.md`
- `.claude/skills/travel-planner/reference/inline-linking.md`

### Phase 6: Parity Audit

Verify agent can do everything the UI can do.

| UI Action | Agent Capability | Status |
|-----------|------------------|--------|
| Create trip | `create_entity(trip, ...)` | NEW |
| Delete trip | (not in UI either) | N/A |
| Rename trip | `update_entity(trip, ...)` | NEW |
| View itinerary | `read_entity(itinerary, tripId)` | NEW |
| Edit itinerary | `update_entity(itinerary, tripId, content)` | NEW |
| Toggle TODO | `toggle_todo` | NEW |
| View context | `read_entity(context, tripId)` | NEW |
| Update context | `update_entity(context, tripId, content)` | NEW |
| Generate map | `Skill(nano-banana)` | KEEP |
| Upload file | N/A (user action) | OK |
| Chat | Existing | OK |

---

## File Changes Summary

### New Files
```
server/tools/
  index.ts              # Tool registry (exports all tools)
  entity-tools.ts       # Dynamic CRUD: list_entity_types, read_entity, create_entity, update_entity, list_entities, toggle_todo
  completion-tools.ts   # complete_task with shouldContinue: false
```

### Modified Files
```
agentsdk/agent-client.ts    # Register custom tools in SDK config, update allowedTools
agentsdk/system-prompt.ts   # Expand to comprehensive guide (behavior in prose)
server/ws-session.ts        # Enhanced context injection, server-side title generation, handle complete_task
server/storage.ts           # Add readContext/writeContext, listUploads; remove prefs.json code; updateTrip
server/api.ts               # Replace prefs API with context API
web/App.tsx                 # Handle context/trips update broadcasts
README.md                   # Update prefs references to context
CLAUDE.md                   # Update data model and API references
```

### Deprecated
```
.claude/skills/travel-planner/SKILL.md    # Logic moves to system prompt
prefs.json (per trip)                      # Consolidated into context.md
.claude/skills/chat-title-generator/       # Moved to server-side
```

### Kept
```
.claude/skills/nano-banana/                # Still used via Skill tool for image generation
.claude/skills/travel-planner/reference/   # Inject into system prompt
```

---

## Current Progress (Implemented)

### Tools + Agent Wiring
- Added `server/tools/entity-tools.ts`, `server/tools/completion-tools.ts`, `server/tools/index.ts`
- Registered inline tools in `server/ws-session.ts` and allowlisted in `agentsdk/agent-client.ts`
- Disabled user-level plugins/MCP tools to avoid unintended browser tool use

### Storage + API
- Replaced `prefs.json` with `context.md` in `server/storage.ts`
- Added `readContext`/`writeContext`, `updateTrip`, and `listUploads`
- Replaced `/prefs` API with `/context` in `server/api.ts`

### Prompt + Context Injection
- Expanded `agentsdk/system-prompt.ts` with agent-native guidance
- Added explicit “no XML/tool-tag output” rule to prevent `<write_file>` / `<anthinking>` leaks
- Updated `server/ws-session.ts` context injection (removed file paths, added TODO counts + context)
- Server-side chat title generation from the first user message

### UI + Docs
- Broadcast `context_updated` and `trips_updated` events on tool results
- UI listens for `trips_updated` and refreshes trip list
- Updated `README.md` and `CLAUDE.md` to reflect `context.md`

### Known Gaps / Next Steps
- Add UI for viewing/editing `context.md` (optional)
- Verify tool-based itinerary edits avoid XML output in assistant messages
- Update any remaining refs to `prefs` in tests or docs (if present)

---

## Verification Plan

1. **Start dev server**: `PORT=3002 DISABLE_AUTH=true bun run dev`

2. **Playwright tests** (using MCP):
   - Navigate to `http://localhost:3002`
   - Create a new trip
   - Send message: "Add a museum day with the Louvre"
   - Verify agent uses `read_entity(itinerary)` → modifies → `update_entity(itinerary)`
   - Verify agent calls `complete_task` at the end
   - Verify itinerary shows Louvre with verified hours

3. **Parity test**:
   - For each UI action, describe it to the agent
   - Verify agent can achieve the same outcome

4. **Emergent capability test** (the ultimate test):
   - Ask: "Cross-reference my TODO items with my preferences and tell me what I should prioritize"
   - Agent should compose `read_entity(itinerary)` + `read_entity(context)` + reasoning
   - If agent says "I don't have a feature for that"—architecture is still too constrained

---

## Success Criteria (from agent-native-architecture skill)

### Architecture
| Criterion | How Plan Addresses It |
|-----------|----------------------|
| **Parity**: Agent can achieve anything users can through UI | Dynamic CRUD tools cover all UI actions (create trip, edit itinerary, toggle TODO, update context) |
| **Granularity**: Tools are primitives, not workflows | `read_entity`, `create_entity`, `update_entity`, `list_entities` are generic primitives; `toggle_todo` is atomic |
| **Composability**: New features via prompts alone | Adding "bookings" = add handler entry + prompt section (no new tools) |
| **Emergent capability**: Agent handles open-ended requests | Agent can compose `read_entity(itinerary)` + `read_entity(context)` + reasoning for novel requests |
| **Behavior change = prompt edit** | Workflow logic in system prompt, not skill code |

### Implementation
| Criterion | How Plan Addresses It |
|-----------|----------------------|
| **Dynamic context in system prompt** | `buildTripContextPrompt()` injects trip name, TODO counts, preferences |
| **Every UI action has agent tool** | Parity audit in Phase 6 verifies coverage |
| **Tools documented in user vocabulary** | System prompt lists tools with natural descriptions |
| **Shared workspace** | Agent and UI both work in `~/.travelagent/trips/<tripId>/` |
| **Agent actions reflect in UI immediately** | `ws-session.ts` broadcasts `itinerary_updated` on entity writes |
| **Full CRUD for every entity** | Create/read/update are implemented; delete remains an explicit gap to add later |
| **Explicit completion signal** | `complete_task` tool with `shouldContinue: false` |
| **context.md for accumulated knowledge** | Phase 4 adds `context` entity type with read/write |

### Product
| Criterion | How Plan Addresses It |
|-----------|----------------------|
| **Simple requests work immediately** | Agent reads itinerary, makes change, writes back—no skill invocation dance |
| **Power users can push in unexpected directions** | Dynamic discovery lets agent use any entity type |
| **Learn from what users ask** | Observe which entity types agent tries to access (logs) |
| **Approval matches stakes** | Write operations allowed (low stakes); could add approval for delete later |

### The Ultimate Test
> Describe an outcome to the agent that's within your domain but that you didn't build a specific feature for. Can it figure out how to accomplish it?

**Test prompt:** "Cross-reference my TODO items with my preferences and tell me what I should prioritize"

**Expected behavior:** Agent composes `read_entity(itinerary)` + `read_entity(context)` + reasoning

**If agent says "I don't have a feature for that"** → architecture is still too constrained
