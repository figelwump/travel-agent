---
name: cron-manager
description: Manage reminders and deadlines using OpenClaw's built-in cron scheduler.
allowed-tools:
  - cron
---

# Scheduler Manager (OpenClaw Cron)

This project uses OpenClaw's built-in **cron tool** (not system cron). Use it to schedule reminders and follow-ups.

## Key Facts

- **Tool:** `cron`
- **Reminders repeat daily** after they start unless you disable or remove the job
- **Preferred payload:** `sessionTarget: "main"` with `payload.kind: "systemEvent"` to show a reminder in the active chat

## Workflow

### Step 1: Clarify schedule if missing
If the user doesn’t specify a datetime or timezone, ask them.

### Step 2: Create the job
- For a **one-off reminder**, use `schedule.kind: "at"` with an ISO timestamp.
- For a **daily repeating reminder starting on a specific date**, use `schedule.kind: "every"` with:
  - `everyMs: 86400000`
  - `anchorMs: <epoch-ms of first run time>`

### Step 3: Confirm
Tell the user the exact send time and timezone.

## Examples

### Example 1: One-off reminder
User: “Remind me tomorrow at 9am to check in.”

Create:
```json
{
  "action": "add",
  "job": {
    "name": "Check-in reminder",
    "schedule": { "kind": "at", "at": "2026-01-24T09:00:00-08:00" },
    "payload": { "kind": "systemEvent", "text": "Reminder: check in." },
    "sessionTarget": "main",
    "enabled": true
  }
}
```

### Example 2: Cancellation deadline (repeat daily after start)
User: “My hotel has free cancellation until Feb 10.”

Create a reminder **3 days before** (Feb 7 at 9am local) that repeats daily:
```json
{
  "action": "add",
  "job": {
    "name": "Hotel cancellation deadline",
    "schedule": {
      "kind": "every",
      "everyMs": 86400000,
      "anchorMs": 1760000000000
    },
    "payload": {
      "kind": "systemEvent",
      "text": "Reminder: free cancellation ends on Feb 10."
    },
    "sessionTarget": "main",
    "enabled": true
  }
}
```
Use the user's timezone to compute `anchorMs` for the first run time.

## Updating / Completing

- When the user completes a task, **disable** the job with `cron` action `update` and `patch.enabled=false`, or remove it.
- Use `cron` action `list` to locate a job if you need its id.

## Common Pitfalls

- **Missing timezone:** always ask or use the user's stated timezone.
- **Wrong schedule kind:** use `every` with `anchorMs` for daily repeats starting on a specific date.
