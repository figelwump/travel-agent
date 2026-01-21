import "dotenv/config";
import { WebSocketHandler } from "./ws-handler";
import type { WSClient } from "./ws-types";
import { handleApiRequest } from "./api";
import { logTs } from "./log";
import * as path from "path";
import * as fs from "fs/promises";
import { Buffer } from "buffer";
import { createHeaders, jsonResponse } from "./http";

const PORT = Number(process.env.PORT || 3001);
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || process.env.BASIC_AUTH_PASSWORD || process.env.BASIC_AUTH_PASS;
const DISABLE_AUTH = process.env.DISABLE_AUTH === "true";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (!DISABLE_AUTH && !AUTH_PASSWORD) {
  console.warn("AUTH_PASSWORD not set and DISABLE_AUTH not true; all requests will be rejected");
}

const wsHandler = new WebSocketHandler();
const webClientRoot = path.join(process.cwd(), "web");

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return ALLOWED_ORIGINS.length === 0; // allow same-origin/dev tools when allowlist empty
  if (ALLOWED_ORIGINS.length === 0) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

function allowedOriginHeader(origin: string | null): string | undefined {
  if (!origin && ALLOWED_ORIGINS.length === 0) return "*";
  if (origin && isOriginAllowed(origin)) return origin;
  return undefined;
}

function getPasswordFromRequest(req: Request, url: URL): string | null {
  // Check query param token
  const token = url.searchParams.get("token");
  if (token) return token;

  // Check Authorization header (for API calls)
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const [scheme, encoded] = authHeader.split(" ");
    if (encoded && scheme?.toLowerCase() === "basic") {
      try {
        const decoded = Buffer.from(encoded, "base64").toString("utf8");
        const separator = decoded.indexOf(":");
        if (separator !== -1) {
          return decoded.slice(separator + 1);
        }
      } catch {}
    }
  }

  return null;
}

function isAuthorized(password: string | null): boolean {
  if (DISABLE_AUTH) return true;
  if (!AUTH_PASSWORD) return false;
  return password === AUTH_PASSWORD;
}

function unauthorizedResponse(origin: string | null): Response {
  const headers = createHeaders("application/json", { origin, allowedOriginHeader });
  headers["WWW-Authenticate"] = 'Basic realm="travelagent"';
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers,
  });
}

const postcssPluginsPromise = Promise.all([import("postcss"), import("@tailwindcss/postcss"), import("autoprefixer")]);

function resolveWebClientPath(urlPath: string): string | null {
  const relative = urlPath.replace(/^\/web\//, "");
  const resolved = path.join(webClientRoot, relative);
  const normalized = path.normalize(resolved);
  if (!normalized.startsWith(webClientRoot)) {
    return null;
  }
  return normalized;
}

function guessContentType(filePath: string): string {
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) return "text/yaml";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".js")) return "application/javascript";
  return "text/plain";
}

function isAppRoute(pathname: string): boolean {
  if (pathname === "/ws") return false;
  if (pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/web/")) return false;
  return true;
}

async function serveCss(filePath: string, origin: string | null): Promise<Response | null> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    const cssContent = await file.text();
    const [postcssMod, tailwindMod, autoprefixerMod] = await postcssPluginsPromise;
    const postcss = postcssMod.default ?? postcssMod;
    const tailwindcss = tailwindMod.default ?? tailwindMod;
    const autoprefixer = autoprefixerMod.default ?? autoprefixerMod;

    const result = await postcss([
      tailwindcss(),
      autoprefixer,
    ]).process(cssContent, {
      from: filePath,
      to: undefined,
    });

    return new Response(result.css, {
      headers: createHeaders("text/css", { origin, allowedOriginHeader }),
    });
  } catch (error) {
    console.error("CSS processing error", error);
    return new Response("CSS processing failed", { status: 500, headers: createHeaders(undefined, { origin, allowedOriginHeader }) });
  }
}

async function serveTsModule(filePath: string, origin: string | null): Promise<Response | null> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    const build = await Bun.build({
      entrypoints: [filePath],
      target: "browser",
      format: "esm",
    });

    if (!build.success || build.outputs.length === 0) {
      return new Response("Transpilation failed", { status: 500, headers: createHeaders(undefined, { origin, allowedOriginHeader }) });
    }

    const jsCode = await build.outputs[0].text();
    return new Response(jsCode, {
      headers: createHeaders("application/javascript", { origin, allowedOriginHeader }),
    });
  } catch (error) {
    console.error("Transpilation error", error);
    return new Response("Transpilation failed", { status: 500, headers: createHeaders(undefined, { origin, allowedOriginHeader }) });
  }
}

async function serveStaticAsset(filePath: string, origin: string | null): Promise<Response | null> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    return new Response(file, {
      headers: createHeaders(guessContentType(filePath), { origin, allowedOriginHeader }),
    });
  } catch (error) {
    console.error("Static asset error", error);
    return null;
  }
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,

  websocket: {
    open(ws: WSClient) {
      wsHandler.onOpen(ws);
    },
    message(ws: WSClient, message: string) {
      wsHandler.onMessage(ws, message);
    },
    close(ws: WSClient) {
      wsHandler.onClose(ws);
    },
  },

  async fetch(req: Request, server: any) {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");

    if (ALLOWED_ORIGINS.length > 0 && origin && !isOriginAllowed(origin)) {
      return new Response("Forbidden", { status: 403, headers: createHeaders(undefined, { origin, allowedOriginHeader }) });
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: createHeaders(undefined, { origin, allowedOriginHeader }) });
    }

    if (url.pathname === "/ws") {
      // Accept all WebSocket connections - auth happens via message
      const upgraded = server.upgrade(req, { data: { sessionKey: "", authenticated: false } });
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400, headers: createHeaders(undefined, { origin, allowedOriginHeader }) });
      }
      return;
    }

    // Protect API endpoints
    if (!DISABLE_AUTH && url.pathname.startsWith("/api")) {
      const password = getPasswordFromRequest(req, url);
      if (!isAuthorized(password)) {
        return unauthorizedResponse(origin);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(req, url, { origin, allowedOriginHeader });
    }

    if (url.pathname.startsWith("/web/") && url.pathname.endsWith(".css")) {
      const filePath = resolveWebClientPath(url.pathname);
      if (!filePath) return new Response("Not Found", { status: 404, headers: createHeaders(undefined, { origin, allowedOriginHeader }) });
      const response = await serveCss(filePath, origin);
      if (response) return response;
    }

    if (url.pathname.startsWith("/web/") && (url.pathname.endsWith(".ts") || url.pathname.endsWith(".tsx"))) {
      const filePath = resolveWebClientPath(url.pathname);
      if (!filePath) return new Response("Not Found", { status: 404, headers: createHeaders(undefined, { origin, allowedOriginHeader }) });
      const response = await serveTsModule(filePath, origin);
      if (response) return response;
    }

    if (url.pathname.startsWith("/web/")) {
      const filePath = resolveWebClientPath(url.pathname);
      if (!filePath) {
        return new Response("Not Found", { status: 404, headers: createHeaders(undefined, { origin, allowedOriginHeader }) });
      }
      const response = await serveStaticAsset(filePath, origin);
      if (response) return response;
      return new Response("Not Found", { status: 404, headers: createHeaders(undefined, { origin, allowedOriginHeader }) });
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      return jsonResponse({
        error: "Please connect via WebSocket at /ws",
      }, 400, { origin, allowedOriginHeader });
    }

    // Serve HTML shell for app routes (deep linking support)
    if (isAppRoute(url.pathname)) {
      const indexPath = path.join(webClientRoot, "index.html");
      try {
        const file = await fs.readFile(indexPath);
        return new Response(file, { headers: createHeaders("text/html", { origin, allowedOriginHeader }) });
      } catch (error) {
        console.error("Failed to read index.html", error);
        return new Response("index.html not found", { status: 500, headers: createHeaders(undefined, { origin, allowedOriginHeader }) });
      }
    }

    return new Response("Not Found", { status: 404, headers: createHeaders(undefined, { origin, allowedOriginHeader }) });
  },
});

logTs(`Server running at http://localhost:${server.port}`);
logTs(`WebSocket endpoint available at ws://localhost:${server.port}/ws`);
logTs("Serving Travel Agent UI from /web");
