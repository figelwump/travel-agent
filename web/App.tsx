import React, { useEffect, useMemo, useRef, useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { Message, TextBlock } from "./components/message/types";
import { ChatPanel } from "./components/ChatPanel";
import { ItineraryPane } from "./components/ItineraryPane";

const createTextBlock = (text: string): TextBlock => ({ type: 'text', text });

type Credentials = { password: string };
const CREDENTIALS_STORAGE_KEY = 'travelagent:auth';

type Trip = { id: string; name: string; createdAt: string; updatedAt: string };
type Conversation = { id: string; tripId: string; title: string; createdAt: string; updatedAt: string; sdkSessionId?: string | null };

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

  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [itineraryMarkdown, setItineraryMarkdown] = useState<string>('');
  const [showItinerary, setShowItinerary] = useState(true);
  const [draft, setDraft] = useState('');

  const wsUrl = typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
    : 'ws://localhost:3000/ws';

  const activeTrip = useMemo(() => trips.find(t => t.id === activeTripId) ?? null, [trips, activeTripId]);
  const activeConversation = useMemo(() => conversations.find(c => c.id === activeConversationId) ?? null, [conversations, activeConversationId]);

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
        case 'assistant_partial': {
          if (message.tripId !== activeTripId || message.conversationId !== activeConversationId) break;
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

          setIsLoading(false);
          break;
        }
        case 'result': {
          if (message.tripId !== activeTripId || message.conversationId !== activeConversationId) break;
          if (message.success) {
            console.log('Query completed successfully', message);
          } else {
            console.error('Query failed:', message.error);
          }
          streamingMessageIdRef.current = null;
          setIsLoading(false);
          break;
        }
        case 'itinerary_updated': {
          if (message.tripId !== activeTripId) break;
          refreshItinerary();
          break;
        }
        case 'prefs_updated': {
          // noop in UI for now (context refresh happens on next message)
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
  }, []);

  const refreshTrips = async () => {
    const res = await apiFetch<Trip[]>('/api/trips', { method: 'GET' }, credentials);
    if (!res.ok) {
      setConnectionError(`API error (${res.status}): ${res.error}`);
      return;
    }
    setTrips(res.data);
    if (!activeTripId && res.data.length > 0) {
      setActiveTripId(res.data[0].id);
    }
  };

  const refreshConversations = async (tripId: string) => {
    const res = await apiFetch<Conversation[]>(`/api/trips/${tripId}/conversations`, { method: 'GET' }, credentials);
    if (!res.ok) return;
    setConversations(res.data);
    if (!activeConversationId && res.data.length > 0) setActiveConversationId(res.data[0].id);
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
    const res = await apiFetch<string>(`/api/trips/${activeTripId}/itinerary`, { method: 'GET' }, credentials);
    if (!res.ok) return;
    setItineraryMarkdown(res.data);
  };

  useEffect(() => {
    if (!credentials) return;
    refreshTrips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials]);

  useEffect(() => {
    if (!credentials || !activeTripId) return;
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
    setItineraryMarkdown('');
    refreshConversations(activeTripId);
    refreshItinerary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTripId, credentials]);

  useEffect(() => {
    if (!activeTripId || !activeConversationId || !credentials) return;
    refreshMessages(activeTripId, activeConversationId);
    sendMessage({ type: 'subscribe', tripId: activeTripId, conversationId: activeConversationId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTripId, activeConversationId, credentials]);

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
    setTrips([]);
    setActiveTripId(null);
    setConversations([]);
    setActiveConversationId(null);
    setItineraryMarkdown('');
  };

  if (!credentials) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: 'hsl(var(--bg-primary))' }}>
        <div className="terminal-container max-w-md w-full mx-4 p-6">
          <h1 className="header-display text-xl mb-3" style={{ color: 'hsl(var(--text-primary))' }}>
            Access Required
          </h1>
          <p className="mono-label mb-4" style={{ color: 'hsl(var(--text-secondary))' }}>
            Enter the password to connect.
          </p>
          {connectionError && (
            <div className="mb-4 p-3 rounded" style={{ background: 'hsl(var(--bg-tertiary))', border: '1px solid hsl(var(--border-primary))' }}>
              <p className="mono-label text-sm" style={{ color: 'hsl(var(--text-error, 0 70% 60%))' }}>
                {connectionError}
              </p>
            </div>
          )}
          <form onSubmit={handleCredentialsSubmit} className="space-y-3">
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Password"
              className="input-terminal w-full"
              autoFocus
            />
            <button type="submit" className="btn-primary w-full">Continue</button>
          </form>
        </div>
      </div>
    );
  }

  const canSend = Boolean(isConnected && !isLoading && activeTripId && activeConversationId);

  const handleCreateTrip = async () => {
    const name = prompt('Trip name (e.g., “Iceland”):');
    if (!name) return;
    const res = await apiFetch<Trip>('/api/trips', { method: 'POST', body: JSON.stringify({ name }) }, credentials);
    if (!res.ok) {
      alert(`Failed to create trip: ${res.error}`);
      return;
    }
    await refreshTrips();
    setActiveTripId(res.data.id);
  };

  const handleCreateConversation = async () => {
    if (!activeTripId) return;
    const title = prompt('Chat title (optional):') || undefined;
    const res = await apiFetch<Conversation>(`/api/trips/${activeTripId}/conversations`, { method: 'POST', body: JSON.stringify({ title }) }, credentials);
    if (!res.ok) {
      alert(`Failed to create chat: ${res.error}`);
      return;
    }
    await refreshConversations(activeTripId);
    setActiveConversationId(res.data.id);
    setMessages([]);
  };

  const handleSendUserText = (text: string) => {
    if (!activeTripId || !activeConversationId) return;
    const timestamp = new Date().toISOString();
    const userMessage: Message = { id: Date.now().toString(), type: 'user', content: text, timestamp };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    sendMessage({ type: 'chat', tripId: activeTripId, conversationId: activeConversationId, content: text });
  };

  const handleUploadFiles = async (files: FileList) => {
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
  };

  const handleAskAboutSelection = async (selectionMarkdown: string) => {
    if (!activeTripId) return;
    const res = await apiFetch<Conversation>(`/api/trips/${activeTripId}/conversations`, { method: 'POST', body: JSON.stringify({ title: 'Question about itinerary' }) }, credentials);
    if (!res.ok) {
      alert(`Failed to create chat: ${res.error}`);
      return;
    }
    await refreshConversations(activeTripId);
    setActiveConversationId(res.data.id);
    setMessages([]);
    // Prefill draft with the selection context; user can type a question after.
    setDraft(`I'm looking at this itinerary excerpt:\n\n\`\`\`markdown\n${selectionMarkdown.trim()}\n\`\`\`\n\nMy question: `);
    // Subscribe ASAP (before sending anything).
    sendMessage({ type: 'subscribe', tripId: activeTripId, conversationId: res.data.id });
  };

  const handleUpdateItineraryRequest = () => {
    if (!activeTripId || !activeConversationId) return;
    handleSendUserText(
      [
        `Please update the itinerary now and save it.`,
        ``,
        `Requirements:`,
        `- Output the FULL updated itinerary as a single fenced block with language \`itinerary-md\`.`,
        `- Immediately after the code block, include: <!-- travelagent:save-itinerary -->`,
        `- Also include: <!-- travelagent:generate-map -->`,
        `- Use collapsible day sections with <details><summary>…</summary> … </details> where helpful.`,
        `- Add Google Maps links per destination (and per day when useful).`,
        `- Add 1–2 representative images per destination section.`,
        `- Include TODOs as task list items (- [ ] / - [x]) for anything the user still needs to decide/book.`,
        ``,
        `If anything is still ambiguous, ask me the minimum set of questions first.`,
      ].join('\n')
    );
  };

  return (
    <div className="flex flex-col h-screen" style={{ background: 'hsl(var(--bg-primary))' }}>
      <header className="terminal-container border-b-0 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="animate-fade-in">
            <h1 className="header-display text-2xl" style={{ color: 'hsl(var(--text-primary))' }}>
              Travel Agent
            </h1>
            <p className="mono-label mt-1 flex items-center gap-2">
              <span style={{ color: 'hsl(var(--accent-muted))' }}>{'>'}</span>
              Plan trips + keep a living itinerary
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap justify-end">
            <div className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
            <span className="mono-label">{isConnected ? 'Connected' : 'Connecting...'}</span>

            <select
              className="input-terminal px-3 py-2"
              value={activeTripId ?? ''}
              onChange={(e) => setActiveTripId(e.target.value || null)}
              disabled={!trips.length}
              style={{ minWidth: 180 }}
            >
              {trips.length === 0 ? (
                <option value="">No trips yet</option>
              ) : (
                trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)
              )}
            </select>
            <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={handleCreateTrip}>New trip</button>

            <select
              className="input-terminal px-3 py-2"
              value={activeConversationId ?? ''}
              onChange={(e) => setActiveConversationId(e.target.value || null)}
              disabled={!activeTripId || !conversations.length}
              style={{ minWidth: 180 }}
            >
              {conversations.length === 0 ? (
                <option value="">No chats yet</option>
              ) : (
                conversations.map(c => <option key={c.id} value={c.id}>{c.title}</option>)
              )}
            </select>
            <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={handleCreateConversation} disabled={!activeTripId}>New chat</button>

            <button
              type="button"
              className="btn-secondary px-3 py-2 text-xs"
              onClick={() => setShowItinerary(v => !v)}
              disabled={!activeTripId}
            >
              {showItinerary ? 'Hide itinerary' : 'Show itinerary'}
            </button>

            <button
              type="button"
              className="btn-primary px-3 py-2 text-xs"
              onClick={handleUpdateItineraryRequest}
              disabled={!canSend}
              title="Asks the agent to produce a full updated itinerary and save it"
            >
              Update itinerary
            </button>

            <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={handleResetCredentials}>
              Update credentials
            </button>
          </div>
        </div>

        {connectionError && (
          <div className="max-w-6xl mx-auto mt-3">
            <div className="mono-label text-sm" style={{ color: 'hsl(var(--text-tertiary))' }}>
              {connectionError}
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-hidden">
        <div className="max-w-6xl mx-auto h-full px-6 py-4">
          <div className={`grid h-full gap-4 ${showItinerary ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div className="terminal-container h-full overflow-hidden">
              <ChatPanel
                isConnected={isConnected}
                isLoading={isLoading}
                messages={messages}
                draft={draft}
                setDraft={setDraft}
                onSend={handleSendUserText}
                onUploadFiles={handleUploadFiles}
                disabled={!canSend}
                tripName={activeTrip?.name ?? null}
                conversationTitle={activeConversation?.title ?? null}
              />
            </div>

            {showItinerary && (
              <div className="terminal-container h-full overflow-hidden">
                <ItineraryPane
                  tripId={activeTripId}
                  credentials={credentials}
                  markdown={itineraryMarkdown}
                  onRefresh={refreshItinerary}
                  onAskAboutSelection={handleAskAboutSelection}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
