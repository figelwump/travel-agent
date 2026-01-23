import type { ScheduledTask } from "./task-storage";
import { sendReminderEmail } from "./handlers/email-reminder";

export async function runTask(task: ScheduledTask): Promise<void> {
  switch (task.type) {
    case "email-reminder":
      await sendReminderEmail(task);
      return;
    default:
      throw new Error(`Unsupported task type: ${task.type}`);
  }
}
