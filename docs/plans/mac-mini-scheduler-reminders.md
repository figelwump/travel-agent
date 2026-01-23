# Travel Agent: Mac Mini Setup + Scheduler + Cancellation Reminders (Simplified)

## Overview

Three-part implementation optimized for fast iteration and debuggability on a Mac mini:
1. **Mac mini deployment setup** - Run the Bun server as a launchd service
2. **Simple scheduler service** - Application-level scheduler for one-time reminders only
3. **Cancellation reminders** - Agent-driven booking deadline tracking with email notifications

---

## Part 1: Mac Mini Deployment Setup (Prod-like)

### Goals
- Always-on server on the Mac mini
- Simple restart and logging via launchd
- Minimal infrastructure changes

### Changes Needed

#### 1.1 Local runtime configuration
- Keep PORT at `3001`
- Store data under `TRAVEL_AGENT_HOME` (default `~/.travelagent`)
- Add `NOTIFICATION_EMAIL` and `RESEND_API_KEY` to environment

#### 1.2 Launchd service
- Create a launchd plist to run the server on boot:
  - Runs `bun run start` from the repo directory
  - Sets required env vars
  - Logs to a file under `~/Library/Logs/travel-agent/`

Example (draft):
```xml
<!-- ~/Library/LaunchAgents/com.travelagent.server.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.travelagent.server</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/bin/bun</string>
      <string>run</string>
      <string>start</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/vishal/GiantThings/repos/travel-agent</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PORT</key><string>3001</string>
      <key>TRAVEL_AGENT_HOME</key><string>/Users/vishal/.travelagent</string>
      <key>RESEND_API_KEY</key><string>re_...</string>
      <key>NOTIFICATION_EMAIL</key><string>you@example.com</string>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/vishal/Library/Logs/travel-agent/server.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/vishal/Library/Logs/travel-agent/server.err</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
  </dict>
</plist>
```

#### 1.3 Optional: Local reverse proxy + HTTPS
- Only needed if receiving public webhooks or external access
- Caddy is the simplest (automatic TLS)

### Files to Create/Modify
- `docs/` (instructions only, no code changes required)

---

## Part 2: Simple Scheduler Service (One-time reminders only)

### Design Philosophy
- **Application-level scheduler** driven by `setInterval`
- **One-time schedules only** (ISO timestamp)
- **JSON-based task storage** at `TRAVEL_AGENT_HOME/scheduler/tasks.json`
- **Agent-accessible via tools** - create, list, delete, pause tasks

### Data Model

```typescript
// TRAVEL_AGENT_HOME/scheduler/tasks.json
type ScheduledTask = {
  id: string;
  name: string;
  type: "email-reminder" | "webhook" | "custom";
  schedule: { runAt: string; timezone: string }; // ISO datetime + user timezone
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string;

  payload: {
    tripId?: string;
    subject?: string;
    body?: string;
    deadlineDate?: string;    // What we're reminding about
  };

  options?: {
    deleteAfterRun?: boolean;  // For one-time tasks
    maxRetries?: number;
  };
};
```

### Implementation

#### 2.1 `server/scheduler/task-storage.ts`
```typescript
listTasks(): Promise<ScheduledTask[]>
getTask(id: string): Promise<ScheduledTask | null>
createTask(task: Omit<ScheduledTask, 'id' | 'createdAt'>): Promise<ScheduledTask>
updateTask(id: string, patch: Partial<ScheduledTask>): Promise<ScheduledTask>
deleteTask(id: string): Promise<boolean>
getTasksByTripId(tripId: string): Promise<ScheduledTask[]>
```

#### 2.2 `server/scheduler/scheduler.ts`
```typescript
class Scheduler {
  private checkInterval: Timer;

  start(): void
  stop(): void
  checkTasks(): void  // Run every minute, execute due tasks

  // One-time schedule: due when now >= runAt (converted to UTC)
  calculateNextRun(task: ScheduledTask): Date | null
}
```

#### 2.3 `server/scheduler/handlers/email-reminder.ts`
```typescript
async function sendReminderEmail(task: ScheduledTask): Promise<void>
```

#### 2.4 Agent Tools in `server/tools/scheduler-tools.ts`
```typescript
create_scheduled_task
list_scheduled_tasks
delete_scheduled_task
update_scheduled_task
```

#### 2.5 Update `cron-manager` skill
- Document application-level scheduler
- Remove references to system cron (`/etc/cron.d`)
- Provide examples for one-time reminders

### Startup Integration

In `server/server.ts`:
```typescript
import { Scheduler } from "./scheduler/scheduler";

const scheduler = new Scheduler();
scheduler.start();

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

---

## Part 3: Cancellation Reminder System

### Design Philosophy
- **Fully agent-driven** - agent detects bookings and creates reminders autonomously
- **System prompt guidance** - teach agent when/how to create reminders
- **Central management UI** - view/manage all reminders in the web app

### How It Works

1. **Agent detects booking** in conversation
2. **Agent extracts deadline** and creates reminder:
   ```
   {
     name: "Marriott cancellation deadline",
     type: "email-reminder",
     schedule: {
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

### System Prompt Addition

Add to `agentsdk/system-prompt.ts`:
```markdown
## Booking & Cancellation Tracking

When you see booking information:
1. Ask about cancellation policies if not mentioned.
2. Extract the deadline and user's timezone (from global context).
3. Create a reminder 3 days before the deadline.
4. Confirm with the user that the reminder is set.
```

### API Endpoints for UI

Add to `server/api.ts`:
```typescript
GET  /api/scheduler/tasks
GET  /api/scheduler/tasks?tripId=...
POST /api/scheduler/tasks
DELETE /api/scheduler/tasks/:id
PATCH /api/scheduler/tasks/:id
```

### Web UI Component

Add `web/RemindersPane.tsx`:
- List upcoming reminders grouped by trip
- Show deadline date, reminder date, booking name
- Toggle enable/disable
- Delete reminder

### Files to Create/Modify
- `agentsdk/system-prompt.ts` (add booking tracking guidance)
- `server/api.ts` (add scheduler endpoints)
- `web/RemindersPane.tsx` (create)
- `web/App.tsx` (add reminders view/route)

---

## Global Context: User Timezone

Store user timezone in `~/.travelagent/global-context.md`:
```
Timezone: America/Los_Angeles
```

The agent reads this when creating reminders.

---

## Environment Variables

```bash
RESEND_API_KEY=re_...
NOTIFICATION_EMAIL=you@example.com
PORT=3001
TRAVEL_AGENT_HOME=~/.travelagent
```

---

## Implementation Order

### Phase 1: Mac Mini Setup
1. Create launchd plist
2. Start the service and verify logs
3. Confirm API reachable at `http://localhost:3001`

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

```bash
# Start server locally
bun run start

# CLI session test
TRAVEL_AGENT_URL=http://localhost:3001 bun run cli session run \
  --message "Create a test reminder for tomorrow at 9am" \
  --trip "Scheduler Test"

# Verify task created
cat ~/.travelagent/scheduler/tasks.json
```

---

## Dependencies

```bash
bun add resend
```

---

## Risk Considerations

1. **Email deliverability** - Use a verified sender domain in Resend
2. **Timezone handling** - Store schedule timezone; compute `nextRun` in UTC; display in user local timezone
3. **Missed tasks** - On startup, check for overdue tasks and run them
4. **Task persistence** - JSON file atomic writes to prevent corruption
5. **Agent reliability** - System prompt must be clear about when to create reminders
