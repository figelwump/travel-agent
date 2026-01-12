import React, { useEffect, useMemo, useRef } from 'react';
import { MessageRenderer } from './message/MessageRenderer';
import type { Message } from './message/types';

// Icons for the input bar
const PaperclipIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);

interface ChatPanelProps {
  isConnected: boolean;
  isLoading: boolean;
  disabled: boolean;
  messages: Message[];
  draft: string;
  setDraft: (v: string) => void;
  textareaHeight?: number | null;
  onTextareaHeightChange?: (height: number) => void;
  onSend: (text: string) => void;
  onUploadFiles: (files: FileList) => void;
  tripName: string | null;
  conversationTitle: string | null;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function ChatPanel({
  isConnected,
  isLoading,
  disabled,
  messages,
  draft,
  setDraft,
  textareaHeight,
  onTextareaHeightChange,
  onSend,
  onUploadFiles,
  tripName,
  conversationTitle,
  textareaRef: externalTextareaRef,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalTextareaRef ?? internalTextareaRef;

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages.length]);

  const hasStreamingAssistant = useMemo(() => (
    messages.some(msg => msg.type === 'assistant' && msg.metadata?.streaming)
  ), [messages]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (typeof textareaHeight === 'number') {
      textarea.style.height = `${textareaHeight}px`;
      return;
    }
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
  }, [textareaHeight, draft]);

  const handleSubmit = () => {
    const trimmed = draft.trim();
    if (!trimmed || disabled) return;
    setDraft('');
    onSend(trimmed);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12 px-6">
            {/* Travel-themed decorative icon */}
            <div className="empty-state-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                {tripName ? (
                  // Compass icon for active trip
                  <>
                    <circle cx="12" cy="12" r="10" />
                    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" opacity="0.2" />
                    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
                  </>
                ) : (
                  // Globe icon for no trip
                  <>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </>
                )}
              </svg>
            </div>

            <h2 className="header-display text-2xl mb-3" style={{ color: 'hsl(var(--text-primary))' }}>
              {tripName ? tripName : 'Where to next?'}
            </h2>

            <p className="text-sm max-w-sm mb-6" style={{ color: 'hsl(var(--text-secondary))', lineHeight: 1.7 }}>
              {tripName
                ? 'Share your travel dates, interests, and must-see destinations. I\'ll help craft your perfect itinerary.'
                : 'Create a new trip to start planning your next adventure with your personal travel agent.'}
            </p>

            {tripName && (
              <div className="flex flex-wrap gap-2 justify-center">
                {['Beach getaway', 'City exploration', 'Mountain retreat', 'Cultural immersion'].map((suggestion, i) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="suggestion-chip animate-fade-in"
                    style={{ animationDelay: `${i * 75}ms` }}
                    onClick={() => {
                      setDraft(`I'm interested in a ${suggestion.toLowerCase()} experience.`);
                    }}
                    disabled={disabled}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, index) => {
              const isLast = index === messages.length - 1;
              const isLastAssistantStillWorking = isLast && msg.type === 'assistant' && isLoading;
              return (
                <div key={msg.id} className="animate-slide-up" style={{ animationDelay: `${Math.min(index * 40, 240)}ms` }}>
                  <MessageRenderer message={msg} isLastAndStillWorking={isLastAssistantStillWorking} />
                </div>
              );
            })}

            {isLoading && !hasStreamingAssistant && (
              <div className="message-card message-assistant p-4 animate-slide-up">
                <div className="flex items-center gap-3">
                  <span className="mono-label" style={{ color: 'hsl(var(--text-tertiary))' }}>AGENT</span>
                  <div className="flex items-center gap-2">
                    <span className="loading-dots" aria-label="Loading">
                      <span className="loading-dot" />
                      <span className="loading-dot" />
                      <span className="loading-dot" />
                    </span>
                    <span style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem' }}>Thinking</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message input area */}
      <div className="chat-input-container">
        <div className="chat-input-wrapper">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.txt"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onUploadFiles(e.target.files);
              }
              e.target.value = '';
            }}
          />

          {/* Icon bar */}
          <div className="chat-input-icons">
            <button
              type="button"
              className="chat-input-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              title="Attach files"
            >
              <PaperclipIcon />
            </button>
          </div>

          {/* Text input */}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={disabled ? 'Select a trip to begin…' : 'Message your travel agent...'}
            className="chat-textarea"
            disabled={disabled}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              const nextHeight = Math.min(target.scrollHeight, 150);
              target.style.height = nextHeight + 'px';
              onTextareaHeightChange?.(nextHeight);
            }}
          />

          {/* Send button */}
          <button
            type="button"
            className="chat-send-btn"
            onClick={handleSubmit}
            disabled={disabled || !draft.trim()}
            title="Send message"
          >
            <SendIcon />
          </button>
        </div>

        <div className="chat-input-hint">
          <span>Enter to send • Shift+Enter for newline</span>
        </div>
      </div>
    </div>
  );
}
