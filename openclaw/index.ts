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

const plugin = {
  id: "travel-agent",
  name: "Travel Agent",
  description: "Travel tools and UI for OpenClaw",
  register(api: ClawdbotPluginApi) {
    const pluginRoot = path.dirname(fileURLToPath(import.meta.url));
    const config = resolveConfig(api, pluginRoot);
    const storage = createStorage(config.workspaceRoot);

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
            await storage.writeContext(tripId, content);
            return { content: [{ type: "text", text: `Updated context for ${tripId}.` }] };
          },
        };

        return [readItinerary, updateItinerary, readContext, updateContext];
      },
      { names: ["read_itinerary", "update_itinerary", "read_context", "update_context"] }
    );

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
