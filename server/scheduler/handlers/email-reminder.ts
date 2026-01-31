import { Resend } from "resend";
import type { ScheduledTask } from "../task-storage";
import { logTs } from "../../log";

let resendClient: Resend | null = null;
let lastSendAtMs = 0;
const MIN_INTERVAL_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    logTs(`[Scheduler] Skipping email reminder for task=${task.id}: NOTIFICATION_EMAIL not configured`);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logTs(`[Scheduler] Skipping email reminder for task=${task.id}: RESEND_API_KEY not configured`);
    return;
  }

  const now = Date.now();
  const elapsed = now - lastSendAtMs;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
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

  lastSendAtMs = Date.now();
  logTs(`[Scheduler] Email reminder sent task=${task.id} to=${to}`);
}
