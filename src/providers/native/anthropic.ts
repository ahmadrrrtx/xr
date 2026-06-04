/**
 * XR — Native Anthropic Provider (Claude models)
 * 
 * Supports ALL Claude models: Sonnet, Opus, Haiku, 3.5, 3.7, etc.
 * Direct API access with full tool-calling support.
 * 
 * API Docs: https://docs.anthropic.com/en/api/messages
 * 
 * Cost: NOT free, but great quality. Use Groq/Ollama for zero-cost.
 */
import type { Message, ModelTurn, Provider, Tool } from "../../core/types.ts";
import { repairToTurn } from "../../reliability/repair.ts";

interface AnthropicOptions {
  model?: string;
  apiKeyEnv?: string;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
}

interface AnthropicContent {
  type: "text";
  text: string;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown> };
}

interface AnthropicToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

// Track pending tool use IDs for proper response mapping
const pendingToolUses: Map<string, { tool: string; args: Record<string, unknown> }> = new Map();
let toolCallCounter = 0;

export class AnthropicProvider implements Provider {
  id = "anthropic";
  label = "Anthropic Claude";
  private apiKey: string;
  private model: string;
  
  // Claude model capability profiles
  private static readonly MODELS: Record<string, { 
    supportsVision?: boolean; 
    maxTokens?: number;
    supportsPromptCache?: boolean;
  }> = {
    "claude-opus-4-5": { supportsVision: true, maxTokens: 8192, supportsPromptCache: true },
    "claude-sonnet-4-5": { supportsVision: true, maxTokens: 8192, supportsPromptCache: true },
    "claude-3-5-sonnet": { supportsVision: true, maxTokens: 8192, supportsPromptCache: true },
    "claude-3-5-haiku": { supportsVision: true, maxTokens: 8192 },
    "claude-3-opus": { supportsVision: true, maxTokens: 4096 },
    "claude-3-sonnet": { supportsVision: true, maxTokens: 4096 },
    "claude-3-haiku": { supportsVision: false, maxTokens: 4096 },
  };

  constructor(opts: AnthropicOptions = {}) {
    const envKey = opts.apiKeyEnv ?? "ANTHROPIC_API_KEY";
    this.apiKey = process.env[envKey] ?? "";
    this.model = opts.model ?? "claude-3-5-sonnet-20241022";
  }

  async chat(messages: Message[], tools: Tool[]): Promise<ModelTurn> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new Error(
        `Anthropic API key not found. Set ANTHROPIC_API_KEY in your environment.\n` +
        `Get your key at: https://console.anthropic.com/settings/keys`
      );
    }

    // Convert XR messages to Anthropic format
    const anthropicMessages: AnthropicMessage[] = [];
    const toolResults: AnthropicToolResult[] = [];
    
    for (const msg of messages) {
      if (msg.role === "system") {
        // Anthropic uses a separate system parameter
        continue;
      }
      
      if (msg.role === "tool") {
        // Tool results come as user messages with tool_use content
        const toolUseId = msg.name ?? "unknown";
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUseId,
          content: msg.content,
        });
      } else if (msg.role === "assistant") {
        // Parse assistant content - might include tool calls
        const content: AnthropicContent[] = [];
        
        // Check if this is a JSON tool call format
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
            // Assistant is making tool calls
            const calls: AnthropicContent[] = [];
            for (const tc of parsed.tool_calls) {
              const toolUseId = `toolu_${Date.now()}_${toolCallCounter++}`;
              pendingToolUses.set(toolUseId, { tool: tc.tool, args: tc.args ?? {} });
              calls.push({
                type: "tool_use",
                id: toolUseId,
                name: tc.tool,
                input: tc.args ?? {},
              });
            }
            content.push(...calls);
          } else if (parsed.message) {
            content.push({ type: "text", text: parsed.message });
          }
        } catch {
          // Plain text message
          content.push({ type: "text", text: msg.content });
        }
        
        if (content.length > 0) {
          anthropicMessages.push({ role: "assistant", content });
        }
      } else if (msg.role === "user") {
        // Check if this is a tool result (from our conversion)
        if (msg.content.startsWith("[tool_result:") || msg.content.startsWith("[tool:")) {
          const match = msg.content.match(/\[tool(?:_result)?:([^\]]+)\]/);
          if (match) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: match[1],
              content: msg.content.replace(/\[tool(?:_result)?:[^\]]+\]\s*/, ""),
            });
          }
        } else {
          anthropicMessages.push({ role: "user", content: msg.content });
        }
      }
    }

    // Append tool results as user messages
    for (const tr of toolResults) {
      anthropicMessages.push({ role: "user", content: [tr] as unknown as string });
    }

    // Build tools for Anthropic
    const anthropicTools: AnthropicTool[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object",
        properties: t.parameters,
      } as any,
    }));

    // Get system prompt
    const systemPrompt = this.buildSystemPrompt(tools);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: anthropicMessages,
      max_tokens: 1024,
      system: systemPrompt,
    };

    if (anthropicTools.length > 0) {
      body.tools = anthropicTools;
    }

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let detail = `HTTP ${res.status}: ${txt.slice(0, 300)}`;
        
        // Try to parse error for better messages
        try {
          const errJson = JSON.parse(txt);
          if (errJson.error?.type) {
            detail = `${errJson.error.type}: ${errJson.error.message}`;
          }
        } catch { /* use raw */ }
        
        throw new Error(`Anthropic API error: ${detail}`);
      }

      const json: any = await res.json();
      
      // Parse Anthropic response
      const assistantContent = json.content ?? [];
      let message = "";
      const toolCalls: { tool: string; args: Record<string, unknown> }[] = [];

      for (const block of assistantContent) {
        if (block.type === "text") {
          message += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            tool: block.name,
            args: block.input ?? {},
          });
        }
      }

      // Usage info
      const usage = json.usage ? {
        inTokens: json.usage.input_tokens ?? 0,
        outTokens: json.usage.output_tokens ?? 0,
      } : undefined;

      return {
        message,
        toolCalls,
        done: toolCalls.length === 0,
        usage,
      };
    } catch (e) {
      // Fall back to OpenAI-compatible endpoint if available
      if ((e as Error).message.includes("API key not found")) throw e;
      
      // Try OpenAI-compatible endpoint as fallback
      const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "";
      if (baseUrl) {
        return this.chatOpenAICompat(messages, tools, baseUrl, apiKey);
      }
      
      throw e;
    }
  }

  private buildSystemPrompt(tools: Tool[]): string {
    const toolDocs = tools
      .map((t) => `- ${t.name}: ${t.description}\n  params: ${JSON.stringify(t.parameters)}`)
      .join("\n");

    return [
      "You are XR, a careful, security-first AI agent built by @ahmadrrrtx.",
      "You are helpful, precise, and always prioritize user safety and privacy.",
      "",
      "When responding to user requests, think step by step and use tools when needed.",
      "Only use tools from this available list:",
      toolDocs || "(no tools available)",
      "",
      "Format your response as a JSON object with these fields:",
      '- "message": your reasoning/response to the user (string)',
      '- "tool_calls": array of tool calls to execute (array of {tool: string, args: object})',
      '- "done": true when task is complete, false if you need to use more tools (boolean)',
      "",
      "Example response (no tools):",
      '{"message": "I can help you with that. Let me explain...", "tool_calls": [], "done": true}',
      "",
      "Example response (with tool call):",
      '{"message": "Let me check the current directory contents.", "tool_calls": [{"tool": "shell", "args": {"command": "ls -la"}}], "done": false}',
    ].join("\n");
  }

  // OpenAI-compatible fallback for proxy services like LiteLLM
  private async chatOpenAICompat(
    messages: Message[], 
    tools: Tool[],
    baseUrl: string,
    apiKey: string
  ): Promise<ModelTurn> {
    const sys: Message = { role: "system", content: this.buildSystemPrompt(tools) };
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [sys, ...messages].map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: m.role === "tool" ? `[tool:${m.name}] ${m.content}` : m.content,
      })),
      temperature: 0,
    };

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Anthropic (compat) ${res.status}: ${txt.slice(0, 200)}`);
    }

    const json: any = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? "";
    const usage = json?.usage
      ? { inTokens: json.usage.prompt_tokens ?? 0, outTokens: json.usage.completion_tokens ?? 0 }
      : undefined;

    return { ...repairToTurn(content), usage };
  }

  async health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }> {
    const start = Date.now();
    const apiKey = this.apiKey;
    
    if (!apiKey) {
      return { ok: false, detail: "ANTHROPIC_API_KEY not set" };
    }

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });

      const latency = Date.now() - start;
      
      if (res.ok) {
        return { ok: true, latencyMs: latency, detail: `Claude ${this.model}` };
      }
      
      const txt = await res.text().catch(() => "");
      try {
        const err = JSON.parse(txt);
        return { ok: false, detail: err.error?.type ?? `HTTP ${res.status}` };
      } catch {
        return { ok: false, detail: `HTTP ${res.status}` };
      }
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
