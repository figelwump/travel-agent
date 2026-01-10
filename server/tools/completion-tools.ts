import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export const completionTools = [
  tool(
    "complete_task",
    "Signal that the current task is complete",
    {
      summary: z.string().describe("Summary of what was accomplished"),
      status: z.enum(["success", "partial", "blocked"]).optional(),
    },
    async ({ summary }) => {
      return {
        content: [{ type: "text", text: summary }],
        shouldContinue: false,
      };
    },
  ),
];
