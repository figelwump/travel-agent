import * as fs from "fs/promises";
import * as path from "path";
import { travelAgentHome } from "../storage";

export type ScheduledTaskType = "email-reminder" | "webhook" | "custom";

export type ScheduledTask = {
  id: string;
  name: string;
  type: ScheduledTaskType;
  schedule: { runAt: string; timezone: string };
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string | null;
  runAttempts?: number;
  lastError?: string;
  payload: {
    tripId?: string;
    subject?: string;
    body?: string;
    deadlineDate?: string;
  };
  options?: {
    deleteAfterRun?: boolean;
    maxRetries?: number;
  };
};

function nowIso(): string {
  return new Date().toISOString();
}

function schedulerDir(): string {
  return path.join(travelAgentHome(), "scheduler");
}

function tasksPath(): string {
  return path.join(schedulerDir(), "tasks.json");
}

async function readTasks(): Promise<ScheduledTask[]> {
  try {
    const raw = await fs.readFile(tasksPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((task) => task && typeof task.id === "string") as ScheduledTask[];
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${path.basename(filePath)}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath);
}

async function writeTasks(tasks: ScheduledTask[]): Promise<void> {
  await writeFileAtomic(tasksPath(), JSON.stringify(tasks, null, 2));
}

export async function listTasks(): Promise<ScheduledTask[]> {
  return readTasks();
}

export async function getTask(id: string): Promise<ScheduledTask | null> {
  const tasks = await readTasks();
  return tasks.find((task) => task.id === id) ?? null;
}

export async function createTask(task: Omit<ScheduledTask, "id" | "createdAt">): Promise<ScheduledTask> {
  const tasks = await readTasks();
  const createdAt = nowIso();
  const id = crypto.randomUUID();
  const options = {
    deleteAfterRun: true,
    ...task.options,
  };
  const next: ScheduledTask = {
    ...task,
    id,
    createdAt,
    enabled: task.enabled ?? true,
    options,
  };
  tasks.push(next);
  await writeTasks(tasks);
  return next;
}

export async function updateTask(id: string, patch: Partial<ScheduledTask>): Promise<ScheduledTask> {
  const tasks = await readTasks();
  const idx = tasks.findIndex((task) => task.id === id);
  if (idx === -1) throw new Error(`Task not found: ${id}`);
  const current = tasks[idx];
  const next: ScheduledTask = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
  };
  tasks[idx] = next;
  await writeTasks(tasks);
  return next;
}

export async function deleteTask(id: string): Promise<boolean> {
  const tasks = await readTasks();
  const next = tasks.filter((task) => task.id !== id);
  if (next.length === tasks.length) return false;
  await writeTasks(next);
  return true;
}

export async function getTasksByTripId(tripId: string): Promise<ScheduledTask[]> {
  const tasks = await readTasks();
  return tasks.filter((task) => task.payload?.tripId === tripId);
}
