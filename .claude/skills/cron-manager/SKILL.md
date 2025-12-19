---
name: cron-manager
description: Create and manage cron jobs (recurring events, repeating workflows, scheduled tasks). Use when user asks to schedule something to run automatically, create recurring tasks, set up periodic jobs, or manage cron entries.
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# Cron Manager

Create and manage cron jobs for recurring tasks, scheduled workflows, and periodic automation.

## Configuration

**Resource root (do not `cd` here):** `$SKILL_ROOT` = `.claude/skills/cron-manager`

**Cron manager script:** `$SKILL_ROOT/scripts/cron-manager.sh`

**Persistent cron directory:** `/var/data/cron.d`

When executing commands or referencing paths, use `$SKILL_ROOT` only to build absolute paths to helper resources and keep the shell working directory at the repository root.

## Prerequisites

- Container must be running with cron daemon started (handled by entrypoint.sh)
- The `$SKILL_ROOT/scripts/cron-manager.sh` helper script must be available

## Guidelines

- **ALWAYS ask the user for the time period/schedule if not specified** - Use AskUserQuestion to clarify
- Convert natural language time expressions to cron syntax (see reference)
- Use descriptive job names (alphanumeric, dashes, underscores only)
- Always reload cron after creating or deleting jobs
- Commands should use absolute paths
- Output is logged to `/var/log/cron.log`

## Workflow

### Step 1: Clarify Schedule (if not specified)

If the user does not specify when the task should run, **you MUST ask them**:

```markdown
Use AskUserQuestion with options like:
- "Every minute" (for testing)
- "Every 5 minutes"
- "Every hour"
- "Every day at midnight"
- Or ask them to specify a custom schedule
```

Common questions to ask:
- "How often should this run?"
- "What time of day?"
- "Which days of the week?"
- "At what minute past the hour?"

### Step 2: Convert to Cron Schedule

Translate the user's time specification to cron format. See `$SKILL_ROOT/reference/crontab-syntax.md` for:
- Common schedule patterns
- Natural language to cron mapping
- Time format conversions

Examples:
| User Request | Cron Expression |
| ------------ | --------------- |
| "every 5 minutes" | `*/5 * * * *` |
| "every hour" | `0 * * * *` |
| "every day at 3pm" | `0 15 * * *` |
| "every Monday at 9am" | `0 9 * * 1` |
| "weekdays at 6pm" | `0 18 * * 1-5` |

### Step 3: Determine the Command

Identify what the user wants to run:
- If they provide a script path, use it directly
- If they describe an action, create a script in `/var/data/cron.d/scripts/` and reference it
- Always use absolute paths when creating the cron job

**Scripts directory:** `/var/data/cron.d/scripts/` (persistent storage, created automatically by cron-manager.sh)

For complex tasks, create a script:
```bash
# Create the task script in the persistent scripts directory
cat > /var/data/cron.d/scripts/my-task.sh << 'EOF'
#!/bin/sh
# Task description here
your-command-here
EOF
chmod +x /var/data/cron.d/scripts/my-task.sh
```

Then reference it with the full path: `/var/data/cron.d/scripts/my-task.sh`

### Step 4: Create the Cron Job

Use the cron manager script:

```bash
$SKILL_ROOT/scripts/cron-manager.sh create <job-name> "<schedule>" "<command>"
```

Example:
```bash
$SKILL_ROOT/scripts/cron-manager.sh create daily-backup "0 2 * * *" "/app/scripts/backup.sh"
```

### Step 5: Reload Cron

Always reload cron to apply changes:

```bash
$SKILL_ROOT/scripts/cron-manager.sh reload
```

### Step 6: Verify

List jobs to confirm:
```bash
$SKILL_ROOT/scripts/cron-manager.sh list
```

## Managing Existing Jobs

### List all cron jobs
```bash
$SKILL_ROOT/scripts/cron-manager.sh list
```

### Show job details
```bash
$SKILL_ROOT/scripts/cron-manager.sh show <job-name>
```

### Delete a job
```bash
$SKILL_ROOT/scripts/cron-manager.sh delete <job-name>
$SKILL_ROOT/scripts/cron-manager.sh reload
```

## Decision Tree: Schedule Selection

When user asks for a recurring task but doesn't specify timing:

1. **For monitoring/health checks**: Suggest every 5 or 15 minutes
2. **For backups**: Suggest daily at 2 AM (low-traffic time)
3. **For reports**: Suggest daily at 9 AM or weekly on Monday
4. **For cleanup tasks**: Suggest daily at midnight
5. **For notifications**: Ask user preference
6. **For testing**: Suggest every minute initially, then adjust

Always confirm the schedule with the user before creating the job.

## Common Errors

- **"Job name must contain only letters, numbers, dashes, and underscores"**: Rename the job using valid characters only. Example: use `daily-backup` not `daily backup`

- **"Job already exists"**: Either choose a different name or acknowledge that it will be overwritten

- **"cron daemon not found"**: The container may not have cron installed. Check with `which cron` or `which crond`

- **Job not running**:
  1. Check the schedule is correct
  2. Verify cron was reloaded: `$SKILL_ROOT/scripts/cron-manager.sh reload`
  3. Check logs: `tail -f /var/log/cron.log`
  4. Ensure command path is absolute

- **Permission denied**: Ensure scripts are executable with `chmod +x`

## Example Conversations

### Example 1: User specifies schedule
**User**: "Create a cron job to backup the database every day at 2am"
**Agent**: Creates job with schedule `0 2 * * *`

### Example 2: User doesn't specify schedule
**User**: "I want to run a health check periodically"
**Agent**: Uses AskUserQuestion to ask how often (every 5 mins, 15 mins, hourly, etc.)

### Example 3: User uses natural language
**User**: "Send me a report every Monday morning"
**Agent**: Interprets as "every Monday at 9am" → `0 9 * * 1`

## Reference

- `$SKILL_ROOT/reference/crontab-syntax.md` – Complete crontab syntax guide with natural language mappings
