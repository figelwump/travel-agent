import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as storage from "../storage";

export function createTripTools(tripId: string) {
  const normalizedTripId = tripId.trim();
  if (!normalizedTripId) {
    throw new Error("Trip ID is required to create trip tools.");
  }
  const noParams = z.object({}).passthrough();
  const itineraryUpdateSchema = z.object({
    content: z.string().describe("Full itinerary markdown content"),
  }).passthrough();
  const contextUpdateSchema = z.object({
    content: z.string().describe("Full context markdown content"),
  }).passthrough();
  const toggleTodoSchema = z.object({
    lineNumber: z.number().describe("1-based line number"),
  }).passthrough();
  const resolveContent = (input: { content?: unknown; new_content?: unknown }) => {
    if (typeof input.content === "string") return { ok: true as const, content: input.content };
    if (typeof input.new_content === "string") return { ok: true as const, content: input.new_content };
    return {
      ok: false as const,
      error: "Missing content. Use { content: \"<markdown>\" }.",
    };
  };

  return [
  tool(
    "read_itinerary",
    "Read the itinerary markdown for the current trip",
    noParams,
    async () => {
      const result = await storage.readItinerary(normalizedTripId);
      return {
        content: [{ type: "text", text: result }],
      };
    },
  ),
  tool(
    "update_itinerary",
    "Replace the itinerary markdown for the current trip (requires full markdown in content)",
    itineraryUpdateSchema,
    async (input) => {
      const resolved = resolveContent(input ?? {});
      if (!resolved.ok) {
        return {
          content: [{ type: "text", text: resolved.error }],
          isError: true,
        };
      }
      await storage.writeItinerary(normalizedTripId, resolved.content);
      return {
        content: [{ type: "text", text: `Updated itinerary for ${normalizedTripId}` }],
      };
    },
  ),
  tool(
    "read_context",
    "Read the trip context markdown for the current trip",
    noParams,
    async () => {
      const result = await storage.readContext(normalizedTripId);
      return {
        content: [{ type: "text", text: result }],
      };
    },
  ),
  tool(
    "update_context",
    "Replace the trip context markdown for the current trip (requires full markdown in content)",
    contextUpdateSchema,
    async (input) => {
      const resolved = resolveContent(input ?? {});
      if (!resolved.ok) {
        return {
          content: [{ type: "text", text: resolved.error }],
          isError: true,
        };
      }
      await storage.writeContext(normalizedTripId, resolved.content);
      return {
        content: [{ type: "text", text: `Updated context for ${normalizedTripId}` }],
      };
    },
  ),
  tool(
    "toggle_todo",
    "Toggle a TODO checkbox in the itinerary",
    toggleTodoSchema,
    async ({ lineNumber }) => {
      const result = await storage.toggleTodoAtLine(normalizedTripId, lineNumber);
      return {
        content: [
          {
            type: "text",
            text: result.updated
              ? `Toggled TODO on line ${lineNumber}`
              : `No TODO found on line ${lineNumber}`,
          },
        ],
      };
    },
  ),
  ];
}
