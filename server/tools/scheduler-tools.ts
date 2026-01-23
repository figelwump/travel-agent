import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  createTask,
  deleteTask,
  getTask,
  getTasksByTripId,
  listTasks,
  updateTask,
  type ScheduledTask,
} from "../scheduler/task-storage";
import { Scheduler } from "../scheduler/scheduler";

function ensureTripId(tripId: string, payload: ScheduledTask["payload"] | undefined) {
  if (!payload) {
    return { tripId };
  }
  if (payload.tripId && payload.tripId !== tripId) {
    throw new Error("Task tripId does not match current trip.");
  }
  return { ...payload, tripId };
}

export function createSchedulerTools(tripId: string) {
  const normalizedTripId = tripId.trim();
  if (!normalizedTripId) {
    throw new Error("Trip ID is required to create scheduler tools.");
  }

  const scheduleSchema = z.object({
    runAt: z.string().describe("ISO datetime string; can omit timezone if timezone field provided"),
    timezone: z.string().optional().describe("IANA timezone name, e.g., America/Los_Angeles"),
  });

  const payloadSchema = z
    .object({
      tripId: z.string().optional(),
      subject: z.string().optional(),
      body: z.string().optional(),
      deadlineDate: z.string().optional(),
    })
    .optional();

  const optionsSchema = z
    .object({
      deleteAfterRun: z.boolean().optional(),
      maxRetries: z.number().int().min(0).optional(),
    })
    .optional();

  const createSchema = {
    name: z.string().min(1),
    type: z.enum(["email-reminder", "webhook", "custom"]),
    schedule: scheduleSchema,
    enabled: z.boolean().optional(),
    payload: payloadSchema,
    options: optionsSchema,
  };

  const updateSchema = {
    id: z.string().min(1),
    patch: z.record(z.any()).describe("Partial task update"),
  };

  const deleteSchema = {
    id: z.string().min(1),
  };

  const listSchema = {
    includeAll: z.boolean().optional().describe("Include tasks outside current trip"),
  };

  return [
    tool(
      "create_scheduled_task",
      "Create a one-time scheduled task (defaults to current trip)",
      createSchema,
      async (input) => {
        try {
          const payload = ensureTripId(normalizedTripId, input?.payload as ScheduledTask["payload"] | undefined);
          const task = await createTask({
            name: input.name,
            type: input.type,
            schedule: {
              runAt: input.schedule.runAt,
              timezone: input.schedule.timezone || "UTC",
            },
            enabled: input.enabled ?? true,
            payload,
            options: input.options,
          });

          const scheduler = new Scheduler();
          const nextRun = scheduler.calculateNextRun(task);
          const finalTask = nextRun
            ? await updateTask(task.id, { nextRun: nextRun.toISOString() })
            : task;

          return {
            content: [{ type: "text", text: JSON.stringify(finalTask, null, 2) }],
          };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: err?.message || String(err) }],
            isError: true,
          };
        }
      },
    ),
    tool(
      "list_scheduled_tasks",
      "List scheduled tasks for the current trip",
      listSchema,
      async (input) => {
        try {
          if (input?.includeAll) {
            const tasks = await listTasks();
            return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
          }
          const tasks = await getTasksByTripId(normalizedTripId);
          return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: err?.message || String(err) }],
            isError: true,
          };
        }
      },
    ),
    tool(
      "update_scheduled_task",
      "Update a scheduled task (current trip only)",
      updateSchema,
      async ({ id, patch }) => {
        try {
          const current = await getTask(id);
          if (!current) {
            return { content: [{ type: "text", text: `Task not found: ${id}` }], isError: true };
          }
          if (current.payload?.tripId && current.payload.tripId !== normalizedTripId) {
            return { content: [{ type: "text", text: "Task does not belong to current trip." }], isError: true };
          }

          const nextPatch = { ...patch } as Record<string, any>;
          if (typeof nextPatch.payload === "object" && nextPatch.payload) {
            nextPatch.payload = ensureTripId(normalizedTripId, {
              ...(current.payload || {}),
              ...(nextPatch.payload as Record<string, any>),
            });
          }

          const updated = await updateTask(id, nextPatch as Partial<ScheduledTask>);
          return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: err?.message || String(err) }],
            isError: true,
          };
        }
      },
    ),
    tool(
      "delete_scheduled_task",
      "Delete a scheduled task",
      deleteSchema,
      async ({ id }) => {
        try {
          const current = await getTask(id);
          if (!current) {
            return { content: [{ type: "text", text: `Task not found: ${id}` }], isError: true };
          }
          if (current.payload?.tripId && current.payload.tripId !== normalizedTripId) {
            return { content: [{ type: "text", text: "Task does not belong to current trip." }], isError: true };
          }
          const deleted = await deleteTask(id);
          return { content: [{ type: "text", text: deleted ? `Deleted task ${id}` : `Task not found: ${id}` }] };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: err?.message || String(err) }],
            isError: true,
          };
        }
      },
    ),
  ];
}
