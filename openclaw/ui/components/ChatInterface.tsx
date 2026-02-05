import React, { useState, useRef, useEffect, useMemo } from 'react';
import { MessageRenderer } from './message/MessageRenderer';
import { Message } from './message/types';

interface ChatInterfaceProps {
  isConnected: boolean;
  sendMessage: (message: any) => void;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  sessionId: string | null;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  onResetAuth?: () => void;
  connectionError?: string | null;
}

export function ChatInterface({ isConnected, sendMessage, messages, setMessages, sessionId, isLoading, setIsLoading, onResetAuth, connectionError }: ChatInterfaceProps) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const dispatchMessage = (content: string) => {
    const timestamp = new Date().toISOString();
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content,
      timestamp,
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    sendMessage({ type: 'chat', content, sessionId });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading || !isConnected) return;

    const trimmed = inputValue.trim();
    if (!trimmed) return;

    setInputValue('');
    dispatchMessage(trimmed);
  };

  const hasStreamingAssistant = useMemo(() => (
    messages.some(msg => msg.type === 'assistant' && msg.metadata?.streaming)
  ), [messages]);

  return (
    <div className="flex flex-col h-screen" style={{ background: 'hsl(var(--bg-primary))' }}>
      {/* Header */}
      <header className="terminal-container border-b-0 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="animate-fade-in">
            <h1 className="header-display text-2xl" style={{ color: 'hsl(var(--text-primary))' }}>
              Travel Agent
            </h1>
            <p className="mono-label mt-1 flex items-center gap-2">
              <span style={{ color: 'hsl(var(--accent-muted))' }}>{'>'}</span>
              Collaborative trip planning
            </p>
          </div>

          <div className="flex items-center gap-3 animate-fade-in delay-100">
            <div className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
            <span className="mono-label">
              {isConnected ? 'Connected' : 'Connecting...'}
            </span>
            {onResetAuth && (
              <button
                type="button"
                className="btn-secondary px-3 py-1 text-xs"
                onClick={onResetAuth}
                style={{ lineHeight: 1 }}
              >
                Update credentials
              </button>
            )}
          </div>
        </div>

        {connectionError && (
          <div className="max-w-5xl mx-auto mt-3">
            <div className="mono-label text-sm" style={{ color: 'hsl(var(--text-tertiary))' }}>
              {connectionError}
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6">
          {/* Messages or Empty State */}
          {messages.length === 0 ? (
            <div className="relative py-20 animate-fade-in delay-200">
              <div className="grid-pattern absolute inset-0 opacity-30" />
              <div className="relative text-center">
                <div className="inline-block mb-6">
                  <div
                    className="w-16 h-16 mx-auto border-2 flex items-center justify-center"
                    style={{
                      borderColor: 'hsl(var(--accent-primary) / 0.3)',
                      background: 'hsl(var(--bg-tertiary))'
                    }}
                  >
                    <span className="phosphor-glow text-2xl">_</span>
                  </div>
                </div>
                <h2 className="header-display text-xl mb-3" style={{ color: 'hsl(var(--text-primary))' }}>
                  Ready for input
                </h2>
                <p className="mono-label max-w-md mx-auto leading-relaxed">
                  Ask for an itinerary draft, refine a day plan, or capture booking details.
                  You can also add preferences or open questions to follow up on.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, index) => (
                <div
                  key={msg.id}
                  className="animate-slide-up"
                  style={{ animationDelay: `${Math.min(index * 50, 300)}ms` }}
                >
                  <MessageRenderer message={msg} />
                </div>
              ))}

              {isLoading && !hasStreamingAssistant && (
                <div className="message-card message-assistant p-4 animate-slide-up">
                  <div className="flex items-center gap-3">
                    <span className="mono-label" style={{ color: 'hsl(var(--text-tertiary))' }}>AGENT</span>
                    <span className="typing-cursor" style={{ color: 'hsl(var(--text-secondary))' }}>
                      Processing
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="terminal-container border-t px-6 py-4">
        <form onSubmit={handleSubmit} className="max-w-5xl mx-auto">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <span
                className="absolute left-4 top-1/2 -translate-y-1/2 text-sm"
                style={{ color: 'hsl(var(--accent-muted))' }}
              >
                {'>'}
              </span>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={isConnected ? 'Enter command or question...' : 'Establishing connection...'}
                className="input-terminal w-full pl-8"
                disabled={isLoading || !isConnected}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || !inputValue.trim() || !isConnected}
              className="btn-primary flex items-center gap-2"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              Execute
            </button>
          </div>

          {/* Input hints */}
          <div className="flex items-center gap-4 mt-3">
            <span className="mono-label" style={{ fontSize: '0.65rem' }}>
              <kbd
                className="px-1.5 py-0.5 border mr-1"
                style={{
                  background: 'hsl(var(--bg-tertiary))',
                  borderColor: 'hsl(var(--border-subtle))'
                }}
              >
                Enter
              </kbd>
              to send
            </span>
            {sessionId && (
              <span className="mono-label" style={{ fontSize: '0.65rem', color: 'hsl(var(--text-tertiary))' }}>
                Session: {sessionId.slice(0, 8)}...
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
