import React, { useState } from 'react';
import { SystemMessage as SystemMessageType } from './types';

interface SystemMessageProps {
  message: SystemMessageType;
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

export function SystemMessage({ message }: SystemMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isInitMessage = message.metadata?.type === 'system' && message.metadata?.subtype === 'init';

  return (
    <div
      className="message-card p-4"
      style={{
        background: 'hsl(var(--bg-tertiary))',
        borderLeft: '2px solid hsl(var(--info) / 0.5)'
      }}
    >
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2"
            style={{ background: 'hsl(var(--info))' }}
          />
          <span className="mono-label" style={{ color: 'hsl(var(--info))' }}>
            System
          </span>
          {isInitMessage && (
            <span
              className="mono-label px-2 py-0.5"
              style={{
                fontSize: '0.6rem',
                background: 'hsl(var(--info) / 0.1)',
                color: 'hsl(var(--info))'
              }}
            >
              Init
            </span>
          )}
        </div>
        <span className="mono-label" style={{ fontSize: '0.65rem' }}>
          {formatTimestamp(message.timestamp)}
        </span>
      </div>

      <div
        className="whitespace-pre-wrap"
        style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem' }}
      >
        {message.content}
      </div>

      {message.metadata && (
        <div
          className="mt-3 pt-3 border-t"
          style={{ borderColor: 'hsl(var(--border-subtle))' }}
        >
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="mono-label hover-glow flex items-center gap-2"
            style={{ fontSize: '0.65rem' }}
          >
            <span style={{ color: 'hsl(var(--text-tertiary))' }}>
              {isExpanded ? '[-]' : '[+]'}
            </span>
            <span>metadata</span>
          </button>

          {isExpanded && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {message.metadata.model && (
                <div className="flex items-center gap-2">
                  <span className="mono-label" style={{ fontSize: '0.6rem' }}>Model:</span>
                  <code className="code-inline" style={{ fontSize: '0.7rem' }}>{message.metadata.model}</code>
                </div>
              )}
              {message.metadata.cwd && (
                <div className="flex items-center gap-2">
                  <span className="mono-label" style={{ fontSize: '0.6rem' }}>CWD:</span>
                  <code className="code-inline" style={{ fontSize: '0.7rem' }}>{message.metadata.cwd}</code>
                </div>
              )}
              {message.metadata.session_id && (
                <div className="flex items-center gap-2">
                  <span className="mono-label" style={{ fontSize: '0.6rem' }}>Session:</span>
                  <code className="code-inline" style={{ fontSize: '0.7rem' }}>
                    {message.metadata.session_id.slice(0, 12)}...
                  </code>
                </div>
              )}
              {message.metadata.permissionMode && (
                <div className="flex items-center gap-2">
                  <span className="mono-label" style={{ fontSize: '0.6rem' }}>Permissions:</span>
                  <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>
                    {message.metadata.permissionMode}
                  </span>
                </div>
              )}
              {message.metadata.tools && message.metadata.tools.length > 0 && (
                <div className="col-span-2">
                  <span className="mono-label" style={{ fontSize: '0.6rem' }}>Tools:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {message.metadata.tools.slice(0, 10).map((tool, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5"
                        style={{
                          fontSize: '0.65rem',
                          background: 'hsl(var(--bg-elevated))',
                          color: 'hsl(var(--text-tertiary))'
                        }}
                      >
                        {tool}
                      </span>
                    ))}
                    {message.metadata.tools.length > 10 && (
                      <span
                        className="px-1.5 py-0.5"
                        style={{
                          fontSize: '0.65rem',
                          color: 'hsl(var(--text-tertiary))'
                        }}
                      >
                        +{message.metadata.tools.length - 10} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
