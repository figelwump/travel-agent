import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { handleApiRequest } from "./api";
import * as storage from "./storage";
import { createTripTools } from "./tools/entity-tools";

let tempHome: string | null = null;
let previousHome: string | undefined;

async function apiCall(pathname: string, init?: RequestInit): Promise<Response> {
  const url = new URL(`http://localhost${pathname}`);
  const req = new Request(url, init);
  return handleApiRequest(req, url);
}

beforeEach(async () => {
  previousHome = process.env.TRAVEL_AGENT_HOME;
  tempHome = await mkdtemp(path.join(tmpdir(), "travel-agent-test-"));
  process.env.TRAVEL_AGENT_HOME = tempHome;
  await storage.ensureDataDirs();
});

afterEach(async () => {
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
  }
  if (previousHome === undefined) {
    delete process.env.TRAVEL_AGENT_HOME;
  } else {
    process.env.TRAVEL_AGENT_HOME = previousHome;
  }
  tempHome = null;
});

describe("storage", () => {
  test("createTrip seeds context but not itinerary", async () => {
    const trip = await storage.createTrip("Test Trip");
    const itinerary = await storage.readItinerary(trip.id);
    const context = await storage.readContext(trip.id);

    expect(itinerary).toBe("");
    expect(context).toContain("# Trip Context");
  });

  test("writeItinerary + toggleTodoAtLine updates the right line", async () => {
    const trip = await storage.createTrip("Todo Trip");
    const content = [
      "# Todo Trip — Itinerary",
      "- [ ] Book flights",
      "- [x] Confirm hotel",
    ].join("\n");
    await storage.writeItinerary(trip.id, content);

    const firstToggle = await storage.toggleTodoAtLine(trip.id, 2);
    expect(firstToggle.updated).toBe(true);
    expect(firstToggle.content).toContain("- [x] Book flights");

    const secondToggle = await storage.toggleTodoAtLine(trip.id, 3);
    expect(secondToggle.updated).toBe(true);
    expect(secondToggle.content).toContain("- [ ] Confirm hotel");
  });

  test("readGlobalContext seeds a global profile", async () => {
    const globalContext = await storage.readGlobalContext();
    expect(globalContext).toContain("# Global Travel Profile");
  });
});

describe("api itinerary", () => {
  test("GET/PUT/DELETE itinerary round-trip", async () => {
    const trip = await storage.createTrip("API Trip");
    const itineraryUrl = `/api/trips/${trip.id}/itinerary`;

    let res = await apiCall(itineraryUrl);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");

    const updated = "# API Trip — Itinerary\n\n## Notes\n- Book Art Deco walking tour";
    res = await apiCall(itineraryUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: updated }),
    });
    expect(res.status).toBe(200);

    res = await apiCall(itineraryUrl);
    expect(await res.text()).toBe(updated);

    res = await apiCall(itineraryUrl, { method: "DELETE" });
    expect(res.status).toBe(200);

    res = await apiCall(itineraryUrl);
    expect(await res.text()).toBe("");
  });

  test("PUT itinerary validates input and toggle-todo works", async () => {
    const trip = await storage.createTrip("Toggle Trip");
    const itineraryUrl = `/api/trips/${trip.id}/itinerary`;

    let res = await apiCall(itineraryUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: 123 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "content must be a string" });

    await storage.writeItinerary(trip.id, "# Toggle Trip — Itinerary\n- [ ] Pack bags");
    const toggleUrl = `/api/trips/${trip.id}/itinerary/toggle-todo`;
    res = await apiCall(toggleUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line: 2 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: true });

    const refreshed = await storage.readItinerary(trip.id);
    expect(refreshed).toContain("- [x] Pack bags");
  });
});

describe("mcp trip tools", () => {
  test("update_itinerary tool writes full markdown content", async () => {
    const trip = await storage.createTrip("MCP Trip");
    const mcpServer = createSdkMcpServer({ name: "t", tools: createTripTools(trip.id) });
    const server = (mcpServer as any).instance;
    const callHandler = server?.server?._requestHandlers?.get("tools/call");

    expect(callHandler).toBeDefined();

    const updated = "# MCP Trip — Itinerary\n\n## Notes\n- Book Art Deco walking tour";
    const result = await callHandler(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "update_itinerary",
          arguments: { content: updated },
        },
      },
      {}
    );

    expect(result.content?.[0]?.text).toContain("Updated itinerary");
    expect(await storage.readItinerary(trip.id)).toBe(updated);
  });

  test("read_itinerary tool returns current markdown", async () => {
    const trip = await storage.createTrip("Read MCP Trip");
    const content = "# Read MCP Trip — Itinerary\n\n## Notes\n- Sample note";
    await storage.writeItinerary(trip.id, content);

    const mcpServer = createSdkMcpServer({ name: "t", tools: createTripTools(trip.id) });
    const server = (mcpServer as any).instance;
    const callHandler = server?.server?._requestHandlers?.get("tools/call");

    const result = await callHandler(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "read_itinerary",
          arguments: {},
        },
      },
      {}
    );

    expect(result.content?.[0]?.text).toContain("Read MCP Trip — Itinerary");
    expect(result.content?.[0]?.text).toContain("Sample note");
  });

  test("update_global_context tool writes global profile", async () => {
    const trip = await storage.createTrip("Global MCP Trip");
    const mcpServer = createSdkMcpServer({ name: "t", tools: createTripTools(trip.id) });
    const server = (mcpServer as any).instance;
    const callHandler = server?.server?._requestHandlers?.get("tools/call");

    const updated = "# Global Travel Profile\n\n- Kids: 2\n- Ages: 7, 10\n";
    const result = await callHandler(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "update_global_context",
          arguments: { content: updated },
        },
      },
      {}
    );

    expect(result.content?.[0]?.text).toContain("Updated global travel profile");
    expect(await storage.readGlobalContext()).toBe(updated);
  });
});
