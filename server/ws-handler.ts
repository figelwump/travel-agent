import type { WSClient, IncomingMessage } from "./ws-types";
import { ConversationSession } from "./ws-session";

// Auth config - must match server.ts
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || process.env.BASIC_AUTH_PASSWORD || process.env.BASIC_AUTH_PASS;
const DISABLE_AUTH = process.env.DISABLE_AUTH === "true";

export class WebSocketHandler {
  private sessions: Map<string, ConversationSession> = new Map();

  private sessionKey(tripId: string, conversationId: string): string {
    return `${tripId}:${conversationId}`;
  }

  private getOrCreateSession(tripId: string, conversationId: string): ConversationSession {
    const key = this.sessionKey(tripId, conversationId);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const next = new ConversationSession({ tripId, conversationId });
    this.sessions.set(key, next);
    return next;
  }

  private isAuthenticated(ws: WSClient): boolean {
    return DISABLE_AUTH || ws.data.authenticated === true;
  }

  public async onOpen(ws: WSClient) {
    ws.data.sessionKey = "";
    ws.data.authenticated = false;

    if (DISABLE_AUTH) {
      ws.data.authenticated = true;
      ws.send(JSON.stringify({ type: "connected", message: "Connected to Travel Agent" }));
      return;
    }

    if (!AUTH_PASSWORD) {
      ws.send(JSON.stringify({ type: "auth_failed", error: "Server authentication not configured" }));
      ws.close();
      return;
    }

    ws.send(JSON.stringify({ type: "auth_required", message: "Send auth message with password" }));
  }

  public async onMessage(ws: WSClient, message: string) {
    try {
      const data = JSON.parse(message) as IncomingMessage;

      if (data.type === "auth") {
        if (DISABLE_AUTH) {
          ws.data.authenticated = true;
          ws.send(JSON.stringify({ type: "connected", message: "Connected to Travel Agent" }));
          return;
        }
        if (!AUTH_PASSWORD) {
          ws.send(JSON.stringify({ type: "auth_failed", error: "Server authentication not configured" }));
          ws.close();
          return;
        }
        if (data.password === AUTH_PASSWORD) {
          ws.data.authenticated = true;
          ws.send(JSON.stringify({ type: "connected", message: "Connected to Travel Agent" }));
          return;
        }
        ws.send(JSON.stringify({ type: "auth_failed", error: "Invalid password" }));
        ws.close();
        return;
      }

      if (!this.isAuthenticated(ws)) {
        ws.send(JSON.stringify({ type: "error", error: "Not authenticated" }));
        return;
      }

      if (data.type === "unsubscribe") {
        if (ws.data.sessionKey) {
          const session = this.sessions.get(ws.data.sessionKey);
          session?.unsubscribe(ws);
        }
        ws.data.sessionKey = "";
        ws.send(JSON.stringify({ type: "unsubscribed" }));
        return;
      }

      if (data.type === "subscribe") {
        const key = this.sessionKey(data.tripId, data.conversationId);
        const session = this.getOrCreateSession(data.tripId, data.conversationId);
        if (ws.data.sessionKey && ws.data.sessionKey !== key) {
          const current = this.sessions.get(ws.data.sessionKey);
          current?.unsubscribe(ws);
        }
        session.subscribe(ws);
        ws.data.sessionKey = key;
        ws.send(JSON.stringify({ type: "subscribed", tripId: data.tripId, conversationId: data.conversationId }));
        return;
      }

      if (data.type === "chat") {
        const key = this.sessionKey(data.tripId, data.conversationId);
        const session = this.getOrCreateSession(data.tripId, data.conversationId);
        if (!ws.data.sessionKey || ws.data.sessionKey !== key) {
          if (ws.data.sessionKey) {
            const current = this.sessions.get(ws.data.sessionKey);
            current?.unsubscribe(ws);
          }
          session.subscribe(ws);
          ws.data.sessionKey = key;
        }
        if (data.newConversation) {
          session.endConversation();
        }
        await session.addUserMessage(data.content);
        return;
      }

      ws.send(JSON.stringify({ type: "error", error: "Unknown message type" }));
    } catch (err) {
      console.error("WebSocket error:", err);
      ws.send(JSON.stringify({ type: "error", error: "Failed to process message" }));
    }
  }

  public onClose(ws: WSClient) {
    if (ws.data.sessionKey) {
      const session = this.sessions.get(ws.data.sessionKey);
      session?.unsubscribe(ws);
    }
  }
}

