import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Options = {
  sessionsPath: string;
  workspace: string;
  tripId?: string;
  dryRun: boolean;
};

type SessionEntry = {
  sessionId?: string;
  sessionFile?: string;
  updatedAt?: number;
};

type StoredMessage = {
  id: string;
  type: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

type TripMeta = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type ConversationMeta = {
  id: string;
  tripId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sessionKey?: string | null;
  titleSource?: "user" | "auto";
  titleUpdatedAt?: string;
};

function usage() {
  console.log(`Usage: npx tsx openclaw/scripts/import-openclaw-sessions.ts [options]

Options:
  --sessions <path>       Path to sessions.json (default: ~/.openclaw/agents/travel/sessions/sessions.json)
  --workspace <path>      OpenClaw travel workspace (default: openclaw/workspace)
  --trip <tripId>         Import only a specific trip
  --dry-run               Print actions without writing
  --help                  Show this help
`);
}

function parseArgs(argv: string[]): Options {
  const defaults: Options = {
    sessionsPath: path.join(os.homedir(), ".openclaw", "agents", "travel", "sessions", "sessions.json"),
    workspace: path.resolve(__dirname, "..", "workspace"),
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--sessions") {
      defaults.sessionsPath = argv[++i] || defaults.sessionsPath;
      continue;
    }
    if (arg === "--workspace" || arg === "--dest") {
      defaults.workspace = argv[++i] || defaults.workspace;
      continue;
    }
    if (arg === "--trip") {
      defaults.tripId = argv[++i];
      continue;
    }
    if (arg === "--dry-run") {
      defaults.dryRun = true;
      continue;
    }
  }
  return defaults;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function parseSessionKey(sessionKey: string): { tripId: string; conversationId: string } | null {
  const parts = sessionKey.split(":");
  if (parts.length < 4) return null;
  if (parts[0] !== "agent" || parts[1] !== "travel") return null;
  return { tripId: parts[2], conversationId: parts[3] };
}

function extractText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (part && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  if (typeof (content as any).text === "string") return (content as any).text;
  return "";
}

function cleanUserPrompt(raw: string): string {
  if (!raw) return raw;
  if (!raw.includes("You are Travel Agent") && !raw.includes("[message_id")) {
    return raw.trim();
  }
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const match = line.match(/^\[[^\]]+\]\s*(.+)$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  const filtered = lines.filter((line) => {
    if (line.startsWith("[")) return false;
    if (line.toLowerCase().startsWith("you are travel agent")) return false;
    if (line.toLowerCase().startsWith("do not claim")) return false;
    if (line.startsWith("- ")) return false;
    return true;
  });
  return filtered.join("\n").trim() || raw.trim();
}

function toIsoTimestamp(value: unknown, fallback?: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return fallback ?? new Date().toISOString();
}

function titleFromText(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Conversation";
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

async function writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${path.basename(filePath)}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

async function ensureTrip(workspace: string, tripId: string, createdAt: string): Promise<TripMeta> {
  const tripDir = path.join(workspace, "trips", tripId);
  const tripMetaPath = path.join(tripDir, "trip.json");
  const existing = await readJson<TripMeta>(tripMetaPath);
  if (existing) return existing;

  const name = `Imported Trip ${tripId.slice(0, 8)}`;
  const meta: TripMeta = {
    id: tripId,
    name,
    createdAt,
    updatedAt: createdAt,
  };
  await fs.mkdir(tripDir, { recursive: true });
  await writeJsonAtomic(tripMetaPath, meta);

  const itineraryPath = path.join(tripDir, "itinerary.md");
  if (!(await exists(itineraryPath))) {
    const template = [
      `# ${name} — Itinerary`,
      "",
      "## Overview",
      "",
      "- Dates: TBD",
      "- Travelers: TBD",
      "- Pace: TBD",
      "",
      "## Destinations",
      "",
      "<details open>",
      "<summary><strong>Day 1 — Arrival</strong></summary>",
      "",
      "- [ ] Book flights",
      "- [ ] Book first night lodging",
      "",
      "</details>",
      "",
    ].join("\n");
    await fs.writeFile(itineraryPath, template, "utf8");
  }

  const contextPath = path.join(tripDir, "context.md");
  if (!(await exists(contextPath))) {
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
      "## Last Updated",
      `- ${createdAt}`,
      "",
    ].join("\n");
    await fs.writeFile(contextPath, template, "utf8");
  }

  return meta;
}

async function readExistingMessageIds(messagesPath: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!(await exists(messagesPath))) return ids;
  const raw = await fs.readFile(messagesPath, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as StoredMessage;
      if (entry?.id) ids.add(entry.id);
    } catch {
      // ignore malformed lines
    }
  }
  return ids;
}

async function importSession(options: Options, sessionKey: string, entry: SessionEntry) {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return;
  if (options.tripId && parsed.tripId !== options.tripId) return;

  const sessionFile = entry.sessionFile || (entry.sessionId
    ? path.join(path.dirname(options.sessionsPath), `${entry.sessionId}.jsonl`)
    : undefined);
  if (!sessionFile || !(await exists(sessionFile))) {
    console.warn(`Skipping ${sessionKey}: session file not found.`);
    return;
  }

  const raw = await fs.readFile(sessionFile, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  const messages: StoredMessage[] = [];

  for (const line of lines) {
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt?.type !== "message") continue;
    const msg = evt?.message;
    if (!msg || !msg.role) continue;
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = extractText(msg.content);
    if (!text) continue;

    const cleaned = msg.role === "user" ? cleanUserPrompt(text) : text.trim();
    if (!cleaned) continue;

    const id = typeof evt.id === "string" ? evt.id : `${sessionKey}:${messages.length}`;
    const timestamp = toIsoTimestamp(msg.timestamp ?? evt.timestamp);

    messages.push({
      id,
      type: msg.role,
      content: cleaned,
      timestamp,
    });
  }

  if (messages.length === 0) return;

  const tripDir = path.join(options.workspace, "trips", parsed.tripId);
  const conversationsDir = path.join(tripDir, "chats", parsed.conversationId);
  const conversationMetaPath = path.join(conversationsDir, "conversation.json");
  const messagesPath = path.join(conversationsDir, "messages.jsonl");

  const createdAt = messages[0].timestamp;
  const updatedAt = messages[messages.length - 1].timestamp;

  if (!options.dryRun) {
    await ensureTrip(options.workspace, parsed.tripId, createdAt);
  }

  const existingIds = await readExistingMessageIds(messagesPath);
  const newMessages = messages.filter((msg) => !existingIds.has(msg.id));
  if (newMessages.length === 0) return;

  const existingMeta = await readJson<ConversationMeta>(conversationMetaPath);
  const titleSeed = messages.find((m) => m.type === "user")?.content ?? messages[0].content;
  const title = titleFromText(titleSeed);
  const meta: ConversationMeta = {
    id: parsed.conversationId,
    tripId: parsed.tripId,
    title: existingMeta?.title || title,
    createdAt: existingMeta?.createdAt || createdAt,
    updatedAt,
    sessionKey,
    titleSource: existingMeta?.titleSource ?? "auto",
    titleUpdatedAt: existingMeta?.titleUpdatedAt ?? updatedAt,
  };

  if (options.dryRun) {
    console.log(`Would import ${newMessages.length} messages into ${parsed.tripId}/${parsed.conversationId}`);
    return;
  }

  await fs.mkdir(conversationsDir, { recursive: true });
  await writeJsonAtomic(conversationMetaPath, meta);
  const payload = newMessages.map((msg) => JSON.stringify(msg)).join("\n") + "\n";
  await fs.appendFile(messagesPath, payload, "utf8");

  const tripMetaPath = path.join(tripDir, "trip.json");
  const tripMeta = await readJson<TripMeta>(tripMetaPath);
  if (tripMeta) {
    const next = {
      ...tripMeta,
      updatedAt,
    };
    await writeJsonAtomic(tripMetaPath, next);
  }

  console.log(`Imported ${newMessages.length} messages into ${parsed.tripId}/${parsed.conversationId}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Sessions:  ${options.sessionsPath}`);
  console.log(`Workspace: ${options.workspace}`);
  if (options.tripId) {
    console.log(`Trip filter: ${options.tripId}`);
  }
  if (options.dryRun) {
    console.log("Dry run enabled. No files will be written.");
  }

  if (!(await exists(options.sessionsPath))) {
    console.error(`sessions.json not found at ${options.sessionsPath}`);
    process.exit(1);
  }

  const raw = await fs.readFile(options.sessionsPath, "utf8");
  const sessions = JSON.parse(raw) as Record<string, SessionEntry>;
  const entries = Object.entries(sessions).filter(([key]) => key.startsWith("agent:travel:"));

  let processed = 0;
  for (const [sessionKey, entry] of entries) {
    await importSession(options, sessionKey, entry);
    processed += 1;
  }

  console.log(`Done. Processed ${processed} travel session(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
