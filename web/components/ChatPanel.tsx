import React, { useEffect, useMemo, useRef } from 'react';
import { MessageRenderer } from './message/MessageRenderer';
import type { Message } from './message/types';

interface ChatPanelProps {
  isConnected: boolean;
  isLoading: boolean;
  disabled: boolean;
  messages: Message[];
  draft: string;
  setDraft: (v: string) => void;
  onSend: (text: string) => void;
  onUploadFiles: (files: FileList) => void;
  tripName: string | null;
  conversationTitle: string | null;
}

export function ChatPanel({
  isConnected,
  isLoading,
  disabled,
  messages,
  draft,
  setDraft,
  onSend,
  onUploadFiles,
  tripName,
  conversationTitle,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages.length]);

  const hasStreamingAssistant = useMemo(() => (
    messages.some(msg => msg.type === 'assistant' && msg.metadata?.streaming)
  ), [messages]);

  const handleSubmit = () => {
    const trimmed = draft.trim();
    if (!trimmed || disabled) return;
    setDraft('');
    onSend(trimmed);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 py-3 flex items-center justify-between gap-3" style={{ borderColor: 'hsl(var(--border-subtle))' }}>
        <div className="min-w-0">
          <div className="mono-label" style={{ color: 'hsl(var(--text-tertiary))' }}>Chat</div>
          <div className="truncate" style={{ color: 'hsl(var(--text-primary))', fontSize: '0.9rem' }}>
            {(tripName ?? 'No trip selected')} — {(conversationTitle ?? 'No chat selected')}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            title="Upload files (images, PDFs, etc.)"
          >
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onUploadFiles(e.target.files);
              }
              e.target.value = '';
            }}
          />
          <div className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="py-10">
            <div className="mono-label" style={{ color: 'hsl(var(--text-tertiary))' }}>
              Start by telling me what you're planning.
            </div>
            <div className="mt-3 text-sm" style={{ color: 'hsl(var(--text-secondary))' }}>
              The agent will ask if this is a new trip or an existing itinerary.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, index) => (
              <div key={msg.id} className="animate-slide-up" style={{ animationDelay: `${Math.min(index * 40, 240)}ms` }}>
                <MessageRenderer message={msg} />
              </div>
            ))}

            {isLoading && !hasStreamingAssistant && (
              <div className="message-card message-assistant p-4 animate-slide-up">
                <div className="flex items-center gap-3">
                  <span className="mono-label" style={{ color: 'hsl(var(--text-tertiary))' }}>AGENT</span>
                  <span className="typing-cursor" style={{ color: 'hsl(var(--text-secondary))' }}>Processing</span>
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t px-4 py-3" style={{ borderColor: 'hsl(var(--border-subtle))' }}>
        <div className="relative">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={disabled ? 'Select a trip + chat to begin…' : 'Type a message… (Enter to send, Shift+Enter for newline)'}
            className="input-terminal w-full"
            disabled={disabled}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            style={{ resize: 'none', paddingTop: '0.75rem', paddingBottom: '0.75rem' }}
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="mono-label" style={{ fontSize: '0.65rem', color: 'hsl(var(--text-tertiary))' }}>
            Enter to send • Shift+Enter for newline
          </span>
          <button type="button" className="btn-primary px-4 py-2 text-xs" onClick={handleSubmit} disabled={disabled || !draft.trim()}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

