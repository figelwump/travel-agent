import type { WSClient } from "./ws-types";
import { AgentClient } from "../agentsdk/agent-client";
import { createSdkMcpServer, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as storage from "./storage";
import * as fs from "fs/promises";
import { createTripTools } from "./tools";
import { logTs } from "./log";
import { checkTitleEligibility, generateTitle } from "./title-generator";

function createTripMcpServer(
  tripId: string,
  options?: {
    includeReadItinerary?: boolean;
    includeReadContext?: boolean;
    includeReadGlobalContext?: boolean;
  },
) {
  // Short name "t" to keep tool name prefixes short
  const includeReadItinerary = options?.includeReadItinerary ?? true;
  const includeReadContext = options?.includeReadContext ?? true;
  const includeReadGlobalContext = options?.includeReadGlobalContext ?? true;
  const tripTools = createTripTools(tripId).filter((tool) => {
    if (!includeReadItinerary && tool.name === "read_itinerary") return false;
    if (!includeReadContext && tool.name === "read_context") return false;
    if (!includeReadGlobalContext && tool.name === "read_global_context") return false;
    return true;
  });
  return createSdkMcpServer({
    name: "t",
    tools: tripTools,
  });
}

const ALLOWED_TRIP_TOOLS = [
  "Task",
  "mcp__entity-tools__read_itinerary",
  "mcp__entity-tools__update_itinerary",
  "mcp__entity-tools__generate_trip_map",
  "mcp__entity-tools__read_context",
  "mcp__entity-tools__update_context",
  "mcp__entity-tools__read_global_context",
  "mcp__entity-tools__update_global_context",
  "mcp__entity-tools__toggle_todo",
  "mcp__entity-tools__create_scheduled_task",
  "mcp__entity-tools__list_scheduled_tasks",
  "mcp__entity-tools__update_scheduled_task",
  "mcp__entity-tools__delete_scheduled_task",
  "WebSearch",
  "WebFetch",
  "Skill",
];

function shouldAllowReadItinerary(message: string, itineraryTruncated: boolean): boolean {
  if (itineraryTruncated) return true;
  const normalized = message.toLowerCase();
  return /\b(read|show|view|review)\b.*\bitinerary\b/.test(normalized)
    || /\b(itinerary)\b.*\b(read|show|view|review)\b/.test(normalized)
    || /\bwhat(?:'s| is) in (?:my|the) itinerary\b/.test(normalized)
    || /\bcurrent itinerary\b/.test(normalized);
}

function shouldAllowReadContext(message: string, contextTruncated: boolean): boolean {
  if (contextTruncated) return true;
  const normalized = message.toLowerCase();
  return /\b(read|show|view|review)\b.*\bcontext\b/.test(normalized)
    || /\b(context)\b.*\b(read|show|view|review)\b/.test(normalized)
    || /\bwhat(?:'s| is) in (?:my|the) context\b/.test(normalized)
    || /\bcurrent context\b/.test(normalized);
}

function shouldAllowReadGlobalContext(message: string, globalContextTruncated: boolean): boolean {
  if (globalContextTruncated) return true;
  const normalized = message.toLowerCase();
  return /\b(read|show|view|review)\b.*\b(global context|profile|preferences)\b/.test(normalized)
    || /\b(global context|profile|preferences)\b.*\b(read|show|view|review)\b/.test(normalized)
    || /\bwhat(?:'s| is) in (?:my|the) global context\b/.test(normalized)
    || /\btravel profile\b/.test(normalized);
}

function selectAllowedTripTools(
  message: string,
  itineraryTruncated: boolean,
  contextTruncated: boolean,
  globalContextTruncated: boolean,
): string[] {
  const normalized = message.toLowerCase();
  const mentionsItinerary = /\b(itinerary|schedule|day\s+\d+)\b/.test(normalized);
  const mentionsContext = /\b(context|preferences?|bookings?|confirmations?)\b/.test(normalized);
  const allowReadItinerary = shouldAllowReadItinerary(message, itineraryTruncated);
  const allowReadContext = shouldAllowReadContext(message, contextTruncated);
  const allowReadGlobalContext = shouldAllowReadGlobalContext(message, globalContextTruncated);

  return ALLOWED_TRIP_TOOLS.filter((tool) => {
    if (mentionsItinerary && !mentionsContext && tool === "mcp__entity-tools__update_context") return false;
    if (!allowReadItinerary && tool === "mcp__entity-tools__read_itinerary") return false;
    if (!allowReadContext && tool === "mcp__entity-tools__read_context") return false;
    if (!allowReadGlobalContext && tool === "mcp__entity-tools__read_global_context") return false;
    return true;
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function createTextBroadcast(type: string, payload: Record<string, unknown>) {
  return JSON.stringify({ type, ...payload });
}

function joinAssistantText(message: any): string {
  const content = message?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("");
  }
  return "";
}

function normalizeToolName(name: string): string {
  if (name.startsWith("mcp__")) {
    const parts = name.split("__");
    return parts.length >= 3 ? parts.slice(2).join("__") : name;
  }
  return name;
}

function sanitizeAssistantText(text: string): string {
  let result = text
    // Remove complete XML tool tags
    .replace(/<antthinking>[\s\S]*?<\/antthinking>/gi, "")
    .replace(/<anthinking>[\s\S]*?<\/anthinking>/gi, "")
    .replace(/<write_file>[\s\S]*?<\/write_file>/gi, "")
    .replace(/<read_file>[\s\S]*?<\/read_file>/gi, "")
    .replace(/<edit_file>[\s\S]*?<\/edit_file>/gi, "")
    .replace(/<multi_edit>[\s\S]*?<\/multi_edit>/gi, "")
    .replace(/<execute>[\s\S]*?<\/execute>/gi, "")
    .replace(/<tool>[\s\S]*?<\/tool>/gi, "")
    .replace(/<path>[\s\S]*?<\/path>/gi, "")
    .replace(/<content>[\s\S]*?<\/content>/gi, "")
    .replace(/<result>[\s\S]*?<\/result>/gi, "")
    .replace(/<scratchpad>[\s\S]*?<\/scratchpad>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    // Remove incomplete/streaming XML tags at end of text
    .replace(/<(?:antthinking|anthinking|write_file|read_file|edit_file|multi_edit|execute|tool|path|content|result|scratchpad|thinking)[^>]*$/i, "")
    // Remove stray closing tags
    .replace(/<\/(?:antthinking|anthinking|write_file|read_file|edit_file|multi_edit|execute|tool|path|content|result|scratchpad|thinking)>/gi, "")
    // Clean up whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return result;
}

function generateTitleFromMessage(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Chat";
  const words = cleaned
    .split(" ")
    .map((word) => word.replace(/^[^\w]+|[^\w]+$/g, ""))
    .filter(Boolean);
  const title = words.slice(0, 6).join(" ").trim();
  return title ? title.slice(0, 80) : "Chat";
}

type ConversationSessionParams = {
  tripId: string;
  conversationId: string;
};

export class ConversationSession {
  public readonly tripId: string;
  public readonly conversationId: string;

  private subscribers: Set<WSClient> = new Set();
  private queryPromise: Promise<void> | null = null;
  private agentClient = new AgentClient();
  private sdkSessionId: string | null = null;
  private partialTextBuffer: string | null = null;
  private abortController: AbortController | null = null;
  private cancelRequested = false;
  private resultSent = false;
  private itineraryMtimeBeforeQuery: number | null = null;
  private itineraryUpdatedDuringQuery = false;
  private activeModel: string | null = null;
  private lastUserMessage: string | null = null;
  private activeAllowedTools: Set<string> | null = null;
  private pendingToolActivity = new Map<string, {
    id: string;
    name: string;
    input: Record<string, unknown>;
    status: "running" | "complete";
    startedAt: string;
    completedAt?: string;
  }>();
  private titleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private titleGenerationInFlight = false;
  private toolTimings = new Map<string, {
    id: string;
    name: string;
    startedAt: string;
    startedAtMs: number;
    inputReadyAt?: string;
    inputReadyAtMs?: number;
    inputBytes?: number;
    contentChars?: number;
    streamedStart?: boolean;
  }>();
  private handledToolResults = new Set<string>();
  private mcpServer: ReturnType<typeof createSdkMcpServer>;
  // Track the client that initiated the current query so we can send them the result
  // even if they switch to a different conversation
  private queryInitiator: WSClient | null = null;

  constructor({ tripId, conversationId }: ConversationSessionParams) {
    this.tripId = tripId;
    this.conversationId = conversationId;
    this.mcpServer = createTripMcpServer(tripId);
  }

  subscribe(client: WSClient) {
    this.subscribers.add(client);
    client.send(
      JSON.stringify({
        type: "session_info",
        tripId: this.tripId,
        conversationId: this.conversationId,
        isActive: this.queryPromise !== null,
      }),
    );
  }

  unsubscribe(client: WSClient) {
    this.subscribers.delete(client);
  }

  endConversation() {
    this.sdkSessionId = null;
    this.queryPromise = null;
  }

  cancelActiveQuery(): void {
    if (!this.queryPromise || !this.abortController || this.resultSent) return;
    this.cancelRequested = true;
    this.abortController.abort();
    this.pendingToolActivity.clear();
    this.toolTimings.clear();
    this.handledToolResults.clear();
    this.resultSent = true;
    this.broadcastResult({
      type: "result",
      success: false,
      error: "cancelled",
      tripId: this.tripId,
      conversationId: this.conversationId,
    });
  }

  private broadcast(message: any) {
    const msgStr = JSON.stringify(message);
    for (const client of this.subscribers) {
      try {
        client.send(msgStr);
      } catch (err) {
        console.error("Error broadcasting to client:", err);
        this.subscribers.delete(client);
      }
    }
  }

  // Broadcast result message, also sending to the query initiator if they're no longer subscribed
  private broadcastResult(message: any) {
    const msgStr = JSON.stringify(message);
    const sentTo = new Set<WSClient>();

    // Send to all current subscribers
    for (const client of this.subscribers) {
      try {
        client.send(msgStr);
        sentTo.add(client);
      } catch (err) {
        console.error("Error broadcasting to client:", err);
        this.subscribers.delete(client);
      }
    }

    // Also send to the query initiator if they switched to a different conversation
    if (this.queryInitiator && !sentTo.has(this.queryInitiator)) {
      try {
        this.queryInitiator.send(msgStr);
      } catch (err) {
        console.error("Error sending result to query initiator:", err);
      }
    }

    // Clear the initiator after sending result
    this.queryInitiator = null;
  }

  private isToolAllowedForSession(toolName?: string | null): boolean {
    if (!toolName) return true;
    if (!this.activeAllowedTools) return true;
    return this.activeAllowedTools.has(toolName);
  }

  private broadcastError(error: string) {
    this.broadcast({ type: "error", error, tripId: this.tripId, conversationId: this.conversationId });
  }

  private async getItineraryMtime(): Promise<number | null> {
    try {
      const itineraryPath = `${storage.travelAgentHome()}/trips/${this.tripId}/itinerary.md`;
      const stat = await fs.stat(itineraryPath);
      return stat.mtimeMs;
    } catch {
      return null;
    }
  }

  private async checkAndBroadcastItineraryChange(): Promise<void> {
    if (this.itineraryUpdatedDuringQuery) {
      this.itineraryUpdatedDuringQuery = false;
      this.itineraryMtimeBeforeQuery = null;
      return;
    }
    const currentMtime = await this.getItineraryMtime();
    if (this.itineraryMtimeBeforeQuery === null) {
      if (currentMtime !== null) {
        this.broadcast({ type: "itinerary_updated", tripId: this.tripId });
      }
      this.itineraryMtimeBeforeQuery = null;
      return;
    }
    if (currentMtime !== null && currentMtime !== this.itineraryMtimeBeforeQuery) {
      this.broadcast({ type: "itinerary_updated", tripId: this.tripId });
    }
    this.itineraryMtimeBeforeQuery = null;
  }

  private async ensureConversationLoaded(): Promise<void> {
    if (this.sdkSessionId) return;
    const meta = await storage.getConversation(this.tripId, this.conversationId);
    if (meta?.sdkSessionId) this.sdkSessionId = meta.sdkSessionId;
  }

  private async buildTripContextPrompt(): Promise<{
    prompt: string;
    itineraryTruncated: boolean;
    contextTruncated: boolean;
    globalContextTruncated: boolean;
    tripName: string;
    itinerarySnapshot: string;
    contextSnapshot: string;
    globalContextSnapshot: string;
  }> {
    const trip = await storage.getTrip(this.tripId);
    const tripName = trip?.name ?? "Unnamed";
    const itinerary = await storage.readItinerary(this.tripId);
    const context = await storage.readContext(this.tripId);
    const globalContext = await storage.readGlobalContext();
    const todoMatches = itinerary.match(/- \\[ \\]/g) || [];
    const doneMatches = itinerary.match(/- \\[x\\]/gi) || [];
    const itineraryTrimmed = itinerary.trim();
    const contextTrimmed = context.trim();
    const globalContextTrimmed = globalContext.trim();
    const maxItineraryChars = 12000;
    const maxContextChars = 8000;
    const maxGlobalContextChars = 8000;
    const itineraryTruncated = itineraryTrimmed.length > maxItineraryChars;
    const contextTruncated = contextTrimmed.length > maxContextChars;
    const globalContextTruncated = globalContextTrimmed.length > maxGlobalContextChars;
    const itineraryInstruction = itineraryTruncated
      ? "The itinerary below is truncated. Call read_itinerary only if you need the full version."
      : "The full itinerary is provided below and has already been read. Do NOT call read_itinerary or mention reading it. Do not use filesystem tools to fetch it.";
    const contextInstruction = contextTruncated
      ? "The context below is truncated. Call read_context only if you need the full version."
      : "The full context is provided below. Do NOT call read_context or mention reading it.";
    const globalContextInstruction = globalContextTruncated
      ? "The global context below is truncated. Call read_global_context only if you need the full version."
      : "The full global context is provided below. Do NOT call read_global_context or mention reading it.";
    const itinerarySnapshot = itineraryTrimmed
      ? itineraryTrimmed.length > maxItineraryChars
        ? `${itineraryTrimmed.slice(0, maxItineraryChars)}\n\n[Itinerary truncated; call read_itinerary for full details.]`
        : itineraryTrimmed
      : "(empty)";
    const contextSnapshot = contextTrimmed
      ? contextTrimmed.length > maxContextChars
        ? `${contextTrimmed.slice(0, maxContextChars)}\n\n[Context truncated; call read_context for full details.]`
        : contextTrimmed
      : "(empty)";
    const globalContextSnapshot = globalContextTrimmed
      ? globalContextTrimmed.length > maxGlobalContextChars
        ? `${globalContextTrimmed.slice(0, maxGlobalContextChars)}\n\n[Global context truncated; call read_global_context for full details.]`
        : globalContextTrimmed
      : "(empty)";

    const prompt = [
      `## CRITICAL: Active trip is already selected`,
      `Active trip: ${tripName} (${this.tripId}).`,
      `Do NOT ask which trip the user wants or offer to create a new trip.`,
      `Use the Current Itinerary and Known Context below for this trip.`,
      ``,
      `## YOUR TRIP ID (current trip): ${this.tripId}`,
      ``,
      `Trip Name: ${tripName}`,
      `Pending TODOs: ${todoMatches.length} | Completed: ${doneMatches.length}`,
      ``,
      `Trip tools are already scoped to this trip. Do not ask for the trip ID or pass tripId in tool inputs.`,
      `The current itinerary is included below.`,
      itineraryInstruction,
      `The current context is included below.`,
      contextInstruction,
      `The global context is included below.`,
      globalContextInstruction,
      `Trip-specific context overrides global context when they conflict.`,
      `Tool availability for this request:`,
      `- read_itinerary: ${itineraryTruncated ? "ENABLED (itinerary truncated)" : "DISABLED (full itinerary already provided)"}`,
      `- read_context: ${contextTruncated ? "ENABLED (context truncated)" : "DISABLED (full context already provided)"}`,
      `- read_global_context: ${globalContextTruncated ? "ENABLED (global context truncated)" : "DISABLED (full global context already provided)"}`,
      `Do not call any tool marked DISABLED.`,
      ``,
      `---`,
      ``,
      `**Current Itinerary:**`,
      itinerarySnapshot,
      ``,
      `**Known Context:**`,
      contextSnapshot,
      ``,
      `**Global Context:**`,
      globalContextSnapshot,
    ].join("\n");

    return {
      prompt,
      itineraryTruncated,
      contextTruncated,
      globalContextTruncated,
      tripName,
      itinerarySnapshot,
      contextSnapshot,
      globalContextSnapshot,
    };
  }

  private isDefaultTitle(title?: string | null): boolean {
    if (!title) return true;
    const normalized = title.trim().toLowerCase();
    return normalized === "chat" || normalized === "planning" || normalized === "question";
  }

  private async maybeUpdateConversationTitle(): Promise<void> {
    if (!this.lastUserMessage) return;
    const meta = await storage.getConversation(this.tripId, this.conversationId);
    if (!meta || !this.isDefaultTitle(meta.title)) return;
    const title = generateTitleFromMessage(this.lastUserMessage);
    if (this.isDefaultTitle(title) || title === meta.title) return;
    await storage.updateConversation(this.tripId, this.conversationId, { title });
  }

  private scheduleTitleGeneration(): void {
    // Clear any existing debounce timer
    if (this.titleDebounceTimer) {
      clearTimeout(this.titleDebounceTimer);
      this.titleDebounceTimer = null;
    }

    // Don't schedule if a query is in flight or title generation is already running
    if (this.queryPromise || this.titleGenerationInFlight) {
      logTs(`[TitleGeneration] Not scheduling: queryInFlight=${!!this.queryPromise} titleInFlight=${this.titleGenerationInFlight}`);
      return;
    }

    logTs(`[TitleGeneration] Scheduling title generation in 15 seconds for ${this.conversationId}`);

    // Debounce: wait 15 seconds before generating
    this.titleDebounceTimer = setTimeout(() => {
      this.titleDebounceTimer = null;
      logTs(`[TitleGeneration] Timer fired, running title generation`);
      this.runTitleGeneration().catch((err) => {
        console.error("[TitleGeneration] Background error:", err);
      });
    }, 15000);
  }

  private async runTitleGeneration(): Promise<void> {
    // Don't run if query started during debounce
    if (this.queryPromise) {
      return;
    }

    this.titleGenerationInFlight = true;
    try {
      const meta = await storage.getConversation(this.tripId, this.conversationId);
      if (!meta) return;

      const messages = await storage.readMessages(this.tripId, this.conversationId, 10);
      const eligibility = checkTitleEligibility(meta.title, meta.titleSource, messages);

      if (!eligibility.eligible) {
        logTs(`[TitleGeneration] Skipped: ${eligibility.reason}`);
        return;
      }

      const trip = await storage.getTrip(this.tripId);
      const tripName = trip?.name ?? "Trip";

      logTs(`[TitleGeneration] Generating title for conversation ${this.conversationId}`);
      const newTitle = await generateTitle(tripName, messages, this.agentClient);

      if (!newTitle) {
        logTs("[TitleGeneration] No title returned");
        return;
      }

      // Re-check meta in case user renamed during generation
      const freshMeta = await storage.getConversation(this.tripId, this.conversationId);
      if (freshMeta?.titleSource === "user") {
        logTs("[TitleGeneration] User renamed during generation, skipping update");
        return;
      }

      await storage.updateConversation(this.tripId, this.conversationId, {
        title: newTitle,
        titleSource: "auto",
        titleUpdatedAt: new Date().toISOString(),
      });

      logTs(`[TitleGeneration] Updated title to: ${newTitle}`);

      // Broadcast title update to connected clients
      this.broadcast({
        type: "conversation_title_updated",
        conversationId: this.conversationId,
        title: newTitle,
        tripId: this.tripId,
      });
    } finally {
      this.titleGenerationInFlight = false;
    }
  }

  private handleStreamEvent(event: any) {
    const eventType = event?.type;
    switch (eventType) {
      case "message_start":
        this.partialTextBuffer = "";
        break;
      case "content_block_start":
        if (event?.content_block?.type === "text") {
          if (this.partialTextBuffer === null) this.partialTextBuffer = "";
        } else if (event?.content_block?.type === "tool_use") {
          // Immediately broadcast that a tool is being called, even before input is complete
          const toolBlock = event.content_block;
          if (!this.isToolAllowedForSession(toolBlock?.name)) return;
          this.trackToolStart({ id: toolBlock.id, name: toolBlock.name }, true);
          this.broadcast({
            type: "tool_use_start",
            tool: {
              id: toolBlock.id,
              name: toolBlock.name,
            },
            timestamp: nowIso(),
            tripId: this.tripId,
            conversationId: this.conversationId,
          });
          // Track the tool as running
          this.recordToolUse({
            id: toolBlock.id,
            name: toolBlock.name,
            input: {},
          });
        }
        break;
      case "content_block_delta":
        if (
          this.partialTextBuffer !== null &&
          event?.delta?.type === "text_delta" &&
          typeof event?.delta?.text === "string"
        ) {
          this.partialTextBuffer += event.delta.text;
          // Sanitize streaming output to remove XML tool tags that shouldn't be shown
          const sanitized = sanitizeAssistantText(this.partialTextBuffer);
          this.broadcast({
            type: "assistant_partial",
            content: sanitized,
            tripId: this.tripId,
            conversationId: this.conversationId,
          });
        }
        break;
      case "message_stop":
        this.partialTextBuffer = null;
        break;
      default:
        break;
    }
  }

  private broadcastToolUse(tool: any) {
    if (!tool?.id || !tool?.name) return;
    if (!this.isToolAllowedForSession(tool.name)) return;
    this.broadcast({
      type: "tool_use",
      tool,
      timestamp: nowIso(),
      tripId: this.tripId,
      conversationId: this.conversationId,
    });
  }

  private broadcastToolResult(result: any) {
    const toolUseId = result?.tool_use_id;
    if (!toolUseId) return;
    const toolName = result?.name ?? result?.tool_name ?? null;
    if (toolName && !this.isToolAllowedForSession(toolName)) return;
    this.broadcast({
      type: "tool_result",
      tool_use_id: toolUseId,
      tool_name: toolName,
      content: result?.content ?? "",
      is_error: Boolean(result?.is_error),
      timestamp: nowIso(),
      tripId: this.tripId,
      conversationId: this.conversationId,
    });
  }

  private recordToolUse(tool: any) {
    if (!tool?.id || !tool?.name) return;
    if (!this.isToolAllowedForSession(tool.name)) return;
    if (this.pendingToolActivity.has(tool.id)) return;
    this.pendingToolActivity.set(tool.id, {
      id: tool.id,
      name: tool.name,
      input: tool.input ?? {},
      status: "running",
      startedAt: nowIso(),
    });
  }

  private trackToolStart(tool: { id?: string; name?: string }, streamedStart: boolean): void {
    if (!tool?.id) return;
    const existing = this.toolTimings.get(tool.id);
    if (existing) {
      if (streamedStart) existing.streamedStart = true;
      if (tool.name && !existing.name) existing.name = tool.name;
      return;
    }
    const startedAtMs = Date.now();
    const entry = {
      id: tool.id,
      name: tool.name ?? "Tool",
      startedAt: nowIso(),
      startedAtMs,
      streamedStart,
    };
    this.toolTimings.set(tool.id, entry);
    logTs(`[ToolStart] id=${entry.id} name=${entry.name} streamed=${streamedStart ? "true" : "false"}`);
  }

  private extractContentChars(input: Record<string, unknown>): number | null {
    const candidates = [
      input.content,
      input.new_content,
      input.text,
      input.value,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string") return candidate.length;
      if (Array.isArray(candidate)) {
        const text = candidate
          .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>).text : null))
          .filter((item): item is string => typeof item === "string")
          .join("");
        if (text) return text.length;
      }
      if (candidate && typeof candidate === "object") {
        const nested = candidate as Record<string, unknown>;
        const nestedText = typeof nested.content === "string" ? nested.content
          : typeof nested.text === "string" ? nested.text
          : typeof nested.value === "string" ? nested.value
          : null;
        if (nestedText) return nestedText.length;
      }
    }
    return null;
  }

  private trackToolInput(tool: { id?: string; name?: string; input?: Record<string, unknown> }): void {
    if (!tool?.id) return;
    const input = tool.input ?? {};
    const inputJson = (() => {
      try {
        return JSON.stringify(input);
      } catch {
        return null;
      }
    })();
    const inputBytes = inputJson ? Buffer.byteLength(inputJson, "utf8") : undefined;
    const contentChars = this.extractContentChars(input);
    const nowMs = Date.now();
    const existing = this.toolTimings.get(tool.id);
    if (existing) {
      if (!existing.inputReadyAtMs) {
        existing.inputReadyAtMs = nowMs;
        existing.inputReadyAt = nowIso();
      }
      if (inputBytes !== undefined) existing.inputBytes = inputBytes;
      if (contentChars !== null) existing.contentChars = contentChars;
      if (tool.name && !existing.name) existing.name = tool.name;
    } else {
      this.toolTimings.set(tool.id, {
        id: tool.id,
        name: tool.name ?? "Tool",
        startedAt: nowIso(),
        startedAtMs: nowMs,
        inputReadyAt: nowIso(),
        inputReadyAtMs: nowMs,
        inputBytes,
        contentChars: contentChars ?? undefined,
        streamedStart: false,
      });
    }
    const labelName = tool.name ?? existing?.name ?? "Tool";
    const sizeLabel = inputBytes !== undefined ? `${inputBytes}b` : "?";
    const contentLabel = contentChars !== null ? `${contentChars} chars` : "?";
    logTs(`[ToolInput] id=${tool.id} name=${labelName} bytes=${sizeLabel} content=${contentLabel}`);
  }

  private logToolEnd(result: any): void {
    const toolUseId = result?.tool_use_id;
    if (!toolUseId) return;
    const timing = this.toolTimings.get(toolUseId);
    const endMs = Date.now();
    const isError = Boolean(result?.is_error || result?.isError);
    const toolName = result?.name ?? result?.tool_name ?? timing?.name ?? "Tool";
    const totalMs = timing ? endMs - timing.startedAtMs : null;
    const generationMs = timing?.inputReadyAtMs ? timing.inputReadyAtMs - timing.startedAtMs : null;
    const executionMs = timing?.inputReadyAtMs ? endMs - timing.inputReadyAtMs : null;
    const inputBytes = timing?.inputBytes;
    const contentChars = timing?.contentChars;
    const formatMs = (value: number | null) => (value === null ? "?" : `${Math.round(value)}ms`);
    const formatSize = (value?: number) => (value === undefined ? "?" : `${value}b`);
    const formatChars = (value?: number) => (value === undefined ? "?" : `${value} chars`);
    logTs(`[ToolEnd] id=${toolUseId} name=${toolName} error=${isError ? "true" : "false"} total=${formatMs(totalMs)} gen=${formatMs(generationMs)} exec=${formatMs(executionMs)} bytes=${formatSize(inputBytes)} content=${formatChars(contentChars)}`);
    this.toolTimings.delete(toolUseId);
  }

  private handleToolResultPayload(result: any): void {
    const toolUseId = result?.tool_use_id;
    if (!toolUseId || this.handledToolResults.has(toolUseId)) return;
    this.handledToolResults.add(toolUseId);
    this.recordToolResult(result);
    this.handleToolResultSideEffects(result);
    this.logToolEnd(result);
    this.broadcastToolResult(result);
  }

  private recordToolResult(result: any) {
    const toolUseId = result?.tool_use_id;
    if (!toolUseId) return;
    const toolName = result?.name ?? result?.tool_name ?? null;
    if (toolName && !this.isToolAllowedForSession(toolName)) return;
    const existing = this.pendingToolActivity.get(toolUseId);
    if (existing) {
      existing.status = "complete";
      existing.completedAt = nowIso();
      return;
    }
    this.pendingToolActivity.set(toolUseId, {
      id: toolUseId,
      name: result?.name ?? result?.tool_name ?? "Tool",
      input: {},
      status: "complete",
      startedAt: nowIso(),
      completedAt: nowIso(),
    });
  }

  private handleToolResultSideEffects(result: any) {
    const toolUseId = result?.tool_use_id;
    if (!toolUseId) return;
    const activity = this.pendingToolActivity.get(toolUseId);
    const toolName = normalizeToolName(result?.name ?? result?.tool_name ?? activity?.name ?? "");
    const isError = Boolean(result?.is_error || result?.isError);
    if (!toolName || isError) return;
    if (toolName === "update_context") {
      this.broadcast({ type: "context_updated", tripId: this.tripId });
      return;
    }
    if (toolName === "update_itinerary") {
      this.itineraryUpdatedDuringQuery = true;
      this.broadcast({
        type: "itinerary_updated",
        tripId: this.tripId,
        source: "tool_result",
        immediate: true,
      });
    }
  }

  async addUserMessage(content: string, initiator?: WSClient): Promise<void> {
    if (this.queryPromise) await this.queryPromise;
    await this.ensureConversationLoaded();
    this.lastUserMessage = content;
    // Track who initiated this query so we can send them the result even if they switch chats
    this.queryInitiator = initiator ?? null;

    logTs(`\n${"=".repeat(60)}`);
    logTs(`[UserMessage] tripId=${this.tripId} convId=${this.conversationId}`);
    logTs(`[UserMessage] content: ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`);

    const userMsg: storage.StoredMessage = {
      id: crypto.randomUUID(),
      type: "user",
      content,
      timestamp: nowIso(),
    };
    await storage.appendMessage(this.tripId, this.conversationId, userMsg);
    this.broadcast({ type: "user_message", content, tripId: this.tripId, conversationId: this.conversationId });

    // Track itinerary mtime to detect changes made by agent tools
    this.itineraryMtimeBeforeQuery = await this.getItineraryMtime();

    this.queryPromise = (async () => {
      this.cancelRequested = false;
      this.resultSent = false;
      let querySucceeded = false;
      const abortController = new AbortController();
      this.abortController = abortController;
      try {
        const ctxPrompt = await this.buildTripContextPrompt();
        logTs(`[TripContext]\n${ctxPrompt.prompt}`);
        const options = this.sdkSessionId ? { resume: this.sdkSessionId } : {};

        const allowReadItinerary = shouldAllowReadItinerary(content, ctxPrompt.itineraryTruncated);
        const allowReadContext = shouldAllowReadContext(content, ctxPrompt.contextTruncated);
        const allowReadGlobalContext = shouldAllowReadGlobalContext(content, ctxPrompt.globalContextTruncated);
        const allowedTools = selectAllowedTripTools(
          content,
          ctxPrompt.itineraryTruncated,
          ctxPrompt.contextTruncated,
          ctxPrompt.globalContextTruncated,
        );
        const resolvedModel = this.agentClient.getDefaultModel();
        this.activeModel = resolvedModel;
        logTs(`[AgentQuery] Starting query, resume=${!!this.sdkSessionId}, model=${resolvedModel}`);
        const modelPrompt = [
          `Trip already selected: ${ctxPrompt.tripName} (${this.tripId}).`,
          `Do NOT ask which trip or offer to create a new trip.`,
          `Use the itinerary, trip context, and global context below for this request.`,
          ``,
          `Current Itinerary:`,
          ctxPrompt.itinerarySnapshot,
          ``,
          `Known Context:`,
          ctxPrompt.contextSnapshot,
          ``,
          `Global Context:`,
          ctxPrompt.globalContextSnapshot,
          ``,
          `User request: ${content}`,
        ].join("\n");
        const mcpServer = allowReadItinerary && allowReadContext && allowReadGlobalContext
          ? this.mcpServer
          : createTripMcpServer(this.tripId, {
            includeReadItinerary: allowReadItinerary,
            includeReadContext: allowReadContext,
            includeReadGlobalContext: allowReadGlobalContext,
          });
        this.activeAllowedTools = new Set(allowedTools);
        for await (const message of this.agentClient.queryStream(modelPrompt, {
          ...options,
          appendSystemPrompt: ctxPrompt.prompt,
          allowedTripId: this.tripId,
          allowedTools,
          mcpServers: { "entity-tools": mcpServer },
          abortController,
        })) {
          await this.handleSdkMessage(message);
        }
        querySucceeded = true;
      } catch (err: any) {
        const errMsg = err?.message ? String(err.message) : "";
        const isAbort = err?.name === "AbortError" || errMsg.toLowerCase().includes("abort");
        if (!this.cancelRequested && !isAbort) {
          console.error("Agent query failed", err);
          this.broadcastError(errMsg || "Query failed");
        }
      } finally {
        this.activeAllowedTools = null;
        this.activeModel = null;
        this.queryPromise = null;
        this.abortController = null;
        this.cancelRequested = false;
        this.itineraryUpdatedDuringQuery = false;
        this.toolTimings.clear();
        this.handledToolResults.clear();
        // Ensure a result is always sent so the client knows the query is done
        if (!this.resultSent) {
          this.resultSent = true;
          this.broadcastResult({
            type: "result",
            success: true,
            tripId: this.tripId,
            conversationId: this.conversationId,
          });
        }
        // Schedule title generation after query completes successfully
        if (querySucceeded) {
          this.scheduleTitleGeneration();
        }
      }
    })();

    await this.queryPromise;
  }

  private async handleSdkMessage(message: SDKMessage): Promise<void> {
    const messageType = (message as any).type as string | undefined;
    if (this.cancelRequested && messageType !== "system") {
      return;
    }

    // Log all non-stream messages with detailed info
    if (messageType !== "stream_event") {
      const msgAny = message as any;

      // Check for tool use in assistant messages (tools are in message.message.content array)
      if (messageType === "assistant" && msgAny.message?.content) {
        const content = msgAny.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_use") {
              logTs(`[ToolUse] ${block.name}`, JSON.stringify(block.input ?? {}).slice(0, 300));
            }
          }
        }
      }

      // Check for tool_result message type
      if (messageType === "tool_result") {
        const result = typeof msgAny.content === "string" ? msgAny.content : JSON.stringify(msgAny.content ?? "");
        const isError = msgAny.is_error || msgAny.isError;
        const toolName = msgAny.tool_name ?? msgAny.name ?? "unknown";
        const normalizedToolName = normalizeToolName(String(toolName));
        logTs(`[ToolResult] tool=${toolName} isError=${isError}:`, result.slice(0, 500) + (result.length > 500 ? "..." : ""));

        if (
          ["create_scheduled_task", "update_scheduled_task", "delete_scheduled_task"].includes(normalizedToolName)
        ) {
          this.broadcast({
            type: "scheduler_tasks_updated",
            tripId: this.tripId,
            conversationId: this.conversationId,
          });
        }
      }

      // Log other message types
      if (messageType !== "assistant" && messageType !== "tool_result") {
        logTs(`[SDKMessage] type=${messageType}`, msgAny.subtype ? `subtype=${msgAny.subtype}` : "");
      }
    }

    if (messageType === "stream_event") {
      this.handleStreamEvent((message as any).event);
      return;
    }

    if (messageType === "system" && (message as any).subtype === "init") {
      const sid = (message as any).session_id as string | undefined;
      if (sid) {
        this.sdkSessionId = sid;
        await storage.updateConversation(this.tripId, this.conversationId, { sdkSessionId: sid });
      }
      this.broadcast({ type: "system", subtype: "init", tripId: this.tripId, conversationId: this.conversationId });
      return;
    }

    if (messageType === "assistant") {
      const toolBlocks = (message as any)?.message?.content;
      if (Array.isArray(toolBlocks)) {
        for (const block of toolBlocks) {
          if (block?.type === "tool_use") {
            this.trackToolStart({ id: block.id, name: block.name }, false);
            this.trackToolInput({ id: block.id, name: block.name, input: block.input ?? {} });
            this.broadcastToolUse(block);
            this.recordToolUse(block);
          }
        }
      }
      const text = joinAssistantText(message);
      const cleanedText = text ? sanitizeAssistantText(text) : "";
      if (cleanedText) {
        logTs(`[AssistantResponse] ${cleanedText.slice(0, 300)}${cleanedText.length > 300 ? "..." : ""}`);
        const toolActivity = Array.from(this.pendingToolActivity.values());
        const msg: storage.StoredMessage = {
          id: crypto.randomUUID(),
          type: "assistant",
          content: cleanedText,
          timestamp: nowIso(),
          metadata: toolActivity.length > 0 ? { toolActivity } : undefined,
        };
        await storage.appendMessage(this.tripId, this.conversationId, msg);
        this.broadcast({ type: "assistant_message", content: cleanedText, tripId: this.tripId, conversationId: this.conversationId });
        this.pendingToolActivity.clear();
        await this.maybeUpdateConversationTitle();
        this.lastUserMessage = null;
      }
      return;
    }

    if (messageType === "tool_result") {
      this.handleToolResultPayload(message);
      return;
    }

    if (messageType === "result") {
      const subtype = (message as any).subtype;
      const modelLabel = this.activeModel ?? "unknown";
      logTs(`[Result] ${subtype}, model=${modelLabel}, cost=$${(message as any).total_cost_usd?.toFixed(4) ?? "?"}, duration=${(message as any).duration_ms ?? "?"}ms`);
      if (this.resultSent) return;
      this.resultSent = true;
      if (subtype === "success") {
        this.broadcastResult({
          type: "result",
          success: true,
          result: (message as any).result,
          cost: (message as any).total_cost_usd,
          duration: (message as any).duration_ms,
          tripId: this.tripId,
          conversationId: this.conversationId,
        });
      } else {
        this.broadcastResult({ type: "result", success: false, error: subtype, tripId: this.tripId, conversationId: this.conversationId });
      }
      // Check if itinerary was modified by agent tools (Write/Edit)
      await this.checkAndBroadcastItineraryChange();
      this.pendingToolActivity.clear();
      return;
    }

    if (message.type === "user") {
      // Log user messages injected by SDK (e.g., tool results, permission prompts)
      const msgAny = message as any;
      const content = msgAny.message?.content ?? msgAny.content;
      const contentStr = typeof content === "string"
        ? content
        : JSON.stringify(content, null, 2);
      logTs(`[SDKUserMessage] Full message structure:`);
      logTs(JSON.stringify(message, null, 2).slice(0, 2000));
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "tool_result" && block?.tool_use_id) {
            const activity = this.pendingToolActivity.get(block.tool_use_id);
            const enriched = {
              ...block,
              name: block?.name ?? activity?.name,
              tool_name: block?.tool_name ?? activity?.name,
            };
            this.handleToolResultPayload(enriched);
          }
        }
      }
      return;
    }

    // Log unhandled message types
    logTs(`[SDKMessage:Unhandled] type=${message.type}`, JSON.stringify(message).slice(0, 200));
  }
}
