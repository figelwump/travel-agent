import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AssistantMessage as AssistantMessageType, ToolUseBlock, TextBlock, StructuredPrompt, ToolActivity } from './types';

interface AssistantMessageProps {
  message: AssistantMessageType;
  onSendMessage?: (message: StructuredPrompt | string) => void;
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

// Strip MCP server prefix from tool names for cleaner display
// e.g., "mcp__t__read_itinerary" -> "read_itinerary"
function cleanToolName(name: string): string {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    // mcp__servername__toolname -> toolname
    return parts.length >= 3 ? parts.slice(2).join('__') : name;
  }
  return name;
}

function ToolUseComponent({ toolUse, expanded }: { toolUse: ToolUseBlock; expanded?: boolean }) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = expanded ?? internalExpanded;
  const canToggle = expanded === undefined;
  const toolName = toolUse.name === 'Skill' && toolUse.input?.skill
    ? `Skill: ${toolUse.input.skill}`
    : cleanToolName(toolUse.name);

  const formatToolDisplay = () => {
    const input = toolUse.input;
    const name = cleanToolName(toolUse.name);

    switch(name) {
      case 'Read':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>File:</span>
              <code className="code-inline">{input.file_path}</code>
            </div>
            {input.offset && (
              <div className="flex items-center gap-2">
                <span className="mono-label" style={{ fontSize: '0.65rem' }}>Offset:</span>
                <span style={{ color: 'hsl(var(--text-secondary))' }}>{input.offset}</span>
              </div>
            )}
            {input.limit && (
              <div className="flex items-center gap-2">
                <span className="mono-label" style={{ fontSize: '0.65rem' }}>Limit:</span>
                <span style={{ color: 'hsl(var(--text-secondary))' }}>{input.limit} lines</span>
              </div>
            )}
          </div>
        );

      case 'Write':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>File:</span>
              <code className="code-inline">{input.file_path}</code>
            </div>
            <div>
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>Content:</span>
              <pre className="code-block p-2 mt-1" style={{ maxHeight: '120px', overflowY: 'auto' }}>
                {input.content.length > 500 ? input.content.substring(0, 500) + '...' : input.content}
              </pre>
            </div>
          </div>
        );

      case 'Edit':
      case 'MultiEdit':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>File:</span>
              <code className="code-inline">{input.file_path}</code>
            </div>
            {name === 'Edit' ? (
              <>
                {input.replace_all && (
                  <div
                    className="mono-label px-2 py-1 inline-block"
                    style={{
                      fontSize: '0.6rem',
                      background: 'hsl(var(--accent-muted) / 0.2)',
                      color: 'hsl(var(--accent-primary))'
                    }}
                  >
                    Replace all occurrences
                  </div>
                )}
                <div className="space-y-2">
                  <div>
                    <span className="mono-label" style={{ fontSize: '0.65rem', color: 'hsl(var(--error))' }}>
                      Remove:
                    </span>
                    <pre
                      className="p-2 mt-1 border"
                      style={{
                        background: 'hsl(var(--error) / 0.05)',
                        borderColor: 'hsl(var(--error) / 0.2)',
                        maxHeight: '80px',
                        overflowY: 'auto',
                        fontSize: '0.75rem'
                      }}
                    >
                      {input.old_string}
                    </pre>
                  </div>
                  <div>
                    <span className="mono-label" style={{ fontSize: '0.65rem', color: 'hsl(var(--success))' }}>
                      Add:
                    </span>
                    <pre
                      className="p-2 mt-1 border"
                      style={{
                        background: 'hsl(var(--success) / 0.05)',
                        borderColor: 'hsl(var(--success) / 0.2)',
                        maxHeight: '80px',
                        overflowY: 'auto',
                        fontSize: '0.75rem'
                      }}
                    >
                      {input.new_string}
                    </pre>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <span className="mono-label" style={{ fontSize: '0.65rem' }}>
                  {input.edits?.length || 0} edits
                </span>
                {input.edits?.slice(0, 3).map((edit: any, i: number) => (
                  <div
                    key={i}
                    className="pl-3 border-l-2"
                    style={{ borderColor: 'hsl(var(--border-medium))' }}
                  >
                    <div className="mono-label" style={{ fontSize: '0.6rem', color: 'hsl(var(--text-tertiary))' }}>
                      Edit {i + 1}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>
                      {edit.old_string.substring(0, 50)}{edit.old_string.length > 50 ? '...' : ''}
                    </div>
                  </div>
                ))}
                {input.edits?.length > 3 && (
                  <div className="mono-label pl-3" style={{ fontSize: '0.6rem', color: 'hsl(var(--text-tertiary))' }}>
                    ... and {input.edits.length - 3} more
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case 'Bash':
        return (
          <div className="space-y-2">
            {input.description && (
              <div style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.8rem' }}>
                {input.description}
              </div>
            )}
            <pre
              className="p-3"
              style={{
                background: 'hsl(220 20% 4%)',
                border: '1px solid hsl(var(--border-subtle))',
                color: 'hsl(var(--success))',
                fontSize: '0.8rem'
              }}
            >
              <span style={{ color: 'hsl(var(--accent-muted))', marginRight: '0.5rem' }}>$</span>
              {input.command}
            </pre>
            <div className="flex gap-3">
              {input.run_in_background && (
                <span
                  className="mono-label px-2 py-0.5"
                  style={{
                    fontSize: '0.6rem',
                    background: 'hsl(var(--info) / 0.1)',
                    color: 'hsl(var(--info))'
                  }}
                >
                  Background
                </span>
              )}
              {input.timeout && (
                <span className="mono-label" style={{ fontSize: '0.6rem' }}>
                  Timeout: {input.timeout}ms
                </span>
              )}
            </div>
          </div>
        );

      case 'Grep':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>Pattern:</span>
              <code
                className="px-2 py-0.5"
                style={{
                  background: 'hsl(var(--accent-primary) / 0.1)',
                  color: 'hsl(var(--accent-primary))',
                  fontSize: '0.8rem'
                }}
              >
                {input.pattern}
              </code>
            </div>
            {input.path && (
              <div className="flex items-center gap-2">
                <span className="mono-label" style={{ fontSize: '0.65rem' }}>Path:</span>
                <code className="code-inline">{input.path}</code>
              </div>
            )}
            {input.glob && (
              <div className="flex items-center gap-2">
                <span className="mono-label" style={{ fontSize: '0.65rem' }}>Glob:</span>
                <code className="code-inline">{input.glob}</code>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              {input['-i'] && (
                <span className="mono-label px-2 py-0.5" style={{ fontSize: '0.6rem', background: 'hsl(var(--bg-elevated))' }}>
                  case-insensitive
                </span>
              )}
              {input['-n'] && (
                <span className="mono-label px-2 py-0.5" style={{ fontSize: '0.6rem', background: 'hsl(var(--bg-elevated))' }}>
                  line-numbers
                </span>
              )}
              {input.multiline && (
                <span className="mono-label px-2 py-0.5" style={{ fontSize: '0.6rem', background: 'hsl(var(--bg-elevated))' }}>
                  multiline
                </span>
              )}
            </div>
          </div>
        );

      case 'Glob':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>Pattern:</span>
              <code className="code-inline">{input.pattern}</code>
            </div>
            {input.path && (
              <div className="flex items-center gap-2">
                <span className="mono-label" style={{ fontSize: '0.65rem' }}>Path:</span>
                <code className="code-inline">{input.path}</code>
              </div>
            )}
          </div>
        );

      case 'WebSearch':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>Query:</span>
              <span style={{ color: 'hsl(var(--text-primary))' }}>{input.query}</span>
            </div>
            {input.allowed_domains && input.allowed_domains.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="mono-label" style={{ fontSize: '0.65rem' }}>Domains:</span>
                <span style={{ color: 'hsl(var(--text-secondary))' }}>{input.allowed_domains.join(', ')}</span>
              </div>
            )}
          </div>
        );

      case 'WebFetch':
        return (
          <div className="space-y-2">
            <div>
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>URL:</span>
              <code className="code-inline block mt-1 break-all">{input.url}</code>
            </div>
            <div>
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>Prompt:</span>
              <div className="mt-1" style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.85rem' }}>
                {input.prompt}
              </div>
            </div>
          </div>
        );

      case 'Task':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>Agent:</span>
              <span
                className="px-2 py-0.5"
                style={{
                  background: 'hsl(var(--info) / 0.1)',
                  color: 'hsl(var(--info))',
                  fontSize: '0.8rem'
                }}
              >
                {input.subagent_type}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>Description:</span>
              <span style={{ color: 'hsl(var(--text-secondary))' }}>{input.description}</span>
            </div>
            <div>
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>Prompt:</span>
              <div
                className="mt-1 p-2 border"
                style={{
                  background: 'hsl(var(--bg-primary))',
                  borderColor: 'hsl(var(--border-subtle))',
                  maxHeight: '100px',
                  overflowY: 'auto',
                  fontSize: '0.8rem',
                  color: 'hsl(var(--text-secondary))'
                }}
              >
                {input.prompt}
              </div>
            </div>
          </div>
        );

      case 'TodoWrite':
        return (
          <div className="space-y-2">
            <div className="mono-label" style={{ fontSize: '0.65rem' }}>
              {input.todos?.length || 0} items
            </div>
            {input.todos?.map((todo: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <span
                  style={{
                    color: todo.status === 'completed' ? 'hsl(var(--success))' :
                           todo.status === 'in_progress' ? 'hsl(var(--accent-primary))' :
                           'hsl(var(--text-tertiary))'
                  }}
                >
                  {todo.status === 'completed' ? '[x]' :
                   todo.status === 'in_progress' ? '[>]' : '[ ]'}
                </span>
                <span
                  style={{
                    color: todo.status === 'completed' ? 'hsl(var(--text-tertiary))' : 'hsl(var(--text-secondary))',
                    textDecoration: todo.status === 'completed' ? 'line-through' : 'none',
                    fontSize: '0.85rem'
                  }}
                >
                  {todo.status === 'in_progress' ? todo.activeForm : todo.content}
                </span>
              </div>
            ))}
          </div>
        );

      case 'Skill':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>Skill:</span>
              <span
                className="px-2 py-1"
                style={{
                  background: 'hsl(var(--accent-primary) / 0.15)',
                  color: 'hsl(var(--accent-primary))',
                  fontSize: '0.85rem'
                }}
              >
                {input.skill}
              </span>
            </div>
            <div className="mono-label" style={{ fontSize: '0.65rem', color: 'hsl(var(--text-tertiary))', fontStyle: 'italic' }}>
              Executing skill workflow...
            </div>
          </div>
        );

      case 'NotebookEdit':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="mono-label" style={{ fontSize: '0.65rem' }}>Notebook:</span>
              <code className="code-inline">{input.notebook_path}</code>
            </div>
            <div className="flex gap-4">
              {input.cell_id && (
                <div className="flex items-center gap-2">
                  <span className="mono-label" style={{ fontSize: '0.65rem' }}>Cell:</span>
                  <code className="code-inline" style={{ fontSize: '0.7rem' }}>{input.cell_id}</code>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="mono-label" style={{ fontSize: '0.65rem' }}>Type:</span>
                <span style={{ color: 'hsl(var(--text-secondary))' }}>{input.cell_type || 'default'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="mono-label" style={{ fontSize: '0.65rem' }}>Mode:</span>
                <span style={{ color: 'hsl(var(--text-secondary))' }}>{input.edit_mode || 'replace'}</span>
              </div>
            </div>
          </div>
        );

      case 'ExitPlanMode':
        return (
          <div className="space-y-2">
            <span className="mono-label" style={{ fontSize: '0.65rem' }}>Plan:</span>
            <div
              className="p-3 border mt-1"
              style={{
                background: 'hsl(var(--info) / 0.05)',
                borderColor: 'hsl(var(--info) / 0.2)',
                maxHeight: '150px',
                overflowY: 'auto',
                fontSize: '0.85rem',
                color: 'hsl(var(--text-secondary))'
              }}
            >
              {input.plan}
            </div>
          </div>
        );

      default:
        return (
          <pre className="code-block p-3 whitespace-pre-wrap" style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {JSON.stringify(input, null, 2)}
          </pre>
        );
    }
  };

  return (
    <div className="tool-card mt-3">
      <div
        className="tool-card-header flex justify-between items-center cursor-pointer hover-glow"
        onClick={canToggle ? () => setInternalExpanded(!internalExpanded) : undefined}
        role={canToggle ? 'button' : undefined}
        tabIndex={canToggle ? 0 : undefined}
        onKeyDown={canToggle ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setInternalExpanded(!internalExpanded);
          }
        } : undefined}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: 'hsl(var(--accent-muted))' }}>{'>'}</span>
          <span className="mono-label" style={{ color: 'hsl(var(--text-secondary))' }}>
            {toolName}
          </span>
        </div>
        {canToggle && (
          <span className="mono-label" style={{ fontSize: '0.65rem', color: 'hsl(var(--text-tertiary))' }}>
            {isExpanded ? '[-]' : '[+]'}
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="p-3">
          {formatToolDisplay()}
        </div>
      )}
    </div>
  );
}

function TextComponent({ text }: { text: TextBlock }) {
  return (
    <div className="prose-terminal">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          code: (mdProps: any) => {
            const { inline, className, children, ...props } = mdProps || {};
            if (inline) {
              return <code className="code-inline" {...props}>{children}</code>;
            }
            // For block code, react-markdown wraps this in <pre>, so just return <code>
            return <code {...props}>{children}</code>;
          },
          pre: ({ node, ...props }) => (
            <pre className="code-block p-3" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol {...props} />
          ),
          p: ({ node, ...props }) => (
            <p {...props} />
          ),
        }}
      >
        {text.text}
      </ReactMarkdown>
    </div>
  );
}

export function AssistantMessage({ message }: AssistantMessageProps) {
  const [showMetadata, setShowMetadata] = useState(false);
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const isStreaming = message.metadata?.streaming;
  const toolActivity = Array.isArray(message.metadata?.toolActivity)
    ? message.metadata?.toolActivity as ToolActivity[]
    : [];
  const runningToolCount = toolActivity.filter(tool => tool.status === 'running').length;

  const formatToolLabel = (tool: ToolActivity) => {
    if (tool.name === 'Skill' && tool.input?.skill) {
      return `Skill: ${tool.input.skill}`;
    }
    return cleanToolName(tool.name) || 'Tool';
  };

  const formatToolSummary = (tool: ToolActivity) => {
    const input = tool.input ?? {};
    const truncate = (value: string, max = 72) => (
      value.length > max ? `${value.slice(0, max - 3)}...` : value
    );
    const name = cleanToolName(tool.name);

    switch (name) {
      case 'Skill':
        return input.skill ? `Run ${truncate(String(input.skill), 40)}` : 'Skill workflow';
      case 'Read':
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
      case 'NotebookEdit':
        return input.file_path ? truncate(String(input.file_path)) : 'File operation';
      case 'Bash':
        return input.command ? truncate(`$ ${String(input.command)}`) : 'Shell command';
      case 'WebFetch':
        return input.url ? truncate(String(input.url)) : 'Fetch URL';
      case 'WebSearch':
        return input.query ? truncate(String(input.query)) : 'Search query';
      case 'Glob':
      case 'Grep':
        return input.pattern ? truncate(String(input.pattern)) : 'Pattern match';
      case 'Task':
        return input.subagent_type ? `Agent: ${input.subagent_type}` : 'Sub-agent task';
      case 'TodoWrite':
        return input.todos ? `${input.todos.length} todos` : 'Todo update';
      // Trip tools
      case 'read_itinerary':
      case 'update_itinerary':
        return 'Itinerary';
      case 'read_context':
      case 'update_context':
        return 'Context';
      case 'toggle_todo':
        return input.lineNumber ? `Line ${input.lineNumber}` : 'Toggle checkbox';
      case 'complete_task':
        return input.summary ? truncate(String(input.summary), 50) : 'Task complete';
      default:
        return 'Working...';
    }
  };

  const formatToolDetails = (tool: ToolActivity) => {
    const toolUse: ToolUseBlock = {
      type: 'tool_use',
      id: tool.id,
      name: tool.name,
      input: tool.input ?? {},
    };
    return <ToolUseComponent toolUse={toolUse} expanded />;
  };

  return (
    <div className={`message-card message-assistant p-4 ${isStreaming ? 'animate-flicker' : ''}`}>
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2"
              style={{
                background: isStreaming ? 'hsl(var(--accent-primary))' : 'hsl(var(--text-tertiary))'
              }}
            />
            <span className="mono-label" style={{ color: 'hsl(var(--text-secondary))' }}>
              Agent
            </span>
          </div>
          {message.metadata?.model && (
            <span
              className="mono-label px-2 py-0.5"
              style={{
                fontSize: '0.6rem',
                background: 'hsl(var(--bg-tertiary))',
                color: 'hsl(var(--text-tertiary))'
              }}
            >
              {message.metadata.model}
            </span>
          )}
          {isStreaming && (
            <span className="typing-cursor mono-label" style={{ color: 'hsl(var(--accent-primary))' }}>
              streaming
            </span>
          )}
        </div>
        <span className="mono-label" style={{ fontSize: '0.65rem' }}>
          {formatTimestamp(message.timestamp)}
        </span>
      </div>

      <div className="space-y-3">
        {toolActivity.length > 0 && (
          <div className="tool-activity-panel">
            <div className="tool-activity-header">
              <span className="mono-label" style={{ color: 'hsl(var(--text-secondary))' }}>
                Tool activity
              </span>
              <span className="mono-label" style={{ color: 'hsl(var(--text-tertiary))' }}>
                {runningToolCount > 0 ? `${runningToolCount} running` : 'All complete'}
              </span>
            </div>
            <div className="tool-activity-list">
              {toolActivity.map((tool) => (
                <div
                  key={tool.id}
                  className={`tool-activity-item ${tool.status} ${expandedToolId === tool.id ? 'expanded' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedToolId === tool.id}
                  onClick={() => setExpandedToolId(prev => (prev === tool.id ? null : tool.id))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setExpandedToolId(prev => (prev === tool.id ? null : tool.id));
                    }
                  }}
                >
                  <div className="tool-activity-row">
                    <div className="tool-activity-name">
                      <span className={`tool-activity-dot ${tool.status}`} />
                      <span className="mono-label" style={{ color: 'hsl(var(--text-secondary))' }}>
                        {formatToolLabel(tool)}
                      </span>
                      <span className="tool-activity-summary">
                        {formatToolSummary(tool)}
                      </span>
                    </div>
                    <span
                      className={`tool-activity-status ${tool.status}`}
                      aria-label={tool.status === 'running' ? 'Running' : 'Complete'}
                      title={tool.status === 'running' ? 'Running' : 'Complete'}
                    >
                      {tool.status === 'running' ? (
                        'Running'
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 10l4 4 8-8" />
                        </svg>
                      )}
                    </span>
                  </div>
                  {expandedToolId === tool.id && (
                    <div className="tool-activity-details">
                      {formatToolDetails(tool)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {message.content.map((block, index) => {
          if (block.type === 'text') {
            return <TextComponent key={index} text={block} />;
          } else if (block.type === 'tool_use') {
            return <ToolUseComponent key={index} toolUse={block} />;
          }
          return null;
        })}
      </div>

      {message.metadata && Object.keys(message.metadata).length > 0 && !isStreaming && (
        <div className="mt-4 pt-3 border-t" style={{ borderColor: 'hsl(var(--border-subtle))' }}>
          <button
            onClick={() => setShowMetadata(!showMetadata)}
            className="mono-label hover-glow flex items-center gap-2"
            style={{ fontSize: '0.65rem' }}
          >
            <span style={{ color: 'hsl(var(--text-tertiary))' }}>
              {showMetadata ? '[-]' : '[+]'}
            </span>
            <span>metadata</span>
            {message.metadata.usage && (
              <span style={{ color: 'hsl(var(--text-tertiary))' }}>
                ({message.metadata.usage.input_tokens} in / {message.metadata.usage.output_tokens} out)
              </span>
            )}
          </button>

          {showMetadata && (
            <pre
              className="code-block p-3 mt-2 whitespace-pre-wrap"
              style={{ maxHeight: '200px', overflowY: 'auto' }}
            >
              {JSON.stringify(message.metadata, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
