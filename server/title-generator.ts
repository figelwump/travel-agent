import { AgentClient } from "../agentsdk/agent-client";
import type { StoredMessage } from "./storage";

const TITLE_PROMPT_TEMPLATE = `Generate a short chat title (4-7 words).

Rules:
- Include destination or travel focus if mentioned
- Prefer intent + destination (e.g., "Tokyo Hotel Options" not "Helping With Hotels")
- Avoid generic filler words
- No quotes, punctuation, or emoji
- Don't repeat the trip name unless it adds clarity

Trip name: {tripName}

Recent messages:
{messages}

Return ONLY the title, nothing else.`;

function formatMessagesForTitle(messages: StoredMessage[], maxMessages = 5): string {
  const recent = messages.slice(-maxMessages);
  return recent
    .map((m) => {
      const role = m.type === "user" ? "User" : "Assistant";
      const content = m.content.slice(0, 500);
      return `${role}: ${content}`;
    })
    .join("\n\n");
}

function isGenericTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  const genericTitles = [
    "chat",
    "new chat",
    "planning",
    "question",
    "help",
    "travel planning",
    "trip planning",
    "untitled",
  ];
  return genericTitles.includes(normalized);
}

export type TitleEligibility = {
  eligible: boolean;
  reason?: string;
};

export function checkTitleEligibility(
  currentTitle: string,
  titleSource: "user" | "auto" | undefined,
  messages: StoredMessage[],
): TitleEligibility {
  // Respect user manual renames
  if (titleSource === "user") {
    return { eligible: false, reason: "user_renamed" };
  }

  // If we already have a good auto-generated title, don't regenerate
  if (titleSource === "auto" && !isGenericTitle(currentTitle)) {
    return { eligible: false, reason: "already_titled" };
  }

  // Check for minimum signal
  const userMessages = messages.filter((m) => m.type === "user");
  const assistantMessages = messages.filter((m) => m.type === "assistant");

  const hasEnoughUserMessages = userMessages.length >= 2;
  const hasSubstantialAssistantReply = assistantMessages.some(
    (m) => m.content.length >= 600
  );
  const hasDestinationMention = userMessages.some((m) =>
    /\b(?:to|in|at|visit|visiting|fly|flying|hotel|flight|book|booking)\s+\w+/i.test(m.content)
  );

  if (!hasEnoughUserMessages && !hasSubstantialAssistantReply && !hasDestinationMention) {
    return { eligible: false, reason: "insufficient_signal" };
  }

  return { eligible: true };
}

export async function generateTitle(
  tripName: string,
  messages: StoredMessage[],
  agentClient?: AgentClient,
): Promise<string | null> {
  const client = agentClient ?? new AgentClient();
  const formattedMessages = formatMessagesForTitle(messages);

  const prompt = TITLE_PROMPT_TEMPLATE
    .replace("{tripName}", tripName)
    .replace("{messages}", formattedMessages);

  try {
    const { messages: responseMessages } = await client.querySingle(prompt, {
      model: "haiku",
      tools: [],
      allowedTools: [],
      maxTurns: 1,
      appendSystemPrompt: "", // Override base travel agent prompt
    });

    // Extract the text response
    for (const msg of responseMessages) {
      if ((msg as any).type === "assistant") {
        const content = (msg as any).message?.content;
        if (typeof content === "string") {
          return cleanTitle(content);
        }
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === "text" && typeof block.text === "string") {
              return cleanTitle(block.text);
            }
          }
        }
      }
    }
    return null;
  } catch (err) {
    console.error("[TitleGenerator] Failed to generate title:", err);
    return null;
  }
}

function cleanTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, "") // Remove surrounding quotes
    .replace(/[.!?]$/, "") // Remove trailing punctuation
    .slice(0, 80);
}
