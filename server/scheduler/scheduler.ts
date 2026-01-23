import { logTs } from "../log";
import type { ScheduledTask } from "./task-storage";
import { deleteTask, listTasks, updateTask } from "./task-storage";
import { runTask } from "./task-runner";

const CHECK_INTERVAL_MS = 60_000;

function nowIso(): string {
  return new Date().toISOString();
}

function hasTimezoneOffset(value: string): boolean {
  return /Z$|[+-]\d{2}:?\d{2}$/.test(value);
}

function parseLocalDateTime(value: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  const [datePart, timePart = "00:00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map((v) => Number(v));
  const [hour, minute, second = "0"] = timePart.split(":").map((v) => Number(v));
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute) || Number.isNaN(second)) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

function getTimeZoneOffset(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  const hour = Number(lookup.hour);
  const minute = Number(lookup.minute);
  const second = Number(lookup.second);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - date.getTime();
}

function parseRunAt(runAt: string, timezone: string): Date | null {
  if (hasTimezoneOffset(runAt)) {
    const date = new Date(runAt);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parts = parseLocalDateTime(runAt);
  if (!parts) return null;

  const utcCandidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  try {
    const offset = getTimeZoneOffset(utcCandidate, timezone);
    return new Date(utcCandidate.getTime() - offset);
  } catch {
    return null;
  }
}

export class Scheduler {
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(): void {
    if (this.checkInterval) return;
    logTs("[Scheduler] Starting scheduler loop");
    void this.checkTasks();
    this.checkInterval = setInterval(() => {
      void this.checkTasks();
    }, CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logTs("[Scheduler] Scheduler loop stopped");
    }
  }

  async checkTasks(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tasks = await listTasks();
      const taskNames = tasks.map((task) => `${task.id}:${task.name}`).join(", ");
      logTs(`[Scheduler] Loaded ${tasks.length} task(s)${tasks.length ? ` (${taskNames})` : ""}`);
      const now = new Date();

      for (const task of tasks) {
        if (!task.enabled) continue;
        const nextRun = this.calculateNextRun(task);
        if (!nextRun) continue;

        const nextRunIso = nextRun.toISOString();
        if (task.nextRun !== nextRunIso) {
          await updateTask(task.id, { nextRun: nextRunIso });
        }

        if (now < nextRun) continue;

        try {
          logTs(`[Scheduler] Running task ${task.id} (${task.name})`);
          await runTask(task);
          if (task.options?.deleteAfterRun ?? true) {
            await deleteTask(task.id);
            logTs(`[Scheduler] Deleted task ${task.id} after run`);
          } else {
            await updateTask(task.id, {
              lastRun: nowIso(),
              enabled: false,
              nextRun: null,
              runAttempts: 0,
              lastError: undefined,
            });
          }
        } catch (err: any) {
          const attempts = (task.runAttempts ?? 0) + 1;
          const maxRetries = task.options?.maxRetries ?? 0;
          const disable = maxRetries > 0 && attempts > maxRetries;
          await updateTask(task.id, {
            runAttempts: attempts,
            lastError: err?.message || String(err),
            enabled: disable ? false : task.enabled,
          });
          logTs(`[Scheduler] Task ${task.id} failed (${attempts} attempts):`, err);
        }
      }
    } finally {
      this.running = false;
    }
  }

  calculateNextRun(task: ScheduledTask): Date | null {
    const timezone = task.schedule?.timezone || "UTC";
    const runAt = task.schedule?.runAt;
    if (!runAt) return null;
    return parseRunAt(runAt, timezone);
  }
}
