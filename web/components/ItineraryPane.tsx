import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

/**
 * Pre-process markdown to convert content inside <details> tags to HTML.
 * This is needed because remark doesn't parse markdown inside raw HTML blocks.
 */
function preprocessDetailsContent(md: string): string {
  // Match <details...>...</details> blocks
  return md.replace(
    /(<details[^>]*>)([\s\S]*?)(<\/details>)/gi,
    (match, openTag, content, closeTag) => {
      // Process the content inside details (but preserve <summary> tags)
      const processed = content
        // Convert **bold** to <strong>
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Convert bullet lists: lines starting with "- " become <ul><li>
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        // Wrap consecutive <li> items in <ul>
        .replace(/(<li>[\s\S]*?<\/li>)(\n?)(?=<li>|$)/g, '$1$2')
        // Group consecutive li items into ul
        .replace(/((?:<li>[\s\S]*?<\/li>\n?)+)/g, '<ul>$1</ul>')
        // Convert [text](url) links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        // Convert task list items: - [ ] and - [x]
        .replace(/<li>\[ \] (.+)<\/li>/g, '<li><input type="checkbox" disabled /> $1</li>')
        .replace(/<li>\[x\] (.+)<\/li>/gi, '<li><input type="checkbox" checked disabled /> $1</li>');

      return openTag + processed + closeTag;
    }
  );
}

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

// Collapse icon (points right to indicate collapsing the panel)
const CollapseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M13 5l7 7-7 7M6 5l7 7-7 7" />
  </svg>
);

interface ItineraryPaneProps {
  tripId: string | null;
  credentials: Credentials | null;
  markdown: string;
  onRefresh: () => void;
  onAskAboutSelection: (selectionMarkdown: string) => void;
  onCollapse?: () => void;
  tripCreatedAt?: string | null;
  tripUpdatedAt?: string | null;
}

function withAuthToken(url: string, credentials: Credentials | null): string {
  if (!url || !credentials?.password) return url;
  if (!url.startsWith('/api/')) return url;
  try {
    if (typeof window === 'undefined') return url;
    const resolved = new URL(url, window.location.origin);
    if (!resolved.searchParams.has('token')) {
      resolved.searchParams.set('token', credentials.password);
    }
    return resolved.pathname + resolved.search;
  } catch {
    return url;
  }
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

export function ItineraryPane({
  tripId,
  credentials,
  markdown,
  onRefresh,
  onAskAboutSelection,
  onCollapse,
  tripCreatedAt,
  tripUpdatedAt,
}: ItineraryPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(markdown);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingMap, setIsGeneratingMap] = useState(false);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    []
  );
  const createdLabel = useMemo(() => {
    if (!tripCreatedAt) return null;
    const d = new Date(tripCreatedAt);
    if (Number.isNaN(d.getTime())) return null;
    return dateFormatter.format(d);
  }, [dateFormatter, tripCreatedAt]);
  const updatedLabel = useMemo(() => {
    if (!tripUpdatedAt) return null;
    const d = new Date(tripUpdatedAt);
    if (Number.isNaN(d.getTime())) return null;
    return dateFormatter.format(d);
  }, [dateFormatter, tripUpdatedAt]);

  useEffect(() => {
    if (!isEditing) setDraft(markdown);
  }, [markdown, isEditing]);

  const canInteract = Boolean(tripId && credentials);

  // Map checkbox text content to line numbers for reliable lookups.
  // Render order from ReactMarkdown can differ from source order when
  // checkboxes are inside HTML blocks (like <details>).
  const todoTextToLine = useMemo(() => {
    const lines = markdown.split('\n');
    const map = new Map<string, number>();
    const todoRegex = /^\s*(?:[-*+]|\d+\.)\s+\[[ xX]\]\s+(.+)$/;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(todoRegex);
      if (match) {
        const text = match[1].trim();
        if (!map.has(text)) map.set(text, i + 1); // 1-based, first occurrence wins
      }
    }
    return map;
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

  // Pre-process markdown to handle content inside <details> tags
  const processedMarkdown = useMemo(() => {
    if (!markdown) return '';
    return preprocessDetailsContent(markdown);
  }, [markdown]);

  const markdownLines = useMemo(() => processedMarkdown.split('\n'), [processedMarkdown]);

  const headingRanges = useMemo(() => {
    const headings: Array<{ line: number; level: number }> = [];
    for (let i = 0; i < markdownLines.length; i += 1) {
      const match = markdownLines[i].match(/^(#{1,6})\s+(.+)$/);
      if (!match) continue;
      headings.push({ line: i + 1, level: match[1].length });
    }
    const ranges = new Map<number, { endLine: number }>();
    for (let i = 0; i < headings.length; i += 1) {
      const current = headings[i];
      let endLine = markdownLines.length;
      for (let j = i + 1; j < headings.length; j += 1) {
        if (headings[j].level <= current.level) {
          endLine = headings[j].line - 1;
          break;
        }
      }
      ranges.set(current.line, { endLine });
    }
    return ranges;
  }, [markdownLines]);

  const getMarkdownSlice = useCallback(
    (startLine?: number | null, endLine?: number | null) => {
      if (!startLine || !endLine) return null;
      const startIdx = Math.max(1, startLine) - 1;
      const endIdx = Math.min(markdownLines.length, endLine);
      if (startIdx < 0 || endIdx <= startIdx) return null;
      const slice = markdownLines.slice(startIdx, endIdx).join('\n').trim();
      return slice || null;
    },
    [markdownLines],
  );

  const getHeadingSection = useCallback(
    (line?: number | null) => {
      if (!line) return null;
      const range = headingRanges.get(line);
      return getMarkdownSlice(line, range?.endLine);
    },
    [getMarkdownSlice, headingRanges],
  );

  const renderHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    const Tag = `h${level}` as const;
    return ({ node, children, ...props }: any) => {
      const line = node?.position?.start?.line as number | undefined;
      const section = getHeadingSection(line);
      return (
        <Tag {...props} className={`itinerary-heading ${props.className || ''}`.trim()}>
          <span>{children}</span>
          {section && (
            <button
              type="button"
              className="ask-inline-btn"
              onClick={() => onAskAboutSelection(section)}
              title="Ask about this section"
            >
              Ask about section
            </button>
          )}
        </Tag>
      );
    };
  };

  const renderListItem = ({ node, children, ...props }: any) => {
    const line = node?.position?.start?.line as number | undefined;
    const endLine = node?.position?.end?.line as number | undefined;
    const isTopLevel = (node?.position?.start?.column ?? 99) <= 3;
    const isTodo = typeof node?.checked === 'boolean';
    const item = isTopLevel && !isTodo ? getMarkdownSlice(line, endLine) : null;
    return (
      <li {...props} className={`itinerary-list-item ${props.className || ''}`.trim()}>
        {children}
        {item && (
          <button
            type="button"
            className="ask-inline-btn"
            onClick={() => onAskAboutSelection(item)}
            title="Ask about this item"
          >
            Ask about item
          </button>
        )}
      </li>
    );
  };

  const MarkdownImage = ({ node, ...props }: any) => {
    const [failed, setFailed] = useState(false);
    const src = typeof props.src === 'string' ? withAuthToken(props.src, credentials) : props.src;
    const alt = props.alt ?? 'Image';
    if (!src) {
      return <span style={{ color: 'hsl(var(--text-tertiary))' }}>[Image missing: {alt}]</span>;
    }
    if (failed) {
      return (
        <a href={src} target="_blank" rel="noopener noreferrer">
          [Image failed to load: {alt}]
        </a>
      );
    }
    return (
      <img
        {...props}
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  };

  return (
    <div className="flex flex-col h-full" ref={containerRef}>
      <div className="border-b px-4 py-3 flex items-center justify-between gap-3" style={{ borderColor: 'hsl(var(--border-subtle))' }}>
        <div className="flex items-center gap-3 min-w-0">
          {onCollapse && (
            <button
              type="button"
              className="itinerary-collapse-btn"
              onClick={onCollapse}
              title="Collapse itinerary"
            >
              <CollapseIcon />
            </button>
          )}
          <div className="min-w-0">
            <div className="mono-label" style={{ color: 'hsl(var(--text-tertiary))' }}>Itinerary</div>
            {(createdLabel || updatedLabel) && (
              <div className="text-xs mt-1" style={{ color: 'hsl(var(--text-tertiary))' }}>
                {createdLabel && <span>Trip created: {createdLabel}</span>}
                {createdLabel && updatedLabel && <span style={{ margin: '0 8px' }}>•</span>}
                {updatedLabel && <span>Last updated: {updatedLabel}</span>}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" className="icon-btn" onClick={onRefresh} disabled={!canInteract || isSaving} title="Refresh">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={handleGenerateMap}
            disabled={!canInteract || isSaving || isGeneratingMap}
            title="Generate map"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setIsEditing(v => !v)}
            disabled={!canInteract || isSaving}
            title={isEditing ? 'Preview' : 'Edit'}
          >
            {isEditing ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            )}
          </button>
          {isEditing && (
            <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={handleSave} disabled={!canInteract || isSaving}>
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
                h1: renderHeading(1),
                h2: renderHeading(2),
                h3: renderHeading(3),
                h4: renderHeading(4),
                h5: renderHeading(5),
                h6: renderHeading(6),
                a: ({ node, ...props }) => {
                  const href = typeof props.href === 'string' ? withAuthToken(props.href, credentials) : props.href;
                  return <a {...props} href={href} target="_blank" rel="noopener noreferrer" />;
                },
                img: MarkdownImage,
                li: renderListItem,
                input: (props: any) => {
                  if (props.type !== 'checkbox') return <input {...props} />;
                  return (
                    <input
                      {...props}
                      disabled={false}
                      onChange={(e) => {
                        // Find the parent list item and get its text content
                        const listItem = e.target.closest('li');
                        if (!listItem) return;
                        const text = listItem.textContent?.trim();
                        if (!text) return;
                        const line = todoTextToLine.get(text);
                        if (typeof line === 'number') handleToggleTodoLine(line);
                      }}
                    />
                  );
                }
              }}
            >
              {processedMarkdown || '*No itinerary loaded yet.*'}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
