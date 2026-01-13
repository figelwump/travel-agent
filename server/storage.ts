import * as fs from "fs/promises";
import * as path from "path";
import * as nanoBanana from "./nano-banana";

export type Trip = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  tripId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sdkSessionId?: string | null;
};

export type StoredMessage = {
  id: string;
  type: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function homeDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) throw new Error("No HOME/USERPROFILE set; cannot resolve travel agent data directory.");
  return home;
}

export function travelAgentHome(): string {
  return process.env.TRAVEL_AGENT_HOME || path.join(homeDir(), ".travelagent");
}

function tripsRoot(): string {
  return path.join(travelAgentHome(), "trips");
}

export async function ensureDataDirs(): Promise<void> {
  await fs.mkdir(tripsRoot(), { recursive: true });
}

function tripDir(tripId: string): string {
  return path.join(tripsRoot(), tripId);
}

function tripMetaPath(tripId: string): string {
  return path.join(tripDir(tripId), "trip.json");
}

function itineraryPath(tripId: string): string {
  return path.join(tripDir(tripId), "itinerary.md");
}

function contextPath(tripId: string): string {
  return path.join(tripDir(tripId), "context.md");
}

function globalContextPath(): string {
  return path.join(travelAgentHome(), "global-context.md");
}

function conversationsRoot(tripId: string): string {
  return path.join(tripDir(tripId), "chats");
}

function conversationDir(tripId: string, conversationId: string): string {
  return path.join(conversationsRoot(tripId), conversationId);
}

function conversationMetaPath(tripId: string, conversationId: string): string {
  return path.join(conversationDir(tripId, conversationId), "conversation.json");
}

function messagesPath(tripId: string, conversationId: string): string {
  return path.join(conversationDir(tripId, conversationId), "messages.jsonl");
}

export function uploadsDir(tripId: string): string {
  return path.join(tripDir(tripId), "uploads");
}

export function assetsDir(tripId: string): string {
  return path.join(tripDir(tripId), "assets");
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${path.basename(filePath)}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath);
}

export async function listTrips(): Promise<Trip[]> {
  await ensureDataDirs();
  const root = tripsRoot();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const trips: Trip[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const meta = await readJsonFile<Trip>(tripMetaPath(ent.name));
    if (meta) trips.push(meta);
  }
  trips.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return trips;
}

export async function createTrip(name: string): Promise<Trip> {
  await ensureDataDirs();
  const id = crypto.randomUUID();
  const dir = tripDir(id);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(conversationsRoot(id), { recursive: true });
  await fs.mkdir(uploadsDir(id), { recursive: true });
  await fs.mkdir(assetsDir(id), { recursive: true });

  const t = nowIso();
  const tripName = name.trim() || "Untitled trip";
  const trip: Trip = { id, name: tripName, createdAt: t, updatedAt: t };
  await writeFileAtomic(tripMetaPath(id), JSON.stringify(trip, null, 2));

  // Seed context
  await ensureContext(id);

  // Seed a default conversation
  await createConversation(id, "Planning");
  return trip;
}

export async function getTrip(tripId: string): Promise<Trip | null> {
  return readJsonFile<Trip>(tripMetaPath(tripId));
}

export async function updateTrip(tripId: string, patch: Partial<Trip>): Promise<Trip | null> {
  const current = await getTrip(tripId);
  if (!current) return null;
  const next: Trip = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };
  if (typeof next.name !== "string" || !next.name.trim()) {
    next.name = current.name;
  }
  await writeFileAtomic(tripMetaPath(tripId), JSON.stringify(next, null, 2));
  return next;
}

export async function touchTrip(tripId: string): Promise<void> {
  const trip = await getTrip(tripId);
  if (!trip) return;
  trip.updatedAt = nowIso();
  await writeFileAtomic(tripMetaPath(tripId), JSON.stringify(trip, null, 2));
}

export async function deleteTrip(tripId: string): Promise<boolean> {
  await ensureDataDirs();
  const root = tripsRoot();
  const resolved = safePathWithin(root, tripId);
  if (!resolved) return false;
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) return false;
  } catch (err: any) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
  await fs.rm(resolved, { recursive: true, force: true });
  return true;
}

export async function ensureItinerary(tripId: string, tripName?: string): Promise<void> {
  try {
    await fs.access(itineraryPath(tripId));
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
    // If no name provided, try to look it up from trip metadata
    let name = tripName;
    if (!name) {
      const trip = await getTrip(tripId);
      name = trip?.name ?? "My Trip";
    }
    const template = [
      `# ${name} — Itinerary`,
      ``,
      `## Overview`,
      ``,
      `- Dates: TBD`,
      `- Travelers: TBD`,
      `- Pace: TBD`,
      ``,
      `## Destinations`,
      ``,
      `<details open>`,
      `<summary><strong>Day 1 — Arrival</strong></summary>`,
      ``,
      `- [ ] Book flights`,
      `- [ ] Book first night lodging`,
      ``,
      `</details>`,
      ``,
    ].join("\n");
    await writeFileAtomic(itineraryPath(tripId), template);
  }
}

export async function readItinerary(tripId: string): Promise<string> {
  try {
    return await fs.readFile(itineraryPath(tripId), "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
}

export async function writeItinerary(tripId: string, content: string): Promise<void> {
  await writeFileAtomic(itineraryPath(tripId), content);
  await touchTrip(tripId);
}

export async function deleteItinerary(tripId: string): Promise<void> {
  try {
    await fs.unlink(itineraryPath(tripId));
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
  await touchTrip(tripId);
}

export async function toggleTodoAtLine(tripId: string, line1Based: number): Promise<{ updated: boolean; content: string }> {
  const content = await readItinerary(tripId);
  const lines = content.split("\n");
  const idx = line1Based - 1;
  if (idx < 0 || idx >= lines.length) return { updated: false, content };
  const line = lines[idx];
  const unchecked = /^(\s*)([-*+]|\d+\.)\s+\[ \]/;
  const checked = /^(\s*)([-*+]|\d+\.)\s+\[[xX]\]/;
  if (unchecked.test(line)) lines[idx] = line.replace(unchecked, "$1$2 [x]");
  else if (checked.test(line)) lines[idx] = line.replace(checked, "$1$2 [ ]");
  else return { updated: false, content };
  const next = lines.join("\n");
  await writeItinerary(tripId, next);
  return { updated: true, content: next };
}

export async function ensureContext(tripId: string): Promise<void> {
  try {
    await fs.access(contextPath(tripId));
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
    const template = [
      "# Trip Context",
      "",
      "## Trip Details",
      "- Dates: TBD",
      "- Travelers: TBD",
      "",
      "## Confirmed Bookings",
      "- None yet",
      "",
      "## Preferences",
      "- Pace: TBD",
      "- Interests: TBD",
      "- Dietary: TBD",
      "",
      "## Pending Decisions",
      "- None yet",
      "",
      `## Last Updated`,
      nowIso(),
      "",
    ].join("\n");
    await writeFileAtomic(contextPath(tripId), template);
  }
}

export async function ensureGlobalContext(): Promise<void> {
  try {
    await fs.access(globalContextPath());
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
    const template = [
      "# Global Travel Profile",
      "",
      "## Travelers",
      "- Adults: TBD",
      "- Kids: TBD",
      "- Kids ages: TBD",
      "",
      "## Preferences",
      "- Pace: TBD",
      "- Interests: TBD",
      "- Lodging: TBD",
      "- Dining: TBD",
      "- Accessibility: TBD",
      "",
      "## Constraints",
      "- Budget: TBD",
      "- Loyalty programs: TBD",
      "- Airlines: TBD",
      "",
      "## Notes",
      "- TBD",
      "",
      "## Last Updated",
      nowIso(),
      "",
    ].join("\n");
    await writeFileAtomic(globalContextPath(), template);
  }
}

export async function readContext(tripId: string): Promise<string> {
  await ensureContext(tripId);
  try {
    return await fs.readFile(contextPath(tripId), "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
}

export async function writeContext(tripId: string, content: string): Promise<void> {
  await writeFileAtomic(contextPath(tripId), content);
  await touchTrip(tripId);
}

export async function readGlobalContext(): Promise<string> {
  await ensureGlobalContext();
  try {
    return await fs.readFile(globalContextPath(), "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
}

export async function writeGlobalContext(content: string): Promise<void> {
  await writeFileAtomic(globalContextPath(), content);
}

export async function listConversations(tripId: string): Promise<Conversation[]> {
  await fs.mkdir(conversationsRoot(tripId), { recursive: true });
  const entries = await fs.readdir(conversationsRoot(tripId), { withFileTypes: true });
  const out: Conversation[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const meta = await readJsonFile<Conversation>(conversationMetaPath(tripId, ent.name));
    if (meta) out.push(meta);
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

export async function listUploads(tripId: string): Promise<string[]> {
  const dir = uploadsDir(tripId);
  await fs.mkdir(dir, { recursive: true });
  const ents = await fs.readdir(dir, { withFileTypes: true });
  return ents.filter((e) => e.isFile()).map((e) => e.name);
}

export async function createConversation(tripId: string, title?: string): Promise<Conversation> {
  await fs.mkdir(conversationsRoot(tripId), { recursive: true });
  const id = crypto.randomUUID();
  const dir = conversationDir(tripId, id);
  await fs.mkdir(dir, { recursive: true });
  const t = nowIso();
  const meta: Conversation = {
    id,
    tripId,
    title: (title?.trim() || "Chat").slice(0, 80),
    createdAt: t,
    updatedAt: t,
    sdkSessionId: null,
  };
  await writeFileAtomic(conversationMetaPath(tripId, id), JSON.stringify(meta, null, 2));
  await fs.writeFile(messagesPath(tripId, id), "", "utf8");
  await touchTrip(tripId);
  return meta;
}

export async function getConversation(tripId: string, conversationId: string): Promise<Conversation | null> {
  return readJsonFile<Conversation>(conversationMetaPath(tripId, conversationId));
}

export async function updateConversation(tripId: string, conversationId: string, patch: Partial<Conversation>): Promise<void> {
  const current = (await getConversation(tripId, conversationId)) ?? {
    id: conversationId,
    tripId,
    title: "Chat",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    sdkSessionId: null,
  };
  const next: Conversation = { ...current, ...patch, updatedAt: nowIso() };
  await writeFileAtomic(conversationMetaPath(tripId, conversationId), JSON.stringify(next, null, 2));
  await touchTrip(tripId);
}

export async function appendMessage(tripId: string, conversationId: string, msg: StoredMessage): Promise<void> {
  await fs.mkdir(conversationDir(tripId, conversationId), { recursive: true });
  await fs.appendFile(messagesPath(tripId, conversationId), JSON.stringify(msg) + "\n", "utf8");
  await updateConversation(tripId, conversationId, {});
}

export async function readMessages(tripId: string, conversationId: string, limit = 500): Promise<StoredMessage[]> {
  try {
    const raw = await fs.readFile(messagesPath(tripId, conversationId), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const selected = lines.slice(Math.max(0, lines.length - limit));
    const out: StoredMessage[] = [];
    for (const line of selected) {
      try {
        out.push(JSON.parse(line) as StoredMessage);
      } catch {}
    }
    return out;
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

export function safePathWithin(rootDir: string, relPath: string): string | null {
  const resolved = path.resolve(rootDir, relPath);
  const normalizedRoot = path.resolve(rootDir);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) return null;
  return resolved;
}

function generateFallbackTripMapSvg(tripName: string, destinations: string[]): string {
  const escaped = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const items = destinations
    .slice(0, 12)
    .map(
      (d, i) =>
        `<text x="24" y="${80 + i * 22}" fill="#f6e7c7" font-size="14" font-family="monospace">${i + 1}. ${escaped(d)}</text>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <rect width="1200" height="675" fill="#0b0c10"/>
  <rect x="20" y="20" width="1160" height="635" fill="#12141c" stroke="#b0892e" stroke-width="2"/>
  <text x="24" y="52" fill="#f6e7c7" font-size="22" font-family="serif" font-style="italic">${escaped(tripName)} — Trip Map (placeholder)</text>
  <text x="24" y="74" fill="#cdbf9a" font-size="12" font-family="monospace">Set NANO_BANANA_PRO_* env vars to enable generated maps</text>
  ${items}
</svg>`;
}

export async function generateTripMap(
  tripId: string,
  destinations: string[],
): Promise<{ assetPath: string; assetUrl: string }> {
  const trip = await getTrip(tripId);
  const tripName = trip?.name ?? tripId;
  const outDir = assetsDir(tripId);
  await fs.mkdir(outDir, { recursive: true });

  if (nanoBanana.isConfigured()) {
    const prompt = [
      "Create a single 16:9 map-style illustration that visualizes this trip itinerary as a route.",
      `Trip: ${tripName}.`,
      `Destinations in order: ${destinations.join(" -> ")}.`,
      "Dark theme, crisp labels, subtle route line, minimal UI clutter.",
    ].join(" ");

    const result = await nanoBanana.generateImage({ prompt, aspectRatio: "16:9" });
    const assetPath = path.join(outDir, `itinerary-map.${result.extension}`);
    await fs.writeFile(assetPath, result.buffer);
    return { assetPath, assetUrl: `/api/trips/${tripId}/assets/itinerary-map.${result.extension}` };
  }

  const svg = generateFallbackTripMapSvg(tripName, destinations);
  const assetPath = path.join(outDir, "itinerary-map.svg");
  await fs.writeFile(assetPath, svg, "utf8");
  return { assetPath, assetUrl: `/api/trips/${tripId}/assets/itinerary-map.svg` };
}

export async function ensureMapReferencedInItinerary(tripId: string, assetUrl: string): Promise<void> {
  const itinerary = await readItinerary(tripId);
  const marker = "![Trip map]";
  const line = `${marker}(${assetUrl})`;
  if (itinerary.includes(marker)) {
    const next = itinerary.replace(/!\[Trip map\]\([^)]+\)/, line);
    if (next !== itinerary) {
      await writeItinerary(tripId, next);
    }
    return;
  }
  await writeItinerary(tripId, `${line}\n\n${itinerary}`);
}
