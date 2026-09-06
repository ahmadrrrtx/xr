/**
 * XR — Native AWS Bedrock Provider
 * 
 * Supports AWS Bedrock models via AWS SDK:
 * - Anthropic (Claude via Bedrock)
 * - Meta (Llama via Bedrock)
 * - Mistral AI (via Bedrock)
 * - AI21 (Jurassic via Bedrock)
 * - Cohere (via Bedrock)
 * - Amazon (Titan via Bedrock)
 * 
 * API Docs: https://docs.aws.amazon.com/bedrock/
 * 
 * Cost: AWS pricing (varies by model and region).
 *       Best for enterprise users with existing AWS infrastructure.
 *       No free tier, but has sustained-use discounts.
 */
import type { Message, ModelTurn, Provider, Tool, ChatOptions, ProviderStreamChunk } from "../../core/types.ts";
import { guardedRequest } from "../request-guard.ts";
import { normalizeProviderError } from "../errors.ts";
import { repairToTurn } from "../../reliability/repair.ts";
import { secretBrokerSync } from "../../security/secret-broker.ts";

interface BedrockOptions {
  model?: string;
  region?: string;
  // AWS credentials from environment or IAM role
  accessKeyIdEnv?: string;
  secretAccessKeyEnv?: string;
}

// Region-specific endpoints
const BEDROCK_ENDPOINTS: Record<string, string> = {
  "us-east-1": "bedrock-runtime.us-east-1",
  "us-west-2": "bedrock-runtime.us-west-2",
  "eu-west-1": "bedrock-runtime.eu-west-1",
  "ap-southeast-1": "bedrock-runtime.ap-southeast-1",
};

export class BedrockProvider implements Provider {
  id = "bedrock";
  label = "AWS Bedrock";
  private model: string;

  get modelId(): string {
    return this.model;
  }
  private region: string;
  private accessKey?: string;
  private secretKey?: string;
  private sessionToken?: string;

  // Model ID mapping (Bedrock model IDs are different from standard names)
  private static readonly MODEL_MAP: Record<string, { 
    provider: string; 
    id: string;
    supportsTools?: boolean;
  }> = {
    "claude-3-sonnet": { provider: "anthropic", id: "anthropic.claude-3-sonnet-20240229-v1:0", supportsTools: true },
    "claude-3-opus": { provider: "anthropic", id: "anthropic.claude-3-opus-20240229-v1:0", supportsTools: true },
    "claude-3-haiku": { provider: "anthropic", id: "anthropic.claude-3-haiku-20240307-v1:0", supportsTools: true },
    "claude-3.5-sonnet": { provider: "anthropic", id: "anthropic.claude-3-5-sonnet-20241022-v1:0", supportsTools: true },
    "llama-3-70b": { provider: "meta", id: "meta.llama3-70b-instruct-v1:0", supportsTools: false },
    "llama-3-8b": { provider: "meta", id: "meta.llama3-8b-instruct-v1:0", supportsTools: false },
    "mistral-large": { provider: "mistral", id: "mistral.mistral-large-2407-v1:0", supportsTools: false },
    "mistral-7b": { provider: "mistral", id: "mistral.mistral-7b-instruct-v0:2", supportsTools: false },
    "titan-text": { provider: "amazon", id: "amazon.titan-text-premier-v1:0", supportsTools: false },
    "jurassic-2": { provider: "ai21", id: "ai21.j2-ultra-v1", supportsTools: false },
    "command-r": { provider: "cohere", id: "cohere.command-r-v1:0", supportsTools: true },
    "command-r-plus": { provider: "cohere", id: "cohere.command-r-plus-v1:0", supportsTools: true },
  };

  constructor(opts: BedrockOptions = {}) {
    this.model = opts.model ?? "claude-3-sonnet";
    this.region = opts.region ?? process.env.AWS_REGION ?? "us-east-1";
    
    const akEnv = opts.accessKeyIdEnv ?? "AWS_ACCESS_KEY_ID";
    const skEnv = opts.secretAccessKeyEnv ?? "AWS_SECRET_ACCESS_KEY";
    
    // Phase 8 · F-24 — resolved through the broker (durable store first, then
    // ambient) rather than read straight from process.env. Bedrock is the one
    // provider that legitimately CACHES credentials on the instance: STS
    // rotation rewrites accessKey/secretKey mid-session (see getSTSToken), so
    // a per-request callback would discard the refreshed pair. The broker is
    // still the single resolution path.
    this.accessKey = secretBrokerSync(akEnv);
    this.secretKey = secretBrokerSync(skEnv);
    this.sessionToken = secretBrokerSync("AWS_SESSION_TOKEN");
  }

  private async getAuthToken(): Promise<string> {
    // If we have explicit credentials, use them
    if (this.accessKey && this.secretKey) {
      return this.signRequest();
    }

    // Try to get token from STS (for IAM roles)
    try {
      const { runCommand } = await import("../../util/process.ts");
      const credsRes = await runCommand("aws", ["sts", "get-caller-identity", "--query", "Arn", "--output", "text"], { timeoutMs: 5000 });
      const creds = credsRes.stdout.trim();
      if (credsRes.ok && creds) {
        const tokenRes = await this.getSTSToken();
        if (tokenRes) return tokenRes;
      }
    } catch { /* not authenticated via AWS CLI */ }

    // Try environment variable token approach
    if (process.env.AWS_WEB_IDENTITY_TOKEN_FILE) {
      const token = await this.getWebIdentityToken();
      if (token) return token;
    }

    throw new Error(
      `AWS credentials not found. Set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY, \n` +
      `or use 'aws configure' to set up AWS CLI credentials, \n` +
      `or use an EC2/ECS IAM role.`
    );
  }

  private signRequest(): string {
    // Simple signature - in production you'd use AWS SDK or sigv4
    // For now, we'll use the AWS SDK if available
    try {
      const { SignatureV4 } = require("@aws-sdk/signature-v4");
      const { Hash } = require("@aws-sdk/hash-node");
      const sig = new SignatureV4({
        service: "bedrock",
        region: this.region,
        credentials: {
          accessKeyId: this.accessKey!,
          secretAccessKey: this.secretKey!,
        },
        sha256: Hash.bind(null, "sha256"),
      });
      return "signed"; // Placeholder - actual signing is complex
    } catch {
      // Fall back to basic auth for testing
      const creds = Buffer.from(`${this.accessKey}:${this.secretKey}`).toString("base64");
      return `Basic ${creds}`;
    }
  }

  private async getSTSToken(): Promise<string | null> {
    try {
      const { runCommand } = await import("../../util/process.ts");
      const roleArn = process.env.AWS_ROLE_ARN ?? "";
      if (!roleArn) return null;
      const result = await runCommand("aws", ["sts", "assume-role", "--role-arn", roleArn, "--role-session-name", "xr-agent"], { timeoutMs: 10000 });
      if (!result.ok) return null;
      const json = JSON.parse(result.stdout);
      this.accessKey = json.Credentials?.AccessKeyId;
      this.secretKey = json.Credentials?.SecretAccessKey;
      this.sessionToken = json.Credentials?.SessionToken;
      return this.signRequest();
    } catch {
      return null;
    }
  }

  private async getWebIdentityToken(): Promise<string | null> {
    try {
      const { readFileSync } = await import("node:fs");
      const token = readFileSync(process.env.AWS_WEB_IDENTITY_TOKEN_FILE!, "utf8").trim();
      return token;
    } catch {
      return null;
    }
  }

  private getBedrockModelId(): string {
    const mapped = BedrockProvider.MODEL_MAP[this.model.toLowerCase()];
    if (mapped) return mapped.id;
    
    // If not in map, try to construct
    // For Claude via Bedrock
    if (this.model.toLowerCase().includes("claude")) {
      return `anthropic.${this.model.toLowerCase().replace(/\./g, "-").replace(/claude-/g, "claude-")}-v1:0`;
    }
    
    return this.model;
  }

  async chat(messages: Message[], tools: Tool[], options?: ChatOptions): Promise<ModelTurn> {
    const token = await this.getAuthToken();
    const modelId = this.getBedrockModelId();
    const bedrockModel = BedrockProvider.MODEL_MAP[this.model.toLowerCase()];
    
    // Build request body based on model provider
    let body: Record<string, unknown>;
    let endpoint: string;

    if (bedrockModel?.provider === "anthropic" || modelId.includes("anthropic")) {
      body = this.buildAnthropicBody(messages, tools);
      endpoint = `https://bedrock-runtime.${this.region}/model/anthropic.${modelId.split(".")[1]}/invoke`;
    } else if (bedrockModel?.provider === "meta" || modelId.includes("meta")) {
      body = this.buildLlamaBody(messages);
      endpoint = `https://bedrock-runtime.${this.region}/model/${modelId}/invoke`;
    } else if (bedrockModel?.provider === "mistral" || modelId.includes("mistral")) {
      body = this.buildMistralBody(messages);
      endpoint = `https://bedrock-runtime.${this.region}/model/${modelId}/invoke`;
    } else {
      // Default: try Claude format
      body = this.buildAnthropicBody(messages, tools);
      endpoint = `https://bedrock-runtime.${this.region}/model/${modelId}/invoke`;
    }

    try {
      const signedHeaders = await this.signRequest();
      
      // GAP-001 — bounded + cancellable (was: no signal, no timeout).
      const res = await guardedRequest(this.id, options, (signal) =>
        fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": signedHeaders,
            "X-Amz-Date": new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z",
            ...(this.sessionToken ? { "X-Amz-Security-Token": this.sessionToken } : {}),
          },
          body: JSON.stringify(body),
          signal,
        }),
      );

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Bedrock ${res.status}: ${txt.slice(0, 200)}`);
      }

      const json: any = await res.json();
      
      // Parse response based on model type
      if (bedrockModel?.provider === "anthropic") {
        return this.parseAnthropicResponse(json);
      } else if (bedrockModel?.provider === "meta") {
        return this.parseLlamaResponse(json);
      } else if (bedrockModel?.provider === "mistral") {
        return this.parseMistralResponse(json);
      }

      return repairToTurn(JSON.stringify(json));
    } catch (e) {
      throw e;
    }
  }

  private buildAnthropicBody(messages: Message[], tools: Tool[]): Record<string, unknown> {
    const anthropicMsgs: Array<{ role: string; content: string | Array<unknown> }> = [];
    
    for (const msg of messages) {
      if (msg.role === "system") continue;
      
      if (msg.role === "tool") {
        anthropicMsgs.push({
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: msg.name ?? "unknown",
            content: msg.content,
          }],
        });
      } else if (msg.role === "assistant") {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.tool_calls) {
            const content: Array<unknown> = [];
            if (parsed.message) content.push({ type: "text", text: parsed.message });
            for (const tc of parsed.tool_calls) {
              content.push({ type: "tool_use", id: `toolu_${Date.now()}`, name: tc.tool, input: tc.args ?? {} });
            }
            anthropicMsgs.push({ role: "assistant", content });
          } else {
            anthropicMsgs.push({ role: "assistant", content: parsed.message ?? msg.content });
          }
        } catch {
          anthropicMsgs.push({ role: "assistant", content: msg.content });
        }
      } else {
        anthropicMsgs.push({ role: msg.role, content: msg.content });
      }
    }

    const toolsList = tools.length > 0 ? tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: { type: "object", properties: t.parameters },
    })) : undefined;

    return {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1024,
      messages: anthropicMsgs,
      ...(toolsList ? { tools: toolsList } : {}),
    };
  }

  private buildLlamaBody(messages: Message[]): Record<string, unknown> {
    // Llama via Bedrock uses a different format
    const prompt = messages.map(m => {
      if (m.role === "system") return `<|begin_of_text|>system\n${m.content}`;
      if (m.role === "user") return `<|start_header_id|>user<|end_header_id|>\n${m.content}`;
      if (m.role === "assistant") return `<|start_header_id|>assistant<|end_header_id|>\n${m.content}`;
      return m.content;
    }).join("<|eot_id|>");

    return {
      prompt: `<|begin_of_text|>${prompt}<|start_header_id|>assistant<|end_header_id|>\n`,
      max_gen_len: 1024,
      temperature: 0.3,
      top_p: 0.9,
    };
  }

  private buildMistralBody(messages: Message[]): Record<string, unknown> {
    const mistralMessages: Array<{ role: string; content: string }> = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        mistralMessages.push({ role: "system", content: msg.content });
      } else if (msg.role === "tool") {
        mistralMessages.push({ role: "user", content: `[tool:${msg.name}] ${msg.content}` });
      } else {
        mistralMessages.push({ role: msg.role, content: msg.content });
      }
    }

    return {
      prompt: mistralMessages.map(m => `<s>[INST] ${m.content} [/INST]`).join(""),
      max_tokens: 1024,
      temperature: 0.3,
    };
  }

  private parseAnthropicResponse(json: any): ModelTurn {
    const content = json.content?.[0] ?? {};
    let message = content.text ?? "";
    const toolCalls: { tool: string; args: Record<string, unknown> }[] = [];

    if (content.type === "tool_use" && content.name) {
      toolCalls.push({ tool: content.name, args: content.input ?? {} });
    }

    return {
      message,
      toolCalls,
      done: toolCalls.length === 0,
      usage: json.usage ? { inTokens: json.usage.input_tokens, outTokens: json.usage.output_tokens } : undefined,
    };
  }

  private parseLlamaResponse(json: any): ModelTurn {
    const completion = json.generation ?? json.outputs?.[0]?.text ?? "";
    return repairToTurn(completion);
  }

  private parseMistralResponse(json: any): ModelTurn {
    const outputs = json.outputs ?? [];
    const completion = outputs.map((o: any) => o.text ?? o.generation ?? "").join("");
    return repairToTurn(completion);
  }

  async *chatStream(
    messages: import("../../core/types.ts").Message[],
    tools: import("../../core/types.ts").Tool[],
    options?: import("../../core/types.ts").ChatOptions,
  ): AsyncGenerator<ProviderStreamChunk> {
    try {
      const turn = await this.chat(messages, tools, options);
      if (turn.message) {
        yield { text: turn.message, providerId: this.id, model: this.model };
      }
      for (const tc of turn.toolCalls ?? []) {
        yield { toolCall: { tool: tc.tool, args: tc.args }, providerId: this.id, model: this.model };
      }
      yield { usage: turn.usage, finish: true, providerId: this.id, model: this.model };
    } catch (e) {
      throw normalizeProviderError(e, this.id, this.model);
    }
  }

  
  async health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }> {
    if (!this.accessKey && !process.env.AWS_WEB_IDENTITY_TOKEN_FILE) {
      // Check if AWS CLI is configured
      try {
        const { runCommand } = await import("../../util/process.ts");
        const r = await runCommand("aws", ["sts", "get-caller-identity"], { timeoutMs: 5000 });
        if (r.ok) return { ok: true, detail: `region: ${this.region} (IAM role)` };
        return { ok: false, detail: "AWS credentials not configured" };
      } catch {
        return { ok: false, detail: "AWS credentials not configured" };
      }
    }

    return { ok: true, detail: `region: ${this.region}` };
  }
}
