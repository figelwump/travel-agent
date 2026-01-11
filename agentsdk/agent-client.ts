import { query } from "@anthropic-ai/claude-agent-sdk";
import type { HookJSONOutput, SettingSource, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
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
  cwd?: string;
  model?: string;
  includePartialMessages?: boolean;
  allowedTools?: string[];
  mcpServers?: Record<string, any>;
  appendSystemPrompt?: string;
  allowedTripId?: string | null;
  hooks?: any;
  env?: NodeJS.ProcessEnv;
  settingSources?: SettingSource[];
  resume?: string;
  stderr?: (msg: string) => void;
}

export class AgentClient {
  private defaultOptions: AgentQueryOptions;
  private allowedTripId: string | null = null;

  constructor(options?: Partial<AgentQueryOptions>) {
    this.defaultOptions = {
      maxTurns: 100,
      cwd: process.cwd(),
      model: "sonnet",
      includePartialMessages: true,
      allowedTools: [
        "Task", "Bash", "Glob", "Grep", "LS", "ExitPlanMode", "Read", "Edit", "MultiEdit", "Write", "NotebookEdit",
        "WebFetch", "TodoWrite", "WebSearch", "BashOutput", "KillBash",
        // Entity tools (MCP server "entity-tools" prefixes them with mcp__entity-tools__)
        "mcp__entity-tools__list_entity_types", "mcp__entity-tools__list_entities",
        "mcp__entity-tools__read_entity", "mcp__entity-tools__create_entity",
        "mcp__entity-tools__update_entity", "mcp__entity-tools__toggle_todo",
        "mcp__entity-tools__complete_task",
        "Skill",
      ],
      appendSystemPrompt: SANDBOX_SYSTEM_PROMPT,
      settingSources: ["project"], // Avoid user-level plugins/tools (e.g., browser MCP)
      stderr: (msg: string) => console.error("[claude-sdk]", msg.trim()),
      hooks: {
        PreToolUse: [
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
    this.allowedTripId = mergedOptions.allowedTripId ?? null;
    try {
      for await (const message of query({
        prompt,
        options: mergedOptions
      })) {
        yield message;
      }
    } finally {
      this.allowedTripId = previousAllowedTripId;
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
