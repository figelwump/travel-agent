import type { WSClient } from "./ws-types";
import { AgentClient } from "../agentsdk/agent-client";
import { createSdkMcpServer, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as storage from "./storage";
import * as fs from "fs/promises";
import { entityTools, completionTools } from "./tools";

// Create MCP server with custom entity tools
// Short name "t" to minimize tool name prefix (mcp__t__read_entity)
const entityMcpServer = createSdkMcpServer({
  name: "t",
  tools: [...entityTools, ...completionTools],
});

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
  private itineraryMtimeBeforeQuery: number | null = null;
  private lastUserMessage: string | null = null;
  private pendingToolActivity = new Map<string, {
    id: string;
    name: string;
    input: Record<string, unknown>;
    status: "running" | "complete";
    startedAt: string;
    completedAt?: string;
  }>();

  constructor({ tripId, conversationId }: ConversationSessionParams) {
    this.tripId = tripId;
    this.conversationId = conversationId;
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
    if (this.itineraryMtimeBeforeQuery === null) return;
    const currentMtime = await this.getItineraryMtime();
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

  private async buildTripContextPrompt(): Promise<string> {
    const trip = await storage.getTrip(this.tripId);
    const itinerary = await storage.readItinerary(this.tripId);
    const context = await storage.readContext(this.tripId);
    const todoMatches = itinerary.match(/- \\[ \\]/g) || [];
    const doneMatches = itinerary.match(/- \\[x\\]/gi) || [];

    return [
      `## YOUR TRIP ID: ${this.tripId}`,
      ``,
      `Trip Name: ${trip?.name ?? "Unnamed"}`,
      `Pending TODOs: ${todoMatches.length} | Completed: ${doneMatches.length}`,
      ``,
      `For ALL entity tool calls, use id="${this.tripId}"`,
      ``,
      `---`,
      ``,
      `**Known Context:**`,
      context.trim() ? context : "(empty)",
    ].join("\n");
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

  private handleStreamEvent(event: any) {
    const eventType = event?.type;
    switch (eventType) {
      case "message_start":
        this.partialTextBuffer = "";
        break;
      case "content_block_start":
        if (event?.content_block?.type === "text") {
          if (this.partialTextBuffer === null) this.partialTextBuffer = "";
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
    this.broadcast({
      type: "tool_result",
      tool_use_id: toolUseId,
      tool_name: result?.name ?? result?.tool_name ?? null,
      content: result?.content ?? "",
      is_error: Boolean(result?.is_error),
      timestamp: nowIso(),
      tripId: this.tripId,
      conversationId: this.conversationId,
    });
  }

  private recordToolUse(tool: any) {
    if (!tool?.id || !tool?.name) return;
    if (this.pendingToolActivity.has(tool.id)) return;
    this.pendingToolActivity.set(tool.id, {
      id: tool.id,
      name: tool.name,
      input: tool.input ?? {},
      status: "running",
      startedAt: nowIso(),
    });
  }

  private recordToolResult(result: any) {
    const toolUseId = result?.tool_use_id;
    if (!toolUseId) return;
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

  private handleToolResultSideEffects(toolUseId: string) {
    const activity = this.pendingToolActivity.get(toolUseId);
    if (!activity) return;
    if (activity.name === "update_entity") {
      const entityType = String(activity.input?.entityType ?? "");
      if (entityType === "context") {
        this.broadcast({ type: "context_updated", tripId: this.tripId });
      }
      if (entityType === "trip") {
        this.broadcast({ type: "trips_updated", tripId: this.tripId });
      }
    }
    if (activity.name === "create_entity") {
      const entityType = String(activity.input?.entityType ?? "");
      if (entityType === "trip") {
        this.broadcast({ type: "trips_updated", tripId: this.tripId });
      }
    }
  }

  async addUserMessage(content: string): Promise<void> {
    if (this.queryPromise) await this.queryPromise;
    await this.ensureConversationLoaded();
    this.lastUserMessage = content;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[UserMessage] tripId=${this.tripId} convId=${this.conversationId}`);
    console.log(`[UserMessage] content: ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`);

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
      try {
        const ctxPrompt = await this.buildTripContextPrompt();
        console.log(`[TripContext]\n${ctxPrompt}`);
        const options = this.sdkSessionId ? { resume: this.sdkSessionId } : {};
        console.log(`[AgentQuery] Starting query, resume=${!!this.sdkSessionId}`);

        for await (const message of this.agentClient.queryStream(content, {
          ...options,
          appendSystemPrompt: ctxPrompt,
          allowedTripId: this.tripId,
          mcpServers: { "entity-tools": entityMcpServer },
        })) {
          await this.handleSdkMessage(message);
        }
      } catch (err: any) {
        console.error("Agent query failed", err);
        this.broadcastError(err?.message ? String(err.message) : "Query failed");
      } finally {
        this.queryPromise = null;
      }
    })();

    await this.queryPromise;
  }

  private async handleSdkMessage(message: SDKMessage): Promise<void> {
    const messageType = (message as any).type as string | undefined;

    // Log all non-stream messages with detailed info
    if (messageType !== "stream_event") {
      const msgAny = message as any;

      // Check for tool use in assistant messages (tools are in message.message.content array)
      if (messageType === "assistant" && msgAny.message?.content) {
        const content = msgAny.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_use") {
              console.log(`[ToolUse] ${block.name}`, JSON.stringify(block.input ?? {}).slice(0, 300));
            }
          }
        }
      }

      // Check for tool_result message type
      if (messageType === "tool_result") {
        const result = typeof msgAny.content === "string" ? msgAny.content : JSON.stringify(msgAny.content ?? "");
        const isError = msgAny.is_error || msgAny.isError;
        const toolName = msgAny.tool_name ?? msgAny.name ?? "unknown";
        console.log(`[ToolResult] tool=${toolName} isError=${isError}:`, result.slice(0, 500) + (result.length > 500 ? "..." : ""));
      }

      // Log other message types
      if (messageType !== "assistant" && messageType !== "tool_result") {
        console.log(`[SDKMessage] type=${messageType}`, msgAny.subtype ? `subtype=${msgAny.subtype}` : "");
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
            this.broadcastToolUse(block);
            this.recordToolUse(block);
          }
        }
      }
      const text = joinAssistantText(message);
      const cleanedText = text ? sanitizeAssistantText(text) : "";
      if (cleanedText) {
        console.log(`[AssistantResponse] ${cleanedText.slice(0, 300)}${cleanedText.length > 300 ? "..." : ""}`);
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
      this.recordToolResult(message);
      const toolUseId = (message as any)?.tool_use_id;
      if (toolUseId) this.handleToolResultSideEffects(toolUseId);
      this.broadcastToolResult(message);
      return;
    }

    if (messageType === "result") {
      const subtype = (message as any).subtype;
      console.log(`[Result] ${subtype}, cost=$${(message as any).total_cost_usd?.toFixed(4) ?? "?"}, duration=${(message as any).duration_ms ?? "?"}ms`);
      if (subtype === "success") {
        this.broadcast({
          type: "result",
          success: true,
          result: (message as any).result,
          cost: (message as any).total_cost_usd,
          duration: (message as any).duration_ms,
          tripId: this.tripId,
          conversationId: this.conversationId,
        });
      } else {
        this.broadcast({ type: "result", success: false, error: subtype, tripId: this.tripId, conversationId: this.conversationId });
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
      console.log(`[SDKUserMessage] Full message structure:`);
      console.log(JSON.stringify(message, null, 2).slice(0, 2000));
      return;
    }

    // Log unhandled message types
    console.log(`[SDKMessage:Unhandled] type=${message.type}`, JSON.stringify(message).slice(0, 200));
  }
}
