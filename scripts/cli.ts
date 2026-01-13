import fs from "fs/promises";
import path from "path";
import readline from "node:readline";
import WebSocket from "ws";

type Trip = { id: string; name: string; createdAt: string; updatedAt: string };
type Conversation = { id: string; tripId: string; title: string; createdAt: string; updatedAt: string };

type SessionTurn = { user: string };
type SessionInput = { turns: SessionTurn[] };

type TranscriptEvent = Record<string, unknown> & { type: string; timestamp: string };
type ResolvedTrip = { trip: Trip; created: boolean };

const DEFAULT_BASE_URL = process.env.TRAVEL_AGENT_URL || "http://localhost:3000";
const DEFAULT_PASSWORD = process.env.TRAVEL_AGENT_PASSWORD || "";

function nowIso(): string {
  return new Date().toISOString();
}

function cliTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function withSuffix(base: string, suffix: string): string {
  const trimmed = base.trim();
  return trimmed ? `${trimmed} (${suffix})` : suffix;
}

function toWsUrl(baseUrl: string): string {
  if (baseUrl.startsWith("https://")) return baseUrl.replace("https://", "wss://") + "/ws";
  if (baseUrl.startsWith("http://")) return baseUrl.replace("http://", "ws://") + "/ws";
  return "ws://localhost:3000/ws";
}

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function authHeader(password: string): string | null {
  if (!password) return null;
  return `Basic ${base64(`user:${password}`)}`;
}

function parseArgs(argv: string[]): { _: string[]; [key: string]: string | boolean | undefined } {
  const out: { _: string[]; [key: string]: string | boolean | undefined } = { _: [] };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        const key = arg.slice(2, eq);
        const value = arg.slice(eq + 1);
        out[key] = value;
        i += 1;
        continue;
      }
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i += 2;
        continue;
      }
      out[key] = true;
      i += 1;
      continue;
    }
    out._.push(arg);
    i += 1;
  }
  return out;
}

function flagEnabled(
  args: Record<string, string | boolean | undefined>,
  name: string,
  defaultValue: boolean,
): boolean {
  if (args[`no-${name}`]) return false;
  const value = args[name];
  if (value === undefined) return defaultValue;
  if (value === true) return true;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  }
  return defaultValue;
}

function emitJsonLine(payload: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

async function apiFetch<T>(baseUrl: string, password: string, endpoint: string, opts: RequestInit): Promise<T> {
  const headers = new Headers(opts.headers || {});
  const auth = authHeader(password);
  if (auth) headers.set("Authorization", auth);
  if (!headers.has("Content-Type") && opts.body && !(opts.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${baseUrl}${endpoint}`, { ...opts, headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text) as T;
  }
  return text as unknown as T;
}

async function listTrips(baseUrl: string, password: string): Promise<Trip[]> {
  return apiFetch<Trip[]>(baseUrl, password, "/api/trips", { method: "GET" });
}

async function createTrip(baseUrl: string, password: string, name: string): Promise<Trip> {
  return apiFetch<Trip>(baseUrl, password, "/api/trips", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

async function deleteTrip(baseUrl: string, password: string, tripId: string): Promise<void> {
  await apiFetch(baseUrl, password, `/api/trips/${tripId}`, { method: "DELETE" });
}

async function listTripsCommand(args: Record<string, string | boolean | undefined>): Promise<void> {
  const baseUrl = typeof args.url === "string" ? args.url : DEFAULT_BASE_URL;
  const password = typeof args.auth === "string" ? args.auth : DEFAULT_PASSWORD;
  const trips = await listTrips(baseUrl, password);
  emitJsonLine({ type: "trips", trips });
}

async function listConversations(baseUrl: string, password: string, tripId: string): Promise<Conversation[]> {
  return apiFetch<Conversation[]>(baseUrl, password, `/api/trips/${tripId}/conversations`, { method: "GET" });
}

async function deleteConversation(
  baseUrl: string,
  password: string,
  tripId: string,
  conversationId: string,
): Promise<void> {
  await apiFetch(baseUrl, password, `/api/trips/${tripId}/conversations/${conversationId}`, { method: "DELETE" });
}

async function createConversation(
  baseUrl: string,
  password: string,
  tripId: string,
  title: string,
): Promise<Conversation> {
  return apiFetch<Conversation>(baseUrl, password, `/api/trips/${tripId}/conversations`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

function normalizeTurnsFromArray(items: unknown[]): SessionTurn[] {
  const out: SessionTurn[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      out.push({ user: item });
      continue;
    }
    if (item && typeof item === "object") {
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.user === "string") {
        out.push({ user: candidate.user });
        continue;
      }
      if (typeof candidate.role === "string" && candidate.role === "user" && typeof candidate.content === "string") {
        out.push({ user: candidate.content });
        continue;
      }
      if (typeof candidate.type === "string" && candidate.type === "user" && typeof candidate.content === "string") {
        out.push({ user: candidate.content });
        continue;
      }
    }
  }
  return out;
}

async function resolveExistingTrip(
  baseUrl: string,
  password: string,
  args: Record<string, string | boolean | undefined>,
  rest: string[],
): Promise<Trip> {
  const tripId = typeof args["trip-id"] === "string" ? args["trip-id"] : rest[0];
  const tripName = typeof args.trip === "string" ? args.trip : undefined;
  const resolved = await resolveTrip(baseUrl, password, tripId, tripName, false, true);
  return resolved.trip;
}

async function deleteTripCommand(args: Record<string, string | boolean | undefined>, rest: string[]): Promise<void> {
  const baseUrl = typeof args.url === "string" ? args.url : DEFAULT_BASE_URL;
  const password = typeof args.auth === "string" ? args.auth : DEFAULT_PASSWORD;
  const trip = await resolveExistingTrip(baseUrl, password, args, rest);
  await deleteTrip(baseUrl, password, trip.id);
  emitJsonLine({ type: "trip_deleted", tripId: trip.id, name: trip.name });
}

async function listConversationsCommand(args: Record<string, string | boolean | undefined>, rest: string[]): Promise<void> {
  const baseUrl = typeof args.url === "string" ? args.url : DEFAULT_BASE_URL;
  const password = typeof args.auth === "string" ? args.auth : DEFAULT_PASSWORD;
  const trip = await resolveExistingTrip(baseUrl, password, args, rest);
  const conversations = await listConversations(baseUrl, password, trip.id);
  emitJsonLine({ type: "conversations", tripId: trip.id, conversations });
}

async function deleteConversationCommand(
  args: Record<string, string | boolean | undefined>,
  rest: string[],
): Promise<void> {
  const baseUrl = typeof args.url === "string" ? args.url : DEFAULT_BASE_URL;
  const password = typeof args.auth === "string" ? args.auth : DEFAULT_PASSWORD;
  const trip = await resolveExistingTrip(baseUrl, password, args, rest);
  const conversationId = typeof args["conversation-id"] === "string" ? args["conversation-id"] : rest[1];
  if (!conversationId) throw new Error("Missing --conversation-id");
  await deleteConversation(baseUrl, password, trip.id, conversationId);
  emitJsonLine({ type: "conversation_deleted", tripId: trip.id, conversationId });
}

function normalizeTurns(input: SessionInput | unknown): SessionTurn[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return normalizeTurnsFromArray(input);
  }
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.turns)) return normalizeTurnsFromArray(obj.turns);
    if (Array.isArray(obj.messages)) return normalizeTurnsFromArray(obj.messages);
  }
  return [];
}

async function readSessionInput(filePath: string): Promise<SessionTurn[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as SessionInput | unknown;
  const turns = normalizeTurns(parsed);
  if (turns.length === 0) {
    throw new Error("No turns found in session input.");
  }
  return turns;
}

function matchByName<T extends { name?: string; title?: string }>(items: T[], name: string): T | null {
  const needle = name.trim().toLowerCase();
  return items.find((item) => (item.name || item.title || "").trim().toLowerCase() === needle) || null;
}

async function resolveTrip(
  baseUrl: string,
  password: string,
  tripId: string | undefined,
  tripName: string | undefined,
  createIfMissing: boolean,
  reuseExisting: boolean,
): Promise<ResolvedTrip> {
  if (tripId) {
    const trips = await listTrips(baseUrl, password);
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) throw new Error(`Trip not found: ${tripId}`);
    return { trip, created: false };
  }
  if (!tripName) throw new Error("Missing --trip-id or --trip");
  const trips = await listTrips(baseUrl, password);
  const existing = matchByName(trips, tripName);
  if (existing && reuseExisting) return { trip: existing, created: false };
  if (!createIfMissing) {
    if (existing) {
      throw new Error(`Trip already exists: ${tripName}. Use --reuse-trip to reuse.`);
    }
    throw new Error(`Trip not found: ${tripName}`);
  }
  const name = existing && !reuseExisting ? withSuffix(tripName, `CLI ${cliTimestamp()}`) : tripName;
  const trip = await createTrip(baseUrl, password, name);
  return { trip, created: true };
}

async function resolveConversation(
  baseUrl: string,
  password: string,
  tripId: string,
  conversationId: string | undefined,
  conversationTitle: string | undefined,
  createIfMissing: boolean,
  reuseExisting: boolean,
): Promise<Conversation> {
  if (conversationId) {
    const conversations = await listConversations(baseUrl, password, tripId);
    const convo = conversations.find((c) => c.id === conversationId);
    if (!convo) throw new Error(`Conversation not found: ${conversationId}`);
    return convo;
  }
  const trimmedTitle = conversationTitle?.trim();
  if (!reuseExisting) {
    if (!createIfMissing) {
      throw new Error("Refusing to create a new conversation without --create. Use --reuse-conversation instead.");
    }
    const title = trimmedTitle || `CLI Session ${cliTimestamp()}`;
    return createConversation(baseUrl, password, tripId, title);
  }
  const title = trimmedTitle || "Planning";
  const conversations = await listConversations(baseUrl, password, tripId);
  const existing = matchByName(conversations, title);
  if (existing) return existing;
  if (!createIfMissing) {
    throw new Error(`Conversation not found: ${title}`);
  }
  return createConversation(baseUrl, password, tripId, title);
}

class TranscriptWriter {
  private handle: fs.FileHandle;
  private streamToStdout: boolean;
  private markdownPath?: string;
  private markdownLines: string[] = [];

  private constructor(handle: fs.FileHandle, streamToStdout: boolean, markdownPath?: string) {
    this.handle = handle;
    this.streamToStdout = streamToStdout;
    this.markdownPath = markdownPath;
    if (markdownPath) {
      this.markdownLines.push("# Session Transcript", "");
    }
  }

  static async create(outPath: string, streamToStdout: boolean, markdownPath?: string): Promise<TranscriptWriter> {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    if (markdownPath) {
      await fs.mkdir(path.dirname(markdownPath), { recursive: true });
    }
    const handle = await fs.open(outPath, "a");
    return new TranscriptWriter(handle, streamToStdout, markdownPath);
  }

  async write(event: TranscriptEvent): Promise<void> {
    const line = JSON.stringify(event) + "\n";
    await this.handle.write(line);
    if (this.streamToStdout) {
      process.stdout.write(line);
    }
    this.appendMarkdown(event);
  }

  private appendMarkdown(event: TranscriptEvent) {
    if (!this.markdownPath) return;
    if (event.type === "user" && typeof event.content === "string") {
      this.markdownLines.push(`## User (${event.timestamp})`, "", event.content, "");
      return;
    }
    if (event.type === "assistant_message" && typeof event.content === "string") {
      this.markdownLines.push(`## Assistant (${event.timestamp})`, "", event.content, "");
      return;
    }
    if (event.type === "tool_use") {
      const tool = event.tool as { name?: string; input?: unknown } | undefined;
      const name = tool?.name || "Tool";
      this.markdownLines.push(`## Tool Use: ${name} (${event.timestamp})`, "```json");
      this.markdownLines.push(JSON.stringify(tool?.input ?? {}, null, 2));
      this.markdownLines.push("```", "");
      return;
    }
    if (event.type === "tool_result") {
      const name = typeof event.tool_name === "string" && event.tool_name ? event.tool_name : "Tool";
      this.markdownLines.push(`## Tool Result: ${name} (${event.timestamp})`, "```json");
      this.markdownLines.push(JSON.stringify(event.content ?? {}, null, 2));
      this.markdownLines.push("```", "");
    }
  }

  async close(): Promise<void> {
    await this.handle.close();
    if (this.markdownPath) {
      await fs.writeFile(this.markdownPath, this.markdownLines.join("\n"), "utf8");
    }
  }
}

type PendingResult = { resolve: () => void; reject: (err: Error) => void };

class SessionClient {
  private ws: WebSocket;
  private tripId: string;
  private conversationId: string;
  private writer: TranscriptWriter;
  private pending: PendingResult[] = [];
  private closed = false;

  constructor(ws: WebSocket, tripId: string, conversationId: string, writer: TranscriptWriter) {
    this.ws = ws;
    this.tripId = tripId;
    this.conversationId = conversationId;
    this.writer = writer;
  }

  async sendChat(content: string): Promise<void> {
    if (this.closed) throw new Error("WebSocket closed");
    const resultPromise = new Promise<void>((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
    this.ws.send(JSON.stringify({ type: "chat", tripId: this.tripId, conversationId: this.conversationId, content }));
    return resultPromise;
  }

  async subscribe(): Promise<void> {
    if (this.closed) return;
    this.ws.send(JSON.stringify({ type: "subscribe", tripId: this.tripId, conversationId: this.conversationId }));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.ws.close();
  }

  async handleMessage(message: Record<string, unknown>): Promise<void> {
    const type = String(message.type || "");
    if (type === "assistant_partial" || type === "assistant_delta") {
      return;
    }
    const event: TranscriptEvent = {
      type,
      timestamp: typeof message.timestamp === "string" ? message.timestamp : nowIso(),
      ...message,
    };
    await this.writer.write(event);
    if (type === "result") {
      const tripId = message.tripId as string | undefined;
      const conversationId = message.conversationId as string | undefined;
      if (tripId === this.tripId && conversationId === this.conversationId) {
        const pending = this.pending.shift();
        if (pending) {
          if (message.success === false) {
            pending.reject(new Error(String(message.error || "Query failed")));
          } else {
            pending.resolve();
          }
        }
      }
    }
    if (type === "auth_failed" || type === "error") {
      const pending = this.pending.shift();
      if (pending) {
        pending.reject(new Error(String(message.error || "WebSocket error")));
      }
    }
  }
}

async function connectSessionClient(
  wsUrl: string,
  password: string,
  tripId: string,
  conversationId: string,
  writer: TranscriptWriter,
): Promise<SessionClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket timeout"));
    }, 10000);

    const session = new SessionClient(ws, tripId, conversationId, writer);

    ws.on("message", async (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw);
      } catch (err) {
        await writer.write({ type: "error", timestamp: nowIso(), error: "Invalid JSON from server" });
        return;
      }
      const type = String(msg.type || "");
      if (type === "auth_required") {
        await session.handleMessage(msg);
        if (!password) {
          clearTimeout(timeout);
          reject(new Error("Server requires auth; set --auth or TRAVEL_AGENT_PASSWORD."));
          return;
        }
        ws.send(JSON.stringify({ type: "auth", password }));
        return;
      }
      if (type === "connected") {
        clearTimeout(timeout);
        await session.handleMessage(msg);
        await session.subscribe();
        resolve(session);
        return;
      }
      if (type === "auth_failed") {
        clearTimeout(timeout);
        await session.handleMessage(msg);
        reject(new Error(String(msg.error || "Authentication failed")));
        return;
      }
      await session.handleMessage(msg);
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err instanceof Error ? err : new Error("WebSocket error"));
    });
  });
}

async function runSession(args: Record<string, string | boolean | undefined>): Promise<void> {
  const baseUrl = typeof args.url === "string" ? args.url : DEFAULT_BASE_URL;
  const password = typeof args.auth === "string" ? args.auth : DEFAULT_PASSWORD;
  const wsUrl = typeof args.ws === "string" ? args.ws : toWsUrl(baseUrl);
  const quiet = flagEnabled(args, "quiet", false);

  const inputPath = typeof args.input === "string" ? args.input : "";
  const message = typeof args.message === "string" ? args.message : "";
  if (!inputPath && !message) {
    throw new Error("Missing --input session file or --message");
  }

  const stream = flagEnabled(args, "stream", true);
  const outPath = typeof args.out === "string"
    ? args.out
    : path.join(process.cwd(), "debug", "transcripts", `session-${Date.now()}.jsonl`);
  const markdownPath = typeof args.markdown === "string" ? args.markdown : undefined;

  const turns = message ? [{ user: message }] : await readSessionInput(inputPath);

  const createIfMissing = flagEnabled(args, "create", true);
  const reuseTrip = flagEnabled(args, "reuse-trip", false) || !createIfMissing;
  const reuseConversation = flagEnabled(args, "reuse-conversation", false) || !createIfMissing;
  const cleanup = flagEnabled(args, "cleanup", true);

  const resolvedTrip = await resolveTrip(
    baseUrl,
    password,
    typeof args["trip-id"] === "string" ? args["trip-id"] : undefined,
    typeof args.trip === "string" ? args.trip : undefined,
    createIfMissing,
    reuseTrip,
  );
  const conversation = await resolveConversation(
    baseUrl,
    password,
    resolvedTrip.trip.id,
    typeof args["conversation-id"] === "string" ? args["conversation-id"] : undefined,
    typeof args.conversation === "string" ? args.conversation : undefined,
    createIfMissing,
    reuseConversation,
  );

  const writer = await TranscriptWriter.create(outPath, stream, markdownPath);
  await writer.write({
    type: "session_start",
    timestamp: nowIso(),
      tripId: resolvedTrip.trip.id,
      conversationId: conversation.id,
      input: inputPath || null,
      message: message || null,
      baseUrl,
  });

  let session: SessionClient | null = null;
  let success = false;
  let errorMessage: string | null = null;
  try {
    session = await connectSessionClient(wsUrl, password, resolvedTrip.trip.id, conversation.id, writer);
    for (const turn of turns) {
      const content = turn.user.trim();
      if (!content) continue;
      await writer.write({ type: "user", timestamp: nowIso(), content });
      await session.sendChat(content);
    }
    await writer.write({ type: "session_end", timestamp: nowIso(), success: true });
    success = true;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    await writer.write({ type: "session_end", timestamp: nowIso(), success: false, error: errorMessage });
    throw err;
  } finally {
    if (session) await session.close();
    const summary = {
      type: "session_summary",
      timestamp: nowIso(),
      tripId: resolvedTrip.trip.id,
      conversationId: conversation.id,
      transcriptPath: outPath,
      markdownPath: markdownPath ?? null,
      success,
      error: errorMessage ?? undefined,
    };
    await writer.write(summary);
    await writer.close();
    if (!stream) emitJsonLine(summary);
    if (cleanup && resolvedTrip.created) {
      try {
        await deleteTrip(baseUrl, password, resolvedTrip.trip.id);
      } catch (err) {
        if (!quiet) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Failed to delete trip ${resolvedTrip.trip.id}: ${message}`);
        }
      }
    }
  }
}

async function promptLine(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

async function replSession(args: Record<string, string | boolean | undefined>): Promise<void> {
  const baseUrl = typeof args.url === "string" ? args.url : DEFAULT_BASE_URL;
  const password = typeof args.auth === "string" ? args.auth : DEFAULT_PASSWORD;
  const wsUrl = typeof args.ws === "string" ? args.ws : toWsUrl(baseUrl);
  const quiet = flagEnabled(args, "quiet", false);

  const stream = flagEnabled(args, "stream", true);
  const outPath = typeof args.out === "string"
    ? args.out
    : path.join(process.cwd(), "debug", "transcripts", `session-${Date.now()}.jsonl`);
  const markdownPath = typeof args.markdown === "string" ? args.markdown : undefined;

  const createIfMissing = flagEnabled(args, "create", true);
  const reuseTrip = flagEnabled(args, "reuse-trip", false) || !createIfMissing;
  const reuseConversation = flagEnabled(args, "reuse-conversation", false) || !createIfMissing;
  const cleanup = flagEnabled(args, "cleanup", true);

  const resolvedTrip = await resolveTrip(
    baseUrl,
    password,
    typeof args["trip-id"] === "string" ? args["trip-id"] : undefined,
    typeof args.trip === "string" ? args.trip : undefined,
    createIfMissing,
    reuseTrip,
  );
  const conversation = await resolveConversation(
    baseUrl,
    password,
    resolvedTrip.trip.id,
    typeof args["conversation-id"] === "string" ? args["conversation-id"] : undefined,
    typeof args.conversation === "string" ? args.conversation : undefined,
    createIfMissing,
    reuseConversation,
  );

  const writer = await TranscriptWriter.create(outPath, stream, markdownPath);
  await writer.write({
    type: "session_start",
    timestamp: nowIso(),
      tripId: resolvedTrip.trip.id,
      conversationId: conversation.id,
      mode: "repl",
      baseUrl,
  });

  let session: SessionClient | null = null;
  let success = false;
  let errorMessage: string | null = null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    session = await connectSessionClient(wsUrl, password, resolvedTrip.trip.id, conversation.id, writer);
    if (!quiet) console.log("REPL started. Type /exit to quit.");
    const prompt = quiet ? "" : "> ";
    while (true) {
      const line = await promptLine(rl, prompt);
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "/exit" || trimmed === "/quit") break;
      await writer.write({ type: "user", timestamp: nowIso(), content: trimmed });
      await session.sendChat(trimmed);
    }
    await writer.write({ type: "session_end", timestamp: nowIso(), success: true });
    success = true;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    await writer.write({ type: "session_end", timestamp: nowIso(), success: false, error: errorMessage });
    throw err;
  } finally {
    rl.close();
    if (session) await session.close();
    const summary = {
      type: "session_summary",
      timestamp: nowIso(),
      tripId: resolvedTrip.trip.id,
      conversationId: conversation.id,
      transcriptPath: outPath,
      markdownPath: markdownPath ?? null,
      success,
      error: errorMessage ?? undefined,
    };
    await writer.write(summary);
    await writer.close();
    if (!stream) emitJsonLine(summary);
    if (cleanup && resolvedTrip.created) {
      try {
        await deleteTrip(baseUrl, password, resolvedTrip.trip.id);
      } catch (err) {
        if (!quiet) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Failed to delete trip ${resolvedTrip.trip.id}: ${message}`);
        }
      }
    }
  }
}

async function replaySession(filePath: string): Promise<void> {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  for (const line of lines) {
    let event: TranscriptEvent;
    try {
      event = JSON.parse(line) as TranscriptEvent;
    } catch {
      continue;
    }
    if (event.type === "user" && typeof event.content === "string") {
      console.log(`User: ${event.content}`);
      continue;
    }
    if (event.type === "assistant_message" && typeof event.content === "string") {
      console.log(`Assistant: ${event.content}`);
      continue;
    }
    if (event.type === "tool_use") {
      const tool = event.tool as { name?: string } | undefined;
      console.log(`Tool use: ${tool?.name || "Tool"}`);
      continue;
    }
    if (event.type === "tool_result") {
      const name = typeof event.tool_name === "string" && event.tool_name ? event.tool_name : "Tool";
      console.log(`Tool result: ${name}`);
      continue;
    }
  }
}

function printHelp(): void {
  console.log(`Usage:
  bun run cli trips list
  bun run cli trips delete --trip-id <id>
  bun run cli session run --input session.json [--trip-id <id> | --trip <name>] [--conversation-id <id> | --conversation <title>]
  bun run cli session run --message "Hello" [--trip-id <id> | --trip <name>] [--conversation-id <id> | --conversation <title>]
  bun run cli session repl [--trip-id <id> | --trip <name>] [--conversation-id <id> | --conversation <title>]
  bun run cli conversations list --trip-id <id>
  bun run cli conversations delete --trip-id <id> --conversation-id <id>
  bun run cli session replay <transcript.jsonl>

Options:
  --url <baseUrl>        Base URL (default: ${DEFAULT_BASE_URL})
  --ws <wsUrl>           WebSocket URL override
  --auth <password>      Password for Basic auth (or TRAVEL_AGENT_PASSWORD env)
  --trip-id <id>         Trip id for list/delete or session selection
  --trip <name>          Trip name for session selection (use --reuse-trip to reuse)
  --conversation-id <id> Conversation id for session selection or deletion
  --conversation <title> Conversation title for session selection
  --message <text>       Single user message (skip --input)
  --out <path>           Transcript JSONL output path
  --markdown <path>      Optional markdown transcript output path
  --stream/--no-stream   Echo transcript events to stdout (default: on)
  --quiet                Suppress non-JSON output
  --create/--no-create   Allow creating trips/conversations (default: true)
  --reuse-trip           Reuse an existing trip when a matching name exists
  --reuse-conversation   Reuse an existing conversation when a matching title exists
  --cleanup/--no-cleanup Delete trips created by the CLI after the session (default: true)

Environment:
  TRAVEL_AGENT_URL       Base URL (default: ${DEFAULT_BASE_URL})
  TRAVEL_AGENT_PASSWORD  Password for Basic auth
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const quiet = flagEnabled(args, "quiet", false);
  const [command, subcommand, ...rest] = args._;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "trips" && subcommand === "list") {
    await listTripsCommand(args);
    return;
  }

  if (command === "trips" && subcommand === "delete") {
    await deleteTripCommand(args, rest);
    return;
  }

  if (command === "conversations" && subcommand === "list") {
    await listConversationsCommand(args, rest);
    return;
  }

  if (command === "conversations" && subcommand === "delete") {
    await deleteConversationCommand(args, rest);
    return;
  }

  if (command === "session" && subcommand === "run") {
    await runSession(args);
    return;
  }

  if (command === "session" && subcommand === "repl") {
    await replSession(args);
    return;
  }

  if (command === "session" && subcommand === "replay") {
    const filePath = rest[0];
    if (!filePath) throw new Error("Missing transcript path");
    await replaySession(filePath);
    return;
  }

  if (!quiet) printHelp();
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (flagEnabled(parseArgs(process.argv.slice(2)), "quiet", false)) {
    emitJsonLine({ type: "error", message });
  } else {
    console.error(message);
  }
  process.exit(1);
});
