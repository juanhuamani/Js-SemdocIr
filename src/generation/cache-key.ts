// src/generation/cache-key.ts — identity of one generation request (F2.6).

import { createHash } from 'node:crypto';

import type { GenerationRequest } from './request.ts';

/**
 * Builds a stable cache key from request identity and all generation inputs.
 * The input is represented by its SHA-256 hash to avoid embedding code in the
 * key while still invalidating cache entries when the representation changes.
 *
 * @param request - Fully assembled generation request.
 * @returns Lowercase SHA-256 cache key.
 */
export function createGenerationCacheKey(request: GenerationRequest): string {
  const keyMaterial = {
    functionId: request.functionId,
    representation: request.representation,
    clientMode: request.clientMode,
    provider: request.provider,
    model: request.model,
    modelVersion: request.modelVersion,
    protocolVersion: request.protocolVersion,
    prompt: request.prompt,
    parameters: request.parameters,
    inputHash: createHash('sha256').update(request.input, 'utf8').digest('hex'),
  };
  return createHash('sha256').update(JSON.stringify(keyMaterial), 'utf8').digest('hex');
}
