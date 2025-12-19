import React, { useEffect, useState } from 'react';
import YAML from 'yaml';
import type { StructuredPrompt } from '../message/types';

type Suggestion = {
  id: string;
  title: string;
  prompt: string;
};

const DEFAULT_SUGGESTIONS: Suggestion[] = [];

export function SuggestedQueries({
  onSend,
  disabled,
}: {
  onSend: (prompt: StructuredPrompt | string) => void;
  disabled?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>(DEFAULT_SUGGESTIONS);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await fetch('/web/config/suggestions.yaml');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const doc = YAML.parse(text);
        if (isMounted && Array.isArray(doc)) {
          const cleaned = doc.filter((d) => d && d.id && d.title && d.prompt) as Suggestion[];
          setSuggestions(cleaned);
        }
      } catch {
        if (isMounted) setSuggestions([]);
      }
    })();
    return () => { isMounted = false; };
  }, []);

  return (
    <div className="terminal-container p-4">
      <div className="flex items-center gap-3 mb-4">
        <span style={{ color: 'hsl(var(--accent-muted))' }}>{'>'}</span>
        <span className="mono-label" style={{ color: 'hsl(var(--text-secondary))' }}>
          Quick Actions
        </span>
        <div
          className="flex-1 h-px"
          style={{
            background: 'linear-gradient(90deg, hsl(var(--border-subtle)) 0%, transparent 100%)'
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {suggestions.map((s, index) => (
          <button
            key={s.id}
            disabled={disabled}
            onClick={() => onSend(s.prompt)}
            className="suggestion-chip animate-fade-in"
            style={{
              animationDelay: `${index * 50}ms`,
              animationFillMode: 'backwards'
            }}
          >
            {s.title}
          </button>
        ))}
        {suggestions.length === 0 && (
          <span
            className="mono-label flex items-center gap-2"
            style={{ fontSize: '0.7rem', color: 'hsl(var(--text-tertiary))' }}
          >
            <span style={{ color: 'hsl(var(--accent-muted))' }}>{'>'}</span>
            No suggestions configured
          </span>
        )}
      </div>
    </div>
  );
}
