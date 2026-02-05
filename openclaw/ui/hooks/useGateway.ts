import { useCallback, useEffect, useRef, useState } from "react";

const PROTOCOL_VERSION = 3;

type GatewayFrame =
  | { type: "event"; event: string; payload?: any; seq?: number }
  | { type: "res"; id: string; ok: boolean; payload?: any; error?: { message?: string } }
  | { type: "req"; id: string; method: string; params?: any };

type GatewayRequest = { resolve: (value: any) => void; reject: (err: Error) => void };

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type GatewayEventHandler = (event: { event: string; payload: any }) => void;

type UseGatewayOptions = {
  url: string;
  enabled?: boolean;
  token?: string | null;
  password?: string | null;
  onEvent?: GatewayEventHandler;
  onHello?: (payload: any) => void;
  onClose?: (reason: string) => void;
  onError?: (error: Event) => void;
};

export function useGateway({
  url,
  enabled = true,
  token,
  password,
  onEvent,
  onHello,
  onClose,
  onError,
}: UseGatewayOptions) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, GatewayRequest>>(new Map());
  const connectSentRef = useRef(false);
  const connectTimerRef = useRef<number | null>(null);
  const onEventRef = useRef(onEvent);
  const onHelloRef = useRef(onHello);
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);

  onEventRef.current = onEvent;
  onHelloRef.current = onHello;
  onCloseRef.current = onClose;
  onErrorRef.current = onError;

  const flushPending = useCallback((err: Error) => {
    const pending = pendingRef.current;
    for (const [, entry] of pending) {
      entry.reject(err);
    }
    pending.clear();
  }, []);

  const request = useCallback((method: string, params: any) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = randomId();
    const payload = { type: "req", id, method, params };
    const promise = new Promise((resolve, reject) => {
      pendingRef.current.set(id, { resolve, reject });
    });
    wsRef.current.send(JSON.stringify(payload));
    return promise as Promise<any>;
  }, []);

  const sendConnect = useCallback(() => {
    if (!wsRef.current || connectSentRef.current) return;
    connectSentRef.current = true;
    if (connectTimerRef.current !== null) {
      window.clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }

    const authToken = token?.trim() || undefined;
    const authPassword = password?.trim() || undefined;
    const auth = authToken || authPassword ? { token: authToken, password: authPassword } : undefined;

    const params = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: "webchat-ui",
        displayName: "Travel Agent",
        version: "0.1.0",
        platform: navigator.platform ?? "web",
        mode: "webchat",
      },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      caps: [],
      auth,
      locale: navigator.language ?? "en-US",
      userAgent: navigator.userAgent,
      device: undefined,
    };

    request("connect", params)
      .then((payload) => {
        setConnected(true);
        onHelloRef.current?.(payload);
      })
      .catch((err) => {
        setConnected(false);
        onCloseRef.current?.(String(err));
        wsRef.current?.close(4008, "connect failed");
      });
  }, [password, request, token]);

  const connect = useCallback(() => {
    if (!enabled || !url) return;

    if (wsRef.current &&
        (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
      return;
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;
    connectSentRef.current = false;
    // No nonce required for webchat clients.

    ws.onopen = () => {
      connectTimerRef.current = window.setTimeout(() => {
        sendConnect();
      }, 750);
    };

    ws.onmessage = (event) => {
      let frame: GatewayFrame | null = null;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!frame) return;
      if (frame.type === "event") {
        if (frame.event === "connect.challenge") {
          sendConnect();
          return;
        }
        onEventRef.current?.({ event: frame.event, payload: frame.payload });
        return;
      }
      if (frame.type === "res") {
        const pending = pendingRef.current.get(frame.id);
        if (!pending) return;
        pendingRef.current.delete(frame.id);
        if (frame.ok) {
          pending.resolve(frame.payload);
        } else {
          pending.reject(new Error(frame.error?.message ?? "request failed"));
        }
      }
    };

    ws.onerror = (evt) => {
      onErrorRef.current?.(evt);
    };

    ws.onclose = (evt) => {
      setConnected(false);
      wsRef.current = null;
      flushPending(new Error(`gateway closed (${evt.code}): ${evt.reason || "no reason"}`));
      onCloseRef.current?.(evt.reason || "closed");
    };
  }, [enabled, flushPending, sendConnect, url]);

  const disconnect = useCallback(() => {
    if (connectTimerRef.current !== null) {
      window.clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  const send = useCallback((method: string, params: any) => {
    return request(method, params);
  }, [request]);

  useEffect(() => {
    if (enabled) {
      connect();
      return () => disconnect();
    }
    disconnect();
    return undefined;
  }, [connect, disconnect, enabled, url]);

  return {
    connected,
    request,
    send,
    disconnect,
  };
}
