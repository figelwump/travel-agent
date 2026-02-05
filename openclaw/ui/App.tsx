import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGateway } from "./hooks/useGateway";
import { useUrlRouter } from "./hooks/useUrlRouter";
import { Message, TextBlock } from "./components/message/types";
import { ChatPanel } from "./components/ChatPanel";
import { ItineraryPane } from "./components/ItineraryPane";

const createTextBlock = (text: string): TextBlock => ({ type: "text", text });

const NOTIFICATIONS_STORAGE_KEY = "travelagent:notifications";
const API_BASE = "/agents/travel/api";
const BASE_PATH = "/agents/travel";

type Trip = { id: string; name: string; createdAt: string; updatedAt: string };
type Conversation = {
  id: string;
  tripId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sessionKey?: string | null;
};

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10 4l-4 4 4 4" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 4l4 4-4 4" />
  </svg>
);

const ChatBubbleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
  </svg>
);

const BellIcon = ({ enabled }: { enabled: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={enabled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const ListIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const MessageIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const MapIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
    <line x1="8" y1="2" x2="8" y2="18" />
    <line x1="16" y1="6" x2="16" y2="22" />
  </svg>
);

const BackArrowIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

const CompassIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

type MobileView = "trips" | "itinerary";
type MobileTripsSubview = "trips" | "chats" | "conversation";

const makeId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

async function apiFetch<T>(
  url: string,
  opts: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const resolvedUrl = url.startsWith("/api/")
    ? `${API_BASE}${url.slice("/api".length)}`
    : url;
  const headers = new Headers(opts.headers || {});
  if (!headers.has("Content-Type") && opts.body && !(opts.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(resolvedUrl, { ...opts, headers });
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  if (!res.ok) {
    const text = isJson ? JSON.stringify(await res.json().catch(() => ({}))) : await res.text().catch(() => "");
    return { ok: false, status: res.status, error: text || res.statusText };
  }
  if (isJson) return { ok: true, data: (await res.json()) as T };
  return { ok: true, data: (await res.text()) as T };
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const runIdToMessageIdRef = useRef<Record<string, string>>({});
  const runIdToTextRef = useRef<Record<string, string>>({});
  const activeSessionKeyRef = useRef<string | null>(null);
  const queryInProgressRef = useRef(false);
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [itineraryMarkdown, setItineraryMarkdown] = useState<string>("");
  const [showItinerary, setShowItinerary] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [itineraryFullWidth, setItineraryFullWidth] = useState(false);
  const [draftsByTrip, setDraftsByTrip] = useState<Record<string, string>>({});
  const [draftHeightsByTrip, setDraftHeightsByTrip] = useState<Record<string, number>>({});
  const [showNewTripModal, setShowNewTripModal] = useState(false);
  const [newTripName, setNewTripName] = useState("");
  const newTripInputRef = useRef<HTMLInputElement>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [conversationProgress, setConversationProgress] = useState<Record<string, boolean>>({});
  const [mobileView, setMobileView] = useState<MobileView>("trips");
  const [mobileTripsSubview, setMobileTripsSubview] = useState<MobileTripsSubview>("trips");

  const initialRouteRef = useRef<{ tripId: string | null; conversationId: string | null } | null>(null);
  const urlSyncEnabledRef = useRef(false);
  const pendingRouteRef = useRef<{ tripId: string | null; conversationId: string | null } | null>(null);

  const handlePopState = useCallback((route: { tripId: string | null; conversationId: string | null }) => {
    if (!urlSyncEnabledRef.current) return;

    setActiveTripId((prevTripId) => {
      if (route.tripId === prevTripId) {
        pendingRouteRef.current = null;
        return prevTripId;
      }
      pendingRouteRef.current = route.tripId ? route : null;
      return route.tripId;
    });

    setActiveConversationId((prevConversationId) => {
      if (route.conversationId === prevConversationId) return prevConversationId;
      return route.conversationId;
    });
  }, []);

  const gatewayParams = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        url: "ws://localhost:18789/ws",
        token: null as string | null,
        password: null as string | null,
        search: "",
      };
    }
    const search = window.location.search ?? "";
    const params = new URLSearchParams(search);
    const url =
      params.get("gatewayUrl") ??
      `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
    return {
      url,
      token: params.get("gatewayToken"),
      password: params.get("gatewayPassword"),
      search,
    };
  }, []);

  const { getInitialRoute, navigate, syncUrl } = useUrlRouter(handlePopState, {
    basePath: BASE_PATH,
    search: gatewayParams.search,
  });

  useEffect(() => {
    if (initialRouteRef.current === null) {
      initialRouteRef.current = getInitialRoute();
    }
  }, [getInitialRoute]);

  const activeDraft = useMemo(() => {
    if (!activeTripId) return "";
    return draftsByTrip[activeTripId] ?? "";
  }, [activeTripId, draftsByTrip]);

  const activeDraftHeight = useMemo(() => {
    if (!activeTripId) return null;
    return draftHeightsByTrip[activeTripId] ?? null;
  }, [activeTripId, draftHeightsByTrip]);

  const setDraftForActiveTrip = (value: string) => {
    if (!activeTripId) return;
    setDraftsByTrip((prev) => {
      if (prev[activeTripId] === value) return prev;
      return { ...prev, [activeTripId]: value };
    });
    if (value.length === 0) {
      setDraftHeightsByTrip((prev) => {
        if (!(activeTripId in prev)) return prev;
        const next = { ...prev };
        delete next[activeTripId];
        return next;
      });
    }
  };

  const setDraftHeightForActiveTrip = (value: number) => {
    if (!activeTripId) return;
    setDraftHeightsByTrip((prev) => {
      if (prev[activeTripId] === value) return prev;
      return { ...prev, [activeTripId]: value };
    });
  };

  const activeTrip = useMemo(() => trips.find((t) => t.id === activeTripId) ?? null, [trips, activeTripId]);
  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );
  const activeTripName = activeTrip?.name ?? null;
  const activeSessionKey = useMemo(() => {
    if (!activeTripId || !activeConversationId) return null;
    return activeConversation?.sessionKey ?? `agent:travel:${activeTripId}:${activeConversationId}`;
  }, [activeConversation?.sessionKey, activeConversationId, activeTripId]);

  useEffect(() => {
    activeSessionKeyRef.current = activeSessionKey;
  }, [activeSessionKey]);

  useEffect(() => {
    if (!activeConversationId) return;
    setConversationProgress((prev) => {
      const isBusy = isLoading;
      if (isBusy) {
        if (prev[activeConversationId]) return prev;
        return { ...prev, [activeConversationId]: true };
      }
      if (!prev[activeConversationId]) return prev;
      const next = { ...prev };
      delete next[activeConversationId];
      return next;
    });
  }, [activeConversationId, isLoading]);

  useEffect(() => {
    if (conversations.length === 0) {
      setConversationProgress({});
      return;
    }
    setConversationProgress((prev) => {
      const validIds = new Set(conversations.map((c) => c.id));
      let mutated = false;
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (!validIds.has(key)) {
          mutated = true;
          continue;
        }
        next[key] = value;
      }
      return mutated ? next : prev;
    });
  }, [conversations]);

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

  const handleChatEvent = useCallback(async (payload: any) => {
    const sessionKey = payload?.sessionKey;
    const activeSession = activeSessionKeyRef.current;
    if (!sessionKey || !activeSession || sessionKey !== activeSession) return;
    const runId = typeof payload?.runId === "string" ? payload.runId : "";
    if (!runId) return;
    const state = payload?.state;
    const incomingText = extractChatText(payload?.message);

    if (state === "delta") {
      queryInProgressRef.current = true;
      setIsLoading(true);
      if (activeConversationId) {
        setConversationProgress((prev) =>
          prev[activeConversationId] ? prev : { ...prev, [activeConversationId]: true }
        );
      }
      const prevText = runIdToTextRef.current[runId] ?? "";
      const nextText = incomingText.startsWith(prevText) ? incomingText : prevText + incomingText;
      runIdToTextRef.current[runId] = nextText;
      const messageId = runIdToMessageIdRef.current[runId] ?? runId;
      runIdToMessageIdRef.current[runId] = messageId;
      streamingMessageIdRef.current = messageId;
      const timestamp = new Date().toISOString();
      setMessages((prev) => {
        const index = prev.findIndex((msg) => msg.id === messageId);
        const nextMessage: Message = {
          id: messageId,
          type: "assistant",
          content: [createTextBlock(nextText)],
          timestamp,
          metadata: { streaming: true },
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
      streamingMessageIdRef.current = null;
      delete runIdToTextRef.current[runId];
      delete runIdToMessageIdRef.current[runId];
      setMessages((prev) => {
        const index = prev.findIndex((msg) => msg.id === messageId);
        const nextMessage: Message = {
          id: messageId,
          type: "assistant",
          content: [createTextBlock(finalText)],
          timestamp,
          metadata: { streaming: false },
        };
        if (index >= 0) {
          const next = [...prev];
          next[index] = nextMessage;
          return next;
        }
        return finalText ? [...prev, nextMessage] : prev;
      });
      setIsLoading(false);
      queryInProgressRef.current = false;
      if (activeConversationId) {
        setConversationProgress((prev) => {
          if (!prev[activeConversationId]) return prev;
          const next = { ...prev };
          delete next[activeConversationId];
          return next;
        });
      }
      if (
        typeof document !== "undefined" &&
        document.hidden &&
        notificationsEnabled &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        new Notification("Travel Agent", {
          body: "Response ready",
          tag: "travel-agent-response",
        });
      }
      if (activeTripId) {
        void refreshItinerary();
      }
      if (finalText.trim() && activeTripId && activeConversationId) {
        void apiFetch<{ ok: true }>(
          `/api/trips/${activeTripId}/conversations/${activeConversationId}/messages`,
          { method: "POST", body: JSON.stringify({ type: "assistant", content: finalText, timestamp }) }
        );
      }
      return;
    }

    if (state === "error" || state === "aborted") {
      const timestamp = new Date().toISOString();
      const errorText =
        typeof payload?.errorMessage === "string" && payload.errorMessage
          ? payload.errorMessage
          : "Request failed.";
      setMessages((prev) => [
        ...prev,
        { id: makeId(), type: "system", content: errorText, timestamp },
      ]);
      setIsLoading(false);
      queryInProgressRef.current = false;
      streamingMessageIdRef.current = null;
      delete runIdToMessageIdRef.current[runId];
      delete runIdToTextRef.current[runId];
      if (activeConversationId) {
        setConversationProgress((prev) => {
          if (!prev[activeConversationId]) return prev;
          const next = { ...prev };
          delete next[activeConversationId];
          return next;
        });
      }
    }
  }, [activeConversationId, activeTripId, extractChatText, notificationsEnabled, refreshItinerary]);

  const handleGatewayEvent = useCallback((event: { event: string; payload: any }) => {
    if (event.event === "chat") {
      void handleChatEvent(event.payload);
    }
  }, [handleChatEvent]);

  const { connected: isConnected, request: gatewayRequest } = useGateway({
    url: gatewayParams.url,
    enabled: true,
    token: gatewayParams.token ?? null,
    password: gatewayParams.password ?? null,
    onEvent: handleGatewayEvent,
    onClose: (reason) => {
      setConnectionError(`Gateway disconnected: ${reason}`);
    },
  });

  const canType = Boolean(isConnected && activeTripId && activeConversationId);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const notifPref = window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (notifPref === "true" && "Notification" in window && Notification.permission === "granted") {
      setNotificationsEnabled(true);
    }
  }, []);

  const toggleNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, "false");
      return;
    }

    if (Notification.permission === "granted") {
      setNotificationsEnabled(true);
      window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, "true");
    } else if (Notification.permission !== "denied") {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        setNotificationsEnabled(true);
        window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, "true");
      }
    }
  };

  const refreshTrips = async () => {
    const res = await apiFetch<Trip[]>("/api/trips", { method: "GET" });
    if (!res.ok) {
      setConnectionError(`API error (${res.status}): ${res.error}`);
      return;
    }
    setConnectionError(null);
    setTrips(res.data);

    const initialRoute = initialRouteRef.current;
    if (initialRoute && res.data.length > 0) {
      initialRouteRef.current = null;

      if (initialRoute.tripId) {
        const validTrip = res.data.find((t) => t.id === initialRoute.tripId);
        if (validTrip) {
          setActiveTripId(initialRoute.tripId);
        } else {
          setActiveTripId(res.data[0].id);
          syncUrl(res.data[0].id, null, res.data[0].name);
        }
      } else {
        setActiveTripId(res.data[0].id);
        syncUrl(res.data[0].id, null, res.data[0].name);
      }
      return;
    }

    if (!activeTripId && res.data.length > 0) {
      setActiveTripId(res.data[0].id);
    }
  };

  const refreshConversations = async (tripId: string, options?: { initialConversationId?: string | null }) => {
    const res = await apiFetch<Conversation[]>(`/api/trips/${tripId}/conversations`, { method: "GET" });
    if (!res.ok) return;
    setConversations(res.data);

    if (options?.initialConversationId) {
      const validConversation = res.data.find((c) => c.id === options.initialConversationId);
      if (validConversation) {
        setActiveConversationId(options.initialConversationId);
        urlSyncEnabledRef.current = true;
        return;
      }
    }

    if (res.data.length > 0) {
      setActiveConversationId(res.data[0].id);
    }

    if (options?.initialConversationId !== undefined) {
      urlSyncEnabledRef.current = true;
    }
  };

  const refreshMessages = async (tripId: string, conversationId: string) => {
    const res = await apiFetch<any[]>(`/api/trips/${tripId}/conversations/${conversationId}/messages?limit=800`, {
      method: "GET",
    });
    if (!res.ok) return;
    const mapped: Message[] = res.data.map((m) => {
      if (m.type === "assistant") {
        return { id: m.id, type: "assistant", content: [createTextBlock(m.content)], timestamp: m.timestamp, metadata: m.metadata };
      }
      if (m.type === "system") {
        return { id: m.id, type: "system", content: m.content, timestamp: m.timestamp, metadata: m.metadata };
      }
      return { id: m.id, type: "user", content: m.content, timestamp: m.timestamp, metadata: m.metadata };
    });
    setMessages(mapped);
  };

  const refreshItinerary = useCallback(async () => {
    if (!activeTripId) return;
    const res = await apiFetch<string>(`/api/trips/${activeTripId}/itinerary`, { method: "GET" });
    if (!res.ok) return;
    setItineraryMarkdown(res.data);
  }, [activeTripId]);

  useEffect(() => {
    refreshTrips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingInitialConversationIdRef = useRef<string | null | undefined>(undefined);

  const handleSelectTrip = useCallback((tripId: string) => {
    if (tripId === activeTripId) return;
    const tripName = trips.find((t) => t.id === tripId)?.name ?? null;
    navigate(tripId, null, { tripName });
    setActiveTripId(tripId);
  }, [activeTripId, navigate, trips]);

  const handleSelectConversation = useCallback((conversationId: string) => {
    if (!activeTripId) return;
    if (conversationId === activeConversationId) return;
    navigate(activeTripId, conversationId, { tripName: activeTripName });
    setActiveConversationId(conversationId);
  }, [activeTripId, activeConversationId, navigate, activeTripName]);

  useEffect(() => {
    if (!activeTripId) return;
    queryInProgressRef.current = false;
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
    setItineraryMarkdown("");
    setIsLoading(false);
    setConversationProgress({});
    streamingMessageIdRef.current = null;
    runIdToMessageIdRef.current = {};
    runIdToTextRef.current = {};

    let initialConversationId: string | null | undefined = undefined;
    const pendingRoute = pendingRouteRef.current;
    if (pendingRoute && pendingRoute.tripId === activeTripId) {
      initialConversationId = pendingRoute.conversationId ?? null;
      pendingRouteRef.current = null;
    } else if (pendingInitialConversationIdRef.current === undefined && initialRouteRef.current === null) {
      const currentRoute = getInitialRoute();
      if (currentRoute.tripId === activeTripId && currentRoute.conversationId) {
        initialConversationId = currentRoute.conversationId;
      } else {
        initialConversationId = null;
      }
      pendingInitialConversationIdRef.current = null;
    }

    refreshConversations(activeTripId, initialConversationId !== undefined ? { initialConversationId } : undefined);
    refreshItinerary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTripId]);

  useEffect(() => {
    if (!activeTripId || activeConversationId || conversations.length === 0) return;
    setActiveConversationId(conversations[0].id);
  }, [activeTripId, activeConversationId, conversations]);

  useEffect(() => {
    if (!urlSyncEnabledRef.current) return;
    syncUrl(activeTripId, activeConversationId, activeTripName);
  }, [activeTripId, activeConversationId, activeTripName, syncUrl]);

  useEffect(() => {
    if (!activeTripId || !activeConversationId) return;
    setIsLoading(false);
    streamingMessageIdRef.current = null;
    runIdToMessageIdRef.current = {};
    runIdToTextRef.current = {};
    refreshMessages(activeTripId, activeConversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTripId, activeConversationId]);

  const prevIsLoadingRef = useRef(isLoading);
  useEffect(() => {
    const wasLoading = prevIsLoadingRef.current;
    prevIsLoadingRef.current = isLoading;
    if (wasLoading && !isLoading) {
      setTimeout(() => chatTextareaRef.current?.focus(), 50);
    }
  }, [isLoading]);

  const handleCreateTrip = () => {
    setNewTripName("");
    setShowNewTripModal(true);
    setTimeout(() => newTripInputRef.current?.focus(), 50);
  };

  const handleNewTripSubmit = async () => {
    const name = newTripName.trim();
    if (!name) return;
    setShowNewTripModal(false);
    const res = await apiFetch<Trip>("/api/trips", { method: "POST", body: JSON.stringify({ name }) });
    if (!res.ok) {
      alert(`Failed to create trip: ${res.error}`);
      return;
    }
    await refreshTrips();

    const convRes = await apiFetch<Conversation>(
      `/api/trips/${res.data.id}/conversations`,
      { method: "POST", body: JSON.stringify({ title: "Planning" }) }
    );
    if (convRes.ok) {
      await refreshConversations(res.data.id);
      setMessages([]);
      setIsLoading(false);
      navigate(res.data.id, convRes.data.id, { tripName: res.data.name });
      setActiveTripId(res.data.id);
      setActiveConversationId(convRes.data.id);
    } else {
      navigate(res.data.id, null, { tripName: res.data.name });
      setActiveTripId(res.data.id);
    }
  };

  const handleDeleteTrip = useCallback(async () => {
    if (!activeTripId) return;
    const tripName = activeTrip?.name ?? "this trip";
    const okToDelete = confirm(
      `Delete "${tripName}"? This will remove its itinerary, chats, uploads, and assets. This cannot be undone.`
    );
    if (!okToDelete) return;
    const res = await apiFetch<{ ok: true }>(`/api/trips/${activeTripId}`, { method: "DELETE" });
    if (!res.ok) {
      alert(`Delete failed: ${res.error}`);
      return;
    }

    const remaining = trips.filter((t) => t.id !== activeTripId);
    setTrips(remaining);
    setDraftsByTrip((prev) => {
      if (!(activeTripId in prev)) return prev;
      const next = { ...prev };
      delete next[activeTripId];
      return next;
    });
    setDraftHeightsByTrip((prev) => {
      if (!(activeTripId in prev)) return prev;
      const next = { ...prev };
      delete next[activeTripId];
      return next;
    });

    if (remaining.length > 0) {
      navigate(remaining[0].id, null, { tripName: remaining[0].name });
      setActiveTripId(remaining[0].id);
      return;
    }
    navigate(null, null);
    setActiveTripId(null);
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
    setItineraryMarkdown("");
    setIsLoading(false);
    setConversationProgress({});
    streamingMessageIdRef.current = null;
    runIdToMessageIdRef.current = {};
    runIdToTextRef.current = {};
  }, [activeTripId, activeTrip?.name, trips, navigate]);

  const handleCreateConversation = async () => {
    if (!activeTripId) return;
    const res = await apiFetch<Conversation>(`/api/trips/${activeTripId}/conversations`, { method: "POST" });
    if (!res.ok) {
      alert(`Failed to create chat: ${res.error}`);
      return;
    }
    await refreshConversations(activeTripId);
    navigate(activeTripId, res.data.id, { tripName: activeTripName });
    setActiveConversationId(res.data.id);
    setMessages([]);
  };

  const handleDeleteConversation = async (conversation: Conversation) => {
    if (!activeTripId) return;
    const title = conversation.title?.trim() || "this chat";
    const okToDelete = confirm(`Delete "${title}"? This will remove this chat's history. This cannot be undone.`);
    if (!okToDelete) return;
    const res = await apiFetch<{ ok: true }>(
      `/api/trips/${activeTripId}/conversations/${conversation.id}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      alert(`Delete failed: ${res.error}`);
      return;
    }

    const remaining = conversations.filter((c) => c.id !== conversation.id);
    setConversations(remaining);

    if (conversation.id === activeConversationId) {
      if (remaining.length > 0) {
        navigate(activeTripId, remaining[0].id, { tripName: activeTripName });
        setActiveConversationId(remaining[0].id);
      } else {
        navigate(activeTripId, null, { tripName: activeTripName });
        setActiveConversationId(null);
        setMessages([]);
        setIsLoading(false);
        setConversationProgress({});
        streamingMessageIdRef.current = null;
        runIdToMessageIdRef.current = {};
        runIdToTextRef.current = {};
      }
    }
  };

  const sendChatMessage = useCallback(async (sessionKey: string, message: string) => {
    try {
      await gatewayRequest("chat.send", { sessionKey, message, idempotencyKey: makeId() });
    } catch (err) {
      setConnectionError(`Gateway send failed: ${String(err)}`);
      setIsLoading(false);
      queryInProgressRef.current = false;
    }
  }, [gatewayRequest]);

  const handleStartConversationWithPrompt = useCallback(async (prompt: string, title?: string) => {
    if (!activeTripId) return;
    const res = await apiFetch<Conversation>(
      `/api/trips/${activeTripId}/conversations`,
      { method: "POST", body: JSON.stringify(title ? { title } : {}) }
    );
    if (!res.ok) {
      alert(`Failed to start chat: ${res.error}`);
      return;
    }
    await refreshConversations(activeTripId);
    navigate(activeTripId, res.data.id, { tripName: activeTripName });
    setActiveConversationId(res.data.id);
    streamingMessageIdRef.current = null;
    runIdToMessageIdRef.current = {};
    runIdToTextRef.current = {};
    queryInProgressRef.current = true;
    setIsLoading(true);
    setConversationProgress((prev) => (prev[res.data.id] ? prev : { ...prev, [res.data.id]: true }));
    const timestamp = new Date().toISOString();
    const messageId = makeId();
    const userMessage: Message = { id: messageId, type: "user", content: prompt, timestamp };
    setMessages([userMessage]);
    void apiFetch<{ ok: true }>(
      `/api/trips/${activeTripId}/conversations/${res.data.id}/messages`,
      { method: "POST", body: JSON.stringify({ id: messageId, type: "user", content: prompt, timestamp }) }
    );
    const sessionKey = res.data.sessionKey ?? `agent:travel:${activeTripId}:${res.data.id}`;
    void sendChatMessage(sessionKey, prompt);
  }, [activeTripId, activeTripName, sendChatMessage]);

  const handleSendUserText = useCallback((text: string) => {
    if (!activeTripId || !activeConversationId || !activeSessionKey) return;
    queryInProgressRef.current = true;
    const timestamp = new Date().toISOString();
    const messageId = makeId();
    const userMessage: Message = { id: messageId, type: "user", content: text, timestamp };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setConversationProgress((prev) =>
      prev[activeConversationId] ? prev : { ...prev, [activeConversationId]: true }
    );
    void apiFetch<{ ok: true }>(
      `/api/trips/${activeTripId}/conversations/${activeConversationId}/messages`,
      { method: "POST", body: JSON.stringify({ id: messageId, type: "user", content: text, timestamp }) }
    );
    void sendChatMessage(activeSessionKey, text);
  }, [activeTripId, activeConversationId, activeSessionKey, sendChatMessage]);

  const mapRequestPrompt =
    "Generate a trip map for my itinerary route. Use the current itinerary to determine the ordered destinations. If the route is unclear, ask me for the ordered list.";

  const handleRequestMap = useCallback(() => {
    if (!activeTripId) return;
    void handleStartConversationWithPrompt(mapRequestPrompt, "Trip map");
  }, [activeTripId, handleStartConversationWithPrompt, mapRequestPrompt]);

  const handleCollapseItinerary = useCallback(() => {
    setItineraryFullWidth(false);
    setShowItinerary(false);
  }, []);

  const handleExpandItinerary = useCallback(() => {
    setItineraryFullWidth(true);
  }, []);

  const handleRestoreItinerary = useCallback(() => {
    setItineraryFullWidth(false);
  }, []);

  const handleCancelResponse = useCallback(() => {
    if (!activeSessionKey) return;
    void gatewayRequest("chat.abort", { sessionKey: activeSessionKey }).catch(() => undefined);
    setIsLoading(false);
    queryInProgressRef.current = false;
    streamingMessageIdRef.current = null;
    if (activeConversationId) {
      setConversationProgress((prev) => {
        if (!prev[activeConversationId]) return prev;
        const next = { ...prev };
        delete next[activeConversationId];
        return next;
      });
    }
  }, [activeConversationId, activeSessionKey, gatewayRequest]);

  return (
    <div className="flex flex-col h-screen" style={{ background: "hsl(var(--bg-primary))" }}>
      <header
        className="app-header px-5 py-3"
        style={{
          background: "linear-gradient(180deg, hsl(var(--bg-secondary)) 0%, hsl(var(--bg-primary)) 100%)",
          borderBottom: "1px solid hsl(var(--border-subtle))",
        }}
      >
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4 animate-fade-in shrink-0">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--accent-primary)) 0%, hsl(var(--accent-secondary)) 100%)",
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ color: "hsl(var(--text-inverse))" }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
                </svg>
              </div>
              <div>
                <h1 className="header-display text-lg leading-tight" style={{ color: "hsl(var(--text-primary))" }}>
                  Travel Agent
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2 pl-3" style={{ borderLeft: "1px solid hsl(var(--border-subtle))" }}>
              <div className={`status-dot ${isConnected ? "connected" : "disconnected"}`} />
              <span className="text-xs" style={{ color: "hsl(var(--text-tertiary))" }}>
                {isConnected ? "Connected" : "Connecting..."}
              </span>
              {typeof window !== "undefined" && "Notification" in window && (
                <button
                  type="button"
                  onClick={toggleNotifications}
                  className="ml-2 p-1.5 rounded-md transition-colors"
                  style={{
                    color: notificationsEnabled ? "hsl(var(--accent-primary))" : "hsl(var(--text-tertiary))",
                    background: notificationsEnabled ? "hsl(var(--accent-primary) / 0.1)" : "transparent",
                  }}
                  title={
                    notificationsEnabled
                      ? "Notifications enabled (click to disable)"
                      : "Enable notifications when response is ready"
                  }
                >
                  <BellIcon enabled={notificationsEnabled} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center min-w-0 px-6">
            <div className="trip-pills-container">
              {trips.length === 0 ? (
                <span className="text-sm" style={{ color: "hsl(var(--text-tertiary))" }}>
                  No trips yet — create one to get started
                </span>
              ) : (
                trips.map((t, i) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`trip-pill animate-fade-in ${t.id === activeTripId ? "active" : ""}`}
                    style={{ animationDelay: `${i * 50}ms` }}
                    onClick={() => handleSelectTrip(t.id)}
                  >
                    {t.name}
                  </button>
                ))
              )}
              <button type="button" className="trip-pill add-trip" onClick={handleCreateTrip} title="Plan a new trip">
                <PlusIcon />
              </button>
            </div>
          </div>
        </div>

        {connectionError && (
          <div className="mt-3 p-2.5 rounded-lg" style={{ background: "hsl(var(--error) / 0.1)" }}>
            <p className="text-xs text-center" style={{ color: "hsl(var(--error))" }}>
              {connectionError}
            </p>
          </div>
        )}
      </header>

      <div className="flex-1 flex overflow-hidden app-main-content">
        {!itineraryFullWidth && (
          <aside className={`chat-sidebar ${sidebarOpen ? "open" : "closed"}`} style={{ background: "hsl(var(--bg-secondary))" }}>
            <div className="chat-sidebar-header">
              <div className="flex items-center gap-2">
                <ChatBubbleIcon />
                <span className="mono-label">Chats</span>
              </div>
              <button
                type="button"
                className="sidebar-toggle"
                onClick={() => setSidebarOpen(false)}
                title="Collapse sidebar"
              >
                <ChevronLeftIcon />
              </button>
            </div>

            <div className="chat-sidebar-content">
              {!activeTripId ? (
                <div className="chat-sidebar-empty">
                  <span className="mono-label text-xs">Select a trip</span>
                </div>
              ) : conversations.length === 0 ? (
                <div className="chat-sidebar-empty">
                  <span className="mono-label text-xs">No chats yet</span>
                  <button type="button" className="btn-secondary mt-3" onClick={handleCreateConversation} disabled={!activeTripId}>
                    Start a chat
                  </button>
                </div>
              ) : (
                <div className="chat-list">
                  {conversations.map((c) => (
                    <div key={c.id} className={`chat-list-item ${c.id === activeConversationId ? "active" : ""}`}>
                      <button
                        type="button"
                        className="chat-list-main"
                        onClick={() => {
                          handleSelectConversation(c.id);
                          setMobileTripsSubview("conversation");
                        }}
                      >
                        <span className="chat-list-title">{c.title}</span>
                        <span className="chat-list-date">{new Date(c.createdAt).toLocaleDateString()}</span>
                      </button>
                      <div className="chat-list-actions">
                        {conversationProgress[c.id] && (
                          <div className="chat-progress busy" aria-hidden="true">
                            <span className="chat-progress-dot" />
                            <span className="chat-progress-dot" />
                            <span className="chat-progress-dot" />
                          </div>
                        )}
                        <button
                          type="button"
                          className="chat-delete-btn"
                          title="Delete chat"
                          aria-label={`Delete ${c.title}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteConversation(c);
                          }}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="chat-sidebar-footer">
              <button type="button" className="new-chat-btn" onClick={handleCreateConversation} disabled={!activeTripId}>
                <PlusIcon />
                <span>New Chat</span>
              </button>
            </div>
          </aside>
        )}

        {!itineraryFullWidth && !sidebarOpen && (
          <button type="button" className="sidebar-expand-btn" onClick={() => setSidebarOpen(true)} title="Expand sidebar">
            <ChevronRightIcon />
          </button>
        )}

        <main className="app-main-area flex-1 flex overflow-hidden p-4 gap-4">
          {!itineraryFullWidth && (
            <div
              className={`chat-panel-container terminal-container overflow-hidden ${showItinerary ? "flex-1" : "flex-1"} ${
                mobileView === "trips" && mobileTripsSubview === "conversation" ? "mobile-visible mobile-has-header" : ""
              }`}
            >
              <ChatPanel
                isConnected={isConnected}
                isLoading={isLoading}
                inputDisabled={!canType}
                messages={messages}
                draft={activeDraft}
                setDraft={setDraftForActiveTrip}
                textareaHeight={activeDraftHeight}
                onTextareaHeightChange={setDraftHeightForActiveTrip}
                onSend={handleSendUserText}
                onCancel={handleCancelResponse}
                tripName={activeTrip?.name ?? null}
                itineraryMarkdown={itineraryMarkdown}
                textareaRef={chatTextareaRef}
              />
            </div>
          )}

          {(showItinerary || itineraryFullWidth) && (
            <div
              className={`terminal-container overflow-hidden flex-1 flex flex-col itinerary-pane-container ${
                mobileView === "itinerary" ? "mobile-visible" : ""
              }`}
            >
              <div className="flex-1 overflow-hidden">
                <ItineraryPane
                  tripId={activeTripId}
                  tripName={activeTrip?.name}
                  markdown={itineraryMarkdown}
                  onRefresh={refreshItinerary}
                  onRequestMap={activeTripId ? handleRequestMap : undefined}
                  onDeleteTrip={handleDeleteTrip}
                  onCollapse={handleCollapseItinerary}
                  isFullWidth={itineraryFullWidth}
                  onExpand={handleExpandItinerary}
                  onRestore={handleRestoreItinerary}
                  tripCreatedAt={activeTrip?.createdAt ?? null}
                  tripUpdatedAt={activeTrip?.updatedAt ?? null}
                />
              </div>
            </div>
          )}

          {!showItinerary && activeTripId && (
            <button
              type="button"
              className="itinerary-expand-btn"
              onClick={() => setShowItinerary(true)}
              title="Show itinerary"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M8 7l-5 5 5 5M3 12h12" />
              </svg>
            </button>
          )}
        </main>
      </div>

      {showNewTripModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0, 0, 0, 0.5)" }}
          onClick={() => setShowNewTripModal(false)}
        >
          <div
            className="rounded-xl shadow-2xl p-6 w-full max-w-md mx-4"
            style={{ background: "hsl(var(--bg-secondary))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              className="text-xl font-semibold mb-4"
              style={{ fontFamily: "'Cormorant Garamond', serif", color: "hsl(var(--text-primary))" }}
            >
              Plan a new trip
            </h2>
            <p className="text-sm mb-4" style={{ color: "hsl(var(--text-secondary))" }}>
              What destination are you dreaming of?
            </p>
            <input
              ref={newTripInputRef}
              type="text"
              value={newTripName}
              onChange={(e) => setNewTripName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNewTripSubmit();
                if (e.key === "Escape") setShowNewTripModal(false);
              }}
              placeholder="e.g., Iceland, Japan, Paris..."
              className="w-full px-4 py-3 rounded-lg mb-4 text-base"
              style={{
                background: "hsl(var(--bg-primary))",
                border: "1px solid hsl(var(--border-medium))",
                color: "hsl(var(--text-primary))",
                outline: "none",
              }}
            />
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowNewTripModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{
                  background: "hsl(var(--bg-tertiary))",
                  color: "hsl(var(--text-secondary))",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleNewTripSubmit}
                disabled={!newTripName.trim()}
                className="btn-primary px-4 py-2 text-sm font-medium"
                style={{
                  opacity: newTripName.trim() ? 1 : 0.5,
                  cursor: newTripName.trim() ? "pointer" : "default",
                }}
              >
                Start Planning
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`mobile-panel mobile-trips-panel ${mobileView === "trips" && mobileTripsSubview === "trips" ? "visible" : ""}`}>
        <div className="mobile-panel-header">
          <h2 className="mobile-panel-title">My Trips</h2>
          <button type="button" className="mobile-panel-action" onClick={handleCreateTrip}>
            <PlusIcon /> New
          </button>
        </div>
        <div className="mobile-panel-content">
          {trips.length === 0 ? (
            <div className="mobile-empty-state">
              <div className="mobile-empty-icon">
                <CompassIcon />
              </div>
              <p>No trips yet</p>
              <button type="button" className="btn-primary mt-4" onClick={handleCreateTrip}>
                Plan your first trip
              </button>
            </div>
          ) : (
            <div className="mobile-trips-list">
              {trips.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`mobile-trip-item ${t.id === activeTripId ? "active" : ""}`}
                  onClick={() => {
                    handleSelectTrip(t.id);
                    setMobileTripsSubview("chats");
                  }}
                >
                  <div className="mobile-trip-icon">
                    <CompassIcon />
                  </div>
                  <div className="mobile-trip-info">
                    <span className="mobile-trip-name">{t.name}</span>
                    <span className="mobile-trip-date">{new Date(t.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <ChevronRightIcon />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={`mobile-panel mobile-chat-panel ${mobileView === "trips" && mobileTripsSubview === "chats" ? "visible" : ""}`}>
        <div className="mobile-panel-header">
          <button type="button" className="mobile-back-btn" onClick={() => setMobileTripsSubview("trips")}>
            <BackArrowIcon />
            <span>Trips</span>
          </button>
          <h2 className="mobile-panel-title">{activeTrip?.name ?? "Chats"}</h2>
          <button type="button" className="mobile-panel-action" onClick={handleCreateConversation} disabled={!activeTripId}>
            <PlusIcon /> New
          </button>
        </div>
        <div className="mobile-panel-content">
          {conversations.length === 0 ? (
            <div className="mobile-empty-state">
              <div className="mobile-empty-icon">
                <MessageIcon />
              </div>
              <p>No conversations yet</p>
              <button type="button" className="btn-primary mt-4" onClick={handleCreateConversation}>
                Start a conversation
              </button>
            </div>
          ) : (
            <div className="mobile-chat-list">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`mobile-chat-item ${c.id === activeConversationId ? "active" : ""}`}
                  onClick={() => {
                    handleSelectConversation(c.id);
                    setMobileTripsSubview("conversation");
                  }}
                >
                  <div className="mobile-chat-info">
                    <span className="mobile-chat-title">{c.title}</span>
                    <span className="mobile-chat-date">{new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>
                  {conversationProgress[c.id] && (
                    <div className="chat-progress busy" aria-hidden="true">
                      <span className="chat-progress-dot" />
                      <span className="chat-progress-dot" />
                      <span className="chat-progress-dot" />
                    </div>
                  )}
                  <ChevronRightIcon />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={`mobile-chat-header ${mobileView === "trips" && mobileTripsSubview === "conversation" ? "visible" : ""}`}>
        <button type="button" className="mobile-back-btn" onClick={() => setMobileTripsSubview("chats")}>
          <BackArrowIcon />
          <span>{activeTrip?.name ?? "Chats"}</span>
        </button>
        <span className="mobile-chat-current-title">{activeConversation?.title ?? "Conversation"}</span>
      </div>

      <nav className="mobile-tab-bar">
        <div className="mobile-tab-bar-inner">
          <button type="button" className={`mobile-tab-btn ${mobileView === "trips" ? "active" : ""}`} onClick={() => setMobileView("trips")}>
            <span className="mobile-tab-icon"><CompassIcon /></span>
            <span>Trips</span>
          </button>
          <button type="button" className={`mobile-tab-btn ${mobileView === "itinerary" ? "active" : ""}`} onClick={() => setMobileView("itinerary")}>
            <span className="mobile-tab-icon"><MapIcon /></span>
            <span>Itinerary</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default App;
