import React from 'react';
import { UserMessage as UserMessageType, UserToolResultMessage } from './types';

interface UserMessageProps {
  message: UserMessageType | UserToolResultMessage;
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

export function UserMessage({ message }: UserMessageProps) {
  const isToolResult = 'content' in message && Array.isArray(message.content) &&
    message.content.some(c => typeof c === 'object' && 'tool_use_id' in c);

  if (isToolResult) {
    const toolResultMessage = message as UserToolResultMessage;
    return (
      <div className="message-card p-4" style={{ background: 'hsl(var(--bg-tertiary))' }}>
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2"
              style={{ background: 'hsl(var(--info))' }}
            />
            <span className="mono-label" style={{ color: 'hsl(var(--info))' }}>
              Tool Result
            </span>
          </div>
          <span className="mono-label" style={{ fontSize: '0.65rem' }}>
            {formatTimestamp(message.timestamp)}
          </span>
        </div>

        {toolResultMessage.content.map((result, index) => (
          <div key={index} className="mt-3">
            <div
              className="mono-label mb-2 flex items-center gap-2"
              style={{ fontSize: '0.65rem' }}
            >
              <span style={{ color: 'hsl(var(--accent-muted))' }}>ID:</span>
              <code className="code-inline" style={{ fontSize: '0.65rem' }}>
                {result.tool_use_id}
              </code>
            </div>
            <pre
              className="code-block p-3 whitespace-pre-wrap"
              style={{ maxHeight: '200px', overflowY: 'auto' }}
            >
              {result.content}
            </pre>
          </div>
        ))}
      </div>
    );
  }

  const userMessage = message as UserMessageType;
  return (
    <div className="message-card message-user p-4">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2"
            style={{ background: 'hsl(var(--accent-primary))' }}
          />
          <span className="mono-label" style={{ color: 'hsl(var(--accent-primary))' }}>
            You
          </span>
        </div>
        <span className="mono-label" style={{ fontSize: '0.65rem' }}>
          {formatTimestamp(message.timestamp)}
        </span>
      </div>

      <div
        className="whitespace-pre-wrap leading-relaxed"
        style={{ color: 'hsl(var(--text-primary))' }}
      >
        {userMessage.content}
      </div>
    </div>
  );
}
