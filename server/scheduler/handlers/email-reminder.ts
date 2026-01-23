import { Resend } from "resend";
import type { ScheduledTask } from "../task-storage";
import { logTs } from "../../log";

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY not configured.");
  }
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

export async function sendReminderEmail(task: ScheduledTask): Promise<void> {
  const to = process.env.NOTIFICATION_EMAIL;
  if (!to) {
    throw new Error("NOTIFICATION_EMAIL not configured.");
  }

  const from = process.env.NOTIFICATION_FROM || to;
  const subject = task.payload?.subject || task.name || "Travel reminder";
  const body = task.payload?.body || "Reminder";
  const deadline = task.payload?.deadlineDate ? `\n\nDeadline: ${task.payload.deadlineDate}` : "";

  const resend = getResendClient();
  const result = await resend.emails.send({
    from,
    to,
    subject,
    text: `${body}${deadline}`,
  });

  if (result.error) {
    throw new Error(`Resend error: ${result.error.message || "Unknown error"}`);
  }

  logTs(`[Scheduler] Email reminder sent task=${task.id} to=${to}`);
}
