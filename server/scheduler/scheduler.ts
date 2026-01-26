import * as fs from "fs/promises";
import * as path from "path";
import { logTs } from "../log";
import { travelAgentHome } from "../storage";
import type { ScheduledTask } from "./task-storage";
import { deleteTask, listTasks, updateTask } from "./task-storage";
import { runTask } from "./task-runner";

const CHECK_INTERVAL_MS = 60_000;
const LEASE_DURATION_MS = 120_000;

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

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

type SchedulerLease = {
  pid: number;
  token: string;
  expiresAt: number;
};

function leasePath(): string {
  return path.join(travelAgentHome(), "scheduler", "lease.json");
}

async function readLease(): Promise<SchedulerLease | null> {
  try {
    const raw = await fs.readFile(leasePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.pid !== "number" || typeof parsed.token !== "string" || typeof parsed.expiresAt !== "number") {
      return null;
    }
    return parsed as SchedulerLease;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    return null;
  }
}

async function writeLease(lease: SchedulerLease): Promise<void> {
  const filePath = leasePath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const tmp = path.join(dir, `${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(lease, null, 2), "utf8");
    try {
      await fs.rename(tmp, filePath);
      return;
    } catch (err: any) {
      if (err?.code === "ENOENT" && attempt === 0) continue;
      throw err;
    }
  }
}

async function claimLease(): Promise<{ acquired: boolean; lease: SchedulerLease | null; fresh: boolean }> {
  const now = Date.now();
  const current = await readLease();
  if (current && current.expiresAt > now) {
    if (current.pid !== process.pid) return { acquired: false, lease: current, fresh: false };
    const renewed = { ...current, expiresAt: now + LEASE_DURATION_MS };
    await writeLease(renewed);
    return { acquired: true, lease: renewed, fresh: false };
  }
  const token = crypto.randomUUID();
  const next: SchedulerLease = { pid: process.pid, token, expiresAt: now + LEASE_DURATION_MS };
  await writeLease(next);
  const confirmed = await readLease();
  const acquired = Boolean(confirmed && confirmed.token === token);
  return { acquired, lease: confirmed ?? next, fresh: acquired };
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

function getLocalParts(date: Date, timeZone: string): LocalParts | null {
  try {
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
    if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute) || Number.isNaN(second)) {
      return null;
    }
    return { year, month, day, hour, minute, second };
  } catch {
    return null;
  }
}

function makeDateInTimeZone(parts: LocalParts, timeZone: string): Date | null {
  const utcCandidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  try {
    const offset = getTimeZoneOffset(utcCandidate, timeZone);
    return new Date(utcCandidate.getTime() - offset);
  } catch {
    return null;
  }
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

function getRunAtTimeOfDay(runAt: string, timezone: string): Pick<LocalParts, "hour" | "minute" | "second"> | null {
  if (!runAt) return null;
  if (hasTimezoneOffset(runAt)) {
    const date = new Date(runAt);
    if (Number.isNaN(date.getTime())) return null;
    const local = getLocalParts(date, timezone);
    if (!local) return null;
    return { hour: local.hour, minute: local.minute, second: local.second };
  }
  const parts = parseLocalDateTime(runAt);
  if (!parts) return null;
  return { hour: parts.hour, minute: parts.minute, second: parts.second };
}

function shouldRepeatDaily(task: ScheduledTask): boolean {
  if (task.options?.deleteAfterRun) return false;
  return task.type === "email-reminder";
}

function calculateNextDailyRun(task: ScheduledTask, now: Date): Date | null {
  const timezone = task.schedule?.timezone || "UTC";
  const timeOfDay = getRunAtTimeOfDay(task.schedule?.runAt, timezone);
  if (!timeOfDay) return null;
  const today = getLocalParts(now, timezone);
  if (!today) return null;
  return makeDateInTimeZone(
    {
      year: today.year,
      month: today.month,
      day: today.day + 1,
      hour: timeOfDay.hour,
      minute: timeOfDay.minute,
      second: timeOfDay.second,
    },
    timezone,
  );
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
      const leaseResult = await claimLease();
      if (!leaseResult.acquired) {
        const owner = leaseResult.lease?.pid ? ` pid=${leaseResult.lease.pid}` : "";
        logTs(`[Scheduler] Skipping run; another scheduler holds the lease${owner}.`);
        return;
      }
      if (leaseResult.fresh && leaseResult.lease?.pid) {
        logTs(`[Scheduler] Lease acquired by pid=${leaseResult.lease.pid}`);
      }
      const tasks = await listTasks();
      const taskNames = tasks.map((task) => `${task.id}:${task.name}`).join(", ");
      logTs(`[Scheduler] Loaded ${tasks.length} task(s)${tasks.length ? ` (${taskNames})` : ""}`);
      const now = new Date();

      for (const task of tasks) {
        const isDone = task.status === "done" || task.completedAt != null;
        if (isDone) continue;
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
          if (task.options?.deleteAfterRun ?? false) {
            await deleteTask(task.id);
            logTs(`[Scheduler] Deleted task ${task.id} after run`);
          } else {
            if (shouldRepeatDaily(task)) {
              const nextRun = calculateNextDailyRun(task, now);
              const nextRunIso = nextRun ? nextRun.toISOString() : null;
              if (nextRunIso) {
                await updateTask(task.id, {
                  lastRun: nowIso(),
                  enabled: task.enabled,
                  nextRun: nextRunIso,
                  schedule: task.schedule
                    ? { ...task.schedule, runAt: nextRunIso }
                    : task.schedule,
                  runAttempts: 0,
                  lastError: undefined,
                });
              } else {
                await updateTask(task.id, {
                  lastRun: nowIso(),
                  enabled: false,
                  nextRun: null,
                  runAttempts: 0,
                  lastError: "Unable to schedule next reminder run.",
                });
              }
            } else {
              await updateTask(task.id, {
                lastRun: nowIso(),
                enabled: false,
                nextRun: null,
                runAttempts: 0,
                lastError: undefined,
              });
            }
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
