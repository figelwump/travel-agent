import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as storage from "../storage";

type EntityHandler = {
  list?: (parentId?: string) => Promise<unknown>;
  read?: (id: string) => Promise<unknown>;
  create?: (data: any) => Promise<unknown>;
  update?: (id: string, data: any) => Promise<unknown>;
};

const entityHandlers: Record<string, EntityHandler> = {
  trip: {
    list: () => storage.listTrips(),
    read: (id: string) => storage.getTrip(id),
    create: (data: any) => storage.createTrip(String(data?.name ?? "")),
    update: (id: string, data: any) => storage.updateTrip(id, data),
  },
  itinerary: {
    read: (tripId: string) => storage.readItinerary(tripId),
    update: (tripId: string, content: string) => storage.writeItinerary(tripId, content),
  },
  context: {
    read: (tripId: string) => storage.readContext(tripId),
    update: (tripId: string, content: string) => storage.writeContext(tripId, content),
  },
  uploads: {
    list: (tripId?: string) => storage.listUploads(String(tripId ?? "")),
  },
  conversations: {
    list: (tripId?: string) => storage.listConversations(String(tripId ?? "")),
  },
};

const entityTypesRequiringParent = new Set(["uploads", "conversations"]);

export const entityTools = [
  tool(
    "list_entity_types",
    "List available entity types and their operations",
    {},
    async () => {
      const types = Object.entries(entityHandlers).map(([type, ops]) => ({
        type,
        operations: Object.keys(ops),
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(types, null, 2) }],
      };
    },
  ),
  tool(
    "read_entity",
    "Read any entity by type",
    {
      entityType: z.string().describe("Entity type (trip, itinerary, context, etc.)"),
      id: z.string().optional().describe("Entity ID (tripId for most types)"),
    },
    async ({ entityType, id }) => {
      const handler = entityHandlers[entityType];
      if (!handler?.read) {
        return {
          content: [{ type: "text", text: `Unknown entity type or read not supported: ${entityType}` }],
          isError: true,
        };
      }
      if (!id) {
        return {
          content: [{ type: "text", text: "id is required for read_entity" }],
          isError: true,
        };
      }
      const result = await handler.read(id);
      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  ),
  tool(
    "create_entity",
    "Create any entity by type",
    {
      entityType: z.string().describe("Entity type"),
      content: z.any().describe("Content to create"),
    },
    async ({ entityType, content }) => {
      const handler = entityHandlers[entityType];
      if (!handler?.create) {
        return {
          content: [{ type: "text", text: `Create not supported for: ${entityType}` }],
          isError: true,
        };
      }
      const result = await handler.create(content);
      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  ),
  tool(
    "update_entity",
    "Update any entity by type",
    {
      entityType: z.string().describe("Entity type"),
      id: z.string().describe("Entity ID"),
      content: z.any().describe("Content to update"),
    },
    async ({ entityType, id, content }) => {
      const handler = entityHandlers[entityType];
      if (!handler?.update) {
        return {
          content: [{ type: "text", text: `Update not supported for: ${entityType}` }],
          isError: true,
        };
      }
      const result = await handler.update(id, content);
      if (result === null) {
        return {
          content: [{ type: "text", text: `No ${entityType} found for ${id}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: `Updated ${entityType} for ${id}` }],
      };
    },
  ),
  tool(
    "list_entities",
    "List entities of a type",
    {
      entityType: z.string().describe("Entity type (trip, uploads, conversations)"),
      parentId: z.string().optional().describe("Parent ID if scoped (e.g., tripId)"),
    },
    async ({ entityType, parentId }) => {
      const handler = entityHandlers[entityType];
      if (!handler?.list) {
        return {
          content: [{ type: "text", text: `List not supported for: ${entityType}` }],
          isError: true,
        };
      }
      if (entityTypesRequiringParent.has(entityType) && !parentId) {
        return {
          content: [{ type: "text", text: `parentId is required for ${entityType}` }],
          isError: true,
        };
      }
      const result = await handler.list(parentId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  ),
  tool(
    "toggle_todo",
    "Toggle a TODO checkbox in the itinerary",
    {
      tripId: z.string(),
      lineNumber: z.number().describe("1-based line number"),
    },
    async ({ tripId, lineNumber }) => {
      const result = await storage.toggleTodoAtLine(tripId, lineNumber);
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
