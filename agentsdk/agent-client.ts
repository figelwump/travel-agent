import { query } from "@anthropic-ai/claude-agent-sdk";
import type { HookJSONOutput, SettingSource, SDKMessage, SDKUserMessage, AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import * as path from "path";
import { SANDBOX_SYSTEM_PROMPT } from "./system-prompt";

let warnedMissingApiKey = false;

function buildVenvEnv(baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(baseEnv ?? {}) };

  // Surface a clear warning when no API credential is present. On fresh
  // containers (e.g., Render), the SDK process otherwise dies with exit code 1
  // and only shows a generic error to the user.
  const hasApiKey = Boolean(env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN);
  if (!hasApiKey && !warnedMissingApiKey) {
    warnedMissingApiKey = true;
    console.warn("No Anthropic API key/token found. Set ANTHROPIC_API_KEY or a Claude Code OAuth token (CLAUDE_CODE_OAUTH_TOKEN) in the server environment before starting the agent.");
  }

  const projectRoot = process.cwd();
  const venvPath = path.join(projectRoot, '.venv');
  const binDir = path.join(venvPath, 'bin');

  const pathValue = env.PATH ?? '';
  const pathSegments = pathValue ? pathValue.split(':') : [];
  if (!pathSegments.includes(binDir)) {
    env.PATH = pathValue ? `${binDir}:${pathValue}` : binDir;
  }

  if (!env.VIRTUAL_ENV) {
    env.VIRTUAL_ENV = venvPath;
  }

  return env;
}

export interface AgentQueryOptions {
  maxTurns?: number;
  maxThinkingTokens?: number;
  cwd?: string;
  model?: string;
  includePartialMessages?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  tools?: string[] | { type: "preset"; preset: "claude_code" };
  mcpServers?: Record<string, any>;
  appendSystemPrompt?: string;
  allowedTripId?: string | null;
  hooks?: any;
  env?: NodeJS.ProcessEnv;
  settingSources?: SettingSource[];
  resume?: string;
  stderr?: (msg: string) => void;
  abortController?: AbortController;
  agents?: Record<string, AgentDefinition>;
}

export class AgentClient {
  private defaultOptions: AgentQueryOptions;
  private allowedTripId: string | null = null;
  private allowedToolSet: Set<string> | null = null;

  constructor(options?: Partial<AgentQueryOptions>) {
    this.defaultOptions = {
      maxTurns: 100,
      cwd: process.cwd(),
      model: "opus",
      maxThinkingTokens: 10000,
      includePartialMessages: true,
      allowedTools: [
        "Task", "WebFetch", "WebSearch", "Skill",
        // Trip tools (MCP server "entity-tools" prefixes them with mcp__entity-tools__)
        "mcp__entity-tools__read_itinerary", "mcp__entity-tools__update_itinerary",
        "mcp__entity-tools__generate_trip_map",
        "mcp__entity-tools__read_context", "mcp__entity-tools__update_context",
        "mcp__entity-tools__read_global_context", "mcp__entity-tools__update_global_context",
        "mcp__entity-tools__toggle_todo",
      ],
      tools: ["Task", "WebFetch", "WebSearch", "Skill"],
      agents: {
        research: {
          description: "Research venues, verify hours/prices, find official websites and booking links. Use for batch lookups of multiple venues.",
          prompt: `You are a travel research assistant. Your job is to verify information about venues, attractions, restaurants, and services.

For each item you research:
1. Find the official website
2. Verify current hours of operation
3. Find current pricing (admission, tickets, etc.)
4. Note any booking requirements or recommendations
5. Get the Google Maps link

Return your findings in a structured format that can be easily incorporated into an itinerary. Include source links for all facts.

If you cannot verify something, say so clearly rather than guessing.`,
          tools: ["WebSearch", "WebFetch"],
          model: "haiku",
        },
      },
      appendSystemPrompt: SANDBOX_SYSTEM_PROMPT,
      settingSources: ["project"], // Avoid user-level plugins/tools (e.g., browser MCP)
      stderr: (msg: string) => console.error("[claude-sdk]", msg.trim()),
      hooks: {
        PreToolUse: [
          {
            matcher: ".*",
            hooks: [
              async (input: any): Promise<HookJSONOutput> => {
                const toolName = input.tool_name;
                const allowedToolSet = this.allowedToolSet;
                if (!allowedToolSet || !toolName) {
                  return { continue: true };
                }
                if (allowedToolSet.has(toolName)) {
                  return { continue: true };
                }
                return {
                  decision: "block",
                  stopReason: `Tool ${toolName} is not allowed for this session. Use the trip tools only.`,
                  continue: false,
                };
              },
            ],
          },
          {
            matcher: "Write|Edit|MultiEdit",
            // Only allow file writes/edits to paths under ~/.travelagent for now.
            hooks: [
              async (input: any): Promise<HookJSONOutput> => {
                const toolName = input.tool_name;
                const toolInput = input.tool_input;

                if (!['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
                  return { continue: true };
                }

                // Normalize path (handle tilde or relative paths)
                let filePath = '';
                if (toolName === 'Write' || toolName === 'Edit') {
                  filePath = toolInput.file_path || '';
                } else if (toolName === 'MultiEdit') {
                  filePath = toolInput.file_path || '';
                }

                // Resolve home directory if ~ is used
                let homeDir = process.env.HOME || process.env.USERPROFILE || '';
                const normalizedSandboxPath = path.resolve(homeDir, '.travelagent');
                const allowedTripId = this.allowedTripId;
                const normalizedAllowedPath = allowedTripId
                  ? path.resolve(normalizedSandboxPath, 'trips', allowedTripId)
                  : normalizedSandboxPath;
                let normalizedFilePath: string;
                if (filePath.startsWith('~')) {
                  // Expand tilde to home directory
                  normalizedFilePath = path.resolve(homeDir, filePath.slice(1));
                } else {
                  normalizedFilePath = path.resolve(filePath);
                }

                const allowedRootMatch = normalizedFilePath === normalizedAllowedPath
                  || normalizedFilePath.startsWith(normalizedAllowedPath + path.sep);
                if (!allowedRootMatch) {
                  const scopeLabel = allowedTripId
                    ? `~/.travelagent/trips/${allowedTripId}`
                    : `~/.travelagent`;
                  return {
                    decision: 'block',
                    stopReason: `Writes and edits are only allowed inside ${scopeLabel}. Please use a path under: ${normalizedAllowedPath}/`,
                    continue: false
                  };
                }

                return { continue: true };
              }
            ]
          }
        ]
      },
      env: buildVenvEnv(options?.env),
      ...options
    };

    this.defaultOptions.env = buildVenvEnv(this.defaultOptions.env);
  }

  getDefaultModel(): string {
    return this.defaultOptions.model ?? "unknown";
  }

  async *queryStream(
    prompt: string | AsyncIterable<SDKUserMessage>,
    options?: Partial<AgentQueryOptions>
  ): AsyncIterable<SDKMessage> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    // If callers provide an extra system prompt (e.g., per-trip context), append it
    // to the base prompt rather than replacing it.
    const baseSystem = this.defaultOptions.appendSystemPrompt ?? "";
    const extraSystem = options?.appendSystemPrompt;
    mergedOptions.appendSystemPrompt = extraSystem ? `${baseSystem}\n\n${extraSystem}` : baseSystem;
    mergedOptions.env = buildVenvEnv(mergedOptions.env);
    mergedOptions.includePartialMessages = true;

    const previousAllowedTripId = this.allowedTripId;
    const previousAllowedToolSet = this.allowedToolSet;
    this.allowedTripId = mergedOptions.allowedTripId ?? null;
    this.allowedToolSet = mergedOptions.allowedTools ? new Set(mergedOptions.allowedTools) : null;
    try {
      for await (const message of query({
        prompt,
        options: mergedOptions
      })) {
        yield message;
      }
    } finally {
      this.allowedTripId = previousAllowedTripId;
      this.allowedToolSet = previousAllowedToolSet;
    }
  }

  async querySingle(prompt: string, options?: Partial<AgentQueryOptions>): Promise<{
    messages: SDKMessage[];
    cost: number;
    duration: number;
  }> {
    const messages: SDKMessage[] = [];
    let totalCost = 0;
    let duration = 0;

    for await (const message of this.queryStream(prompt, options)) {
      messages.push(message);

      if (message.type === "result" && message.subtype === "success") {
        totalCost = message.total_cost_usd;
        duration = message.duration_ms;
      }
    }

    return { messages, cost: totalCost, duration };
  }
}
