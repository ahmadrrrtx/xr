/**
 * XR — Native Google AI Provider (Gemini models)
 * 
 * Supports ALL Gemini models: 1.5 Flash, 1.5 Pro, 1.5 Ultra, 2.0, etc.
 * Direct API access with full tool-calling (function calling) support.
 * 
 * API Docs: https://ai.google.dev/gemini-api/docs
 * 
 * Cost: Free tier (15 req/min, 1500 req/day on Gemini 1.5 Flash!)
 *       Great for zero-cost setup.
 */
import type { Message, ModelTurn, Provider, Tool } from "../../core/types.ts";
import { repairToTurn } from "../../reliability/repair.ts";

interface GoogleOptions {
  model?: string;
  apiKeyEnv?: string;
}

// Gemini content format
interface GeminiContent {
  role?: string;
  parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> } }>;
}

export class GoogleProvider implements Provider {
  id = "google";
  label = "Google Gemini";
  private apiKey: string;
  private model: string;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  // Gemini model configs
  private static readonly MODELS: Record<string, { 
    supportsVision?: boolean;
    supportsFunctionCalling?: boolean;
    maxTokens?: number;
    isFreeTier?: boolean;
  }> = {
    "gemini-2.0-flash": { supportsVision: true, supportsFunctionCalling: true, maxTokens: 8192, isFreeTier: true },
    "gemini-1.5-flash": { supportsVision: true, supportsFunctionCalling: true, maxTokens: 8192, isFreeTier: true },
    "gemini-1.5-flash-8b": { supportsVision: true, supportsFunctionCalling: true, maxTokens: 8192, isFreeTier: true },
    "gemini-1.5-pro": { supportsVision: true, supportsFunctionCalling: true, maxTokens: 32768, isFreeTier: false },
    "gemini-pro": { supportsVision: false, supportsFunctionCalling: true, maxTokens: 30720 },
    "gemini-pro-vision": { supportsVision: true, supportsFunctionCalling: true, maxTokens: 4096 },
  };

  constructor(opts: GoogleOptions = {}) {
    const envKey = opts.apiKeyEnv ?? "GOOGLE_API_KEY";
    this.apiKey = process.env[envKey] ?? "";
    this.model = opts.model ?? "gemini-1.5-flash";
  }

  async chat(messages: Message[], tools: Tool[]): Promise<ModelTurn> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new Error(
        `Google API key not found. Set GOOGLE_API_KEY in your environment.\n` +
        `Get your key at: https://aistudio.google.com/app/apikey`
      );
    }

    // Convert messages to Gemini format
    const contents: GeminiContent[] = [];
    let systemInstruction = "";

    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction += msg.content + "\n";
        continue;
      }

      const role = msg.role === "assistant" ? "model" : "user";
      
      if (msg.role === "tool") {
        // Tool results become function responses
        const parts: GeminiContent["parts"] = [{
          functionResponse: {
            name: msg.name ?? "unknown_tool",
            response: { output: msg.content },
          },
        }];
        contents.push({ role: "user", parts });
      } else if (msg.role === "assistant") {
        // Parse JSON tool calls from assistant message
        try {
          const parsed = JSON.parse(msg.content);
          const parts: GeminiContent["parts"] = [];
          
          if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
            for (const tc of parsed.tool_calls) {
              parts.push({
                functionCall: {
                  name: tc.tool,
                  args: tc.args ?? {},
                },
              });
            }
          }
          
          if (parsed.message) {
            parts.push({ text: parsed.message });
          }
          
          if (parts.length > 0) {
            contents.push({ role: "model", parts });
          }
        } catch {
          // Plain text response
          if (msg.content.trim()) {
            contents.push({ role, parts: [{ text: msg.content }] });
          }
        }
      } else {
        // User message
        contents.push({ role, parts: [{ text: msg.content }] });
      }
    }

    // Build tool config for function calling
    const toolsConfig: any = tools.length > 0 ? {
      tools: [
        {
          functionDeclarations: tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: {
              type: "OBJECT",
              properties: t.parameters,
            },
          })),
        },
      ],
    } : undefined;

    // Build request body
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: 0.3,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
    };

    if (toolsConfig) {
      body.tools = toolsConfig.tools;
    }

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${apiKey}`;
    
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let detail = `HTTP ${res.status}: ${txt.slice(0, 300)}`;
        
        try {
          const err = JSON.parse(txt);
          if (err.error?.message) {
            detail = err.error.message;
          }
        } catch { /* use raw */ }
        
        throw new Error(`Google Gemini API error: ${detail}`);
      }

      const json: any = await res.json();
      const candidate = json.candidates?.[0];
      const content = candidate?.content?.parts ?? [];

      let message = "";
      const toolCalls: { tool: string; args: Record<string, unknown> }[] = [];

      for (const part of content) {
        if (part.text) {
          message += part.text;
        }
        if (part.functionCall) {
          toolCalls.push({
            tool: part.functionCall.name,
            args: part.functionCall.args ?? {},
          });
        }
      }

      // Usage info (Gemini provides token counts in response)
      const usage = json.usageMetadata ? {
        inTokens: json.usageMetadata.promptTokenCount ?? 0,
        outTokens: json.usageMetadata.candidatesTokenCount ?? 0,
      } : undefined;

      return {
        message,
        toolCalls,
        done: toolCalls.length === 0,
        usage,
      };
    } catch (e) {
      // Fall back to Vertex AI if configured
      const vertexProject = process.env.GCP_PROJECT_ID;
      const vertexLocation = process.env.GCP_LOCATION ?? "us-central1";
      
      if (vertexProject && (e as Error).message.includes("API key")) {
        // Retry with Vertex AI
        return this.chatVertexAI(messages, tools, vertexProject, vertexLocation);
      }
      
      throw e;
    }
  }

  // Vertex AI fallback for enterprise users
  private async chatVertexAI(
    messages: Message[],
    tools: Tool[],
    project: string,
    location: string
  ): Promise<ModelTurn> {
    const token = await this.getVertexToken();
    if (!token) throw new Error("Failed to get GCP authentication token");

    // Similar conversion as main chat, but use Vertex endpoint
    const contents: GeminiContent[] = [];
    
    for (const msg of messages) {
      if (msg.role === "system") continue;
      const role = msg.role === "assistant" ? "model" : "user";
      
      if (msg.role === "tool") {
        contents.push({
          role: "user",
          parts: [{
            functionResponse: {
              name: msg.name ?? "unknown",
              response: { output: msg.content },
            },
          }],
        });
      } else if (msg.role === "assistant") {
        try {
          const parsed = JSON.parse(msg.content);
          const parts: GeminiContent["parts"] = [];
          if (parsed.tool_calls) {
            for (const tc of parsed.tool_calls) {
              parts.push({
                functionCall: { name: tc.tool, args: tc.args ?? {} },
              });
            }
          }
          if (parsed.message) parts.push({ text: parsed.message });
          if (parts.length) contents.push({ role: "model", parts });
        } catch {
          if (msg.content.trim()) {
            contents.push({ role, parts: [{ text: msg.content }] });
          }
        }
      } else {
        contents.push({ role, parts: [{ text: msg.content }] });
      }
    }

    const toolsConfig: any = tools.length > 0 ? {
      tools: [{
        functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: { type: "OBJECT", properties: t.parameters },
        })),
      }],
    } : undefined;

    const body: Record<string, unknown> = {
      contents,
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    };
    if (toolsConfig) body.tools = toolsConfig.tools;

    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${this.model}:generateContent`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Vertex AI ${res.status}: ${txt.slice(0, 200)}`);
    }

    const json: any = await res.json();
    const content = json.candidates?.[0]?.content?.parts ?? [];
    
    let message = "";
    const toolCalls: { tool: string; args: Record<string, unknown> }[] = [];
    
    for (const part of content) {
      if (part.text) message += part.text;
      if (part.functionCall) {
        toolCalls.push({ tool: part.functionCall.name, args: part.functionCall.args ?? {} });
      }
    }

    return { message, toolCalls, done: toolCalls.length === 0 };
  }

  private async getVertexToken(): Promise<string | null> {
    try {
      const { runCommand } = await import("../../util/process.ts");
      const r = await runCommand("gcloud", ["auth", "print-access-token"], { timeoutMs: 10000 });
      const token = r.stdout.trim();
      return r.ok && token ? token : null;
    } catch {
      return null;
    }
  }

  async health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      return { ok: false, detail: "GOOGLE_API_KEY not set" };
    }

    const start = Date.now();
    try {
      const res = await fetch(
        `${this.baseUrl}/models?key=${apiKey}`,
        { method: "GET" }
      );

      const latency = Date.now() - start;
      
      if (res.ok) {
        const json: any = await res.json();
        const models = json.models?.map((m: any) => m.name.split("/").pop()) ?? [];
        return { 
          ok: true, 
          latencyMs: latency, 
          detail: `models: ${models.slice(0, 5).join(", ")}${models.length > 5 ? "..." : ""}` 
        };
      }
      
      return { ok: false, detail: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
