import * as fs from "fs/promises";
import * as path from "path";

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

function prefsPath(tripId: string): string {
  return path.join(tripDir(tripId), "prefs.json");
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
  const trip: Trip = { id, name: name.trim() || "Untitled trip", createdAt: t, updatedAt: t };
  await writeFileAtomic(tripMetaPath(id), JSON.stringify(trip, null, 2));

  // Seed itinerary + prefs
  await ensureItinerary(id);
  await ensurePrefs(id);

  // Seed a default conversation
  await createConversation(id, "Planning");
  return trip;
}

export async function getTrip(tripId: string): Promise<Trip | null> {
  return readJsonFile<Trip>(tripMetaPath(tripId));
}

export async function touchTrip(tripId: string): Promise<void> {
  const trip = await getTrip(tripId);
  if (!trip) return;
  trip.updatedAt = nowIso();
  await writeFileAtomic(tripMetaPath(tripId), JSON.stringify(trip, null, 2));
}

export async function ensureItinerary(tripId: string): Promise<void> {
  try {
    await fs.access(itineraryPath(tripId));
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
    const template = [
      `# ${tripId} — Itinerary`,
      ``,
      `> Tip: Use this file as the source of truth. The UI will re-render on refresh.`,
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
  await ensureItinerary(tripId);
  return fs.readFile(itineraryPath(tripId), "utf8");
}

export async function writeItinerary(tripId: string, content: string): Promise<void> {
  await writeFileAtomic(itineraryPath(tripId), content);
  await touchTrip(tripId);
}

export async function toggleTodoAtLine(tripId: string, line1Based: number): Promise<{ updated: boolean; content: string }> {
  const content = await readItinerary(tripId);
  const lines = content.split("\n");
  const idx = line1Based - 1;
  if (idx < 0 || idx >= lines.length) return { updated: false, content };
  const line = lines[idx];
  if (line.includes("- [ ]")) lines[idx] = line.replace("- [ ]", "- [x]");
  else if (line.includes("- [x]")) lines[idx] = line.replace("- [x]", "- [ ]");
  else return { updated: false, content };
  const next = lines.join("\n");
  await writeItinerary(tripId, next);
  return { updated: true, content: next };
}

export async function ensurePrefs(tripId: string): Promise<void> {
  try {
    await fs.access(prefsPath(tripId));
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
    await writeFileAtomic(prefsPath(tripId), JSON.stringify({ travelers: {}, preferences: {} }, null, 2));
  }
}

export async function readPrefs(tripId: string): Promise<Record<string, unknown>> {
  await ensurePrefs(tripId);
  const raw = await fs.readFile(prefsPath(tripId), "utf8");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function mergePrefs(tripId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const current = await readPrefs(tripId);
  const merged = { ...current, ...patch };
  await writeFileAtomic(prefsPath(tripId), JSON.stringify(merged, null, 2));
  await touchTrip(tripId);
  return merged;
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
