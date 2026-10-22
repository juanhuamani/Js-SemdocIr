// src/request.ts — one-representation generation request (F2.5).

import type { RepresentationArtifact } from './representations.ts';
import { loadProtocolConfig, type ProtocolConfig } from './protocol.ts';

/** A single input to a generation provider. */
export interface GenerationRequest {
  protocolVersion: string;
  clientMode: 'mock' | 'provider';
  provider: string | null;
  model: string | null;
  modelVersion: string | null;
  functionId: string;
  representation: RepresentationArtifact['representation'];
  prompt: string;
  input: string;
  parameters: {
    temperature: number;
    topP: string;
    maxTokens: number;
    seed: number | null;
  };
}

/**
 * Builds the shared prompt plus exactly one representation as a request.
 *
 * @param artifact - Selected representation artifact.
 * @param protocol - Validated protocol; the safe draft is loaded by default.
 * @returns A provider-independent request.
 */
export function buildGenerationRequest(
  artifact: RepresentationArtifact,
  protocol: ProtocolConfig = loadProtocolConfig(),
): GenerationRequest {
  return {
    protocolVersion: protocol.protocolVersion,
    clientMode: protocol.generation.clientMode,
    provider: protocol.generation.provider,
    model: protocol.generation.model,
    modelVersion: protocol.generation.modelVersion,
    functionId: artifact.functionId,
    representation: artifact.representation,
    prompt: protocol.prompt,
    input: artifact.content,
    parameters: {
      temperature: protocol.generation.temperature,
      topP: protocol.generation.topP,
      maxTokens: protocol.generation.maxTokens,
      seed: protocol.generation.seed,
    },
  };
}
