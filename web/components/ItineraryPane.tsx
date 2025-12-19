import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

type Credentials = { password: string };

function authHeader(credentials: Credentials | null): string | null {
  if (!credentials?.password) return null;
  return `Basic ${btoa(`user:${credentials.password}`)}`;
}

async function apiFetch(
  url: string,
  opts: RequestInit,
  credentials: Credentials | null
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const headers = new Headers(opts.headers || {});
  const auth = authHeader(credentials);
  if (auth) headers.set('Authorization', auth);
  if (!headers.has('Content-Type') && opts.body && !(opts.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) return { ok: false, status: res.status, error: await res.text().catch(() => res.statusText) };
  return { ok: true, text: await res.text() };
}

interface ItineraryPaneProps {
  tripId: string | null;
  credentials: Credentials | null;
  markdown: string;
  onRefresh: () => void;
  onAskAboutSelection: (selectionMarkdown: string) => void;
}

function extractDestinationsFromMarkdown(md: string): string[] {
  const lines = md.split('\n');
  const idx = lines.findIndex(l => /^##\s+Destinations\s*$/i.test(l.trim()));
  if (idx === -1) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^#{1,6}\s+/.test(line)) break;
    const m = line.match(/^-+\s+(?!\[[ xX]\]\s*)(.+)$/);
    if (!m) continue;
    const item = m[1].trim();
    if (!item) continue;
    out.push(item.replace(/\s+\[[^\]]+\]\s*$/, ''));
  }
  // De-dupe while preserving order.
  return Array.from(new Set(out)).slice(0, 12);
}

export function ItineraryPane({ tripId, credentials, markdown, onRefresh, onAskAboutSelection }: ItineraryPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const todoRenderIndexRef = useRef(0);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(markdown);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingMap, setIsGeneratingMap] = useState(false);

  useEffect(() => {
    if (!isEditing) setDraft(markdown);
  }, [markdown, isEditing]);

  const canInteract = Boolean(tripId && credentials);

  const todoLineNumbers = useMemo(() => {
    const lines = markdown.split('\n');
    const out: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*-\s+\[[ xX]\]\s+/.test(lines[i])) out.push(i + 1); // 1-based
    }
    return out;
  }, [markdown]);

  const handleToggleTodoLine = async (line1Based: number) => {
    if (!tripId || !credentials) return;
    await apiFetch(`/api/trips/${tripId}/itinerary/toggle-todo`, { method: 'POST', body: JSON.stringify({ line: line1Based }) }, credentials);
    onRefresh();
  };

  const handleSave = async () => {
    if (!tripId || !credentials) return;
    setIsSaving(true);
    const res = await apiFetch(`/api/trips/${tripId}/itinerary`, { method: 'PUT', body: JSON.stringify({ content: draft }) }, credentials);
    setIsSaving(false);
    if (!res.ok) {
      alert(`Save failed: ${res.error}`);
      return;
    }
    setIsEditing(false);
    onRefresh();
  };

  const handleGenerateMap = async () => {
    if (!tripId || !credentials) return;
    const extracted = extractDestinationsFromMarkdown(markdown);
    const destinations = extracted.length > 0
      ? extracted
      : (prompt('Destinations in order (comma-separated):') || '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .slice(0, 12);
    if (destinations.length === 0) return;

    setIsGeneratingMap(true);
    const auth = authHeader(credentials);
    const res = await fetch(`/api/trips/${tripId}/generate-map`, {
      method: 'POST',
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ destinations }),
    });
    setIsGeneratingMap(false);
    if (!res.ok) {
      alert(`Generate map failed: ${await res.text().catch(() => res.statusText)}`);
      return;
    }
    onRefresh();
  };

  const selectionLabel = useMemo(() => {
    const t = selection?.text?.trim() ?? '';
    if (!t) return null;
    const short = t.length > 60 ? t.slice(0, 60) + '…' : t;
    return short.replace(/\s+/g, ' ');
  }, [selection]);

  const sanitizeSchema = useMemo(() => {
    // Allow a minimal set of HTML for collapsible sections (<details>/<summary>).
    // Everything else stays on the default safe list.
    return {
      ...defaultSchema,
      tagNames: [...(defaultSchema.tagNames ?? []), 'details', 'summary'],
      attributes: {
        ...(defaultSchema.attributes ?? {}),
        details: ['open'],
        summary: [],
      },
    } as any;
  }, []);

  // Reset render counter so checkbox order matches markdown order.
  todoRenderIndexRef.current = 0;

  return (
    <div className="flex flex-col h-full" ref={containerRef}>
      <div className="border-b px-4 py-3 flex items-center justify-between gap-3" style={{ borderColor: 'hsl(var(--border-subtle))' }}>
        <div className="min-w-0">
          <div className="mono-label" style={{ color: 'hsl(var(--text-tertiary))' }}>Itinerary</div>
          <div className="truncate" style={{ color: 'hsl(var(--text-primary))', fontSize: '0.9rem' }}>
            {tripId ? `Trip: ${tripId.slice(0, 8)}…` : 'No trip selected'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={onRefresh} disabled={!canInteract || isSaving}>
            Refresh
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-xs"
            onClick={handleGenerateMap}
            disabled={!canInteract || isSaving || isGeneratingMap}
            title="Generates a trip-wide map image (uses Nano Banana Pro API if configured)"
          >
            {isGeneratingMap ? 'Generating…' : 'Generate map'}
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-xs"
            onClick={() => setIsEditing(v => !v)}
            disabled={!canInteract || isSaving}
          >
            {isEditing ? 'Preview' : 'Edit'}
          </button>
          {isEditing && (
            <button type="button" className="btn-primary px-3 py-2 text-xs" onClick={handleSave} disabled={!canInteract || isSaving}>
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto px-4 py-4 relative"
        ref={scrollRef}
        onMouseUp={() => {
          const sel = window.getSelection();
          const text = sel?.toString() ?? '';
          if (!sel || !text.trim()) {
            setSelection(null);
            return;
          }
          const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
          if (!range) return;
          const rect = range.getBoundingClientRect();
          const containerRect = scrollRef.current?.getBoundingClientRect();
          if (!containerRect || !scrollRef.current) return;
          setSelection({
            text,
            x: Math.max(8, rect.left - containerRect.left),
            y: Math.max(8, rect.top - containerRect.top - 40 + scrollRef.current.scrollTop),
          });
        }}
      >
        {selection && (
          <div
            className="absolute z-10"
            style={{ left: selection.x, top: selection.y }}
          >
            <button
              type="button"
              className="btn-primary px-3 py-2 text-xs"
              onClick={() => {
                onAskAboutSelection(selection.text);
                setSelection(null);
              }}
              title={selectionLabel ?? undefined}
            >
              Ask about selection
            </button>
          </div>
        )}

        {isEditing ? (
          <textarea
            className="input-terminal w-full"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ minHeight: '100%', resize: 'none' }}
          />
        ) : (
          <div className="prose-terminal">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
              components={{
                input: (props: any) => {
                  if (props.type !== 'checkbox') return <input {...props} />;
                  const idx = todoRenderIndexRef.current++;
                  const line = todoLineNumbers[idx];
                  return (
                    <input
                      {...props}
                      onChange={(e) => {
                        if (typeof line === 'number') handleToggleTodoLine(line);
                      }}
                    />
                  );
                }
              }}
            >
              {markdown || '*No itinerary loaded yet.*'}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
