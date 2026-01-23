---
name: cron-manager
description: Manage the app-level scheduler for one-time reminders and deadlines. Use when the user asks to schedule something or manage reminders.
allowed-tools: AskUserQuestion
---

# Scheduler Manager (App-Level)

This project uses an **application-level scheduler** (not system cron). All tasks are **one-time reminders** stored in JSON under the travel agent data directory.

## Key Facts

- **Storage:** `~/.travelagent/scheduler/tasks.json`
- **Schedule format:** ISO datetime + IANA timezone
- **One-time tasks only** (no recurring schedules)
- **Primary tools:**
  - `create_scheduled_task`
  - `list_scheduled_tasks`
  - `update_scheduled_task`
  - `delete_scheduled_task`

## Workflow

### Step 1: Clarify schedule if missing
If the user doesn’t specify a datetime or timezone, ask them.

### Step 2: Create the task
Create a one-time reminder with a clear subject/body and include the deadline date when relevant.

### Step 3: Confirm
Tell the user the exact send time and timezone.

## Examples

### Example 1: One-time reminder
User: “Remind me tomorrow at 9am to check in.”

Create:
```
{
  "name": "Check-in reminder",
  "type": "email-reminder",
  "schedule": {
    "runAt": "2026-01-24T09:00:00",
    "timezone": "America/Los_Angeles"
  },
  "payload": {
    "subject": "Check-in reminder",
    "body": "Don’t forget to check in."
  },
  "options": { "deleteAfterRun": true }
}
```

### Example 2: Cancellation deadline
User: “My hotel has free cancellation until Feb 10.”

Create a reminder **3 days before** (Feb 7 at 9am local):
```
{
  "name": "Hotel cancellation deadline",
  "type": "email-reminder",
  "schedule": {
    "runAt": "2026-02-07T09:00:00",
    "timezone": "America/Los_Angeles"
  },
  "payload": {
    "subject": "Cancellation deadline approaching: Hotel",
    "body": "Your free cancellation period ends on Feb 10.",
    "deadlineDate": "2026-02-10"
  },
  "options": { "deleteAfterRun": true }
}
```

## Common Pitfalls

- **Missing timezone:** always ask or use the user’s global context timezone.
- **Recurring requests:** explain that only one-time reminders are supported today.
- **Wrong trip:** reminders are scoped to the current trip by default.
