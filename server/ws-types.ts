import type { ServerWebSocket } from "bun";

export type WSClientData = {
  sessionKey: string;
  authenticated: boolean;
};

export type WSClient = ServerWebSocket<WSClientData>;

export type IncomingMessage =
  | { type: "auth"; password: string }
  | { type: "subscribe"; tripId: string; conversationId: string }
  | { type: "chat"; tripId: string; conversationId: string; content: string; newConversation?: boolean }
  | { type: "cancel"; tripId: string; conversationId: string }
  | { type: "unsubscribe" };
