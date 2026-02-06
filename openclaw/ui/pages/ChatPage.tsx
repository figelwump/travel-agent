import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "../components/ChatPanel";
import { Message, TextBlock, ToolActivity } from "../components/message/types";

const createTextBlock = (text: string): TextBlock => ({ type: "text", text });

const SESSION_KEY = "agent:main:default";

const makeId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

type EventHandler = (event: { event: string; payload: any }) => void;

type ChatPageProps = {
  connected: boolean;
  gatewayRequest: (method: string, params: any) => Promise<any>;
  onEvent: (handler: EventHandler) => void;
  offEvent: (handler: EventHandler) => void;
};

export const ChatPage: React.FC<ChatPageProps> = ({
  connected,
  gatewayRequest,
  onEvent,
  offEvent,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const runIdToMessageIdRef = useRef<Record<string, string>>({});
  const runIdToTextRef = useRef<Record<string, string>>({});
  const runIdToToolActivityRef = useRef<Record<string, ToolActivity[]>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const getToolActivityForRun = useCallback((runId: string): ToolActivity[] => {
    const activity = runIdToToolActivityRef.current[runId];
    return Array.isArray(activity) ? activity : [];
  }, []);

  const applyToolActivityToMessage = useCallback((runId: string, toolActivity: ToolActivity[]) => {
    if (!runId) return;
    setMessages((prev) => {
      const messageId = runIdToMessageIdRef.current[runId] ?? runId;
      const index = prev.findIndex((msg) => msg.id === messageId && msg.type === "assistant");
      if (index < 0) return prev;
      const current = prev[index];
      if (current.type !== "assistant") return prev;
      const metadata = { ...(current.metadata ?? {}), toolActivity };
      const next = [...prev];
      next[index] = { ...current, metadata };
      return next;
    });
  }, []);

  const extractChatText = useCallback((message: any): string => {
    if (!message) return "";
    if (typeof message === "string") return message;
    if (typeof message.text === "string") return message.text;
    if (Array.isArray(message.content)) {
      return message.content
        .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
        .join("");
    }
    return "";
  }, []);

  const handleChatEvent = useCallback((payload: any) => {
    const sessionKey = payload?.sessionKey;
    if (!sessionKey || sessionKey !== SESSION_KEY) return;
    const runId = typeof payload?.runId === "string" ? payload.runId : "";
    if (!runId) return;
    const state = payload?.state;
    const incomingText = extractChatText(payload?.message);

    if (state === "delta") {
      setIsLoading(true);
      const prevText = runIdToTextRef.current[runId] ?? "";
      const nextText = incomingText.startsWith(prevText) ? incomingText : prevText + incomingText;
      runIdToTextRef.current[runId] = nextText;
      const messageId = runIdToMessageIdRef.current[runId] ?? runId;
      runIdToMessageIdRef.current[runId] = messageId;
      streamingMessageIdRef.current = messageId;
      const timestamp = new Date().toISOString();
      const toolActivity = getToolActivityForRun(runId);
      setMessages((prev) => {
        const index = prev.findIndex((msg) => msg.id === messageId);
        const nextMessage: Message = {
          id: messageId,
          type: "assistant",
          content: [createTextBlock(nextText)],
          timestamp,
          metadata: {
            streaming: true,
            toolActivity: toolActivity.length > 0 ? toolActivity : undefined,
          },
        };
        if (index >= 0) {
          const next = [...prev];
          next[index] = { ...next[index], ...nextMessage };
          return next;
        }
        return [...prev, nextMessage];
      });
      return;
    }

    if (state === "final") {
      const prevText = runIdToTextRef.current[runId] ?? "";
      const finalText = incomingText.startsWith(prevText) ? incomingText : prevText + incomingText;
      const messageId = runIdToMessageIdRef.current[runId] ?? runId;
      const timestamp = new Date().toISOString();
      const toolActivity = getToolActivityForRun(runId);
      streamingMessageIdRef.current = null;
      delete runIdToTextRef.current[runId];
      delete runIdToMessageIdRef.current[runId];
      delete runIdToToolActivityRef.current[runId];
      setMessages((prev) => {
        const index = prev.findIndex((msg) => msg.id === messageId);
        const nextMessage: Message = {
          id: messageId,
          type: "assistant",
          content: [createTextBlock(finalText)],
          timestamp,
          metadata: {
            streaming: false,
            toolActivity: toolActivity.length > 0 ? toolActivity : undefined,
          },
        };
        if (index >= 0) {
          const next = [...prev];
          next[index] = { ...nextMessage };
          return next;
        }
        return finalText ? [...prev, nextMessage] : prev;
      });
      setIsLoading(false);
      return;
    }

    if (state === "error" || state === "aborted") {
      const errorText =
        typeof payload?.errorMessage === "string" && payload.errorMessage
          ? payload.errorMessage
          : "Request failed.";
      setMessages((prev) => [
        ...prev,
        { id: makeId(), type: "system", content: errorText, timestamp: new Date().toISOString() },
      ]);
      setIsLoading(false);
      streamingMessageIdRef.current = null;
      delete runIdToMessageIdRef.current[runId];
      delete runIdToTextRef.current[runId];
      delete runIdToToolActivityRef.current[runId];
    }
  }, [extractChatText, getToolActivityForRun]);

  const handleAgentEvent = useCallback((payload: any) => {
    const sessionKey = payload?.sessionKey;
    if (!sessionKey || sessionKey !== SESSION_KEY) return;
    if (payload?.stream !== "tool") return;
    const runId = typeof payload?.runId === "string" ? payload.runId : "";
    if (!runId) return;
    const data = payload?.data ?? {};
    const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
    if (!toolCallId) return;
    const name = typeof data.name === "string" ? data.name : "tool";
    const phase = typeof data.phase === "string" ? data.phase : "update";
    const timestamp = typeof payload?.ts === "number" ? new Date(payload.ts).toISOString() : new Date().toISOString();
    const input = data.args && typeof data.args === "object" ? (data.args as Record<string, any>) : undefined;

    const existing = runIdToToolActivityRef.current[runId] ?? [];
    const index = existing.findIndex((tool) => tool.id === toolCallId);
    const next = [...existing];

    if (phase === "start") {
      const entry: ToolActivity = {
        id: toolCallId, name,
        input: input ?? (index >= 0 ? existing[index].input : undefined),
        status: "running", startedAt: timestamp,
      };
      if (index >= 0) next[index] = { ...existing[index], ...entry };
      else next.push(entry);
    } else if (phase === "result") {
      const base: ToolActivity = index >= 0
        ? existing[index]
        : { id: toolCallId, name, input: input ?? {}, status: "running", startedAt: timestamp };
      const entry: ToolActivity = { ...base, name, input: base.input ?? input ?? {}, status: "complete", completedAt: timestamp };
      if (index >= 0) next[index] = entry;
      else next.push(entry);
    } else {
      const base: ToolActivity = index >= 0
        ? existing[index]
        : { id: toolCallId, name, input: input ?? {}, status: "running", startedAt: timestamp };
      if (index >= 0) next[index] = { ...base, name, input: base.input ?? input ?? {}, status: "running" };
      else next.push({ ...base, name, input: base.input ?? input ?? {}, status: "running" });
    }

    runIdToToolActivityRef.current[runId] = next;
    const messageId = runIdToMessageIdRef.current[runId] ?? runId;
    runIdToMessageIdRef.current[runId] = messageId;
    setMessages((prev) => {
      const idx = prev.findIndex((msg) => msg.id === messageId && msg.type === "assistant");
      if (idx >= 0) return prev;
      const placeholder: Message = {
        id: messageId, type: "assistant", content: [createTextBlock("")],
        timestamp: new Date().toISOString(),
        metadata: { streaming: true, toolActivity: next },
      };
      return [...prev, placeholder];
    });
    applyToolActivityToMessage(runId, next);
  }, [applyToolActivityToMessage]);

  const handleGatewayEvent = useCallback((event: { event: string; payload: any }) => {
    if (event.event === "chat") {
      handleChatEvent(event.payload);
      return;
    }
    if (event.event === "agent") {
      handleAgentEvent(event.payload);
    }
  }, [handleChatEvent, handleAgentEvent]);

  useEffect(() => {
    onEvent(handleGatewayEvent);
    return () => {
      offEvent(handleGatewayEvent);
    };
  }, [handleGatewayEvent, onEvent, offEvent]);

  const handleSend = useCallback((text: string) => {
    const timestamp = new Date().toISOString();
    const messageId = makeId();
    const userMessage: Message = { id: messageId, type: "user", content: text, timestamp };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    gatewayRequest("chat.send", { sessionKey: SESSION_KEY, message: text, idempotencyKey: makeId() })
      .catch((err) => {
        setConnectionError(`Gateway send failed: ${String(err)}`);
        setIsLoading(false);
      });
  }, [gatewayRequest]);

  const handleCancel = useCallback(() => {
    gatewayRequest("chat.abort", { sessionKey: SESSION_KEY }).catch(() => undefined);
    setIsLoading(false);
    streamingMessageIdRef.current = null;
  }, [gatewayRequest]);

  return (
    <div className="chat-page">
      {connectionError && (
        <div className="chat-page-error" style={{ background: "hsl(var(--error) / 0.1)" }}>
          <p className="text-xs text-center" style={{ color: "hsl(var(--error))" }}>
            {connectionError}
          </p>
        </div>
      )}
      <div className="chat-page-content terminal-container">
        <ChatPanel
          isConnected={connected}
          isLoading={isLoading}
          inputDisabled={!connected}
          messages={messages}
          draft={draft}
          setDraft={setDraft}
          onSend={handleSend}
          onCancel={handleCancel}
          tripName={null}
          itineraryMarkdown=""
          textareaRef={textareaRef}
        />
      </div>
    </div>
  );
};
