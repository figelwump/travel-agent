import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useUrlRouter } from "./hooks/useUrlRouter";
import { Message, TextBlock, ToolActivity } from "./components/message/types";
import { ChatPanel } from "./components/ChatPanel";
import { ItineraryPane } from "./components/ItineraryPane";
import { RemindersPane } from "./RemindersPane";

const createTextBlock = (text: string): TextBlock => ({ type: 'text', text });

type Credentials = { password: string };
const CREDENTIALS_STORAGE_KEY = 'travelagent:auth';
const NOTIFICATIONS_STORAGE_KEY = 'travelagent:notifications';

type Trip = { id: string; name: string; createdAt: string; updatedAt: string };
type Conversation = { id: string; tripId: string; title: string; createdAt: string; updatedAt: string; sdkSessionId?: string | null };

// Icons as inline SVGs for cleaner UI
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

function authHeader(credentials: Credentials | null): string | null {
  if (!credentials?.password) return null;
  return `Basic ${btoa(`user:${credentials.password}`)}`;
}

async function apiFetch<T>(
  url: string,
  opts: RequestInit,
  credentials: Credentials | null
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const headers = new Headers(opts.headers || {});
  const auth = authHeader(credentials);
  if (auth) headers.set('Authorization', auth);
  if (!headers.has('Content-Type') && opts.body && !(opts.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...opts, headers });
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  if (!res.ok) {
    const text = isJson ? JSON.stringify(await res.json().catch(() => ({}))) : await res.text().catch(() => '');
    return { ok: false, status: res.status, error: text || res.statusText };
  }
  if (isJson) return { ok: true, data: await res.json() as T };
  return { ok: true, data: await res.text() as T };
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [hasEverConnected, setHasEverConnected] = useState(false);
  const streamingMessageIdRef = useRef<string | null>(null);
  const toolActivityMessageIdRef = useRef<string | null>(null);
  const toolUseToMessageRef = useRef<Record<string, string>>({});
  const pendingItineraryRefreshRef = useRef(false);
  const queryInProgressRef = useRef(false);
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [itineraryMarkdown, setItineraryMarkdown] = useState<string>('');
  const [showItinerary, setShowItinerary] = useState(true);
  const [rightPaneView, setRightPaneView] = useState<'itinerary' | 'reminders'>('itinerary');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [draftsByTrip, setDraftsByTrip] = useState<Record<string, string>>({});
  const [draftHeightsByTrip, setDraftHeightsByTrip] = useState<Record<string, number>>({});
  const [showNewTripModal, setShowNewTripModal] = useState(false);
  const [newTripName, setNewTripName] = useState('');
  const newTripInputRef = useRef<HTMLInputElement>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  // URL routing - store initial route from URL on mount
  const initialRouteRef = useRef<{ tripId: string | null; conversationId: string | null } | null>(null);
  const urlSyncEnabledRef = useRef(false);
  const pendingRouteRef = useRef<{ tripId: string | null; conversationId: string | null } | null>(null);

  // Handle browser back/forward navigation
  const handlePopState = useCallback((route: { tripId: string | null; conversationId: string | null }) => {
    if (!urlSyncEnabledRef.current) return;

    setActiveTripId(prevTripId => {
      if (route.tripId === prevTripId) {
        pendingRouteRef.current = null;
        return prevTripId;
      }
      pendingRouteRef.current = route.tripId ? route : null;
      return route.tripId;
    });

    setActiveConversationId(prevConversationId => {
      if (route.conversationId === prevConversationId) return prevConversationId;
      return route.conversationId;
    });
  }, []);

  const { getInitialRoute, navigate, syncUrl } = useUrlRouter(handlePopState);

  // Capture initial route on mount
  useEffect(() => {
    if (initialRouteRef.current === null) {
      initialRouteRef.current = getInitialRoute();
    }
  }, [getInitialRoute]);

  const activeDraft = useMemo(() => {
    if (!activeTripId) return '';
    return draftsByTrip[activeTripId] ?? '';
  }, [activeTripId, draftsByTrip]);

  const activeDraftHeight = useMemo(() => {
    if (!activeTripId) return null;
    return draftHeightsByTrip[activeTripId] ?? null;
  }, [activeTripId, draftHeightsByTrip]);

  const setDraftForActiveTrip = (value: string) => {
    if (!activeTripId) return;
    setDraftsByTrip(prev => {
      if (prev[activeTripId] === value) return prev;
      return { ...prev, [activeTripId]: value };
    });
    if (value.length === 0) {
      setDraftHeightsByTrip(prev => {
        if (!(activeTripId in prev)) return prev;
        const next = { ...prev };
        delete next[activeTripId];
        return next;
      });
    }
  };

  const setDraftHeightForActiveTrip = (value: number) => {
    if (!activeTripId) return;
    setDraftHeightsByTrip(prev => {
      if (prev[activeTripId] === value) return prev;
      return { ...prev, [activeTripId]: value };
    });
  };

  const wsUrl = typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
    : 'ws://localhost:3001/ws';

  const activeTrip = useMemo(() => trips.find(t => t.id === activeTripId) ?? null, [trips, activeTripId]);
  const activeConversation = useMemo(() => conversations.find(c => c.id === activeConversationId) ?? null, [conversations, activeConversationId]);
  const activeTripName = activeTrip?.name ?? null;

  // Single WebSocket connection for all components
  const { isConnected, sendMessage } = useWebSocket({
    url: wsUrl,
    enabled: Boolean(credentials),
    maxReconnectAttempts: 5,
    onMessage: (message) => {
      switch (message.type) {
        case 'auth_required': {
          // Server requires authentication - send password
          if (credentials) {
            console.log('Sending auth message');
            sendMessage({ type: 'auth', password: credentials.password });
          }
          break;
        }
        case 'connected': {
          console.log('Connected to server:', message.message);
          setConnectionError(null);
          setHasEverConnected(true);
          break;
        }
        case 'tool_use': {
          if (message.tripId !== activeTripId || message.conversationId !== activeConversationId) break;
          const tool = message.tool;
          if (!tool || !tool.id) break;
          const timestamp = message.timestamp || new Date().toISOString();
          const ensureMessageId = () => {
            if (toolActivityMessageIdRef.current) return toolActivityMessageIdRef.current;
            if (streamingMessageIdRef.current) {
              toolActivityMessageIdRef.current = streamingMessageIdRef.current;
              return toolActivityMessageIdRef.current;
            }
            const newId = `${Date.now()}-assistant-tools`;
            toolActivityMessageIdRef.current = newId;
            if (!streamingMessageIdRef.current) {
              streamingMessageIdRef.current = newId;
            }
            return newId;
          };
          const messageId = ensureMessageId();
          toolUseToMessageRef.current[tool.id] = messageId;
          const nextTool: ToolActivity = {
            id: tool.id,
            name: tool.name ?? 'Tool',
            input: tool.input ?? {},
            status: 'running',
            startedAt: timestamp,
          };
          setMessages(prev => {
            const index = prev.findIndex(msg => msg.id === messageId);
            if (index < 0) {
              const toolMessage: Message = {
                id: messageId,
                type: 'assistant',
                content: [],
                timestamp,
                metadata: { streaming: true, toolActivity: [nextTool] },
              };
              return [...prev, toolMessage];
            }
            const next = [...prev];
            const msg = next[index];
            if (msg.type !== 'assistant') return prev;
            const existing = Array.isArray(msg.metadata?.toolActivity)
              ? msg.metadata?.toolActivity as ToolActivity[]
              : [];
            const existingIndex = existing.findIndex(item => item.id === tool.id);
            const updated = [...existing];
            if (existingIndex >= 0) {
              updated[existingIndex] = { ...existing[existingIndex], ...nextTool };
            } else {
              updated.push(nextTool);
            }
            next[index] = {
              ...msg,
              metadata: { ...(msg.metadata ?? {}), toolActivity: updated },
            };
            return next;
          });
          break;
        }
        case 'tool_use_start': {
          // Immediately show tool activity when tool generation begins (before input is complete)
          if (message.tripId !== activeTripId || message.conversationId !== activeConversationId) break;
          const tool = message.tool;
          if (!tool || !tool.id) break;
          const timestamp = message.timestamp || new Date().toISOString();
          const ensureMessageId = () => {
            if (toolActivityMessageIdRef.current) return toolActivityMessageIdRef.current;
            if (streamingMessageIdRef.current) {
              toolActivityMessageIdRef.current = streamingMessageIdRef.current;
              return toolActivityMessageIdRef.current;
            }
            const newId = `${Date.now()}-assistant-tools`;
            toolActivityMessageIdRef.current = newId;
            if (!streamingMessageIdRef.current) {
              streamingMessageIdRef.current = newId;
            }
            return newId;
          };
          const messageId = ensureMessageId();
          toolUseToMessageRef.current[tool.id] = messageId;
          const nextTool: ToolActivity = {
            id: tool.id,
            name: tool.name ?? 'Tool',
            input: {}, // Input not yet available during streaming
            status: 'running',
            startedAt: timestamp,
          };
          setMessages(prev => {
            const index = prev.findIndex(msg => msg.id === messageId);
            if (index < 0) {
              const toolMessage: Message = {
                id: messageId,
                type: 'assistant',
                content: [],
                timestamp,
                metadata: { streaming: true, toolActivity: [nextTool] },
              };
              return [...prev, toolMessage];
            }
            const next = [...prev];
            const msg = next[index];
            if (msg.type !== 'assistant') return prev;
            const existing = Array.isArray(msg.metadata?.toolActivity)
              ? msg.metadata?.toolActivity as ToolActivity[]
              : [];
            const existingIndex = existing.findIndex(item => item.id === tool.id);
            if (existingIndex >= 0) return prev; // Already tracked
            const updated = [...existing, nextTool];
            next[index] = {
              ...msg,
              metadata: { ...(msg.metadata ?? {}), streaming: true, toolActivity: updated },
            };
            return next;
          });
          break;
        }
        case 'tool_result': {
          if (message.tripId !== activeTripId || message.conversationId !== activeConversationId) break;
          const toolUseId = message.tool_use_id;
          if (!toolUseId) break;
          const timestamp = message.timestamp || new Date().toISOString();
          const toolName = typeof message.tool_name === 'string' && message.tool_name
            ? message.tool_name
            : 'Tool';
          const messageId = toolUseToMessageRef.current[toolUseId]
            ?? toolActivityMessageIdRef.current
            ?? streamingMessageIdRef.current;
          if (!messageId) break;
          setMessages(prev => {
            const index = prev.findIndex(msg => msg.id === messageId);
            if (index < 0) {
              const toolMessage: Message = {
                id: messageId,
                type: 'assistant',
                content: [],
                timestamp,
                metadata: {
                  toolActivity: [{
                    id: toolUseId,
                    name: toolName,
                    status: 'complete',
                    startedAt: timestamp,
                    completedAt: timestamp,
                  }]
                },
              };
              return [...prev, toolMessage];
            }
            const next = [...prev];
            const msg = next[index];
            if (msg.type !== 'assistant') return prev;
            const existing = Array.isArray(msg.metadata?.toolActivity)
              ? msg.metadata?.toolActivity as ToolActivity[]
              : [];
            const existingIndex = existing.findIndex(item => item.id === toolUseId);
            const updated = [...existing];
            if (existingIndex >= 0) {
              updated[existingIndex] = {
                ...existing[existingIndex],
                status: 'complete',
                completedAt: timestamp,
              };
            } else {
              updated.push({
                id: toolUseId,
                name: toolName,
                status: 'complete',
                startedAt: timestamp,
                completedAt: timestamp,
              });
            }
            next[index] = {
              ...msg,
              metadata: { ...(msg.metadata ?? {}), toolActivity: updated },
            };
            return next;
          });
          delete toolUseToMessageRef.current[toolUseId];
          break;
        }
        case 'assistant_partial': {
          if (message.tripId !== activeTripId || message.conversationId !== activeConversationId) break;
          queryInProgressRef.current = true;
          const partialText = typeof message.content === 'string' ? message.content : '';
          const timestamp = new Date().toISOString();
          const existingId = streamingMessageIdRef.current;
          const streamingId = existingId ?? `${Date.now()}-assistant-partial`;

          if (!existingId) {
            streamingMessageIdRef.current = streamingId;
          }

          setMessages(prev => {
            let found = false;
            const next = prev.map(msg => {
              if (msg.id !== streamingId || msg.type !== 'assistant') {
                return msg;
              }
              found = true;
              return {
                ...msg,
                content: [createTextBlock(partialText)],
                timestamp,
                metadata: { ...(msg.metadata ?? {}), streaming: true },
              };
            });

            if (found) {
              return next;
            }

            const partialMessage: Message = {
              id: streamingId,
              type: 'assistant',
              content: [createTextBlock(partialText)],
              timestamp,
              metadata: { streaming: true },
            };

            return [...prev, partialMessage];
          });

          setIsLoading(true);
          break;
        }
        case 'assistant_message': {
          if (message.tripId !== activeTripId || message.conversationId !== activeConversationId) break;
          queryInProgressRef.current = true;
          const text = typeof message.content === 'string' ? message.content : '';
          const timestamp = new Date().toISOString();
          const streamingId = streamingMessageIdRef.current;

          setMessages(prev => {
            if (streamingId) {
              let updated = false;
              const next = prev.map(msg => {
                if (msg.id !== streamingId || msg.type !== 'assistant') {
                  return msg;
                }
                updated = true;
                const baseMetadata = { ...(msg.metadata ?? {}) };
                delete baseMetadata.streaming;
                const metadata = Object.keys(baseMetadata).length > 0 ? baseMetadata : undefined;
                return {
                  ...msg,
                  content: [createTextBlock(text)],
                  timestamp,
                  metadata,
                };
              });

              if (updated) {
                streamingMessageIdRef.current = null;
                return next;
              }
            }

            const assistantMsg: Message = {
              id: Date.now().toString() + '-assistant',
              type: 'assistant',
              content: [createTextBlock(text)],
              timestamp,
            };

            streamingMessageIdRef.current = null;
            return [...prev, assistantMsg];
          });

          // Don't set isLoading=false here - wait for 'result' event
          // Multi-turn conversations may have more assistant turns coming
          toolActivityMessageIdRef.current = null;
          break;
        }
        case 'result': {
          if (message.tripId !== activeTripId || message.conversationId !== activeConversationId) break;
          if (message.success) {
            console.log('Query completed successfully', message);
            // Refresh conversations to pick up any title updates from background agents
            refreshConversations(message.tripId);
          } else {
            console.error('Query failed:', message.error);
          }
          // Send browser notification if tab is hidden and notifications are enabled
          if (document.hidden && notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('Travel Agent', {
              body: message.success ? 'Response ready' : 'Something went wrong',
              tag: 'travel-agent-response', // Prevents duplicate notifications
            });
          }
          streamingMessageIdRef.current = null;
          setIsLoading(false);
          queryInProgressRef.current = false;
          toolActivityMessageIdRef.current = null;
          toolUseToMessageRef.current = {};
          if (pendingItineraryRefreshRef.current) {
            pendingItineraryRefreshRef.current = false;
            refreshItinerary();
          }
          break;
        }
        case 'itinerary_updated': {
          if (message.tripId !== activeTripId) break;
          const immediate = Boolean(message.immediate);
          if (immediate) {
            pendingItineraryRefreshRef.current = false;
            refreshItinerary();
            break;
          }
          if (queryInProgressRef.current) {
            pendingItineraryRefreshRef.current = true;
            break;
          }
          refreshItinerary();
          break;
        }
        case 'context_updated': {
          // noop in UI for now (context refresh happens on next message)
          break;
        }
        case 'trips_updated': {
          refreshTrips();
          break;
        }
        case 'auth_failed': {
          // Auth failed - clear credentials and show login
          console.error('Authentication failed:', message.error);
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(CREDENTIALS_STORAGE_KEY);
          }
          setCredentials(null);
          setPasswordInput('');
          setConnectionError(message.error || 'Authentication failed');
          break;
        }
        case 'error': {
          console.error('Server error:', message.error);
          const errorMessage: Message = {
            id: Date.now().toString(),
            type: 'assistant',
            content: [createTextBlock(`Error: ${message.error}`)],
            timestamp: new Date().toISOString(),
          };
          setMessages(prev => [...prev, errorMessage]);
          streamingMessageIdRef.current = null;
          setIsLoading(false);
          queryInProgressRef.current = false;
          break;
        }
      }
    },
    onError: (evt) => {
      const msg = 'Access denied or connection blocked. Verify your password.';
      console.error(msg, evt);
      setConnectionError(msg);
      if (!hasEverConnected) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(CREDENTIALS_STORAGE_KEY);
        }
        setCredentials(null);
        setPasswordInput('');
      }
    },
    onDisconnect: () => {
      if (!credentials) return;
      setConnectionError('Connection lost. Retrying...');
    }
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(CREDENTIALS_STORAGE_KEY);
    if (saved) {
      try {
        const parsed: Credentials = JSON.parse(saved);
        setCredentials(parsed);
        setPasswordInput(parsed.password);
      } catch (err) {
        console.error('Failed to parse saved credentials', err);
        window.localStorage.removeItem(CREDENTIALS_STORAGE_KEY);
      }
    }
    // Load notification preference
    const notifPref = window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (notifPref === 'true' && 'Notification' in window && Notification.permission === 'granted') {
      setNotificationsEnabled(true);
    }
  }, []);

  const toggleNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    if (notificationsEnabled) {
      // Disable notifications
      setNotificationsEnabled(false);
      window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, 'false');
      return;
    }

    // Enable notifications - request permission if needed
    if (Notification.permission === 'granted') {
      setNotificationsEnabled(true);
      window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, 'true');
    } else if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setNotificationsEnabled(true);
        window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, 'true');
      }
    }
  };

  const refreshTrips = async () => {
    const res = await apiFetch<Trip[]>('/api/trips', { method: 'GET' }, credentials);
    if (!res.ok) {
      setConnectionError(`API error (${res.status}): ${res.error}`);
      return;
    }
    setTrips(res.data);

    // Handle initial URL routing on first load
    const initialRoute = initialRouteRef.current;
    if (initialRoute && res.data.length > 0) {
      // Clear initial route so we don't re-apply it
      initialRouteRef.current = null;

      if (initialRoute.tripId) {
        // Validate URL trip ID
        const validTrip = res.data.find(t => t.id === initialRoute.tripId);
        if (validTrip) {
          setActiveTripId(initialRoute.tripId);
        } else {
          // Invalid trip ID - redirect to first trip
          setActiveTripId(res.data[0].id);
          syncUrl(res.data[0].id, null, res.data[0].name);
        }
      } else {
        // No trip in URL - select first and sync URL
        setActiveTripId(res.data[0].id);
        syncUrl(res.data[0].id, null, res.data[0].name);
      }
      return;
    }

    // Normal refresh - keep current selection if valid
    if (!activeTripId && res.data.length > 0) {
      setActiveTripId(res.data[0].id);
    }
  };

  const refreshConversations = async (tripId: string, options?: { initialConversationId?: string | null }) => {
    const res = await apiFetch<Conversation[]>(`/api/trips/${tripId}/conversations`, { method: 'GET' }, credentials);
    if (!res.ok) return;
    setConversations(res.data);

    // Handle URL-based conversation selection on initial load
    if (options?.initialConversationId) {
      const validConversation = res.data.find(c => c.id === options.initialConversationId);
      if (validConversation) {
        setActiveConversationId(options.initialConversationId);
        urlSyncEnabledRef.current = true;
        return;
      }
      // Invalid conversation ID - fall through to use most recent
    }

    // Use most recent conversation if available
    if (res.data.length > 0) {
      setActiveConversationId(res.data[0].id);
    }

    // Enable URL syncing after initial route is resolved
    if (options?.initialConversationId !== undefined) {
      urlSyncEnabledRef.current = true;
    }
  };

  const refreshMessages = async (tripId: string, conversationId: string) => {
    const res = await apiFetch<any[]>(`/api/trips/${tripId}/conversations/${conversationId}/messages?limit=800`, { method: 'GET' }, credentials);
    if (!res.ok) return;
    const mapped: Message[] = res.data.map((m) => {
      if (m.type === 'assistant') {
        return { id: m.id, type: 'assistant', content: [createTextBlock(m.content)], timestamp: m.timestamp, metadata: m.metadata };
      }
      return { id: m.id, type: 'user', content: m.content, timestamp: m.timestamp, metadata: m.metadata };
    });
    setMessages(mapped);
  };

  const refreshItinerary = async () => {
    if (!activeTripId) return;
    console.debug('[itinerary] refresh start', { tripId: activeTripId });
    const res = await apiFetch<string>(`/api/trips/${activeTripId}/itinerary`, { method: 'GET' }, credentials);
    if (!res.ok) {
      console.debug('[itinerary] refresh failed', { tripId: activeTripId, status: res.status, error: res.error });
      return;
    }
    console.debug('[itinerary] refresh success', {
      tripId: activeTripId,
      length: res.data?.length ?? 0,
      preview: (res.data ?? '').split('\n')[0] || ''
    });
    setItineraryMarkdown(res.data);
  };

  useEffect(() => {
    if (!credentials) return;
    refreshTrips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials]);

  // Track the initial conversation ID to apply on first load
  const pendingInitialConversationIdRef = useRef<string | null | undefined>(undefined);

  const handleSelectTrip = useCallback((tripId: string) => {
    if (tripId === activeTripId) return;
    const tripName = trips.find(t => t.id === tripId)?.name ?? null;
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
    if (!credentials || !activeTripId) return;
    pendingItineraryRefreshRef.current = false;
    queryInProgressRef.current = false;
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
    setItineraryMarkdown('');
    setIsLoading(false);
    streamingMessageIdRef.current = null;
    toolActivityMessageIdRef.current = null;
    toolUseToMessageRef.current = {};

    // Check if we should apply initial URL route
    // pendingInitialConversationIdRef is undefined initially, then set to null after first use
    let initialConversationId: string | null | undefined = undefined;
    const pendingRoute = pendingRouteRef.current;
    if (pendingRoute && pendingRoute.tripId === activeTripId) {
      initialConversationId = pendingRoute.conversationId ?? null;
      pendingRouteRef.current = null;
    } else if (pendingInitialConversationIdRef.current === undefined && initialRouteRef.current === null) {
      // Initial route was already consumed by refreshTrips, get the conversation ID from URL
      const currentRoute = getInitialRoute();
      if (currentRoute.tripId === activeTripId && currentRoute.conversationId) {
        initialConversationId = currentRoute.conversationId;
      } else {
        initialConversationId = null; // Signal this is initial load but no specific conversation
      }
      pendingInitialConversationIdRef.current = null; // Mark as used
    }

    refreshConversations(activeTripId, initialConversationId !== undefined ? { initialConversationId } : undefined);
    refreshItinerary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTripId, credentials]);

  useEffect(() => {
    if (!activeTripId || activeConversationId || conversations.length === 0) return;
    setActiveConversationId(conversations[0].id);
  }, [activeTripId, activeConversationId, conversations]);

  // Sync URL when active trip/conversation changes (after initial route applied)
  useEffect(() => {
    if (!urlSyncEnabledRef.current) return;
    syncUrl(activeTripId, activeConversationId, activeTripName);
  }, [activeTripId, activeConversationId, activeTripName, syncUrl]);

  useEffect(() => {
    if (!activeTripId || !activeConversationId || !credentials) return;
    setIsLoading(false);
    streamingMessageIdRef.current = null;
    toolActivityMessageIdRef.current = null;
    toolUseToMessageRef.current = {};
    refreshMessages(activeTripId, activeConversationId);
    sendMessage({ type: 'subscribe', tripId: activeTripId, conversationId: activeConversationId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTripId, activeConversationId, credentials]);

  // Re-focus the chat textarea after the assistant finishes responding
  const prevIsLoadingRef = useRef(isLoading);
  useEffect(() => {
    const wasLoading = prevIsLoadingRef.current;
    prevIsLoadingRef.current = isLoading;
    if (wasLoading && !isLoading) {
      // Slight delay to ensure DOM is updated
      setTimeout(() => chatTextareaRef.current?.focus(), 50);
    }
  }, [isLoading]);

  const handleCredentialsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const password = passwordInput.trim();
    if (!password) return;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify({ password } satisfies Credentials));
    }
    setCredentials({ password });
    setConnectionError(null);
  };

  const handleResetCredentials = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(CREDENTIALS_STORAGE_KEY);
    }
    setCredentials(null);
    setPasswordInput('');
    setConnectionError(null);
    setMessages([]);
    toolActivityMessageIdRef.current = null;
    toolUseToMessageRef.current = {};
    setTrips([]);
    setActiveTripId(null);
    setConversations([]);
    setActiveConversationId(null);
    setItineraryMarkdown('');
    setDraftsByTrip({});
    setDraftHeightsByTrip({});
  };

  const canType = Boolean(isConnected && activeTripId && activeConversationId);

  const handleCreateTrip = () => {
    setNewTripName('');
    setShowNewTripModal(true);
    // Focus input after modal renders
    setTimeout(() => newTripInputRef.current?.focus(), 50);
  };

  const handleNewTripSubmit = async () => {
    const name = newTripName.trim();
    if (!name) return;
    setShowNewTripModal(false);
    const res = await apiFetch<Trip>('/api/trips', { method: 'POST', body: JSON.stringify({ name }) }, credentials);
    if (!res.ok) {
      alert(`Failed to create trip: ${res.error}`);
      return;
    }
    await refreshTrips();

    const convRes = await apiFetch<Conversation>(
      `/api/trips/${res.data.id}/conversations`,
      { method: 'POST', body: JSON.stringify({ title: 'Planning' }) },
      credentials
    );
    if (convRes.ok) {
      await refreshConversations(res.data.id);
      setMessages([]);
      toolActivityMessageIdRef.current = null;
      toolUseToMessageRef.current = {};
      setIsLoading(false);
      // Navigate to new trip/conversation (adds to history)
      navigate(res.data.id, convRes.data.id, { tripName: res.data.name });
      setActiveTripId(res.data.id);
      setActiveConversationId(convRes.data.id);
    } else {
      // Navigate to trip without conversation
      navigate(res.data.id, null, { tripName: res.data.name });
      setActiveTripId(res.data.id);
    }
  };

  const handleDeleteTrip = async () => {
    if (!activeTripId || !credentials) return;
    const tripName = activeTrip?.name ?? 'this trip';
    const okToDelete = confirm(
      `Delete "${tripName}"? This will remove its itinerary, chats, uploads, and assets. This cannot be undone.`
    );
    if (!okToDelete) return;
    const res = await apiFetch<{ ok: true }>(`/api/trips/${activeTripId}`, { method: 'DELETE' }, credentials);
    if (!res.ok) {
      alert(`Delete failed: ${res.error}`);
      return;
    }

    const remaining = trips.filter(t => t.id !== activeTripId);
    setTrips(remaining);
    setDraftsByTrip(prev => {
      if (!(activeTripId in prev)) return prev;
      const next = { ...prev };
      delete next[activeTripId];
      return next;
    });
    setDraftHeightsByTrip(prev => {
      if (!(activeTripId in prev)) return prev;
      const next = { ...prev };
      delete next[activeTripId];
      return next;
    });

    if (remaining.length > 0) {
      // Navigate to next trip
      navigate(remaining[0].id, null, { tripName: remaining[0].name });
      setActiveTripId(remaining[0].id);
      return;
    }
    // No trips remaining - navigate to root
    navigate(null, null);
    setActiveTripId(null);
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
    setItineraryMarkdown('');
    setIsLoading(false);
    streamingMessageIdRef.current = null;
    toolActivityMessageIdRef.current = null;
    toolUseToMessageRef.current = {};
  };

  const handleCreateConversation = async () => {
    if (!activeTripId) return;
    const res = await apiFetch<Conversation>(`/api/trips/${activeTripId}/conversations`, { method: 'POST' }, credentials);
    if (!res.ok) {
      alert(`Failed to create chat: ${res.error}`);
      return;
    }
    await refreshConversations(activeTripId);
    // Navigate to new conversation (adds to history)
    navigate(activeTripId, res.data.id, { tripName: activeTripName });
    setActiveConversationId(res.data.id);
    setMessages([]);
  };

  const handleDeleteConversation = async (conversation: Conversation) => {
    if (!activeTripId || !credentials) return;
    const title = conversation.title?.trim() || 'this chat';
    const okToDelete = confirm(`Delete "${title}"? This will remove this chat's history. This cannot be undone.`);
    if (!okToDelete) return;
    const res = await apiFetch<{ ok: true }>(
      `/api/trips/${activeTripId}/conversations/${conversation.id}`,
      { method: 'DELETE' },
      credentials
    );
    if (!res.ok) {
      alert(`Delete failed: ${res.error}`);
      return;
    }

    const remaining = conversations.filter(c => c.id !== conversation.id);
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
        streamingMessageIdRef.current = null;
        toolActivityMessageIdRef.current = null;
        toolUseToMessageRef.current = {};
      }
    }
  };

  const handleStartConversationWithPrompt = useCallback(async (prompt: string, title?: string) => {
    if (!activeTripId) return;
    const res = await apiFetch<Conversation>(
      `/api/trips/${activeTripId}/conversations`,
      { method: 'POST', body: JSON.stringify(title ? { title } : {}) },
      credentials
    );
    if (!res.ok) {
      alert(`Failed to start chat: ${res.error}`);
      return;
    }
    await refreshConversations(activeTripId);
    // Navigate to new conversation (adds to history)
    navigate(activeTripId, res.data.id, { tripName: activeTripName });
    setActiveConversationId(res.data.id);
    streamingMessageIdRef.current = null;
    toolActivityMessageIdRef.current = null;
    toolUseToMessageRef.current = {};
    queryInProgressRef.current = true;
    setIsLoading(true);
    const timestamp = new Date().toISOString();
    const userMessage: Message = { id: Date.now().toString(), type: 'user', content: prompt, timestamp };
    setMessages([userMessage]);
    sendMessage({ type: 'chat', tripId: activeTripId, conversationId: res.data.id, content: prompt });
  }, [activeTripId, credentials, sendMessage, navigate]);

  const handleSendUserText = useCallback((text: string) => {
    if (!activeTripId || !activeConversationId) return;
    queryInProgressRef.current = true;
    const timestamp = new Date().toISOString();
    const userMessage: Message = { id: Date.now().toString(), type: 'user', content: text, timestamp };
    setMessages(prev => [...prev, userMessage]);
    toolActivityMessageIdRef.current = null;
    toolUseToMessageRef.current = {};
    setIsLoading(true);
    sendMessage({ type: 'chat', tripId: activeTripId, conversationId: activeConversationId, content: text });
  }, [activeTripId, activeConversationId, sendMessage]);

  const mapRequestPrompt =
    "Generate a trip map for my itinerary route. Use the current itinerary to determine the ordered destinations. If the route is unclear, ask me for the ordered list.";
  const regenerateItineraryPrompt =
    "Fully regenerate the itinerary using the latest itinerary conventions and follow the conventions provided in your system prompt. Do not regenerate the map unless destinations changed.";

  const handleRegenerateItinerary = () => {
    if (isLoading || !activeTripId) return;
    void handleStartConversationWithPrompt(regenerateItineraryPrompt, 'Regenerate itinerary');
  };

  const handleCancelResponse = useCallback(() => {
    if (!activeTripId || !activeConversationId) return;
    sendMessage({ type: 'cancel', tripId: activeTripId, conversationId: activeConversationId });
    setIsLoading(false);
    queryInProgressRef.current = false;
    streamingMessageIdRef.current = null;
    toolActivityMessageIdRef.current = null;
    toolUseToMessageRef.current = {};
  }, [activeTripId, activeConversationId, sendMessage]);

  const handleUploadFiles = useCallback(async (files: FileList) => {
    if (!activeTripId || !activeConversationId) return;
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('file', f));
    const res = await apiFetch<{ files: string[] }>(`/api/trips/${activeTripId}/uploads`, { method: 'POST', body: form }, credentials);
    if (!res.ok) {
      alert(`Upload failed: ${res.error}`);
      return;
    }
    const uploaded = res.data.files;
    const msg = `Uploaded files:\n- ${uploaded.join('\n- ')}`;
    handleSendUserText(msg + `\n\n(Stored in ~/.travelagent/trips/${activeTripId}/uploads/)`);
  }, [activeTripId, activeConversationId, credentials, handleSendUserText]);

  if (!credentials) {
    return (
      <div className="flex items-center justify-center min-h-screen relative overflow-hidden" style={{ background: 'hsl(var(--bg-primary))' }}>
        {/* Decorative background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 -left-32 w-64 h-64 rounded-full opacity-30"
               style={{ background: 'radial-gradient(circle, hsl(var(--accent-primary) / 0.15) 0%, transparent 70%)' }} />
          <div className="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full opacity-20"
               style={{ background: 'radial-gradient(circle, hsl(225 50% 30% / 0.2) 0%, transparent 70%)' }} />
        </div>

        <div className="terminal-container max-w-sm w-full mx-4 p-8 animate-scale-in relative z-10">
          {/* Travel icon */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, hsl(var(--accent-primary) / 0.15) 0%, hsl(var(--accent-primary) / 0.05) 100%)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                   style={{ color: 'hsl(var(--accent-primary))' }}>
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                <path d="M14.05 2a9 9 0 0 1 8 7.94M14.05 6A5 5 0 0 1 18 10" />
              </svg>
            </div>
          </div>

          <h1 className="header-display text-2xl text-center mb-2" style={{ color: 'hsl(var(--text-primary))' }}>
            Travel Agent
          </h1>
          <p className="text-center mb-6" style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.9rem' }}>
            Your personal trip planning assistant
          </p>

          {connectionError && (
            <div className="mb-5 p-3.5 rounded-lg animate-slide-up"
                 style={{ background: 'hsl(var(--error) / 0.1)', border: '1px solid hsl(var(--error) / 0.2)' }}>
              <p className="text-sm text-center" style={{ color: 'hsl(var(--error))' }}>
                {connectionError}
              </p>
            </div>
          )}

          <form onSubmit={handleCredentialsSubmit} className="space-y-4">
            <div>
              <label className="mono-label block mb-2">Password</label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter access password"
                className="input-terminal w-full"
                autoFocus
              />
            </div>
            <button type="submit" className="btn-primary w-full py-3">
              Continue
            </button>
          </form>

          <p className="text-center mt-6" style={{ color: 'hsl(var(--text-tertiary))', fontSize: '0.75rem' }}>
            Secure connection to your travel planning workspace
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen" style={{ background: 'hsl(var(--bg-primary))' }}>
      {/* Top header with branding and trip pills */}
      <header className="px-5 py-3" style={{
        background: 'linear-gradient(180deg, hsl(var(--bg-secondary)) 0%, hsl(var(--bg-primary)) 100%)',
        borderBottom: '1px solid hsl(var(--border-subtle))'
      }}>
        <div className="flex items-center justify-between gap-6">
          {/* Left: Branding */}
          <div className="flex items-center gap-4 animate-fade-in shrink-0">
            <div className="flex items-center gap-3">
              {/* Logo mark */}
              <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                   style={{ background: 'linear-gradient(135deg, hsl(var(--accent-primary)) 0%, hsl(var(--accent-secondary)) 100%)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     style={{ color: 'hsl(var(--text-inverse))' }}>
                  <circle cx="12" cy="12" r="10" />
                  <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
                </svg>
              </div>
              <div>
                <h1 className="header-display text-lg leading-tight" style={{ color: 'hsl(var(--text-primary))' }}>
                  Travel Agent
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2 pl-3" style={{ borderLeft: '1px solid hsl(var(--border-subtle))' }}>
              <div className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
              <span className="text-xs" style={{ color: 'hsl(var(--text-tertiary))' }}>
                {isConnected ? 'Connected' : 'Connecting...'}
              </span>
              {'Notification' in window && (
                <button
                  type="button"
                  onClick={toggleNotifications}
                  className="ml-2 p-1.5 rounded-md transition-colors"
                  style={{
                    color: notificationsEnabled ? 'hsl(var(--accent-primary))' : 'hsl(var(--text-tertiary))',
                    background: notificationsEnabled ? 'hsl(var(--accent-primary) / 0.1)' : 'transparent',
                  }}
                  title={notificationsEnabled ? 'Notifications enabled (click to disable)' : 'Enable notifications when response is ready'}
                >
                  <BellIcon enabled={notificationsEnabled} />
                </button>
              )}
            </div>
          </div>

          {/* Center: Trip pills with horizontal scroll */}
          <div className="flex-1 flex items-center justify-center min-w-0 px-6">
            <div className="trip-pills-container">
              {trips.length === 0 ? (
                <span className="text-sm" style={{ color: 'hsl(var(--text-tertiary))' }}>
                  No trips yet — create one to get started
                </span>
              ) : (
                trips.map((t, i) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`trip-pill animate-fade-in ${t.id === activeTripId ? 'active' : ''}`}
                    style={{ animationDelay: `${i * 50}ms` }}
                    onClick={() => handleSelectTrip(t.id)}
                  >
                    {t.name}
                  </button>
                ))
              )}
              <button
                type="button"
                className="trip-pill add-trip"
                onClick={handleCreateTrip}
                title="Plan a new trip"
              >
                <PlusIcon />
              </button>
            </div>
          </div>

        </div>

        {connectionError && (
          <div className="mt-3 p-2.5 rounded-lg" style={{ background: 'hsl(var(--error) / 0.1)' }}>
            <p className="text-xs text-center" style={{ color: 'hsl(var(--error))' }}>
              {connectionError}
            </p>
          </div>
        )}
      </header>

      {/* Main content area with sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Collapsible Chat History Sidebar */}
        <aside
          className={`chat-sidebar ${sidebarOpen ? 'open' : 'closed'}`}
          style={{ background: 'hsl(var(--bg-secondary))' }}
        >
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
                <button
                  type="button"
                  className="btn-secondary mt-3"
                  onClick={handleCreateConversation}
                  disabled={!activeTripId}
                >
                  Start a chat
                </button>
              </div>
            ) : (
              <div className="chat-list">
                {conversations.map(c => (
                  <div
                    key={c.id}
                    className={`chat-list-item ${c.id === activeConversationId ? 'active' : ''}`}
                  >
                    <button
                      type="button"
                      className="chat-list-main"
                      onClick={() => handleSelectConversation(c.id)}
                    >
                      <span className="chat-list-title">{c.title}</span>
                      <span className="chat-list-date">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </span>
                    </button>
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
                ))}
              </div>
            )}
          </div>

          <div className="chat-sidebar-footer">
            <button
              type="button"
              className="new-chat-btn"
              onClick={handleCreateConversation}
              disabled={!activeTripId}
            >
              <PlusIcon />
              <span>New Chat</span>
            </button>
          </div>
        </aside>

        {/* Sidebar toggle when collapsed */}
        {!sidebarOpen && (
          <button
            type="button"
            className="sidebar-expand-btn"
            onClick={() => setSidebarOpen(true)}
            title="Expand sidebar"
          >
            <ChevronRightIcon />
          </button>
        )}

        {/* Main chat + itinerary area */}
        <main className="flex-1 flex overflow-hidden p-4 gap-4">
          {/* Chat Panel */}
          <div className={`terminal-container overflow-hidden ${showItinerary ? 'flex-1' : 'flex-1'}`}>
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
              onUploadFiles={handleUploadFiles}
              tripName={activeTrip?.name ?? null}
              conversationTitle={activeConversation?.title ?? null}
              textareaRef={chatTextareaRef}
            />
          </div>

          {/* Right-side Pane */}
          {showItinerary && (
            <div className="terminal-container overflow-hidden flex-1 flex flex-col">
              <div className="pane-switcher">
                <button
                  type="button"
                  className={`pane-switcher-btn ${rightPaneView === 'itinerary' ? 'active' : ''}`}
                  onClick={() => setRightPaneView('itinerary')}
                >
                  Itinerary
                </button>
                <button
                  type="button"
                  className={`pane-switcher-btn ${rightPaneView === 'reminders' ? 'active' : ''}`}
                  onClick={() => setRightPaneView('reminders')}
                >
                  Reminders
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                {rightPaneView === 'itinerary' ? (
                  <ItineraryPane
                    tripId={activeTripId}
                    credentials={credentials}
                    markdown={itineraryMarkdown}
                    onRefresh={refreshItinerary}
                    onRequestMap={activeTripId ? () => handleStartConversationWithPrompt(mapRequestPrompt, 'Trip map') : undefined}
                    onRegenerateItinerary={activeTripId ? handleRegenerateItinerary : undefined}
                    onDeleteTrip={handleDeleteTrip}
                    onCollapse={() => setShowItinerary(false)}
                    tripCreatedAt={activeTrip?.createdAt ?? null}
                    tripUpdatedAt={activeTrip?.updatedAt ?? null}
                  />
                ) : (
                  <RemindersPane
                    credentials={credentials}
                    trips={trips}
                    activeTripId={activeTripId}
                    onCollapse={() => setShowItinerary(false)}
                  />
                )}
              </div>
            </div>
          )}

          {/* Expand itinerary button when collapsed */}
          {!showItinerary && activeTripId && (
            <button
              type="button"
              className="itinerary-expand-btn"
              onClick={() => setShowItinerary(true)}
              title={rightPaneView === 'itinerary' ? "Show itinerary" : "Show reminders"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          )}
        </main>
      </div>

      {/* New Trip Modal */}
      {showNewTripModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0, 0, 0, 0.5)' }}
          onClick={() => setShowNewTripModal(false)}
        >
          <div
            className="rounded-xl shadow-2xl p-6 w-full max-w-md mx-4"
            style={{ background: 'hsl(var(--bg-secondary))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              className="text-xl font-semibold mb-4"
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                color: 'hsl(var(--text-primary))'
              }}
            >
              Plan a new trip
            </h2>
            <p
              className="text-sm mb-4"
              style={{ color: 'hsl(var(--text-secondary))' }}
            >
              What destination are you dreaming of?
            </p>
            <input
              ref={newTripInputRef}
              type="text"
              value={newTripName}
              onChange={(e) => setNewTripName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNewTripSubmit();
                if (e.key === 'Escape') setShowNewTripModal(false);
              }}
              placeholder="e.g., Iceland, Japan, Paris..."
              className="w-full px-4 py-3 rounded-lg mb-4 text-base"
              style={{
                background: 'hsl(var(--bg-primary))',
                border: '1px solid hsl(var(--border-medium))',
                color: 'hsl(var(--text-primary))',
                outline: 'none',
              }}
            />
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowNewTripModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{
                  background: 'hsl(var(--bg-tertiary))',
                  color: 'hsl(var(--text-secondary))',
                  cursor: 'pointer',
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
                  cursor: newTripName.trim() ? 'pointer' : 'default',
                }}
              >
                Start Planning
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
