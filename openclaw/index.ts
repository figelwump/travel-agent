import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createStorage, defaultSessionKey, type Conversation, type StoredMessage } from "./storage";

const BASE_PATH = "/agents/travel";
const API_PREFIX = `${BASE_PATH}/api`;

type TravelPluginConfig = {
  workspaceRoot?: string;
  uiRoot?: string;
};

type ResolvedConfig = {
  workspaceRoot: string;
  uiRoot: string;
};

function resolveConfig(api: ClawdbotPluginApi, pluginRoot: string): ResolvedConfig {
  const cfg = (api.pluginConfig ?? {}) as TravelPluginConfig;
  const workspaceRoot = cfg.workspaceRoot
    ? api.resolvePath(cfg.workspaceRoot)
    : path.join(pluginRoot, "workspace");
  const uiRoot = cfg.uiRoot
    ? api.resolvePath(cfg.uiRoot)
    : path.join(pluginRoot, "ui");
  return { workspaceRoot, uiRoot };
}

function getContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json; charset=utf-8",
  };
  return map[ext] ?? "application/octet-stream";
}

function sendJson(res: fs.ReadStream | any, status: number, payload: unknown) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function sendText(res: fs.ReadStream | any, status: number, text: string, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType });
  res.end(text);
}

async function readJsonBody(req: any) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return null;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isPathWithin(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  return normalizedTarget.startsWith(normalizedRoot);
}

function parseTripIdFromSessionKey(sessionKey?: string | null): string | null {
  if (!sessionKey) return null;
  const marker = "agent:travel:";
  const normalized = sessionKey.toLowerCase();
  const idx = normalized.indexOf(marker);
  if (idx !== 0) return null;
  const rest = sessionKey.slice(marker.length);
  const [tripId] = rest.split(":");
  return tripId || null;
}

function resolveTripIdFromParams(params: Record<string, unknown>, sessionKey?: string | null): string | null {
  const explicit = typeof params.tripId === "string" ? params.tripId.trim() : "";
  if (explicit) return explicit;
  return parseTripIdFromSessionKey(sessionKey);
}

type BridgeEntry = {
  tripId: string;
  conversationId: string;
  lastUserDigest?: string;
  lastAssistantDigest?: string;
  updatedAt: string;
};

type BridgeState = {
  sessions: Record<string, BridgeEntry>;
};

function isTripSessionKey(sessionKey?: string | null): boolean {
  if (!sessionKey) return false;
  const parts = sessionKey.split(":");
  if (parts.length < 4) return false;
  if (parts[0] !== "agent" || parts[1] !== "travel") return false;
  const segment = parts[2];
  if (!segment || segment === "subagent" || segment === "hook" || segment === "cron") return false;
  return true;
}

function sessionAgentLabel(sessionKey?: string | null): string {
  if (!sessionKey) return "Agent";
  const parts = sessionKey.split(":");
  if (parts.length >= 2 && parts[0] === "agent") {
    const agentId = parts[1] || "agent";
    if (agentId === "main") return "Main Agent";
    if (agentId === "travel") return "Travel Subagent";
    return `${agentId.charAt(0).toUpperCase()}${agentId.slice(1)} Agent`;
  }
  return "Agent";
}

function extractTextFromContent(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  if (typeof content.text === "string") return content.text.trim();
  return "";
}

function cleanMirroredUserMessage(raw: string): string {
  if (!raw) return raw;
  if (!raw.includes("You are Travel Agent") && !raw.includes("[message_id")) {
    return raw.trim();
  }
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const match = line.match(/^\[[^\]]+\]\s*(.+)$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  const filtered = lines.filter((line) => {
    if (line.startsWith("[")) return false;
    const lower = line.toLowerCase();
    if (lower.startsWith("you are travel agent")) return false;
    if (lower.startsWith("do not claim")) return false;
    if (line.startsWith("- ")) return false;
    return true;
  });
  return filtered.join("\n").trim() || raw.trim();
}

function hashText(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex");
}

const plugin = {
  id: "travel-agent",
  name: "Travel Agent",
  description: "Travel tools and UI for OpenClaw",
  register(api: ClawdbotPluginApi) {
    const pluginRoot = path.dirname(fileURLToPath(import.meta.url));
    const config = resolveConfig(api, pluginRoot);
    const storage = createStorage(config.workspaceRoot);
    const bridgePath = path.join(config.workspaceRoot, "bridge", "session-map.json");
    let bridgeState: BridgeState | null = null;
    let bridgeLoading: Promise<void> | null = null;

    const ensureBridgeLoaded = async () => {
      if (bridgeState) return;
      if (!bridgeLoading) {
        bridgeLoading = (async () => {
          try {
            const raw = await fs.promises.readFile(bridgePath, "utf8");
            const parsed = JSON.parse(raw) as BridgeState;
            bridgeState = parsed && typeof parsed === "object" ? parsed : { sessions: {} };
          } catch (err: any) {
            if (err?.code !== "ENOENT") {
              api.logger.warn(`travel-agent bridge load failed: ${String(err)}`);
            }
            bridgeState = { sessions: {} };
          }
        })();
      }
      await bridgeLoading;
    };

    const persistBridgeState = async () => {
      if (!bridgeState) return;
      const dir = path.dirname(bridgePath);
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = `${bridgePath}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(bridgeState, null, 2), "utf8");
      await fs.promises.rename(tmp, bridgePath);
    };

    const bindSessionToTrip = async (sessionKey: string | null, tripId: string) => {
      if (!sessionKey) return;
      if (isTripSessionKey(sessionKey)) return;
      await ensureBridgeLoaded();
      const state = bridgeState!;
      const existing = state.sessions[sessionKey];
      if (existing && existing.tripId === tripId) return existing;

      const trip = await storage.getTrip(tripId);
      const label = sessionAgentLabel(sessionKey);
      const title = `${label} — ${trip?.name ?? tripId}`;
      const conversation = await storage.createConversation(tripId, { title });
      const entry: BridgeEntry = {
        tripId,
        conversationId: conversation.id,
        updatedAt: new Date().toISOString(),
      };
      state.sessions[sessionKey] = entry;
      await persistBridgeState();
      return entry;
    };

    const appendMirroredMessages = async (
      sessionKey: string,
      messages: unknown[],
    ) => {
      if (!sessionKey || isTripSessionKey(sessionKey)) return;
      await ensureBridgeLoaded();
      const state = bridgeState!;
      const entry = state.sessions[sessionKey];
      if (!entry) return;

      const snapshot = Array.isArray(messages) ? messages : [];
      let lastUser: { content: string; timestamp?: string } | null = null;
      let lastAssistant: { content: string; timestamp?: string } | null = null;

      for (let i = snapshot.length - 1; i >= 0; i--) {
        const msg = snapshot[i] as any;
        if (!msg || typeof msg.role !== "string") continue;
        const text = extractTextFromContent(msg.content);
        if (!text) continue;
        if (!lastAssistant && msg.role === "assistant") {
          lastAssistant = {
            content: text,
            timestamp: typeof msg.timestamp === "string" ? msg.timestamp : undefined,
          };
        }
        if (!lastUser && msg.role === "user") {
          const cleaned = cleanMirroredUserMessage(text);
          if (!cleaned) continue;
          lastUser = {
            content: cleaned,
            timestamp: typeof msg.timestamp === "string" ? msg.timestamp : undefined,
          };
        }
        if (lastUser && lastAssistant) break;
      }

      const nowIso = new Date().toISOString();
      let didWrite = false;
      if (lastUser) {
        const digest = hashText(`user:${lastUser.content}:${lastUser.timestamp ?? ""}`);
        if (digest !== entry.lastUserDigest) {
          const message: StoredMessage = {
            id: crypto.randomUUID(),
            type: "user",
            content: lastUser.content,
            timestamp: lastUser.timestamp ?? nowIso,
            metadata: { sourceSession: sessionKey },
          };
          await storage.appendMessage(entry.tripId, entry.conversationId, message);
          entry.lastUserDigest = digest;
          didWrite = true;
        }
      }

      if (lastAssistant) {
        const digest = hashText(`assistant:${lastAssistant.content}:${lastAssistant.timestamp ?? ""}`);
        if (digest !== entry.lastAssistantDigest) {
          const message: StoredMessage = {
            id: crypto.randomUUID(),
            type: "assistant",
            content: lastAssistant.content,
            timestamp: lastAssistant.timestamp ?? nowIso,
            metadata: { sourceSession: sessionKey },
          };
          await storage.appendMessage(entry.tripId, entry.conversationId, message);
          entry.lastAssistantDigest = digest;
          didWrite = true;
        }
      }

      if (didWrite) {
        entry.updatedAt = nowIso;
        await persistBridgeState();
      }
    };

    api.logger.info(`travel-agent plugin loaded (workspace: ${config.workspaceRoot})`);

    api.registerTool(
      (ctx: any) => {
        const sessionKey = ctx.sessionKey ?? null;

        const readItinerary = {
          name: "read_itinerary",
          description: "Read the current itinerary markdown for a trip.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              tripId: { type: "string", description: "Trip ID (optional; defaults from session)" },
            },
          },
          async execute(_toolCallId: string, params: Record<string, unknown>) {
            const tripId = resolveTripIdFromParams(params, sessionKey);
            if (!tripId) {
              return { content: [{ type: "text", text: "Trip ID is required." }], isError: true };
            }
            await bindSessionToTrip(sessionKey, tripId);
            const itinerary = await storage.readItinerary(tripId);
            return { content: [{ type: "text", text: itinerary || "(empty itinerary)" }] };
          },
        };

        const updateItinerary = {
          name: "update_itinerary",
          description: "Replace the itinerary markdown for a trip.",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["content"],
            properties: {
              tripId: { type: "string", description: "Trip ID (optional; defaults from session)" },
              content: { type: "string", description: "Full itinerary markdown" },
            },
          },
          async execute(_toolCallId: string, params: Record<string, unknown>) {
            const tripId = resolveTripIdFromParams(params, sessionKey);
            const content = typeof params.content === "string" ? params.content : "";
            if (!tripId) {
              return { content: [{ type: "text", text: "Trip ID is required." }], isError: true };
            }
            await bindSessionToTrip(sessionKey, tripId);
            await storage.writeItinerary(tripId, content);
            return { content: [{ type: "text", text: `Updated itinerary for ${tripId}.` }] };
          },
        };

        const readContext = {
          name: "read_context",
          description: "Read the trip context markdown for a trip.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              tripId: { type: "string", description: "Trip ID (optional; defaults from session)" },
            },
          },
          async execute(_toolCallId: string, params: Record<string, unknown>) {
            const tripId = resolveTripIdFromParams(params, sessionKey);
            if (!tripId) {
              return { content: [{ type: "text", text: "Trip ID is required." }], isError: true };
            }
            await bindSessionToTrip(sessionKey, tripId);
            const context = await storage.readContext(tripId);
            return { content: [{ type: "text", text: context || "(empty context)" }] };
          },
        };

        const updateContext = {
          name: "update_context",
          description: "Replace the trip context markdown for a trip.",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["content"],
            properties: {
              tripId: { type: "string", description: "Trip ID (optional; defaults from session)" },
              content: { type: "string", description: "Full context markdown" },
            },
          },
          async execute(_toolCallId: string, params: Record<string, unknown>) {
            const tripId = resolveTripIdFromParams(params, sessionKey);
            const content = typeof params.content === "string" ? params.content : "";
            if (!tripId) {
              return { content: [{ type: "text", text: "Trip ID is required." }], isError: true };
            }
            await bindSessionToTrip(sessionKey, tripId);
            await storage.writeContext(tripId, content);
            return { content: [{ type: "text", text: `Updated context for ${tripId}.` }] };
          },
        };

        return [readItinerary, updateItinerary, readContext, updateContext];
      },
      { names: ["read_itinerary", "update_itinerary", "read_context", "update_context"] }
    );

    api.on("before_agent_start", (_event, ctx) => {
      const sessionKey = ctx.sessionKey?.toLowerCase() ?? "";
      if (!sessionKey.startsWith("agent:travel:")) {
        return;
      }
      return {
        prependContext: [
          "You are Travel Agent. Keep the itinerary and context in sync using tools:",
          "- Always call read_itinerary before making itinerary edits.",
          "- After changes, call update_itinerary with the FULL updated markdown (not a patch).",
          "- Use read_context/update_context to maintain trip context updates.",
          "- When research is requested, use web_search/web_fetch to confirm details before answering.",
          "Do not claim changes are saved unless you actually called update_itinerary/update_context.",
        ].join("\n"),
      };
    });

    api.on("agent_end", (event, ctx) => {
      const sessionKey = ctx.sessionKey ?? null;
      if (!sessionKey) return;
      void appendMirroredMessages(sessionKey, event.messages ?? []);
    });

    api.registerHttpHandler(async (req: any, res: any) => {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (!url.pathname.startsWith(BASE_PATH)) {
        return false;
      }

      if (url.pathname.startsWith(API_PREFIX)) {
        const apiPath = url.pathname.slice(API_PREFIX.length);
        const segments = apiPath.split("/").filter(Boolean);

        if (segments.length === 1 && segments[0] === "trips") {
          if (req.method === "GET") {
            const trips = await storage.listTrips();
            sendJson(res, 200, trips);
            return true;
          }
          if (req.method === "POST") {
            const body = (await readJsonBody(req)) ?? {};
            const name = typeof body.name === "string" ? body.name : "";
            const trip = await storage.createTrip(name);
            sendJson(res, 201, trip);
            return true;
          }
        }

        if (segments.length >= 2 && segments[0] === "trips") {
          const tripId = segments[1];
          if (segments.length === 2) {
            if (req.method === "GET") {
              const trip = await storage.getTrip(tripId);
              if (!trip) {
                sendText(res, 404, "Not found");
                return true;
              }
              sendJson(res, 200, trip);
              return true;
            }
            if (req.method === "DELETE") {
              const deleted = await storage.deleteTrip(tripId);
              if (!deleted) {
                sendText(res, 404, "Not found");
                return true;
              }
              sendJson(res, 200, { ok: true });
              return true;
            }
          }

          if (segments[2] === "itinerary" && segments.length === 3) {
            if (req.method === "GET") {
              const itinerary = await storage.readItinerary(tripId);
              sendText(res, 200, itinerary, "text/markdown; charset=utf-8");
              return true;
            }
            if (req.method === "PUT") {
              const body = (await readJsonBody(req)) ?? {};
              const content = typeof body.content === "string" ? body.content : "";
              await storage.writeItinerary(tripId, content);
              sendJson(res, 200, { ok: true });
              return true;
            }
          }

          if (segments[2] === "itinerary" && segments[3] === "toggle-todo" && segments.length === 4) {
            if (req.method === "POST") {
              const body = (await readJsonBody(req)) ?? {};
              const line = Number(body.line);
              if (!Number.isFinite(line) || line < 1) {
                sendText(res, 400, "Invalid line");
                return true;
              }
              const result = await storage.toggleTodoAtLine(tripId, line);
              sendJson(res, 200, result);
              return true;
            }
          }

          if (segments[2] === "context" && segments.length === 3) {
            if (req.method === "GET") {
              const context = await storage.readContext(tripId);
              sendText(res, 200, context, "text/markdown; charset=utf-8");
              return true;
            }
            if (req.method === "PUT") {
              const body = (await readJsonBody(req)) ?? {};
              const content = typeof body.content === "string" ? body.content : "";
              await storage.writeContext(tripId, content);
              sendJson(res, 200, { ok: true });
              return true;
            }
          }

          if (segments[2] === "conversations" && segments.length === 3) {
            if (req.method === "GET") {
              const conversations = await storage.listConversations(tripId);
              const withSessionKeys = conversations.map((conv) => ({
                ...conv,
                sessionKey: conv.sessionKey ?? defaultSessionKey(tripId, conv.id),
              }));
              sendJson(res, 200, withSessionKeys);
              return true;
            }
            if (req.method === "POST") {
              const body = (await readJsonBody(req)) ?? {};
              const title = typeof body.title === "string" ? body.title : undefined;
              const initialAssistantMessage =
                typeof body.initialAssistantMessage === "string" ? body.initialAssistantMessage : undefined;
              const conversation = await storage.createConversation(tripId, {
                title,
                initialAssistantMessage,
              });
              const result: Conversation = {
                ...conversation,
                sessionKey: conversation.sessionKey ?? defaultSessionKey(tripId, conversation.id),
              };
              sendJson(res, 201, result);
              return true;
            }
          }

          if (segments[2] === "conversations" && segments[3]) {
            const conversationId = segments[3];
            if (segments.length === 4) {
              if (req.method === "GET") {
                const conversation = await storage.getConversation(tripId, conversationId);
                if (!conversation) {
                  sendText(res, 404, "Not found");
                  return true;
                }
                const result: Conversation = {
                  ...conversation,
                  sessionKey: conversation.sessionKey ?? defaultSessionKey(tripId, conversationId),
                };
                sendJson(res, 200, result);
                return true;
              }
              if (req.method === "PATCH") {
                const body = (await readJsonBody(req)) ?? {};
                const title = typeof body.title === "string" ? body.title : undefined;
                if (title) {
                  await storage.updateConversation(tripId, conversationId, {
                    title,
                    titleSource: "user",
                    titleUpdatedAt: new Date().toISOString(),
                  });
                }
                const updated = await storage.getConversation(tripId, conversationId);
                if (!updated) {
                  sendText(res, 404, "Not found");
                  return true;
                }
                const result: Conversation = {
                  ...updated,
                  sessionKey: updated.sessionKey ?? defaultSessionKey(tripId, conversationId),
                };
                sendJson(res, 200, result);
                return true;
              }
              if (req.method === "DELETE") {
                const deleted = await storage.deleteConversation(tripId, conversationId);
                if (!deleted) {
                  sendText(res, 404, "Not found");
                  return true;
                }
                sendJson(res, 200, { ok: true });
                return true;
              }
            }

            if (segments.length >= 5 && segments[4] === "messages") {
              if (req.method === "GET") {
                const limitParam = url.searchParams.get("limit");
                const limit = limitParam ? Number(limitParam) : 500;
                const messages = await storage.readMessages(tripId, conversationId, Number.isFinite(limit) ? limit : 500);
                sendJson(res, 200, messages);
                return true;
              }
              if (req.method === "POST") {
                const body = (await readJsonBody(req)) ?? {};
                const type = typeof body.type === "string" ? body.type : "";
                const content = typeof body.content === "string" ? body.content : "";
                if (!type || !content) {
                  sendText(res, 400, "Invalid message payload");
                  return true;
                }
                const message: StoredMessage = {
                  id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
                  type: type === "assistant" || type === "system" ? type : "user",
                  content,
                  timestamp: typeof body.timestamp === "string" ? body.timestamp : new Date().toISOString(),
                  metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : undefined,
                };
                await storage.appendMessage(tripId, conversationId, message);
                sendJson(res, 201, { ok: true });
                return true;
              }
            }
          }
        }

        sendText(res, 404, "Not found");
        return true;
      }

      const uiRoot = config.uiRoot;
      const distRoot = path.join(uiRoot, "dist");
      const cssPath = path.join(distRoot, "globals.css");
      const jsPath = path.join(distRoot, "index.js");

      if (url.pathname === `${BASE_PATH}/globals.css`) {
        if (!fs.existsSync(cssPath)) {
          sendText(
            res,
            500,
            'UI assets missing. Run "npx tsx openclaw/scripts/build-ui.ts" in the travel-agent repo.'
          );
          return true;
        }
        res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
        fs.createReadStream(cssPath).pipe(res);
        return true;
      }

      if (url.pathname === `${BASE_PATH}/index.js`) {
        if (!fs.existsSync(jsPath)) {
          sendText(
            res,
            500,
            'UI assets missing. Run "npx tsx openclaw/scripts/build-ui.ts" in the travel-agent repo.'
          );
          return true;
        }
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        fs.createReadStream(jsPath).pipe(res);
        return true;
      }

      let relativePath = url.pathname.slice(BASE_PATH.length);
      if (relativePath === "" || relativePath === "/") {
        relativePath = "/index.html";
      }
      const resolved = path.join(uiRoot, relativePath.replace(/^\/+/, ""));

      if (!isPathWithin(uiRoot, resolved)) {
        sendText(res, 400, "Invalid path");
        return true;
      }

      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        res.writeHead(200, { "content-type": getContentType(resolved) });
        fs.createReadStream(resolved).pipe(res);
        return true;
      }

      const indexPath = path.join(uiRoot, "index.html");
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        fs.createReadStream(indexPath).pipe(res);
        return true;
      }

      sendText(res, 404, "Not found");
      return true;
    });
  },
};

export default plugin;
