import * as storage from "./storage";
import { createHeaders, jsonResponse, textResponse } from "./http";
import * as fs from "fs/promises";
import * as path from "path";
import { generateTripMapAsset, ensureMapReferencedInItinerary } from "./map-generator";

type HeaderCtx = Parameters<typeof createHeaders>[1];

async function parseJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function notFound(ctx?: HeaderCtx): Response {
  return textResponse("Not Found", 404, ctx);
}

function badRequest(msg: string, ctx?: HeaderCtx): Response {
  return jsonResponse({ error: msg }, 400, ctx);
}

function ok(ctx?: HeaderCtx): Response {
  return jsonResponse({ ok: true }, 200, ctx);
}

async function serveFile(absolutePath: string, ctx?: HeaderCtx): Promise<Response> {
  const file = Bun.file(absolutePath);
  if (!(await file.exists())) return notFound(ctx);
  const contentType = absolutePath.endsWith(".svg")
    ? "image/svg+xml"
    : absolutePath.endsWith(".png")
      ? "image/png"
      : absolutePath.endsWith(".jpg") || absolutePath.endsWith(".jpeg")
        ? "image/jpeg"
        : absolutePath.endsWith(".webp")
          ? "image/webp"
          : "application/octet-stream";
  return new Response(file, { headers: createHeaders(contentType, ctx) });
}


export async function handleApiRequest(req: Request, url: URL, ctx?: HeaderCtx): Promise<Response> {
  await storage.ensureDataDirs();

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "api") return notFound(ctx);

  if (segments.length === 2 && segments[1] === "health") return ok(ctx);

  // /api/trips
  if (segments.length === 2 && segments[1] === "trips") {
    if (req.method === "GET") return jsonResponse(await storage.listTrips(), 200, ctx);
    if (req.method === "POST") {
      const body = await parseJson(req);
      const name = typeof body?.name === "string" ? body.name : "";
      if (!name.trim()) return badRequest("name is required", ctx);
      return jsonResponse(await storage.createTrip(name), 201, ctx);
    }
    return notFound(ctx);
  }

  // /api/trips/:tripId/...
  if (segments[1] !== "trips" || !segments[2]) return notFound(ctx);
  const tripId = segments[2];

  if (segments.length === 3) {
    if (req.method === "GET") return jsonResponse(await storage.getTrip(tripId), 200, ctx);
    return notFound(ctx);
  }

  // itinerary
  if (segments[3] === "itinerary" && segments.length === 4) {
    if (req.method === "GET") return textResponse(await storage.readItinerary(tripId), 200, ctx, "text/markdown");
    if (req.method === "PUT") {
      const body = await parseJson(req);
      if (typeof body?.content !== "string") return badRequest("content must be a string", ctx);
      await storage.writeItinerary(tripId, body.content);
      return ok(ctx);
    }
    return notFound(ctx);
  }

  if (segments[3] === "itinerary" && segments[4] === "toggle-todo" && segments.length === 5 && req.method === "POST") {
    const body = await parseJson(req);
    const sourcepos = typeof body?.sourcepos === "string" ? body.sourcepos : null;
    const line = typeof body?.line === "number" ? body.line : null;
    let line1Based: number | null = line ? Math.floor(line) : null;
    if (!line1Based && sourcepos) {
      // data-sourcepos: "L1:C1-L2:C2"
      const m = sourcepos.match(/^(\d+):\d+-/);
      if (m) line1Based = Number(m[1]);
    }
    if (!line1Based || line1Based < 1) return badRequest("line (1-based) or sourcepos required", ctx);
    const result = await storage.toggleTodoAtLine(tripId, line1Based);
    return jsonResponse({ updated: result.updated }, 200, ctx);
  }

  // prefs
  if (segments[3] === "prefs" && segments.length === 4) {
    if (req.method === "GET") return jsonResponse(await storage.readPrefs(tripId), 200, ctx);
    if (req.method === "PUT") {
      const body = await parseJson(req);
      if (!body || typeof body !== "object") return badRequest("body must be an object", ctx);
      return jsonResponse(await storage.mergePrefs(tripId, body), 200, ctx);
    }
    return notFound(ctx);
  }

  // conversations
  if (segments[3] === "conversations" && segments.length === 4) {
    if (req.method === "GET") return jsonResponse(await storage.listConversations(tripId), 200, ctx);
    if (req.method === "POST") {
      const body = await parseJson(req);
      const title = typeof body?.title === "string" ? body.title : undefined;
      return jsonResponse(await storage.createConversation(tripId, title), 201, ctx);
    }
    return notFound(ctx);
  }

  if (segments[3] === "conversations" && segments[4] && segments.length === 6 && segments[5] === "messages" && req.method === "GET") {
    const conversationId = segments[4];
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(2000, Math.max(1, Number(limitParam))) : 500;
    return jsonResponse(await storage.readMessages(tripId, conversationId, Number.isFinite(limit) ? limit : 500), 200, ctx);
  }

  // uploads
  if (segments[3] === "uploads" && segments.length >= 5 && req.method === "GET") {
    const rel = segments.slice(4).join("/");
    const root = storage.uploadsDir(tripId);
    const resolved = storage.safePathWithin(root, rel);
    if (!resolved) return badRequest("invalid path", ctx);
    return serveFile(resolved, ctx);
  }

  if (segments[3] === "uploads" && segments.length === 4) {
    if (req.method === "GET") {
      const dir = storage.uploadsDir(tripId);
      await fs.mkdir(dir, { recursive: true });
      const ents = await fs.readdir(dir, { withFileTypes: true });
      const files = ents.filter((e) => e.isFile()).map((e) => e.name);
      return jsonResponse({ files }, 200, ctx);
    }

    if (req.method === "POST") {
      const dir = storage.uploadsDir(tripId);
      await fs.mkdir(dir, { recursive: true });
      const form = await req.formData();
      const out: string[] = [];
      for (const value of form.values()) {
        if (typeof value === "string") continue;
        const file = value as unknown as File;
        const base = (file.name || "upload").replaceAll(/[^\w.\-]+/g, "_").slice(0, 140);
        const filename = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${base}`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        await fs.writeFile(path.join(dir, filename), bytes);
        out.push(filename);
      }
      return jsonResponse({ files: out }, 201, ctx);
    }

    return notFound(ctx);
  }

  // assets: /api/trips/:tripId/assets/<path>
  if (segments[3] === "assets" && segments.length >= 5 && req.method === "GET") {
    const rel = segments.slice(4).join("/");
    const root = storage.assetsDir(tripId);
    const resolved = storage.safePathWithin(root, rel);
    if (!resolved) return badRequest("invalid path", ctx);
    return serveFile(resolved, ctx);
  }

  // generate map
  if (segments[3] === "generate-map" && segments.length === 4 && req.method === "POST") {
    const body = await parseJson(req);
    const destinations = Array.isArray(body?.destinations) ? body.destinations.filter((d: any) => typeof d === "string") : [];
    const { assetUrl } = await generateTripMapAsset(tripId, destinations);
    await ensureMapReferencedInItinerary(tripId, assetUrl);
    return jsonResponse({ assetUrl }, 200, ctx);
  }

  return notFound(ctx);
}
