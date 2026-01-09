import type { WSClient } from "./ws-types";
import { AgentClient } from "../agentsdk/agent-client";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as storage from "./storage";
import * as fs from "fs/promises";

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
    const dataRoot = storage.travelAgentHome();
    const itineraryPath = `${dataRoot}/trips/${this.tripId}/itinerary.md`;

    return [
      `<CURRENT_TRIP_CONTEXT>`,
      `This is the active trip. Do not ask which trip - use this one.`,
      ``,
      `trip_name: ${trip?.name ?? this.tripId}`,
      `trip_id: ${this.tripId}`,
      `itinerary_path: ${itineraryPath}`,
      `preferences_path: ${dataRoot}/trips/${this.tripId}/prefs.json`,
      `uploads_path: ${dataRoot}/trips/${this.tripId}/uploads/`,
      `assets_path: ${dataRoot}/trips/${this.tripId}/assets/`,
      `</CURRENT_TRIP_CONTEXT>`,
      ``,
      `<action_required>`,
      `For ANY itinerary update request: immediately call Skill tool with skill="travel-planner"`,
      `Pass the user's request as the args parameter.`,
      `</action_required>`,
    ].join("\n");
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
          this.broadcast({
            type: "assistant_partial",
            content: this.partialTextBuffer,
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

  async addUserMessage(content: string): Promise<void> {
    if (this.queryPromise) await this.queryPromise;
    await this.ensureConversationLoaded();

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
        console.log(`[ToolResult]:`, result.slice(0, 300) + (result.length > 300 ? "..." : ""));
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
          }
        }
      }
      const text = joinAssistantText(message);
      if (text) {
        console.log(`[AssistantResponse] ${text.slice(0, 300)}${text.length > 300 ? "..." : ""}`);
        const msg: storage.StoredMessage = {
          id: crypto.randomUUID(),
          type: "assistant",
          content: text,
          timestamp: nowIso(),
        };
        await storage.appendMessage(this.tripId, this.conversationId, msg);
        this.broadcast({ type: "assistant_message", content: text, tripId: this.tripId, conversationId: this.conversationId });
      }
      return;
    }

    if (messageType === "tool_result") {
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
      return;
    }

    if (message.type === "user") {
      // (Optional echo)
      return;
    }

    // Log unhandled message types
    console.log(`[SDKMessage:Unhandled] type=${message.type}`, JSON.stringify(message).slice(0, 200));
  }
}
