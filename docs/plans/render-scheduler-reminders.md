# Travel Agent: Render Deployment + Scheduler + Cancellation Reminders (Deprecated)

> **Deprecated:** Use `docs/plans/mac-mini-scheduler-reminders.md` for the current,
> Mac mini–focused plan optimized for rapid iteration and debuggability.

## Overview

Three-part implementation:
1. **Render deployment config** - Make the repo deployment-ready for Render.com
2. **Generic scheduler service** - Application-level cron system the agent can programmatically control
3. **Cancellation reminders** - Agent-driven booking deadline tracking with email notifications

---

## Part 1: Render Deployment Setup

### Current State
- Dockerfile exists with cron + SSH support
- entrypoint.sh handles cron daemon, SSH, skills persistence
- `TRAVEL_AGENT_HOME=/var/data/travelagent` already configured in Dockerfile

### Changes Needed

#### 1.1 Create `render.yaml`
```yaml
services:
  - type: web
    name: travel-agent
    env: docker
    plan: standard  # 2GB RAM
    region: oregon
    numInstances: 1
    dockerfilePath: Dockerfile
    disk:
      name: data
      mountPath: /var/data
      sizeGB: 10
    envVars:
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: AUTH_PASSWORD
        sync: false
      - key: ALLOWED_ORIGINS
        sync: false
      - key: NANO_BANANA_PRO_API_KEY
        sync: false
      - key: RESEND_API_KEY
        sync: false
      - key: NOTIFICATION_EMAIL
        sync: false
      - key: PORT
        value: "3001"
```

#### 1.2 Update Dockerfile
- Keep default PORT at 3001 (align with current app expectations)
- Ensure the server always respects `process.env.PORT` if set
- Add healthcheck endpoint
- Ensure `TRAVEL_AGENT_HOME` points to persistent disk

#### 1.3 Add healthcheck endpoint
- Add `GET /health` to `server/api.ts`
- Returns `{ status: "ok", uptime: ... }`

#### 1.4 Create `.dockerignore`
```
.git
node_modules
debug/
*.log
.env
```

### Files to Create/Modify
- `render.yaml` (create)
- `Dockerfile` (minor updates)
- `.dockerignore` (create)
- `server/api.ts` (add /health endpoint)

---

## Part 2: Generic Scheduler Service

### Design Philosophy
- **Application-level scheduler** driven by `setInterval` + a cron parser library
- **JSON-based task storage** at `TRAVEL_AGENT_HOME/scheduler/tasks.json`
- **Agent-accessible via tools** - create, list, delete, pause tasks
- **Extensible task types** - not just reminders, any recurring task

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  server/scheduler/                                          │
│  ├── scheduler.ts      # Core scheduler engine              │
│  ├── task-storage.ts   # CRUD for scheduled tasks           │
│  ├── task-runner.ts    # Execute tasks by type              │
│  └── handlers/                                              │
│      ├── email-reminder.ts   # Send reminder emails         │
│      └── webhook.ts          # Call webhooks (future)       │
└─────────────────────────────────────────────────────────────┘
```

### Data Model

```typescript
// ~/.travelagent/scheduler/tasks.json
type ScheduledTask = {
  id: string;
  name: string;
  type: "email-reminder" | "webhook" | "custom";
  schedule:
    | { type: "at"; runAt: string; timezone: string }   // ISO datetime
    | { type: "cron"; cron: string; timezone: string }; // cron expression
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string;

  // Type-specific payload
  payload: {
    // For email-reminder:
    tripId?: string;
    subject?: string;
    body?: string;
    deadlineDate?: string;    // What we're reminding about

    // For webhook:
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  };

  // Execution options
  options?: {
    deleteAfterRun?: boolean;  // For one-time tasks
    maxRetries?: number;
  };
};
```

### Implementation

#### 2.1 `server/scheduler/task-storage.ts`
```typescript
// Storage functions
listTasks(): Promise<ScheduledTask[]>
getTask(id: string): Promise<ScheduledTask | null>
createTask(task: Omit<ScheduledTask, 'id' | 'createdAt'>): Promise<ScheduledTask>
updateTask(id: string, patch: Partial<ScheduledTask>): Promise<ScheduledTask>
deleteTask(id: string): Promise<boolean>
getTasksByTripId(tripId: string): Promise<ScheduledTask[]>
```

#### 2.2 `server/scheduler/scheduler.ts`
```typescript
// Core scheduler
class Scheduler {
  private checkInterval: Timer;

  start(): void       // Called on server startup
  stop(): void        // Graceful shutdown
  checkTasks(): void  // Run every minute, execute due tasks

  // Calculate next run time using cron parser + timezone
  calculateNextRun(task: ScheduledTask): Date | null
}
```

#### 2.3 `server/scheduler/handlers/email-reminder.ts`
```typescript
// Email sending via Resend
async function sendReminderEmail(task: ScheduledTask): Promise<void>
```

#### 2.4 Agent Tools in `server/tools/scheduler-tools.ts`
```typescript
// New tools for the agent
create_scheduled_task    // Create a new scheduled task
list_scheduled_tasks     // List all tasks (optionally filtered by tripId)
delete_scheduled_task    // Delete a task by ID
update_scheduled_task    // Modify a task (enable/disable, change schedule)
```

#### 2.5 Update `cron-manager` skill
Update `.claude/skills/cron-manager/SKILL.md` to document the new programmatic approach:
- Remove references to system cron (`/etc/cron.d`)
- Document the new scheduler tools
- Provide examples for common patterns
#### 2.6 Cron library choice
- Use `cron-parser` to compute `nextRun` with timezone support
- Store `nextRun` in UTC for comparisons; keep schedule timezone for display

### Startup Integration

In `server/server.ts`:
```typescript
import { Scheduler } from "./scheduler/scheduler";

const scheduler = new Scheduler();
scheduler.start();

// On server shutdown
process.on("SIGTERM", () => scheduler.stop());
```

### Files to Create/Modify
- `server/scheduler/task-storage.ts` (create)
- `server/scheduler/scheduler.ts` (create)
- `server/scheduler/task-runner.ts` (create)
- `server/scheduler/handlers/email-reminder.ts` (create)
- `server/tools/scheduler-tools.ts` (create)
- `server/tools/index.ts` (export scheduler tools)
- `server/server.ts` (start scheduler)
- `.claude/skills/cron-manager/SKILL.md` (update)
- `package.json` (add `resend` dependency)
- `package.json` (add cron parser dependency)

---

## Part 3: Cancellation Reminder System

### Design Philosophy
- **Fully agent-driven** - agent detects bookings and creates reminders autonomously
- **System prompt guidance** - teach agent when/how to create reminders
- **Central management UI** - view/manage all reminders in the web app

### How It Works

1. **Agent detects booking** in conversation:
   - User shares hotel confirmation with cancellation policy
   - User forwards flight booking email
   - User mentions "free cancellation until March 15"

2. **Agent extracts deadline** and creates reminder:
   ```
   User: "I booked the Marriott, free cancellation until Feb 10"
   Agent: [calls create_scheduled_task with:]
   {
     name: "Marriott cancellation deadline",
     type: "email-reminder",
     schedule: {
       type: "at",
       runAt: "2026-02-07T09:00:00",  // 3 days before
       timezone: "America/Los_Angeles"
     },
     payload: {
       tripId: "...",
       subject: "Cancellation deadline approaching: Marriott",
       body: "Your free cancellation period for Marriott ends on Feb 10...",
       deadlineDate: "2026-02-10"
     },
     options: { deleteAfterRun: true }
   }
   ```

3. **Scheduler sends email** 3 days before deadline

4. **User can manage** via UI or agent conversation

### System Prompt Addition

Add to `agentsdk/system-prompt.ts`:
```markdown
## Booking & Cancellation Tracking

### Proactive Detection

When you see booking information (hotel confirmations, flight details, tour reservations):
1. **Ask about cancellation policies** if not mentioned: "Does this booking have a cancellation deadline I should track?"
2. **Extract the deadline** when the user provides it
3. **Create a reminder** using `create_scheduled_task`:
   - Schedule for **3 days before** the deadline (default)
   - Type: `email-reminder`
   - Include tripId, deadline date, booking details, and user timezone in payload/schedule
4. **Confirm with the user** that you've set the reminder

Example flow:
- User: "I booked the Marriott for our trip"
- Agent: "Great! Does this reservation have a cancellation deadline I should track?"
- User: "Yes, free cancellation until Feb 10"
- Agent: [creates reminder for Feb 7] "I've set a reminder for Feb 7, 3 days before your cancellation deadline."

### Managing Reminders

When the user asks to "show my reminders" or "what deadlines are coming up":
- Use `list_scheduled_tasks` filtered by the current trip
- Summarize upcoming deadlines clearly with dates and booking names

When the user wants to change reminder timing:
- Use `update_scheduled_task` to modify the schedule
- Example: "remind me 1 week before instead" → recalculate and update
```

### API Endpoints for UI

Add to `server/api.ts`:
```typescript
GET  /api/scheduler/tasks              // List all tasks
GET  /api/scheduler/tasks?tripId=...   // List tasks for a trip
POST /api/scheduler/tasks              // Create task (for UI)
DELETE /api/scheduler/tasks/:id        // Delete task
PATCH /api/scheduler/tasks/:id         // Update task (enable/disable)
```

### Web UI Component

Add `web/RemindersPane.tsx`:
- List upcoming reminders grouped by trip
- Show deadline date, reminder date, booking name
- Toggle enable/disable
- Delete reminder
- Link to related trip

### Files to Create/Modify
- `agentsdk/system-prompt.ts` (add booking tracking guidance)
- `server/api.ts` (add scheduler endpoints)
- `web/RemindersPane.tsx` (create)
- `web/App.tsx` (add reminders view/route)

---

## Part 4: Inbound Email for Booking Forwarding (Future)

> **Note:** This is documented for future implementation. Parts 1-3 should be completed first.

### How It Works

1. **Setup inbound domain** in Resend (e.g., `bookings.yourdomain.com`)
2. **User forwards** hotel/flight confirmation to `trips@bookings.yourdomain.com`
3. **Resend webhook** POSTs to `/api/inbound/email`
4. **Server extracts** booking details using Claude
5. **Agent adds** to relevant trip and creates cancellation reminder

### Webhook Endpoint

```typescript
// POST /api/inbound/email
// Resend sends: { from, to, subject, text, html, attachments[] }

async function handleInboundEmail(payload: ResendInboundPayload) {
  // 1. Parse booking details using Claude
  // 2. Match to trip by date or ask user
  // 3. Add to trip context
  // 4. Create cancellation reminder if deadline found
}
```

### Matching Emails to Trips

Options:
- **Date-based**: Match booking dates to trip dates
- **Address-based**: Use trip-specific addresses like `japan-2026@bookings.yourdomain.com`
- **Confirmation flow**: Send reply asking which trip, or add to inbox for manual routing

### Files (Future)
- `server/inbound/email-handler.ts`
- `server/api.ts` (add inbound webhook endpoint)

---

## Environment Variables

New variables needed:
```bash
# Email - Resend (handles both outbound and inbound)
RESEND_API_KEY=re_...
NOTIFICATION_EMAIL=you@example.com  # Where to send reminders

# Inbound email (future)
RESEND_INBOUND_DOMAIN=bookings.yourdomain.com  # Optional, for forwarding bookings

# Optional
SCHEDULER_CHECK_INTERVAL=60000  # ms between checks, default 1 minute
```

---

## Implementation Order

### Phase 1: Render Deployment (can deploy without scheduler)
1. Create `render.yaml`
2. Create `.dockerignore`
3. Add `/health` endpoint
4. Test local Docker build
5. Deploy to Render

### Phase 2: Scheduler Core
1. Create task storage module
2. Create scheduler engine
3. Create email handler
4. Integrate with server startup
5. Test with manual task creation

### Phase 3: Agent Integration
1. Create scheduler tools
2. Update system prompt
3. Update cron-manager skill
4. Test agent creating/managing tasks

### Phase 4: UI & Polish
1. Add API endpoints
2. Create RemindersPane component
3. Add to App navigation
4. End-to-end testing

---

## Verification Plan

### Part 1: Render Deployment
```bash
# Local Docker test
docker build -t travel-agent .
docker run -p 3001:3001 -v $(pwd)/data:/var/data travel-agent

# Verify health endpoint
curl http://localhost:3001/health

# Deploy to Render and verify
# - Service starts successfully
# - /health returns 200
# - Persistent disk mounts at /var/data
# - Trip data persists across deploys
```

### Part 2: Scheduler
```bash
# CLI session test
TRAVEL_AGENT_URL=http://localhost:3001 bun run cli session run \
  --message "Create a test reminder for tomorrow at 9am" \
  --trip "Scheduler Test"

# Verify task created
cat ~/.travelagent/scheduler/tasks.json

# Test email sending (mock or real)
# Fast-forward scheduler check and verify email sent
```

### Part 3: Cancellation Reminders
```bash
# CLI session test
TRAVEL_AGENT_URL=http://localhost:3001 bun run cli session run \
  --message "I booked the Hilton, free cancellation until next Friday" \
  --trip "Cancellation Test"

# Verify reminder created with correct date (3 days before Friday)
# Test UI shows the reminder
# Test agent can list reminders: "what reminders do I have?"
```

---

## Dependencies

```bash
bun add resend   # Email sending (and inbound webhooks in future)
bun add cron-parser
# node-cron not needed - using setInterval + cron parsing
```

---

## Risk Considerations

1. **Email deliverability** - Use Resend's verified sender domain
2. **Timezone handling** - Store schedule timezone; compute `nextRun` in UTC; display in user local timezone
3. **Missed tasks** - On startup, check for overdue tasks and run them
4. **Task persistence** - JSON file atomic writes to prevent corruption
5. **Agent reliability** - System prompt must be clear about when to create reminders
