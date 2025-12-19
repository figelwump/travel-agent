# Crontab Syntax Reference

## Schedule Format

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
│ │ │ │ │
* * * * *
```

## Special Characters

| Character | Description | Example |
| --------- | ----------- | ------- |
| `*` | Any value | `* * * * *` = every minute |
| `,` | List separator | `1,15 * * * *` = minute 1 and 15 |
| `-` | Range | `1-5 * * * *` = minutes 1 through 5 |
| `/` | Step values | `*/15 * * * *` = every 15 minutes |

## Common Schedule Patterns

| Schedule | Cron Expression | Description |
| -------- | --------------- | ----------- |
| Every minute | `* * * * *` | Runs once per minute |
| Every 5 minutes | `*/5 * * * *` | At :00, :05, :10, etc. |
| Every 15 minutes | `*/15 * * * *` | At :00, :15, :30, :45 |
| Every 30 minutes | `*/30 * * * *` | At :00 and :30 |
| Every hour | `0 * * * *` | At minute 0 of every hour |
| Every 2 hours | `0 */2 * * *` | At minute 0, every 2 hours |
| Every 6 hours | `0 */6 * * *` | At 00:00, 06:00, 12:00, 18:00 |
| Daily at midnight | `0 0 * * *` | At 00:00 every day |
| Daily at 2 AM | `0 2 * * *` | At 02:00 every day |
| Daily at 9 AM | `0 9 * * *` | At 09:00 every day |
| Daily at 6 PM | `0 18 * * *` | At 18:00 every day |
| Twice daily | `0 9,18 * * *` | At 09:00 and 18:00 |
| Weekly (Sunday) | `0 0 * * 0` | Sunday at midnight |
| Weekly (Monday) | `0 0 * * 1` | Monday at midnight |
| Every weekday | `0 9 * * 1-5` | Mon-Fri at 09:00 |
| Every weekend | `0 9 * * 0,6` | Sat and Sun at 09:00 |
| Monthly (1st) | `0 0 1 * *` | 1st of month at midnight |
| Monthly (15th) | `0 0 15 * *` | 15th of month at midnight |
| Quarterly | `0 0 1 1,4,7,10 *` | 1st of Jan, Apr, Jul, Oct |
| Yearly | `0 0 1 1 *` | January 1st at midnight |

## Natural Language to Cron Mapping

| User Says | Cron Expression |
| --------- | --------------- |
| "every minute" | `* * * * *` |
| "every 5 minutes" | `*/5 * * * *` |
| "every 10 minutes" | `*/10 * * * *` |
| "every 15 minutes" | `*/15 * * * *` |
| "every half hour", "every 30 minutes" | `*/30 * * * *` |
| "every hour", "hourly" | `0 * * * *` |
| "every 2 hours" | `0 */2 * * *` |
| "every 3 hours" | `0 */3 * * *` |
| "every 4 hours" | `0 */4 * * *` |
| "every 6 hours" | `0 */6 * * *` |
| "every 12 hours", "twice a day" | `0 */12 * * *` |
| "every day", "daily" | `0 0 * * *` |
| "every morning" | `0 9 * * *` |
| "every night", "nightly" | `0 0 * * *` |
| "every weekday" | `0 9 * * 1-5` |
| "every weekend" | `0 9 * * 0,6` |
| "every Monday" | `0 9 * * 1` |
| "every Tuesday" | `0 9 * * 2` |
| "every Wednesday" | `0 9 * * 3` |
| "every Thursday" | `0 9 * * 4` |
| "every Friday" | `0 9 * * 5` |
| "every Saturday" | `0 9 * * 6` |
| "every Sunday" | `0 9 * * 0` |
| "every week", "weekly" | `0 0 * * 0` |
| "every month", "monthly" | `0 0 1 * *` |

## Time Specifications

When user specifies a time like "at 3pm" or "at 14:30":

| Time Format | Hour | Minute |
| ----------- | ---- | ------ |
| "3am", "3 AM" | 3 | 0 |
| "3pm", "3 PM" | 15 | 0 |
| "noon", "12pm" | 12 | 0 |
| "midnight", "12am" | 0 | 0 |
| "9:30am" | 9 | 30 |
| "14:30", "2:30pm" | 14 | 30 |
| "6:15pm" | 18 | 15 |

## Examples with Specific Times

| Request | Cron Expression |
| ------- | --------------- |
| "every day at 3pm" | `0 15 * * *` |
| "every Monday at 9am" | `0 9 * * 1` |
| "weekdays at 6:30pm" | `30 18 * * 1-5` |
| "every hour at :30" | `30 * * * *` |
| "every 15 mins starting at :05" | `5,20,35,50 * * * *` |
| "1st of month at noon" | `0 12 1 * *` |

## Command Examples

Common command patterns for cron jobs:

```bash
# Run a script
$SKILL_ROOT/scripts/backup.sh

# Run with specific shell
/bin/sh -c '$SKILL_ROOT/scripts/task.sh'

# HTTP health check
curl -s https://example.com/health

# Webhook notification
curl -X POST https://example.com/webhook -d '{"status":"ok"}'

# Run Node.js script
/usr/bin/node $SKILL_ROOT/scripts/task.js

# Run Python script
/usr/bin/python3 $SKILL_ROOT/scripts/task.py

# Database backup
pg_dump mydb > /var/data/backups/db-$(date +\%Y\%m\%d).sql

# Log rotation
find /var/log -name "*.log" -mtime +7 -delete

# Clean temp files
rm -rf /tmp/cache/*
```

## Important Notes

1. **All times are in the container's timezone** (usually UTC)
2. **Commands run as root** by default in this setup
3. **Output is logged** to `/var/log/cron.log`
4. **Escape percent signs** in commands: use `\%` instead of `%`
5. **Use absolute paths** for all scripts and binaries
