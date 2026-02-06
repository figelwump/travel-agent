import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import plugin from "./index";
import { createStorage } from "./storage";

type BeforeAgentStartHandler = (event: unknown, ctx: { sessionKey?: string | null }) => unknown;

type FakeApi = {
  pluginConfig: { workspaceRoot: string; uiRoot: string };
  resolvePath: (input: string) => string;
  logger: { info: (_msg: string) => void; warn: (_msg: string) => void };
  registerTool: (_factory: unknown, _opts?: unknown) => void;
  on: (eventName: string, handler: unknown) => void;
  registerHttpHandler: (_handler: unknown) => void;
};

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

async function createTempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "openclaw-plugin-test-"));
  tempDirs.push(dir);
  return dir;
}

function registerPlugin(workspaceRoot: string): BeforeAgentStartHandler {
  const handlers = new Map<string, unknown>();
  const api: FakeApi = {
    pluginConfig: { workspaceRoot, uiRoot: workspaceRoot },
    resolvePath(input: string) {
      return path.isAbsolute(input) ? input : path.resolve(input);
    },
    logger: {
      info() {},
      warn() {},
    },
    registerTool() {},
    on(eventName: string, handler: unknown) {
      handlers.set(eventName, handler);
    },
    registerHttpHandler() {},
  };

  plugin.register(api as any);
  const beforeAgentStart = handlers.get("before_agent_start");
  if (typeof beforeAgentStart !== "function") {
    throw new Error("before_agent_start handler not registered");
  }
  return beforeAgentStart as BeforeAgentStartHandler;
}

describe("openclaw travel plugin before_agent_start", () => {
  test("injects trip scope, preloaded itinerary/context, and cron reminder guidance", async () => {
    const workspaceRoot = await createTempRoot();
    const storage = createStorage(workspaceRoot);
    const trip = await storage.createTrip("Reminder Trip");
    await storage.writeItinerary(trip.id, "# Reminder Trip\n\n- [ ] Plan flights");
    await storage.writeContext(trip.id, "# Trip Context\n\n## Preferences\n- Pace: Relaxed");
    const conversation = await storage.createConversation(trip.id, { title: "Chat" });

    const beforeAgentStart = registerPlugin(workspaceRoot);
    const result = await beforeAgentStart({}, { sessionKey: conversation.sessionKey ?? null });

    expect(result).toBeTruthy();
    expect((result as { prependContext?: string }).prependContext).toBeTruthy();
    const prependContext = (result as { prependContext: string }).prependContext;

    expect(prependContext).toContain("For reminders/follow-ups, schedule with the cron tool");
    expect(prependContext).toContain(`- Trip ID: ${trip.id}`);
    expect(prependContext).toContain(`- Conversation ID: ${conversation.id}`);
    expect(prependContext).toContain("Preloaded itinerary snapshot:");
    expect(prependContext).toContain("# Reminder Trip");
    expect(prependContext).toContain("Preloaded trip context snapshot:");
    expect(prependContext).toContain("Pace: Relaxed");
  });

  test("keeps non-trip travel sessions on base guidance only", async () => {
    const workspaceRoot = await createTempRoot();
    const beforeAgentStart = registerPlugin(workspaceRoot);
    const result = await beforeAgentStart({}, { sessionKey: "agent:travel:subagent:reminders" });

    expect(result).toBeTruthy();
    const prependContext = (result as { prependContext: string }).prependContext;

    expect(prependContext).toContain("Keep the itinerary and context in sync using tools");
    expect(prependContext).not.toContain("Active trip scope:");
    expect(prependContext).not.toContain("Preloaded itinerary snapshot:");
    expect(prependContext).not.toContain("Trip ID:");
  });
});
