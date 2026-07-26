/**
 * XR 5.2.0 — Capability Interoperability Metadata
 *
 * Defines interfaces for plugin, skill, MCP, provider, tool, workflow,
 * integration, and artifact without collapsing execution semantics.
 */
import { CapabilityDescriptor } from "./types.ts";

export interface PluginInterfaceMeta {
  manifestPath?: string;
  entryPoint?: string;
  hooks?: string[];
  workerProtocol?: string;
  sandboxEnabled?: boolean;
}

export interface SkillInterfaceMeta {
  manifestPath?: string;
  instructionsFile?: string;
  commands?: string[];
  activation?: { phrases?: string[]; auto?: boolean };
  workflowReferences?: string[];
}

export interface McpInterfaceMeta {
  serverConfig?: any;
  transport?: string;
  enabled?: boolean;
  registeredTools?: string[];
  registeredResources?: string[];
}

export interface ProviderInterfaceMeta {
  presetId?: string;
  model?: string;
  capabilities?: string[];
  customConfig?: any;
}

export interface ToolInterfaceMeta {
  registryName?: string;
  requiresApproval?: boolean;
  dryRunSupported?: boolean;
  executionContext?: string[];
}

export interface WorkflowInterfaceMeta {
  definitionId?: string;
  definitionVersion?: number;
  nodeIds?: string[];
  parameterSchema?: any;
}

export interface IntegrationInterfaceMeta {
  adapterType?: string;
  endpoint?: string;
  authType?: string;
  registeredCapabilities?: string[];
}

export interface ArtifactInterfaceMeta {
  transformationType?: string;
  inputSchema?: string[];
  outputSchema?: string[];
  artifactContracts?: string[];
}

export function extractInteropDescriptor(desc: CapabilityDescriptor): CapabilityDescriptor {
  const interfaces = desc.interfaces ?? {};
  return {
    ...desc,
    interfaces: {
      plugin: interfaces.plugin || (desc.capabilityType === "plugin" ? { manifestPath: undefined } : undefined),
      skill: interfaces.skill || (desc.capabilityType === "skill" ? { manifestPath: undefined } : undefined),
      mcp: interfaces.mcp || (desc.capabilityType === "mcp" ? { serverConfig: undefined } : undefined),
      provider: interfaces.provider || (desc.capabilityType === "provider" ? { presetId: undefined } : undefined),
      tool: interfaces.tool || (desc.capabilityType === "tool" ? { registryName: undefined } : undefined),
      workflow: interfaces.workflow || (desc.capabilityType === "workflow" ? { definitionId: undefined } : undefined),
      integration: interfaces.integration || (desc.capabilityType === "integration" ? { adapterType: undefined } : undefined),
      artifact: interfaces.artifact || (desc.capabilityType === "artifact" ? { transformationType: undefined } : undefined),
    },
  };
}
