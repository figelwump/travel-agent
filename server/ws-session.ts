import type { WSClient } from "./ws-types";
import { AgentClient } from "../agentsdk/agent-client";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as storage from "./storage";

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

function extractFencedBlock(text: string, langs: string[]): string | null {
  const langPattern = langs.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp("```(?:\\s*)(" + langPattern + ")\\s*\\n([\\s\\S]*?)\\n```", "i");
  const m = text.match(re);
  return m ? m[2] : null;
}

function extractDestinationsFromMarkdown(md: string): string[] {
  const lines = md.split("\n");
  const idx = lines.findIndex((l) => /^##\s+Destinations\s*$/i.test(l.trim()));
  if (idx === -1) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^#{1,6}\s+/.test(line)) break;
    const m = line.match(/^-+\s+(?!\[[ xX]\]\s*)(.+)$/);
    if (!m) continue;
    const item = m[1].trim();
    if (!item) continue;
    out.push(item.replace(/\s+\[[^\]]+\]\s*$/, ""));
  }
  return Array.from(new Set(out)).slice(0, 12);
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

  private async ensureConversationLoaded(): Promise<void> {
    if (this.sdkSessionId) return;
    const meta = await storage.getConversation(this.tripId, this.conversationId);
    if (meta?.sdkSessionId) this.sdkSessionId = meta.sdkSessionId;
  }

  private async buildTripContextPrompt(): Promise<string> {
    const trip = await storage.getTrip(this.tripId);
    const prefs = await storage.readPrefs(this.tripId);
    const itinerary = await storage.readItinerary(this.tripId);

    const uploadsRoot = storage.uploadsDir(this.tripId);
    let uploads: string[] = [];
    try {
      const ents = await (await import("fs/promises")).readdir(uploadsRoot, { withFileTypes: true });
      uploads = ents.filter((e) => e.isFile()).map((e) => e.name).slice(0, 50);
    } catch {}

    const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) + "\n…(truncated)" : s);

    return [
      `You are TravelAgent. You are planning a personal trip with the user.`,
      ``,
      `Data root: ${storage.travelAgentHome()}`,
      `Trip: ${trip?.name ?? this.tripId} (id: ${this.tripId})`,
      `Conversation id: ${this.conversationId}`,
      `Itinerary path: ${storage.travelAgentHome()}/trips/${this.tripId}/itinerary.md`,
      `Preferences path: ${storage.travelAgentHome()}/trips/${this.tripId}/prefs.json`,
      uploads.length ? `Uploaded context files (filenames): ${uploads.join(", ")}` : `Uploaded context files: none`,
      ``,
      `Current preferences (JSON):`,
      "```json",
      clip(JSON.stringify(prefs, null, 2), 6000),
      "```",
      ``,
      `Current itinerary (markdown):`,
      "```markdown",
      clip(itinerary, 12000),
      "```",
      ``,
      `Persistence protocol (VERY IMPORTANT):`,
      `- When you have enough clarity to create/update the itinerary, output ONE fenced block with language \`itinerary-md\` containing the full itinerary markdown, and include the line \`<!-- travelagent:save-itinerary -->\` immediately after the code block.`,
      `- When you want to update stored preferences, output ONE fenced block with language \`travel-prefs.json\` containing a JSON object, and include \`<!-- travelagent:save-prefs -->\` immediately after it.`,
      `- If you want the server to generate a single trip-wide "map image" and insert it into the itinerary, include \`<!-- travelagent:generate-map -->\` and (optionally) provide a \`travel-destinations.json\` fenced block containing either an array of destination strings or an object like { "destinations": ["..."] }.`,
      `- Use markdown task list items for todos: \`- [ ]\` and \`- [x]\`.`,
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

  private async applyAssistantSideEffects(fullText: string) {
    if (fullText.includes("<!-- travelagent:save-itinerary -->")) {
      const block = extractFencedBlock(fullText, ["itinerary-md", "itinerary"]);
      if (block) {
        await storage.writeItinerary(this.tripId, block.trimEnd() + "\n");
        this.broadcast({ type: "itinerary_updated", tripId: this.tripId });
      }
    }

    if (fullText.includes("<!-- travelagent:save-prefs -->")) {
      const block = extractFencedBlock(fullText, ["travel-prefs.json"]);
      if (block) {
        try {
          const parsed = JSON.parse(block) as Record<string, unknown>;
          await storage.mergePrefs(this.tripId, parsed);
          this.broadcast({ type: "prefs_updated", tripId: this.tripId });
        } catch (err) {
          this.broadcast({ type: "error", error: "Failed to parse travel-prefs.json block", tripId: this.tripId });
        }
      }
    }

    if (fullText.includes("<!-- travelagent:generate-map -->")) {
      let destinations: string[] = [];
      const block = extractFencedBlock(fullText, ["travel-destinations.json"]);
      if (block) {
        try {
          const parsed = JSON.parse(block);
          if (Array.isArray(parsed)) destinations = parsed.filter((d) => typeof d === "string");
          else if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).destinations)) {
            destinations = (parsed as any).destinations.filter((d: any) => typeof d === "string");
          }
        } catch {}
      }

      if (destinations.length === 0) {
        const itinerary = await storage.readItinerary(this.tripId);
        destinations = extractDestinationsFromMarkdown(itinerary);
      }

      if (destinations.length > 0) {
        const { assetUrl } = await storage.generateTripMap(this.tripId, destinations);
        await storage.ensureMapReferencedInItinerary(this.tripId, assetUrl);
        this.broadcast({ type: "itinerary_updated", tripId: this.tripId });
      }
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
        await this.applyAssistantSideEffects(text);
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
      return;
    }

    if (message.type === "user") {
      // (Optional echo)
      return;
    }

    // Tool blocks, etc. For MVP, ignore or log.
  }
}
