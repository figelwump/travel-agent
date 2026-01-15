import React, { useEffect, useMemo, useRef, useState } from 'react';
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
      let processed = content
        // Convert ### headings to <h3>, etc.
        .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
        .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
        .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
        // Convert **bold** to <strong>
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Convert [text](url) links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

      // Process lists with proper nesting
      const lines = processed.split('\n');
      const result: string[] = [];
      const listStack: number[] = []; // Track indent levels of open lists

      for (const line of lines) {
        // Match list items with any indentation level
        const listMatch = line.match(/^(\s*)([-*+])\s+(.+)$/);

        if (listMatch) {
          const [, indent, , itemContent] = listMatch;
          const indentLevel = indent.length;

          // Close lists that are deeper than current level
          while (listStack.length > 0 && listStack[listStack.length - 1] >= indentLevel) {
            const closedLevel = listStack.pop()!;
            // Only close if we're actually going back up (not at same level)
            if (closedLevel > indentLevel) {
              result.push('</ul>');
            } else {
              // Same level, put it back
              listStack.push(closedLevel);
              break;
            }
          }

          // Open a new nested list if this is deeper
          if (listStack.length === 0 || indentLevel > listStack[listStack.length - 1]) {
            result.push('<ul>');
            listStack.push(indentLevel);
          }

          // Convert task list checkboxes
          let finalContent = itemContent;
          if (finalContent.startsWith('[ ] ')) {
            finalContent = `<input type="checkbox" disabled /> ${finalContent.slice(4)}`;
          } else if (/^\[[xX]\] /.test(finalContent)) {
            finalContent = `<input type="checkbox" checked disabled /> ${finalContent.slice(4)}`;
          }

          result.push(`<li>${finalContent}</li>`);
        } else {
          // Not a list item - close all open lists
          while (listStack.length > 0) {
            listStack.pop();
            result.push('</ul>');
          }
          result.push(line);
        }
      }

      // Close any remaining open lists
      while (listStack.length > 0) {
        listStack.pop();
        result.push('</ul>');
      }

      processed = result.join('\n');

      return openTag + processed + closeTag;
    }
  );
}

function normalizeDaySections(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inAutoDetails = false;
  let manualDetailsDepth = 0;
  let dayHeadingLevel: number | null = null;
  const emphasisPrefix = '(?:\\*\\*|__)?';
  const emphasisSuffix = '(?:\\*\\*|__)?';
  const dayHeadingRegex = new RegExp(
    `^(#{2,6})\\s+${emphasisPrefix}(Day\\s+\\d+\\b.*)${emphasisSuffix}\\s*$`,
    'i'
  );
  const weekdayPattern = '(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)';
  const weekdayHeadingRegex = new RegExp(
    `^(#{2,6})\\s+${emphasisPrefix}(${weekdayPattern}\\b.*)${emphasisSuffix}\\s*$`,
    'i'
  );
  const headingRegex = /^(#{1,6})\s+/;
  const detailsOpenRegex = /<details\b[^>]*>/i;
  const detailsCloseRegex = /<\/details>/i;

  const closeAutoDetails = () => {
    if (!inAutoDetails) return;
    out.push('</details>');
    if (out[out.length - 1] !== '') out.push('');
    inAutoDetails = false;
    dayHeadingLevel = null;
  };

  for (const line of lines) {
    if (detailsCloseRegex.test(line) && manualDetailsDepth > 0) manualDetailsDepth -= 1;
    if (detailsOpenRegex.test(line)) manualDetailsDepth += 1;

    const dayHeadingMatch = line.match(dayHeadingRegex) || line.match(weekdayHeadingRegex);
    if (dayHeadingMatch && manualDetailsDepth === 0) {
      closeAutoDetails();
      inAutoDetails = true;
      dayHeadingLevel = dayHeadingMatch[1].length;
      const headingText = dayHeadingMatch[2].replace(/\*\*|__/g, '').trim();
      out.push('<details open>');
      out.push(`<summary><strong>${headingText}</strong></summary>`);
      continue;
    }

    if (inAutoDetails) {
      const headingMatch = line.match(headingRegex);
      if (headingMatch && dayHeadingLevel !== null && headingMatch[1].length <= dayHeadingLevel) {
        closeAutoDetails();
      }
    }

    const outputLine = inAutoDetails
      ? line.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1- ')
      : line;
    out.push(outputLine);
  }

  closeAutoDetails();
  return out.join('\n');
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
  onRequestMap?: () => void;
  onRegenerateItinerary?: () => void;
  onDeleteTrip?: () => Promise<void> | void;
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

export function ItineraryPane({
  tripId,
  credentials,
  markdown,
  onRefresh,
  onRequestMap,
  onRegenerateItinerary,
  onDeleteTrip,
  onCollapse,
  tripCreatedAt,
  tripUpdatedAt,
}: ItineraryPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [perTripEdits, setPerTripEdits] = useState<Record<string, { isEditing: boolean; draft: string }>>({});
  const [isSaving, setIsSaving] = useState(false);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    []
  );
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
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
    return dateTimeFormatter.format(d);
  }, [dateTimeFormatter, tripUpdatedAt]);

  const currentTripState = tripId ? perTripEdits[tripId] : undefined;
  const isEditing = currentTripState?.isEditing ?? false;
  const draft = currentTripState?.draft ?? markdown;

  useEffect(() => {
    if (!tripId || isEditing) return;
    setPerTripEdits((prev) => {
      const existing = prev[tripId];
      if (existing?.draft === markdown && existing?.isEditing === false) return prev;
      return { ...prev, [tripId]: { isEditing: false, draft: markdown } };
    });
  }, [isEditing, markdown, tripId]);

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
    setPerTripEdits((prev) => ({ ...prev, [tripId]: { isEditing: false, draft } }));
    onRefresh();
  };

  const handleDeleteTrip = async () => {
    if (!onDeleteTrip) return;
    setIsSaving(true);
    try {
      await onDeleteTrip();
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateMap = async () => {
    if (!onRequestMap) return;
    onRequestMap();
  };

  const handleCancelEdit = () => {
    if (!tripId) return;
    setPerTripEdits((prev) => ({ ...prev, [tripId]: { isEditing: false, draft: markdown } }));
  };

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
    return preprocessDetailsContent(normalizeDaySections(markdown));
  }, [markdown]);

  const renderHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    const Tag = `h${level}` as const;
    return ({ node, children, ...props }: any) => {
      return (
        <Tag {...props} className={`itinerary-heading ${props.className || ''}`.trim()}>
          <span>{children}</span>
        </Tag>
      );
    };
  };

  const renderListItem = ({ node, children, ...props }: any) => {
    return (
      <li {...props} className={`itinerary-list-item ${props.className || ''}`.trim()}>
        {children}
      </li>
    );
  };

  const renderDetails = ({ node, children, ...props }: any) => {
    const childrenArray = React.Children.toArray(children);
    return (
      <details {...props} className={`itinerary-details ${props.className || ''}`.trim()}>
        {childrenArray}
      </details>
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
            onClick={onRegenerateItinerary}
            disabled={!canInteract || isSaving || !onRegenerateItinerary}
            title="Regenerate itinerary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l1.7 4.9L19 8l-5.3 1.1L12 14l-1.7-4.9L5 8l5.3-1.1L12 2z" />
              <path d="M4 16l0.9 2.5L7 19l-2.1 0.5L4 22l-0.9-2.5L1 19l2.1-0.5L4 16z" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={handleGenerateMap}
            disabled={!canInteract || isSaving || !onRequestMap}
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
            onClick={() => {
              if (!tripId) return;
              setPerTripEdits((prev) => {
                const existing = prev[tripId];
                const nextIsEditing = !(existing?.isEditing ?? false);
                const nextDraft = existing?.draft ?? markdown;
                return { ...prev, [tripId]: { isEditing: nextIsEditing, draft: nextDraft } };
              });
            }}
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
          <button
            type="button"
            className="icon-btn"
            onClick={handleDeleteTrip}
            disabled={!canInteract || isSaving || !onDeleteTrip}
            title="Delete trip"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
          {isEditing && (
            <>
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={handleCancelEdit} disabled={!canInteract || isSaving}>
                Cancel
              </button>
              <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={handleSave} disabled={!canInteract || isSaving}>
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto px-4 py-4 relative"
        ref={scrollRef}
      >
        {isEditing ? (
          <textarea
            className="input-terminal w-full"
            value={draft}
            onChange={(e) => {
              if (!tripId) return;
              const nextDraft = e.target.value;
              setPerTripEdits((prev) => {
                const existing = prev[tripId];
                return { ...prev, [tripId]: { isEditing: existing?.isEditing ?? false, draft: nextDraft } };
              });
            }}
            style={{ minHeight: '100%', resize: 'none' }}
          />
        ) : (
          <div className="prose-terminal itinerary-prose">
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
                details: renderDetails,
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
