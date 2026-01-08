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
      `CURRENT TRIP CONTEXT (use these paths, don't search for other trips):`,
      `- Trip: ${trip?.name ?? this.tripId} (id: ${this.tripId})`,
      `- Itinerary: ${itineraryPath}`,
      `- Preferences: ${dataRoot}/trips/${this.tripId}/prefs.json`,
      `- Uploads: ${dataRoot}/trips/${this.tripId}/uploads/`,
      `- Assets: ${dataRoot}/trips/${this.tripId}/assets/`,
      ``,
      `When the user asks about "the itinerary" or "my trip", they mean THIS trip. Read ${itineraryPath} to answer their questions.`,
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

  async addUserMessage(content: string): Promise<void> {
    if (this.queryPromise) await this.queryPromise;
    await this.ensureConversationLoaded();

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
        const options = this.sdkSessionId ? { resume: this.sdkSessionId } : {};

        for await (const message of this.agentClient.queryStream(content, { ...options, appendSystemPrompt: ctxPrompt })) {
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
    if (message.type === "stream_event") {
      this.handleStreamEvent((message as any).event);
      return;
    }

    if (message.type === "system" && (message as any).subtype === "init") {
      const sid = (message as any).session_id as string | undefined;
      if (sid) {
        this.sdkSessionId = sid;
        await storage.updateConversation(this.tripId, this.conversationId, { sdkSessionId: sid });
      }
      this.broadcast({ type: "system", subtype: "init", tripId: this.tripId, conversationId: this.conversationId });
      return;
    }

    if (message.type === "assistant") {
      const text = joinAssistantText(message);
      if (text) {
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

    if (message.type === "result") {
      const subtype = (message as any).subtype;
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

    // Tool blocks, etc. For MVP, ignore or log.
  }
}
