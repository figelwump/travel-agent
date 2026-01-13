import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as storage from "../storage";

export function createTripTools(tripId: string) {
  const normalizedTripId = tripId.trim();
  if (!normalizedTripId) {
    throw new Error("Trip ID is required to create trip tools.");
  }
  const noParams = {};
  const mapSchema = {
    destinations: z
      .array(z.string())
      .min(1)
      .describe("Ordered list of destination names or cities for the trip map"),
    force: z
      .boolean()
      .optional()
      .describe("Regenerate the map even if one is already referenced"),
  };
  const itineraryUpdateSchema = {
    content: z.any().describe("Full itinerary markdown content"),
  };
  const contextUpdateSchema = {
    content: z.any().describe("Full context markdown content"),
  };
  const globalContextUpdateSchema = {
    content: z.any().describe("Full global context markdown content"),
  };
  const toggleTodoSchema = {
    lineNumber: z.number().describe("1-based line number"),
  };
  const resolveContent = (input: unknown) => {
    if (typeof input === "string") return { ok: true as const, content: input };
    if (!input || typeof input !== "object") {
      return {
        ok: false as const,
        error: "Missing content. Use { content: \"<markdown>\" }.",
      };
    }

    const record = input as Record<string, unknown>;
    const candidates = [record.content, record.new_content, record.text, record.value, record.input, record.args];
    for (const candidate of candidates) {
      if (typeof candidate === "string") return { ok: true as const, content: candidate };
      if (Array.isArray(candidate)) {
        const textParts = candidate
          .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>).text : null))
          .filter((item): item is string => typeof item === "string");
        if (textParts.length > 0) return { ok: true as const, content: textParts.join("") };
      }
      if (candidate && typeof candidate === "object") {
        const nested = candidate as Record<string, unknown>;
        const nestedCandidates = [nested.content, nested.text, nested.value];
        for (const nestedCandidate of nestedCandidates) {
          if (typeof nestedCandidate === "string") {
            return { ok: true as const, content: nestedCandidate };
          }
        }
      }
    }

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
      async (input, extra) => {
        let resolved = resolveContent(input ?? {});
        if (!resolved.ok && extra && typeof extra === "object") {
          const candidate = (extra as Record<string, any>)?.request?.params?.arguments;
          if (candidate) {
            resolved = resolveContent(candidate);
          }
        }
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
      "generate_trip_map",
      "Generate or refresh a trip map image and ensure it is referenced in the itinerary",
      mapSchema,
      async (input) => {
        const destinationsInput = Array.isArray(input?.destinations) ? input?.destinations : [];
        const destinations = destinationsInput.map((d) => d.trim()).filter(Boolean).slice(0, 12);
        const force = Boolean(input?.force);
        let itinerary: string | null = null;

        if (!force) {
          itinerary = await storage.readItinerary(normalizedTripId);
          if (itinerary.includes("![Trip map]")) {
            return {
              content: [{ type: "text", text: "Trip map already referenced. Use force: true to regenerate." }],
            };
          }
        }

        if (destinations.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No destinations provided. Please supply an ordered destination list.",
              },
            ],
            isError: true,
          };
        }

        const { assetUrl } = await storage.generateTripMap(normalizedTripId, destinations);
        await storage.ensureMapReferencedInItinerary(normalizedTripId, assetUrl);
        return {
          content: [
            {
              type: "text",
              text: `Generated trip map with ${destinations.length} destination${destinations.length === 1 ? "" : "s"}.`,
            },
            { type: "text", text: assetUrl },
          ],
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
      "read_global_context",
      "Read the global travel profile markdown (shared across trips)",
      noParams,
      async () => {
        const result = await storage.readGlobalContext();
        return {
          content: [{ type: "text", text: result }],
        };
      },
    ),
    tool(
      "update_context",
      "Replace the trip context markdown for the current trip (requires full markdown in content)",
      contextUpdateSchema,
      async (input, extra) => {
        let resolved = resolveContent(input ?? {});
        if (!resolved.ok && extra && typeof extra === "object") {
          const candidate = (extra as Record<string, any>)?.request?.params?.arguments;
          if (candidate) {
            resolved = resolveContent(candidate);
          }
        }
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
      "update_global_context",
      "Replace the global travel profile markdown (shared across trips; requires full markdown in content)",
      globalContextUpdateSchema,
      async (input, extra) => {
        let resolved = resolveContent(input ?? {});
        if (!resolved.ok && extra && typeof extra === "object") {
          const candidate = (extra as Record<string, any>)?.request?.params?.arguments;
          if (candidate) {
            resolved = resolveContent(candidate);
          }
        }
        if (!resolved.ok) {
          return {
            content: [{ type: "text", text: resolved.error }],
            isError: true,
          };
        }
        await storage.writeGlobalContext(resolved.content);
        return {
          content: [{ type: "text", text: "Updated global travel profile" }],
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
